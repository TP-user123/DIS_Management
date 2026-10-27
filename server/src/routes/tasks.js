import { Router } from 'express';
import { Task, User, Handover, Notification, Activity } from '../models.js';
import { auth, asyncHandler, requirePermission } from '../middleware.js';
import { canAssign, ensureCompanyUser, logActivity } from '../utils.js';

const router = Router();
router.use(auth, requirePermission('tasks:view'));

const parseDateOnly = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value ? date : null;
};

const toDateKey = (date) => new Date(date).toISOString().slice(0, 10);

// GET /api/tasks
router.get('/', asyncHandler(async (req, res) => {
  const filter = { companyId: req.companyId };
  if (req.user.role === 'RE') filter.assigneeId = req.user._id;
  if (req.query.status && req.query.status !== 'ALL') filter.status = req.query.status;
  if (req.query.priority && req.query.priority !== 'ALL') filter.priority = req.query.priority;
  if (req.query.assignedToMe === 'true') filter.assigneeId = req.user._id;
  if (req.query.unassigned === 'true' && ['MANAGER', 'TL', 'SL'].includes(req.user.role)) filter.assigneeId = null;
  if (req.query.search) filter.title = { $regex: req.query.search, $options: 'i' };

  const tasks = await Task.find(filter).sort({ updatedAt: -1 }).limit(500).lean();
  const ids = [...new Set(tasks.flatMap(t => [t.assigneeId, t.createdBy, t.assignedBy]).filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: ids }, companyId: req.companyId }).select('name role team').lean();
  const map = Object.fromEntries(users.map(u => [String(u._id), u]));

  res.json(tasks.map(t => ({
    ...t,
    case: null,
    assignee: map[String(t.assigneeId)] || null,
    creator: map[String(t.createdBy)] || null,
    assigner: map[String(t.assignedBy)] || null
  })));
}));

