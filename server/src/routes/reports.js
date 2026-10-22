import { Router } from 'express';
import { Activity, AssetHistory, Case, Handover, Task, Ticket, User, WorkReport } from '../models.js';
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
  const selectedIds = requestedUserId === 'all' ? allUserIds : [requestedUserId];
  const selectedIdStrings = new Set(selectedIds.map(String));

  const [tasks, completedTasks, activities, assetHistory, workReports, handovers] = await Promise.all([
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
    }).sort({ createdAt: -1 }).limit(2000).populate('taskId', 'taskNumber title status').lean()
  ]);

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
      status: row.changes?.status?.to ? actionLabel(row.changes.status.to) : row.assetId?.status || '',
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
