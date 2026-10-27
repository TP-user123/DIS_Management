import { Router } from 'express';
import { Event, User, Notification } from '../models.js';
import { auth, asyncHandler, requirePermission } from '../middleware.js';

const router = Router();
router.use(auth, requirePermission('events:view'));

const validDateKey = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const datePart = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};
const buildOccurrenceDates = (startsAt, endsAt) => {
  const first = datePart(startsAt);
  const last = datePart(endsAt || startsAt);
  if (!validDateKey(first) || !validDateKey(last) || last < first) return [];
  const dates = [];
  const cursor = new Date(`${first}T00:00:00.000Z`);
  const end = new Date(`${last}T00:00:00.000Z`);
  while (cursor <= end && dates.length < 366) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cursor <= end ? [] : dates;
};
const isEventAttendee = (event, user) => event.audience === 'USER'
  ? event.assignedUserIds.some((id) => String(id) === String(user._id))
  : event.team === user.team;

// GET /api/events
router.get('/', asyncHandler(async (req, res) => {
  const events = await Event.find({ companyId: req.companyId }).sort({ startsAt: 1 }).lean();
  const teamNames = [...new Set(events.filter((event) => event.audience === 'TEAM').map((event) => event.team).filter(Boolean))];
  const teamMembers = teamNames.length
    ? await User.find({ companyId: req.companyId, status: 'active', team: { $in: teamNames } }).select('_id team').lean()
    : [];
  const teamMemberIdsByTeam = new Map();
  teamMembers.forEach((member) => {
    const idsForTeam = teamMemberIdsByTeam.get(member.team) || [];
    idsForTeam.push(member._id);
    teamMemberIdsByTeam.set(member.team, idsForTeam);
  });
  const eventAssigneeIds = (event) => event.audience === 'USER'
    ? (event.assignedUserIds || [])
    : (teamMemberIdsByTeam.get(event.team) || []);
  const ids = [...new Set(events.flatMap((event) => [event.createdBy, ...eventAssigneeIds(event)]).map(String))];
  const users = await User.find({ _id: { $in: ids }, companyId: req.companyId }).select('name role team').lean();
  const map = Object.fromEntries(users.map(u => [String(u._id), u]));
  const includeTeamStatus = ['MANAGER', 'TL', 'SL'].includes(req.user.role);

  res.json(events.map((event) => {
    const { occurrenceUpdates = [], ...eventData } = event;
    const assigneeIds = eventAssigneeIds(event);
    const occurrenceDateKeys = event.occurrenceDates?.length
      ? event.occurrenceDates
      : buildOccurrenceDates(event.startsAt, event.endsAt || event.startsAt);
    const legacyCompletedIds = new Set((event.completedByIds || []).map(String));
    const occurrenceStatusByUserDate = new Map(occurrenceUpdates.map((update) => [
      `${String(update.userId)}:${update.dateKey}`,
      update.status
    ]));
    const occurrenceSummaries = includeTeamStatus
      ? occurrenceDateKeys.map((dateKey) => {
        const counts = { dateKey, total: assigneeIds.length, done: 0, pending: 0, cancelled: 0, postponed: 0 };
        assigneeIds.forEach((userId) => {
          const status = occurrenceStatusByUserDate.get(`${String(userId)}:${dateKey}`)
            || (legacyCompletedIds.has(String(userId)) ? 'DONE' : 'PENDING');
          if (status === 'DONE') counts.done += 1;
          else if (status === 'CANCELLED') counts.cancelled += 1;
          else if (status === 'POSTPONED') counts.postponed += 1;
          else counts.pending += 1;
        });
        return counts;
      })
      : undefined;

    return {
      ...eventData,
      ...(includeTeamStatus ? { occurrenceUpdates, occurrenceSummaries } : {}),
      myOccurrenceUpdates: occurrenceUpdates.filter((update) => String(update.userId) === String(req.user._id)),
      creator: map[String(event.createdBy)] || null,
      assignees: assigneeIds.map((id) => map[String(id)]).filter(Boolean)
    };
  }));
}));