// POST /api/tasks - Create task
router.post('/', requirePermission('tasks:create'), asyncHandler(async (req, res) => {
  const { title, description, priority, team, location, frequency, dueAt, assigneeId, category, scheduleDates } = req.body;
  if (!title?.trim()) return res.status(400).json({ message: 'Task title is required.' });

  const taskCategory = ['OPERATIONAL', 'INCIDENT_FOLLOWUP', 'GENERAL'].includes(category) ? category : 'OPERATIONAL';
  let normalizedScheduleDates = [];
  if (taskCategory === 'OPERATIONAL') {
    if (!Array.isArray(scheduleDates) || !scheduleDates.length) {
      return res.status(400).json({ message: 'Select at least one date for this operational task.' });
    }
    if (!['MANAGER', 'TL', 'SL'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only a Shift Lead, Team Leader, or Manager can schedule operational task dates.' });
    }
    if (scheduleDates.length > 100) return res.status(400).json({ message: 'An operational task can have up to 100 schedule dates.' });

    const uniqueDates = new Set();
    normalizedScheduleDates = scheduleDates.map((value) => {
      const date = parseDateOnly(value);
      if (!date) return null;
      const key = toDateKey(date);
      if (uniqueDates.has(key)) return null;
      uniqueDates.add(key);
      return { date, status: 'PENDING' };
    });
    if (normalizedScheduleDates.some((date) => !date)) {
      return res.status(400).json({ message: 'Schedule dates must be valid and cannot contain duplicates.' });
    }
    normalizedScheduleDates.sort((a, b) => a.date - b.date);
  }

  let target = null;
  if (assigneeId) {
    target = await ensureCompanyUser(req.companyId, assigneeId);
    if (!target) return res.status(400).json({ message: 'Choose an active team member.' });
    if (!canAssign(req.user, target)) return res.status(403).json({ message: 'Your role cannot assign work to this user under team/shift rules.' });
  }

  const count = await Task.countDocuments({ companyId: req.companyId });
  const task = await Task.create({
    companyId: req.companyId,
    taskNumber: `TASK-${String(count + 1).padStart(5, '0')}`,
    title: title.trim(),
    description: description || '',
    category: taskCategory,
    priority: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(priority) ? priority : 'MEDIUM',
    status: target ? 'ASSIGNED' : 'OPEN',
    createdBy: req.user._id,
    assignedBy: target ? req.user._id : null,
    assigneeId: target ? target._id : null,
    team: team || req.user.team || 'IT Support',
    location: location || '',
    frequency: taskCategory === 'OPERATIONAL' ? 'ONE_TIME' : ['DAILY', 'WEEKLY', 'QUARTERLY'].includes(frequency) ? frequency : 'ONE_TIME',
    scheduleDates: normalizedScheduleDates,
    dueAt: normalizedScheduleDates[0]?.date || dueAt || null
  });

  const activityWrite = logActivity({
    companyId: req.companyId,
    entityType: 'TASK',
    entityId: task._id,
    action: 'TASK_CREATED',
    performedBy: req.user._id,
    details: { assigneeId: target ? target._id : null }
  });

  const writes = [activityWrite];
  if (target) {
    writes.push(Notification.create({
      companyId: req.companyId,
      userId: target._id,
      type: 'TASK',
      title: 'New task assigned',
      message: `${task.taskNumber}: ${task.title}`,
      link: '/tasks',
      dedupeKey: `task-assigned-${task._id}`
    }));
  }
  await Promise.all(writes);

  res.status(201).json(task);
}));

// PATCH /api/tasks/:id - Update task or task status (Only assigned person can edit)
router.patch('/:id', asyncHandler(async (req, res) => {
  const task = await Task.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!task) return res.status(404).json({ message: 'Task not found.' });

  const isAssignee = task.assigneeId && String(task.assigneeId) === String(req.user._id);
  const isLead = ['MANAGER', 'TL', 'SL'].includes(req.user.role);

  // Strict Rule: Once assigned, only the assigned person can edit or change status
  if (task.assigneeId && !isAssignee) {
    return res.status(403).json({ message: 'This task is assigned to another engineer. Only the assigned person can edit or update this task.' });
  }

  // If unassigned, only a lead can edit or prepare the task
  if (!task.assigneeId && !isLead) {
    return res.status(403).json({ message: 'You do not have permission to edit this unassigned task.' });
  }

  // Completed tasks are locked from modifying task details
  const editable = ['title', 'description', 'priority', 'dueAt', 'location'];
  if (task.status === 'COMPLETED' && editable.some(k => req.body[k] !== undefined)) {
    return res.status(400).json({ message: 'Completed tasks are locked to preserve audit history and cannot be modified.' });
  }

  for (const k of editable) {
    if (req.body[k] !== undefined) task[k] = req.body[k];
  }

  if (req.body.status !== undefined) {
    if (!['OPEN', 'ASSIGNED', 'WIP', 'PENDING', 'COMPLETED'].includes(req.body.status)) {
      return res.status(400).json({ message: 'Invalid task status.' });
    }
    if (req.body.status === 'COMPLETED' && task.scheduleDates.some((occurrence) => occurrence.status === 'PENDING')) {
      return res.status(400).json({ message: 'Complete or cancel each scheduled date from its task timeline before completing this task.' });
    }
    task.status = req.body.status;
    if (req.body.status === 'COMPLETED') task.completedAt = new Date();
    else task.completedAt = null;
  }

  await task.save();

  await logActivity({
    companyId: req.companyId,
    entityType: 'TASK',
    entityId: task._id,
    action: req.body.status !== undefined ? 'TASK_STATUS_CHANGED' : 'TASK_UPDATED',
    performedBy: req.user._id,
    comment: req.body.remarks || req.body.description || '',
    details: req.body
  });

  res.json(task);
}));

