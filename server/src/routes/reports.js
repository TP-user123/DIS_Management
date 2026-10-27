import { Router } from 'express';
import { Activity, Asset, AssetHistory, AssetWorkEvent, Case, Event, Handover, Task, Ticket, User, WorkReport } from '../models.js';
import { auth, asyncHandler, requirePermission } from '../middleware.js';

const router = Router();
router.use(auth);

function canViewMember(viewer, member) {
  if (viewer.role === 'MANAGER') return true;
  if (String(viewer._id) === String(member._id)) return true;
  if (member.team !== viewer.team) return false;
  if (viewer.role === 'TL') return true;
  if (member.role === 'TL') return true;
  if (viewer.role === 'SL') return member.shift === viewer.shift;
  if (viewer.role === 'RE') return member.role === 'SL' || member.shift === viewer.shift;
  return false;
}

function dateRange(req, res) {
  const from = new Date(req.query.from);
  const to = new Date(req.query.to);
  if (!req.query.from || !req.query.to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    res.status(400).json({ message: 'Choose a valid report date range.' });
    return null;
  }
  if (to - from > 366 * 24 * 60 * 60 * 1000) {
    res.status(400).json({ message: 'A report can cover up to 366 days.' });
    return null;
  }
  return { $gte: from, $lt: to };
}

function addTimeline(map, userId, entry) {
  const key = String(userId || '');
  if (!key || !map.has(key)) return;
  map.get(key).push({ ...entry, _id: String(entry._id || `${entry.source}-${entry.createdAt}-${Math.random()}`) });
}