// POST /api/events - Create event with multi-user assignment across all roles
router.post('/', requirePermission('events:manage'), asyncHandler(async (req, res) => {
  const { title, description, startsAt, endsAt, location, audience, team, assignedUserIds = [] } = req.body;

  if (!title?.trim() || !startsAt) {
    return res.status(400).json({ message: 'Event title and start date/time are required.' });
  }

  const startDate = new Date(startsAt);
  const endDate = endsAt ? new Date(endsAt) : null;
  const occurrenceDates = buildOccurrenceDates(startsAt, endsAt || startsAt);
  if (Number.isNaN(startDate.getTime()) || (endDate && (Number.isNaN(endDate.getTime()) || endDate < startDate)) || !occurrenceDates.length) {
    return res.status(400).json({ message: 'Choose a valid event date range of no more than 366 days.' });
  }

  const targetIds = [];
  if (audience === 'USER') {
    for (const id of assignedUserIds) {
      const u = await User.findOne({ _id: id, companyId: req.companyId, status: 'active' });
      if (u) targetIds.push(u._id);
    }
    if (!targetIds.length) {
      return res.status(400).json({ message: 'Choose at least one team member (RE, SL, TL, or Manager) for this event.' });
    }
  }

  const ev = await Event.create({
    companyId: req.companyId,
    title: title.trim(),
    description: description || '',
    startsAt: startDate,
    endsAt: endDate,
    occurrenceDates,
    location: location || '',
    audience: audience === 'USER' ? 'USER' : 'TEAM',
    team: team || req.user.team || 'IT Support',
    assignedUserIds: targetIds,
    createdBy: req.user._id
  });

  const recipients = ev.audience === 'USER'
    ? targetIds
    : await User.find({ companyId: req.companyId, status: 'active', team: ev.team }).distinct('_id');

  for (const id of recipients) {
    try {
      await Notification.create({
        companyId: req.companyId,
        userId: id,
        type: 'EVENT',
        title: 'Added to Event',
        message: `You have been added to the event: "${ev.title}". Starts: ${new Date(ev.startsAt).toLocaleString()}`,
        link: '/events',
        dedupeKey: `event-${ev._id}-${id}`
      });
    } catch {}
  }

  res.status(201).json(ev);
}));

// PATCH /api/events/:id/occurrences/:dateKey - Update one attendee's event date only
router.patch('/:id/occurrences/:dateKey', asyncHandler(async (req, res) => {
  const { dateKey } = req.params;
  const { action, postponedTo } = req.body;
  if (!validDateKey(dateKey)) return res.status(400).json({ message: 'Event occurrence date is invalid.' });
  if (!['DONE', 'CANCEL', 'POSTPONE'].includes(action)) return res.status(400).json({ message: 'Choose Done, Cancel, or Postpone.' });

  const event = await Event.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  if (!isEventAttendee(event, req.user)) {
    return res.status(403).json({ message: 'Only an assigned attendee can update this event date.' });
  }

  if (action === 'POSTPONE' && (!validDateKey(postponedTo) || postponedTo <= dateKey)) {
    return res.status(400).json({ message: 'Choose a later date to postpone this occurrence.' });
  }

  const userId = String(req.user._id);
  const current = event.occurrenceUpdates.find((update) => String(update.userId) === userId && update.dateKey === dateKey);
  if (current && current.status !== 'PENDING') {
    return res.status(409).json({ message: 'This event date has already been updated.' });
  }
  const postponedOccurrence = action === 'POSTPONE'
    ? event.occurrenceUpdates.find((update) => String(update.userId) === userId && update.dateKey === postponedTo)
    : null;
  if (postponedOccurrence && postponedOccurrence.status !== 'PENDING') {
    return res.status(409).json({ message: 'That date already has a completed or cancelled event occurrence.' });
  }

  if (action === 'DONE') {
    const endTimeSource = event.endsAt || event.startsAt;
    const dueAt = new Date(`${dateKey}T${String(endTimeSource.getUTCHours()).padStart(2, '0')}:${String(endTimeSource.getUTCMinutes()).padStart(2, '0')}:00.000Z`);
    if (dueAt > Date.now()) return res.status(400).json({ message: 'This event date can be marked done after its scheduled end time.' });
  }

  const status = action === 'DONE' ? 'DONE' : action === 'CANCEL' ? 'CANCELLED' : 'POSTPONED';
  const updateValues = {
    userId: req.user._id,
    dateKey,
    status,
    postponedTo: action === 'POSTPONE' ? postponedTo : '',
    additional: !event.occurrenceDates.includes(dateKey),
    updatedAt: new Date()
  };
  if (current) Object.assign(current, updateValues);
  else event.occurrenceUpdates.push(updateValues);

  if (action === 'POSTPONE') {
    if (!postponedOccurrence) {
      event.occurrenceUpdates.push({
        userId: req.user._id,
        dateKey: postponedTo,
        status: 'PENDING',
        additional: !event.occurrenceDates.includes(postponedTo),
        updatedAt: new Date()
      });
    }
  }

  await event.save();
  res.json({ message: 'Event date updated.', event });
}));

// PATCH /api/events/:id/complete - Record completion for the current attendee only
router.patch('/:id/complete', asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!event) return res.status(404).json({ message: 'Event not found.' });

  const isAssigned = isEventAttendee(event, req.user);
  if (!isAssigned) return res.status(403).json({ message: 'Only an assigned attendee can mark this event as complete.' });

  const scheduledEnd = new Date(event.endsAt || event.startsAt).getTime();
  if (scheduledEnd > Date.now()) {
    return res.status(400).json({ message: 'This event can be marked complete after its scheduled end time.' });
  }

  event.completedByIds.addToSet(req.user._id);
  await event.save();
  res.json({ message: 'Event marked as complete.', event });
}));