// PATCH /api/tasks/:id/schedule/:scheduleId - Complete, postpone, or cancel one scheduled date.
router.patch('/:id/schedule/:scheduleId', asyncHandler(async (req, res) => {
  const task = await Task.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!task) return res.status(404).json({ message: 'Task not found.' });
  if (task.category !== 'OPERATIONAL' || !task.scheduleDates.length) {
    return res.status(400).json({ message: 'This task does not have a date schedule.' });
  }

  const isAssignee = task.assigneeId && String(task.assigneeId) === String(req.user._id);
  const isLead = ['MANAGER', 'TL', 'SL'].includes(req.user.role);
  if (task.assigneeId ? (!isAssignee && !isLead) : !isLead) {
    return res.status(403).json({ message: 'Only the assigned engineer or an SL/TL lead can action this schedule.' });
  }

  const occurrence = task.scheduleDates.id(req.params.scheduleId);
  if (!occurrence) return res.status(404).json({ message: 'Scheduled date not found.' });
  if (occurrence.status !== 'PENDING') {
    return res.status(409).json({ message: 'This scheduled date has already been completed or cancelled.' });
  }

  const earliestPending = task.scheduleDates
    .filter((entry) => entry.status === 'PENDING')
    .sort((a, b) => a.date - b.date)[0];
  if (!earliestPending || String(earliestPending._id) !== String(occurrence._id)) {
    return res.status(409).json({ message: 'Action the earliest pending scheduled date first.' });
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  if (toDateKey(occurrence.date) > todayKey) {
    return res.status(400).json({ message: 'This scheduled date is not due yet.' });
  }

  const action = String(req.body.action || '').toUpperCase();
  const previousDate = occurrence.date;
  const now = new Date();

  if (action === 'POSTPONE') {
    const nextDate = parseDateOnly(req.body.date);
    const nextDateKey = nextDate && toDateKey(nextDate);
    if (!nextDate || nextDateKey <= todayKey) {
      return res.status(400).json({ message: 'Choose a date after today to postpone this occurrence.' });
    }
    const alreadyScheduled = task.scheduleDates.some((entry) => (
      String(entry._id) !== String(occurrence._id)
      && entry.status === 'PENDING'
      && toDateKey(entry.date) === nextDateKey
    ));
    if (alreadyScheduled) return res.status(409).json({ message: 'Another pending occurrence is already scheduled for that date.' });

    occurrence.date = nextDate;
    occurrence.actionBy = req.user._id;
    occurrence.history.push({ action: 'POSTPONED', fromDate: previousDate, toDate: nextDate, performedBy: req.user._id, performedAt: now });
  } else if (action === 'DONE') {
    occurrence.status = 'DONE';
    occurrence.completedAt = now;
    occurrence.actionBy = req.user._id;
    occurrence.history.push({ action: 'DONE', fromDate: previousDate, performedBy: req.user._id, performedAt: now });
  } else if (action === 'CANCEL') {
    occurrence.status = 'CANCELLED';
    occurrence.cancelledAt = now;
    occurrence.actionBy = req.user._id;
    occurrence.history.push({ action: 'CANCELLED', fromDate: previousDate, performedBy: req.user._id, performedAt: now });
  } else {
    return res.status(400).json({ message: 'Choose Done, Postpone, or Cancel for this scheduled date.' });
  }

  const nextOccurrence = task.scheduleDates
    .filter((entry) => entry.status === 'PENDING')
    .sort((a, b) => a.date - b.date)[0];
  task.dueAt = nextOccurrence?.date || null;
  if (!nextOccurrence) {
    task.status = 'COMPLETED';
    task.completedAt = now;
  }
  await task.save();

  await logActivity({
    companyId: req.companyId,
    entityType: 'TASK',
    entityId: task._id,
    action: `TASK_SCHEDULE_${action}`,
    performedBy: req.user._id,
    details: {
      scheduleId: occurrence._id,
      previousDate,
      nextDate: action === 'POSTPONE' ? occurrence.date : null,
      nextDueAt: task.dueAt
    }
  });

  res.json(task);
}));

// POST /api/tasks/:id/assign - Direct reassignment by SL, TL, or Manager
router.post('/:id/assign', asyncHandler(async (req, res) => {
  const isLead = ['MANAGER', 'TL', 'SL'].includes(req.user.role);
  if (!isLead) {
    return res.status(403).json({ message: 'Only Shift Leads (SL), Team Leaders (TL), or Managers can directly reassign tasks.' });
  }

  const task = await Task.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!task) return res.status(404).json({ message: 'Task not found.' });

  // Anti-credit-theft lock: Completed tasks CANNOT be reassigned
  if (task.status === 'COMPLETED') {
    return res.status(400).json({ message: 'Completed tasks are locked to the completing engineer to prevent credit theft and cannot be reassigned.' });
  }

  const target = await ensureCompanyUser(req.companyId, req.body.assigneeId);
  if (!target) return res.status(400).json({ message: 'Choose an active user.' });

  if (!canAssign(req.user, target)) {
    return res.status(403).json({ message: 'Your role cannot assign work to this user under team/shift rules.' });
  }

  const prevAssigneeId = task.assigneeId;
  task.assigneeId = target._id;
  task.assignedBy = req.user._id;
  if (task.status === 'OPEN') task.status = 'ASSIGNED';
  await task.save();

  const note = req.body.description || req.body.notes || '';
  const activityWrite = logActivity({
    companyId: req.companyId,
    entityType: 'TASK',
    entityId: task._id,
    action: 'TASK_REASSIGNED_BY_LEAD',
    performedBy: req.user._id,
    comment: note,
    details: {
      fromUserId: prevAssigneeId,
      assigneeId: target._id,
      assigneeName: target.name,
      note
    }
  });

  const notificationWrite = Notification.create({
    companyId: req.companyId,
    userId: target._id,
    type: 'TASK',
    title: 'Task reassigned to you',
    message: `${task.taskNumber}: ${task.title}${note ? ' - ' + note : ''}`,
    link: '/tasks',
    dedupeKey: `task-assigned-${task._id}-${Date.now()}`
  });
  await Promise.all([activityWrite, notificationWrite]);

  res.json(task);
}));

