import { Router } from 'express';
import { Event, User, Notification } from '../models.js';
import { auth, asyncHandler, requirePermission } from '../middleware.js';

const router = Router();
router.use(auth, requirePermission('events:view'));

// GET /api/events
router.get('/', asyncHandler(async (req, res) => {
  const f = {
    companyId: req.companyId,
    $or: [
      { audience: 'TEAM', team: req.user.team },
      { audience: 'USER', assignedUserIds: req.user._id },
      { createdBy: req.user._id }
    ]
  };

  if (['MANAGER', 'TL', 'SL'].includes(req.user.role)) {
    delete f.$or;
  }

  const events = await Event.find(f).sort({ startsAt: 1 }).limit(300).lean();
  const ids = [...new Set(events.flatMap(e => [e.createdBy, ...(e.assignedUserIds || [])]).map(String))];
  const users = await User.find({ _id: { $in: ids }, companyId: req.companyId }).select('name role team').lean();
  const map = Object.fromEntries(users.map(u => [String(u._id), u]));

  res.json(events.map(e => ({
    ...e,
    creator: map[String(e.createdBy)] || null,
    assignees: (e.assignedUserIds || []).map(id => map[String(id)]).filter(Boolean)
  })));
}));

// POST /api/events - Create event with multi-user assignment across all roles
router.post('/', requirePermission('events:manage'), asyncHandler(async (req, res) => {
  const { title, description, startsAt, endsAt, location, audience, team, assignedUserIds = [] } = req.body;

  if (!title?.trim() || !startsAt) {
    return res.status(400).json({ message: 'Event title and start date/time are required.' });
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
    startsAt: new Date(startsAt),
    endsAt: endsAt ? new Date(endsAt) : null,
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
    event.endsAt = d;
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