// PATCH /api/events/:id - Update event details & assigned users
router.patch('/:id', requirePermission('events:manage'), asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!event) return res.status(404).json({ message: 'Event not found.' });

  const isCreator = String(event.createdBy) === String(req.user._id);
  const isManager = req.user.role === 'MANAGER';
  if (!isCreator && !isManager) {
    return res.status(403).json({ message: 'Only the creator of this event or a Manager can modify it.' });
  }

  const { title, description, startsAt, endsAt, location, audience, team, assignedUserIds } = req.body;

  // Completed / concluded events are locked to preserve attendance records
  const isPast = new Date(event.endsAt || event.startsAt).getTime() < Date.now();
  if (isPast && assignedUserIds !== undefined) {
    return res.status(400).json({ message: 'Concluded events are locked and attendees cannot be reassigned.' });
  }

  if (title !== undefined) {
    if (!String(title).trim()) return res.status(400).json({ message: 'Event title is required.' });
    event.title = String(title).trim();
  }
  if (description !== undefined) event.description = String(description);
  if (startsAt !== undefined) {
    const d = new Date(startsAt);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Start date/time is invalid.' });
    event.startsAt = d;
  }
  if (endsAt !== undefined) {
    const d = endsAt ? new Date(endsAt) : null;
    if (d && Number.isNaN(d.getTime())) return res.status(400).json({ message: 'End date/time is invalid.' });
    if (d && d < event.startsAt) return res.status(400).json({ message: 'End date/time must be after the event start.' });
    event.endsAt = d;
  }
  if (startsAt !== undefined || endsAt !== undefined) {
    const firstDate = startsAt !== undefined
      ? datePart(startsAt)
      : event.occurrenceDates[0] || datePart(event.startsAt);
    const lastDate = endsAt !== undefined
      ? datePart(endsAt || firstDate)
      : event.occurrenceDates.at(-1) || datePart(event.endsAt || event.startsAt);
    const occurrenceDates = buildOccurrenceDates(firstDate, lastDate);
    if (!occurrenceDates.length) return res.status(400).json({ message: 'Choose a valid event date range of no more than 366 days.' });
    event.occurrenceDates = occurrenceDates;
  }
  if (location !== undefined) event.location = String(location);
  if (team !== undefined) event.team = String(team);
  if (audience !== undefined) event.audience = audience === 'USER' ? 'USER' : 'TEAM';

  if (assignedUserIds !== undefined) {
    const users = await User.find({ companyId: req.companyId, status: 'active', _id: { $in: assignedUserIds } }).select('_id').lean();
    event.assignedUserIds = users.map(u => u._id);
  }

  if (event.audience === 'USER' && !event.assignedUserIds.length) {
    return res.status(400).json({ message: 'Choose at least one attendee for a person-specific event.' });
  }

  await event.save();

  const recipients = event.audience === 'USER'
    ? event.assignedUserIds
    : await User.find({ companyId: req.companyId, status: 'active', team: event.team }).distinct('_id');

  for (const id of recipients) {
    try {
      await Notification.create({
        companyId: req.companyId,
        userId: id,
        type: 'EVENT',
        title: 'Event Schedule Updated',
        message: `Event "${event.title}" has been updated. Starts: ${new Date(event.startsAt).toLocaleString()}`,
        link: '/events',
        dedupeKey: `event-updated-${event._id}-${id}-${Date.now()}`
      });
    } catch {}
  }

  res.json({ message: 'Event updated.', event });
}));

// DELETE /api/events/:id - Delete/cancel event
router.delete('/:id', requirePermission('events:manage'), asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!event) return res.status(404).json({ message: 'Event not found.' });

  const isCreator = String(event.createdBy) === String(req.user._id);
  const isManager = req.user.role === 'MANAGER';
  if (!isCreator && !isManager) {
    return res.status(403).json({ message: 'Only the creator of this event or a Manager can cancel it.' });
  }

  const recipients = event.audience === 'USER'
    ? event.assignedUserIds
    : await User.find({ companyId: req.companyId, status: 'active', team: event.team }).distinct('_id');

  for (const id of recipients) {
    try {
      await Notification.create({
        companyId: req.companyId,
        userId: id,
        type: 'EVENT',
        title: 'Event Cancelled',
        message: `Event "${event.title}" has been cancelled.`,
        link: '/events',
        dedupeKey: `event-cancelled-${event._id}-${id}`
      });
    } catch {}
  }

  await event.deleteOne();
  res.json({ message: 'Event deleted successfully.' });
}));

export default router;