// POST /api/tasks/:id/handovers - RE assigns handover to MULTIPLE people (REs or SL/TL)
router.post('/:id/handovers', requirePermission('tasks:handover'), asyncHandler(async (req, res) => {
  const task = await Task.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!task) return res.status(404).json({ message: 'Task not found.' });

  const isAssignee = String(task.assigneeId) === String(req.user._id);
  const isLead = ['MANAGER', 'TL', 'SL'].includes(req.user.role);

  if (!isAssignee && !isLead) {
    return res.status(403).json({ message: 'Only the assignee or a lead can hand over this task.' });
  }

  // Support single or multiple recipients
  let targetIds = [];
  if (Array.isArray(req.body.targetUserIds) && req.body.targetUserIds.length > 0) {
    targetIds = req.body.targetUserIds.map(String);
  } else if (req.body.toUserId) {
    targetIds = [String(req.body.toUserId)];
  }

  if (!targetIds.length) {
    return res.status(400).json({ message: 'Select at least one team member (RE or SL/TL) for handover.' });
  }

  // Validate users
  const validUsers = await User.find({
    _id: { $in: targetIds },
    companyId: req.companyId,
    status: 'active'
  }).select('_id name role team').lean();

  if (!validUsers.length) {
    return res.status(400).json({ message: 'None of the selected recipients are active.' });
  }

  const validTargetIds = validUsers.map(u => u._id);

  const handover = await Handover.create({
    companyId: req.companyId,
    caseId: null,
    taskId: task._id,
    fromUserId: task.assigneeId || req.user._id,
    toUserId: validTargetIds[0], // fallback
    targetUserIds: validTargetIds,
    initiatedBy: req.user._id,
    reason: req.body.reason || '',
    notes: req.body.notes || '',
    status: 'PENDING'
  });

  // Notify all candidate recipients
  for (const u of validUsers) {
    try {
      await Notification.create({
        companyId: req.companyId,
        userId: u._id,
        type: 'HANDOVER',
        title: 'Task Handover Offered',
        message: `${task.taskNumber}: ${task.title} offered by ${req.user.name}. Open Handovers to accept.`,
        link: '/handovers',
        dedupeKey: `handover-${handover._id}-${u._id}`
      });
    } catch {}
  }

  await logActivity({
    companyId: req.companyId,
    entityType: 'TASK',
    entityId: task._id,
    action: 'TASK_HANDOVER_BROADCAST',
    performedBy: req.user._id,
    comment: req.body.notes || req.body.reason || '',
    details: {
      candidateCount: validUsers.length,
      candidates: validUsers.map(u => `${u.name} (${u.role})`),
      reason: req.body.reason || ''
    }
  });

  res.status(201).json(handover);
}));

// GET /api/tasks/handovers/inbox - View handovers (shows who accepted and who is working)
router.get('/handovers/inbox', asyncHandler(async (req, res) => {
  const isLead = ['MANAGER', 'TL', 'SL'].includes(req.user.role);

  let query = { companyId: req.companyId, taskId: { $ne: null } };
  if (!isLead) {
    query.$or = [
      { toUserId: req.user._id },
      { targetUserIds: req.user._id },
      { initiatedBy: req.user._id },
      { fromUserId: req.user._id }
    ];
  }

  const handovers = await Handover.find(query).sort({ createdAt: -1 }).limit(100).lean();

  const userIds = [
    ...new Set(
      handovers.flatMap(h => [
        h.fromUserId,
        h.toUserId,
        h.acceptedBy,
        h.initiatedBy,
        ...(h.targetUserIds || [])
      ]).filter(Boolean).map(String)
    )
  ];

  const users = await User.find({ _id: { $in: userIds }, companyId: req.companyId }).select('name role team').lean();
  const um = Object.fromEntries(users.map(u => [String(u._id), u]));

  const taskIds = handovers.map(h => h.taskId).filter(Boolean);
  const tasks = await Task.find({ _id: { $in: taskIds }, companyId: req.companyId }).select('title taskNumber status assigneeId').lean();
  const tm = Object.fromEntries(tasks.map(t => [String(t._id), t]));

  res.json(handovers.map(h => ({
    ...h,
    fromUser: um[String(h.fromUserId)] || null,
    toUser: um[String(h.toUserId)] || null,
    acceptedUser: um[String(h.acceptedBy)] || null,
    targetUsers: (h.targetUserIds || []).map(id => um[String(id)]).filter(Boolean),
    task: tm[String(h.taskId)] || null,
    currentAssignee: tm[String(h.taskId)]?.assigneeId ? um[String(tm[String(h.taskId)].assigneeId)] : null
  })));
}));