function actionLabel(action) {
  return String(action || 'Activity').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventDateKeys(event) {
  const scheduled = [...(event.occurrenceDates || [])];
  for (const update of event.occurrenceUpdates || []) {
    if (update.additional && update.dateKey) scheduled.push(update.dateKey);
  }
  if (scheduled.length) return [...new Set(scheduled)].sort();

  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt || event.startsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const dates = [];
  while (cursor <= last && dates.length < 366) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// Team and personal work tracker. Managers can view the company; leads and engineers
// can view their team scope and its reporting leads.
router.get('/workload', asyncHandler(async (req, res) => {
  const createdAt = dateRange(req, res);
  if (!createdAt) return;

  const activeUsers = await User.find({ companyId: req.companyId, status: 'active' })
    .select('name role team shift')
    .sort({ name: 1 })
    .lean();
  const users = activeUsers.filter((member) => canViewMember(req.user, member));
  const userMap = new Map(users.map((member) => [String(member._id), member]));
  const allUserIds = users.map((member) => member._id);
  const requestedUserId = String(req.query.userId || 'all');
  if (requestedUserId !== 'all' && !userMap.has(requestedUserId)) {
    return res.status(403).json({ message: 'You cannot view reports for that team member.' });
  }
  const selectedIds = requestedUserId === 'all' ? allUserIds : [userMap.get(requestedUserId)._id];
  const selectedIdStrings = new Set(selectedIds.map(String));
  const validDateKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const reportFromKey = validDateKey(req.query.dateFrom) ? req.query.dateFrom : createdAt.$gte.toISOString().slice(0, 10);
  const reportToKey = validDateKey(req.query.dateTo) ? req.query.dateTo : createdAt.$lt.toISOString().slice(0, 10);

  const [tasks, completedTasks, activities, assetHistory, workReports, handovers, assignedTickets, workloadAssets, assignedAssetEvents, calendarEvents] = await Promise.all([
    Task.find({ companyId: req.companyId, assigneeId: { $in: selectedIds } })
      .select('taskNumber title status priority assigneeId assignedBy dueAt completedAt updatedAt')
      .lean(),
    Task.find({ companyId: req.companyId, assigneeId: { $in: selectedIds }, status: 'COMPLETED', completedAt: createdAt })
      .select('taskNumber title status priority assigneeId assignedBy dueAt completedAt')
      .lean(),
    Activity.find({ companyId: req.companyId, performedBy: { $in: selectedIds }, createdAt })
      .sort({ createdAt: -1 }).limit(5000).lean(),
    AssetHistory.find({ companyId: req.companyId, performedBy: { $in: selectedIds }, createdAt })
      .sort({ createdAt: -1 }).limit(3000)
      .populate('assetId', 'assetId issue status lastCompletedIssue')
      .populate('eventId', 'title')
      .lean(),
    WorkReport.find({ companyId: req.companyId, userId: { $in: selectedIds }, createdAt })
      .sort({ createdAt: -1 }).limit(2000).lean(),
    Handover.find({
      companyId: req.companyId,
      $and: [
        { $or: [{ createdAt }, { acceptedAt: createdAt }] },
        { $or: [
          { initiatedBy: { $in: selectedIds } },
          { fromUserId: { $in: selectedIds } },
          { acceptedBy: { $in: selectedIds } },
          { targetUserIds: { $in: selectedIds } }
        ] }
      ]
    }).sort({ createdAt: -1 }).limit(2000).populate('taskId', 'taskNumber title status').lean(),
    Ticket.find({ companyId: req.companyId, assigneeId: { $in: selectedIds } })
      .select('ticketNumber item workflowStatus assigneeId')
      .lean(),
    selectedIds.length ? Asset.find({
      companyId: req.companyId,
      $or: [
        { assignedToId: { $in: selectedIds } },
        { currentIssueResolvedById: { $in: selectedIds } },
        { 'issueHistory.assignedToId': { $in: selectedIds } },
        { 'issueHistory.resolvedById': { $in: selectedIds } }
      ]
    }).select('status isArchived assignedToId eventId issue currentIssueNumber currentIssueResolvedById currentIssueResolvedAt issueHistory createdAt updatedAt').lean() : [],
    selectedIds.length ? AssetWorkEvent.find({
      companyId: req.companyId,
      isArchived: { $ne: true },
      assignedUserIds: { $in: selectedIds },
      $or: [{ scheduledAt: createdAt }, { scheduledAt: null, createdAt }]
    }).select('title scheduledAt createdAt assignedUserIds').sort({ scheduledAt: 1, title: 1 }).lean() : [],
    Event.find({
      companyId: req.companyId,
      $or: [
        { occurrenceDates: { $elemMatch: { $gte: reportFromKey, $lt: reportToKey } } },
        { 'occurrenceUpdates.dateKey': { $gte: reportFromKey, $lt: reportToKey } },
        { $and: [
          { $or: [{ occurrenceDates: { $exists: false } }, { occurrenceDates: { $size: 0 } }] },
          { startsAt: { $lt: createdAt.$lt } },
          { $or: [{ endsAt: { $gte: createdAt.$gte } }, { endsAt: null, startsAt: { $gte: createdAt.$gte } }] }
        ] }
      ]
    }).select('title startsAt endsAt occurrenceDates occurrenceUpdates audience team assignedUserIds completedByIds').sort({ startsAt: 1, title: 1 }).lean()
  ]);

  const issueCyclesByUser = new Map(selectedIds.map((id) => [String(id), { completed: 0, pending: 0, walkIn: 0 }]));
  const dateFrom = createdAt.$gte.getTime();
  const dateTo = createdAt.$lt.getTime();
  for (const asset of workloadAssets) {
    const cycles = asset.issueHistory?.length ? asset.issueHistory : [{
      issueNumber: asset.currentIssueNumber || 1,
      issue: asset.issue,
      status: ['READY_FOR_PICKUP', 'RETURNED'].includes(asset.status) ? 'RESOLVED' : asset.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'RECEIVED',
      assignedToId: asset.assignedToId,
      resolvedById: asset.currentIssueResolvedById,
      resolvedAt: asset.currentIssueResolvedAt || asset.updatedAt,
      reportedAt: asset.createdAt
    }];
    const currentIssueNumber = Number(asset.currentIssueNumber || cycles[cycles.length - 1]?.issueNumber) || 1;
    for (const cycle of cycles) {
      const reportedAt = cycle.reportedAt ? new Date(cycle.reportedAt).getTime() : new Date(asset.createdAt).getTime();
      const resolvedAt = cycle.resolvedAt ? new Date(cycle.resolvedAt).getTime() : NaN;
      const isCurrent = Number(cycle.issueNumber) === currentIssueNumber;
      const isPending = !asset.isArchived && isCurrent && cycle.status !== 'RESOLVED';
      const wasReportedInRange = reportedAt >= dateFrom && reportedAt < dateTo;
      const wasResolvedInRange = resolvedAt >= dateFrom && resolvedAt < dateTo;
      const isWalkIn = !asset.eventId;
      const assignedToId = cycle.assignedToId || (isCurrent ? asset.assignedToId : null);
      const assignedId = assignedToId ? String(assignedToId) : '';
      if (assignedId && issueCyclesByUser.has(assignedId)) {
        const counts = issueCyclesByUser.get(assignedId);
        if (isPending) counts.pending += 1;
        if (isWalkIn && (isPending || wasReportedInRange || (cycle.status === 'RESOLVED' && wasResolvedInRange))) counts.walkIn += 1;
      }
      const resolvedById = cycle.resolvedById || (isCurrent ? asset.currentIssueResolvedById : null);
      const resolverId = resolvedById ? String(resolvedById) : '';
      if (cycle.status === 'RESOLVED' && resolverId && issueCyclesByUser.has(resolverId)) {
        issueCyclesByUser.get(resolverId).completed += 1;
      }
    }
  }
  const ticketsByUser = new Map(selectedIds.map((id) => [String(id), { resolved: 0, pending: 0, total: 0 }]));
  for (const ticket of assignedTickets) {
    const counts = ticketsByUser.get(String(ticket.assigneeId));
    if (!counts) continue;
    counts.total += 1;
    if (ticket.workflowStatus === 'RESOLVED') counts.resolved += 1;
    else counts.pending += 1;
  }
  const eventsByUser = new Map(selectedIds.map((id) => [String(id), []]));
  for (const event of assignedAssetEvents) {
    for (const assigneeId of event.assignedUserIds || []) {
      const assignedTo = eventsByUser.get(String(assigneeId));
      if (assignedTo) assignedTo.push({ _id: String(event._id), title: event.title, scheduledAt: event.scheduledAt || event.createdAt, status: 'SCHEDULED', dateKey: event.scheduledAt ? new Date(event.scheduledAt).toISOString().slice(0, 10) : '' });
    }
  }

  for (const event of calendarEvents) {
    const attendees = event.audience === 'USER'
      ? (event.assignedUserIds || []).map(String).filter((id) => selectedIdStrings.has(id))
      : users.filter((member) => member.team === event.team).map((member) => String(member._id));
    if (!attendees.length) continue;
    const updatesByUserDate = new Map((event.occurrenceUpdates || []).map((update) => [
      `${String(update.userId)}:${update.dateKey}`,
      update
    ]));
    const legacyCompletedIds = new Set((event.completedByIds || []).map(String));
    const occurrences = eventDateKeys(event).filter((key) => key >= reportFromKey && key < reportToKey);
    for (const dateKey of occurrences) {
      for (const attendeeId of attendees) {
        const update = updatesByUserDate.get(`${attendeeId}:${dateKey}`);
        const status = update?.status || (legacyCompletedIds.has(attendeeId) ? 'DONE' : 'PENDING');
        eventsByUser.get(attendeeId)?.push({
          _id: `${String(event._id)}-${dateKey}`,
          eventId: String(event._id),
          title: event.title,
          scheduledAt: event.startsAt,
          dateKey,
          status,
          updatedAt: update?.updatedAt || null
        });
      }
    }
  }

  const taskIds = [...new Set(activities.filter((row) => row.entityType === 'TASK').map((row) => String(row.entityId)))];
  const ticketIds = [...new Set(activities.filter((row) => row.entityType === 'TICKET').map((row) => String(row.entityId)))];
  const caseIds = [...new Set(activities.filter((row) => row.entityType === 'CASE').map((row) => String(row.entityId)))];
  const [activityTasks, activityTickets, activityCases] = await Promise.all([
    taskIds.length ? Task.find({ _id: { $in: taskIds }, companyId: req.companyId }).select('taskNumber title status').lean() : [],
    ticketIds.length ? Ticket.find({ _id: { $in: ticketIds }, companyId: req.companyId }).select('ticketNumber item workflowStatus').lean() : [],
    caseIds.length ? Case.find({ _id: { $in: caseIds }, companyId: req.companyId }).select('caseNumber title status').lean() : []
  ]);
  const entityMap = new Map([
    ...activityTasks.map((row) => [String(row._id), row]),
    ...activityTickets.map((row) => [String(row._id), row]),
    ...activityCases.map((row) => [String(row._id), row])
  ]);
  const assignerIds = [...new Set(tasks.map((task) => task.assignedBy).filter(Boolean).map(String))];
  const assigners = assignerIds.length
    ? await User.find({ _id: { $in: assignerIds }, companyId: req.companyId }).select('name').lean()
    : [];
  const assignerNames = new Map(assigners.map((person) => [String(person._id), person.name]));

  const timelines = new Map(selectedIds.map((id) => [String(id), []]));
  for (const event of calendarEvents) {
    const attendees = event.audience === 'USER'
      ? (event.assignedUserIds || []).map(String).filter((id) => selectedIdStrings.has(id))
      : users.filter((member) => member.team === event.team).map((member) => String(member._id));
    const occurrenceDates = new Set(eventDateKeys(event));
    const updates = event.occurrenceUpdates || [];
    for (const update of updates) {
      const updatedAt = new Date(update.updatedAt || event.startsAt);
      if (update.status === 'PENDING' || !occurrenceDates.has(update.dateKey) || updatedAt < createdAt.$gte || updatedAt >= createdAt.$lt) continue;
      const attendeeId = String(update.userId);
      if (!attendees.includes(attendeeId)) continue;
      const statusText = update.status === 'DONE' ? 'Done' : update.status === 'CANCELLED' ? 'Cancelled' : update.status === 'POSTPONED' ? 'Postponed' : 'Pending';
      addTimeline(timelines, attendeeId, {
        _id: `event-${event._id}-${attendeeId}-${update.dateKey}`,
        source: 'EVENT',
        title: `Event marked ${statusText.toLowerCase()}`,
        subject: event.title,
        status: update.status,
        note: `Scheduled for ${update.dateKey}`,
        createdAt: updatedAt
      });
    }
  }
  for (const activity of activities) {
    const entity = entityMap.get(String(activity.entityId));
    const subject = entity?.taskNumber
      ? `${entity.taskNumber} · ${entity.title}`
      : entity?.ticketNumber
        ? `${entity.ticketNumber}${entity.item ? ` · ${entity.item}` : ''}`
        : entity?.caseNumber
          ? `${entity.caseNumber} · ${entity.title}`
          : activity.details?.title || activity.details?.caseNumber || '';
    const entry = {
      _id: activity._id,
      source: activity.entityType || 'ACTIVITY',
      title: actionLabel(activity.action),
      subject,
      status: entity?.status || entity?.workflowStatus || '',
      note: activity.comment || activity.details?.note || activity.details?.reason || '',
      createdAt: activity.createdAt
    };
    addTimeline(timelines, activity.performedBy, entry);
    const assignedUserId = activity.details?.assigneeId ? String(activity.details.assigneeId) : '';
    if (assignedUserId && userMap.has(assignedUserId) && (/ASSIGNED|REASSIGNED_BY_LEAD|DISTRIBUTED/.test(activity.action || '') || activity.action === 'TASK_CREATED')) {
      addTimeline(timelines, assignedUserId, {
        ...entry,
        _id: `${activity._id}-assignment`,
        title: `${activity.entityType === 'TICKET' ? 'Ticket' : 'Task'} assigned to you`,
        note: activity.comment || activity.details?.description || ''
      });
    }
  }

  for (const row of assetHistory) {
    const isRepeatIssue = ['REPEAT_ISSUE', 'REPEAT_ISSUE_RESOLVED'].includes(row.action);
    const repeatIssue = row.changes?.repeatIssue || {};
    addTimeline(timelines, row.performedBy, {
      _id: row._id,
      source: 'ASSET',
      title: row.action === 'REPEAT_ISSUE' ? 'Repeat issue reported' : row.action === 'REPEAT_ISSUE_RESOLVED' ? 'Repeat issue resolved' : actionLabel(row.action),
      subject: row.assetId?.assetId ? `${row.assetId.assetId}${row.assetId.issue ? ` · ${row.assetId.issue}` : ''}` : 'Asset update',
      status: ['READY_FOR_PICKUP', 'RETURNED'].includes(row.changes?.status?.to)
        ? 'RESOLVED'
        : row.changes?.status?.to ? actionLabel(row.changes.status.to) : row.assetId?.status || '',
      note: row.comment || '',
      repeatIssue: isRepeatIssue,
      repeatIssueText: repeatIssue.issue || row.changes?.issue?.to || row.assetId?.lastCompletedIssue || row.assetId?.issue || '',
      repeatIssueCount: Number(repeatIssue.count) || 0,
      repeatIssueStatus: row.action === 'REPEAT_ISSUE_RESOLVED' || repeatIssue.status?.to === 'RESOLVED' || repeatIssue.status === 'RESOLVED' ? 'RESOLVED' : 'OPEN',
      eventId: row.eventId?._id ? String(row.eventId._id) : '',
      eventTitle: row.eventId?.title || '',
      createdAt: row.createdAt
    });
  }

  for (const report of workReports) {
    addTimeline(timelines, report.userId, {
      _id: report._id,
      source: 'WORK NOTE',
      title: report.title,
      subject: report.completedWork || report.summary,
      status: report.status,
      note: report.blockers ? `Blocker: ${report.blockers}` : report.ticketRefs ? `Tickets: ${report.ticketRefs}` : '',
      createdAt: report.createdAt
    });
  }

  for (const handover of handovers) {
    const taskLabel = handover.taskId?.taskNumber
      ? `${handover.taskId.taskNumber} · ${handover.taskId.title}`
      : 'Task handover';
    const candidateNames = (handover.targetUserIds || [])
      .map((id) => userMap.get(String(id))?.name)
      .filter(Boolean);
    if (createdAt.$gte <= new Date(handover.createdAt) && new Date(handover.createdAt) < createdAt.$lt) {
      const initiatorId = String(handover.initiatedBy || handover.fromUserId || '');
      addTimeline(timelines, initiatorId, {
        _id: `${handover._id}-offered`, source: 'HANDOVER', title: 'Handover offered', subject: taskLabel,
        status: handover.status, note: [candidateNames.length ? `To: ${candidateNames.join(', ')}` : '', handover.reason, handover.notes].filter(Boolean).join(' · '),
        createdAt: handover.createdAt
      });
      for (const candidateId of handover.targetUserIds || []) {
        addTimeline(timelines, candidateId, {
          _id: `${handover._id}-received-${candidateId}`, source: 'HANDOVER', title: 'Handover offered to you', subject: taskLabel,
          status: handover.status, note: handover.reason || handover.notes || '', createdAt: handover.createdAt
        });
      }
    }
    if (handover.acceptedBy && handover.acceptedAt && createdAt.$gte <= new Date(handover.acceptedAt) && new Date(handover.acceptedAt) < createdAt.$lt) {
      addTimeline(timelines, handover.acceptedBy, {
        _id: `${handover._id}-accepted`, source: 'HANDOVER', title: 'Handover accepted', subject: taskLabel,
        status: handover.taskId?.status || handover.status, note: handover.reason || handover.notes || '', createdAt: handover.acceptedAt
      });
    }
  }

  const activeTaskRows = tasks.filter((task) => task.status !== 'COMPLETED');
  const summaries = users.filter((member) => selectedIdStrings.has(String(member._id))).map((member) => {
    const id = String(member._id);
    const assignedTasks = tasks.filter((task) => String(task.assigneeId) === id);
    const incompleteTasks = assignedTasks.filter((task) => task.status !== 'COMPLETED');
    const completedCount = completedTasks.filter((task) => String(task.assigneeId) === id).length;
    const assetCounts = issueCyclesByUser.get(id) || { completed: 0, pending: 0, walkIn: 0 };
    const ticketCounts = ticketsByUser.get(id) || { resolved: 0, pending: 0, total: 0 };
    const userHandovers = handovers.filter((handover) =>
      String(handover.initiatedBy) === id || String(handover.fromUserId) === id ||
      String(handover.acceptedBy) === id || (handover.targetUserIds || []).some((target) => String(target) === id)
    );
    const timeline = (timelines.get(id) || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const toTaskSummary = (task) => ({
      _id: task._id,
      taskNumber: task.taskNumber,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt,
      completedAt: task.completedAt,
      assignedBy: assignerNames.get(String(task.assignedBy)) || ''
    });
    return {
      ...member,
      assignedTaskCount: assignedTasks.length,
      incompleteTaskCount: incompleteTasks.length,
      completedTaskCount: completedCount,
      assetIssuesCompleted: assetCounts.completed,
      assetIssuesPending: assetCounts.pending,
      ticketCount: ticketCounts.total,
      ticketResolvedCount: ticketCounts.resolved,
      ticketPendingCount: ticketCounts.pending,
      walkInIssueCount: assetCounts.walkIn,
      assignedEvents: eventsByUser.get(id) || [],
      eventCount: (eventsByUser.get(id) || []).length,
      handoverCount: userHandovers.length,
      workCount: timeline.length,
      assignedTasks: assignedTasks.map(toTaskSummary),
      incompleteTasks: incompleteTasks.map(toTaskSummary),
      completedTasks: completedTasks.filter((task) => String(task.assigneeId) === id).map(toTaskSummary),
      handovers: userHandovers.map((handover) => ({
        _id: handover._id,
        task: handover.taskId ? { taskNumber: handover.taskId.taskNumber, title: handover.taskId.title, status: handover.taskId.status } : null,
        status: handover.status,
        direction: String(handover.acceptedBy) === id ? 'ACCEPTED' :
          (handover.targetUserIds || []).some((target) => String(target) === id) ? 'RECEIVED' : 'SENT',
        fromUser: userMap.get(String(handover.fromUserId))?.name || '',
        initiatedBy: userMap.get(String(handover.initiatedBy))?.name || '',
        acceptedBy: userMap.get(String(handover.acceptedBy))?.name || '',
        targetUsers: (handover.targetUserIds || []).map((target) => userMap.get(String(target))?.name).filter(Boolean),
        reason: handover.reason,
        notes: handover.notes,
        createdAt: handover.createdAt,
        acceptedAt: handover.acceptedAt
      })),
      timeline
    };
  });

  res.json({
    range: { from: createdAt.$gte, to: createdAt.$lt },
    users: summaries,
    selectedUserId: requestedUserId === 'all' ? null : requestedUserId,
    visibleUserCount: users.length,
    incompleteTaskCount: activeTaskRows.length
  });
}));

// Existing queue analytics remain available to users with report permission.
router.get('/', requirePermission('reports:view'), asyncHandler(async (req, res) => {
  const [tickets, tasks, users] = await Promise.all([
    Ticket.find({ companyId: req.companyId }).select('workflowStatus priorityName assigneeId loggedDate').lean(),
    Task.find({ companyId: req.companyId }).select('status priority assigneeId').lean(),
    User.find({ companyId: req.companyId, status: 'active' }).select('name role').lean()
  ]);
  const status = (ticket) => ['OPEN', 'WIP', 'ROUTED', 'RESOLVED'].includes(ticket.workflowStatus) ? ticket.workflowStatus : 'OPEN';
  const age = (ticket) => Math.max(0, Math.floor((Date.now() - new Date(ticket.loggedDate).getTime()) / 86400000));
  const byEngineer = users.map((member) => {
    const memberTickets = tickets.filter((ticket) => String(ticket.assigneeId) === String(member._id));
    const memberTasks = tasks.filter((task) => String(task.assigneeId) === String(member._id));
    return {
      name: member.name, role: member.role, tickets: memberTickets.length,
      openTickets: memberTickets.filter((ticket) => status(ticket) !== 'RESOLVED').length,
      closedTickets: memberTickets.filter((ticket) => status(ticket) === 'RESOLVED').length,
      tasks: memberTasks.length, completedTasks: memberTasks.filter((task) => task.status === 'COMPLETED').length
    };
  });
  res.json({
    ticketStatus: ['OPEN', 'WIP', 'ROUTED', 'RESOLVED'].map((value) => ({ label: value, value: tickets.filter((ticket) => status(ticket) === value).length })),
    priority: ['Critical', 'Urgent', 'High', 'Medium', 'Low'].map((label) => ({ label, value: tickets.filter((ticket) => status(ticket) !== 'RESOLVED' && String(ticket.priorityName).toLowerCase().includes(label.toLowerCase())).length })),
    aging: [
      { label: '0 days', value: tickets.filter((ticket) => status(ticket) !== 'RESOLVED' && age(ticket) === 0).length },
      { label: '1-3 days', value: tickets.filter((ticket) => status(ticket) !== 'RESOLVED' && age(ticket) >= 1 && age(ticket) <= 3).length },
      { label: '4-7 days', value: tickets.filter((ticket) => status(ticket) !== 'RESOLVED' && age(ticket) >= 4 && age(ticket) <= 7).length },
      { label: '8+ days', value: tickets.filter((ticket) => status(ticket) !== 'RESOLVED' && age(ticket) >= 8).length }
    ],
    byEngineer,
    taskStatus: ['OPEN', 'ASSIGNED', 'WIP', 'PENDING', 'COMPLETED'].map((value) => ({ label: value, value: tasks.filter((task) => task.status === value).length }))
  });
}));

export default router;