// PATCH /api/tasks/handovers/:id - Accept/reject handover; acceptance reassigns task and shows worker
router.patch('/handovers/:id', requirePermission('tasks:handover'), asyncHandler(async (req, res) => {
  const h = await Handover.findOne({ _id: req.params.id, companyId: req.companyId, taskId: { $ne: null } });
  if (!h) return res.status(404).json({ message: 'Handover request not found.' });

  const isCandidate = (h.targetUserIds || []).map(String).includes(String(req.user._id)) || String(h.toUserId) === String(req.user._id);
  const isLead = ['MANAGER', 'TL', 'SL'].includes(req.user.role);

  if (!isCandidate && !isLead) {
    return res.status(403).json({ message: 'Only designated recipients or a lead can respond to this handover.' });
  }

  if (h.status !== 'PENDING') {
    const acceptedUser = h.acceptedBy ? await User.findById(h.acceptedBy).select('name').lean() : null;
    return res.status(400).json({
      message: h.status === 'ACCEPTED'
        ? `This handover was already accepted by ${acceptedUser?.name || 'another team member'}.`
        : 'This handover has already been processed.'
    });
  }

  if (!['ACCEPTED', 'REJECTED'].includes(req.body.status)) {
    return res.status(400).json({ message: 'Status must be ACCEPTED or REJECTED.' });
  }

  h.status = req.body.status;

  if (req.body.status === 'ACCEPTED') {
    h.acceptedAt = new Date();
    h.acceptedBy = req.user._id;
    h.toUserId = req.user._id;
    await h.save();

    const task = await Task.findOne({ _id: h.taskId, companyId: req.companyId });
    if (task) {
      task.assigneeId = req.user._id;
      task.assignedBy = h.initiatedBy;
      if (task.status === 'OPEN') task.status = 'ASSIGNED';
      await task.save();

      await logActivity({
        companyId: req.companyId,
        entityType: 'TASK',
        entityId: task._id,
        action: 'TASK_HANDOVER_ACCEPTED',
        performedBy: req.user._id,
        comment: `Accepted by ${req.user.name}. Currently working on task.`,
        details: { newAssigneeId: req.user._id, newAssigneeName: req.user.name }
      });

      // Notify the original engineer who handed it over
      try {
        await Notification.create({
          companyId: req.companyId,
          userId: h.fromUserId,
          type: 'HANDOVER',
          title: 'Handover Accepted',
          message: `${req.user.name} accepted ${task.taskNumber} and is currently working on it.`,
          link: '/tasks',
          dedupeKey: `handover-accepted-${h._id}`
        });
      } catch {}
    }
  } else {
    // If rejected by this user, if multiple candidates exist, check if others remain
    await h.save();
  }

  res.json(h);
}));

// GET /api/tasks/:id/activity
router.get('/:id/activity', asyncHandler(async (req, res) => {
  const task = await Task.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!task) return res.status(404).json({ message: 'Task not found.' });

  const isAssignee = String(task.assigneeId) === String(req.user._id);
  const isCreator = String(task.createdBy) === String(req.user._id);
  const isLead = ['MANAGER', 'TL', 'SL'].includes(req.user.role);

  if (!isAssignee && !isCreator && !isLead) {
    return res.status(403).json({ message: 'You cannot view this task history.' });
  }

  const rows = await Activity.find({
    companyId: req.companyId,
    entityType: 'TASK',
    entityId: task._id
  }).sort({ createdAt: -1 }).limit(100).lean();

  const ids = [...new Set(rows.map(x => String(x.performedBy)))];
  const users = await User.find({ _id: { $in: ids }, companyId: req.companyId }).select('name role').lean();
  const map = Object.fromEntries(users.map(u => [String(u._id), u]));

  res.json(rows.map(x => ({
    ...x,
    actor: map[String(x.performedBy)] || null
  })));
}));

export default router;
