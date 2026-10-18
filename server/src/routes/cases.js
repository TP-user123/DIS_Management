import { Router } from 'express';
import { Case, Task, Activity, User } from '../models.js';
import { auth, asyncHandler } from '../middleware.js';
import { logActivity, makeCaseNumber, makeTaskNumber } from '../utils.js';

const router = Router();
router.use(auth);

router.get('/', asyncHandler(async (req, res) => {
  const filter = { companyId: req.companyId };
  if (req.query.status && req.query.status !== 'ALL') filter.status = req.query.status;
  if (req.query.priority && req.query.priority !== 'ALL') filter.priority = req.query.priority;
  if (req.query.search) filter.$or = [{ title: { $regex: req.query.search, $options: 'i' } }, { caseNumber: { $regex: req.query.search, $options: 'i' } }];
  const cases = await Case.find(filter).sort({ updatedAt: -1 }).limit(200).lean();
  const ids = cases.map(c => c._id);
  const tasks = await Task.aggregate([{ $match: { companyId: (await Case.findOne(filter).select('companyId').lean())?.companyId, caseId: { $in: ids } } }, { $group: { _id: '$caseId', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } } } }]);
  const taskMap = new Map(tasks.map(t => [String(t._id), t]));
  res.json(cases.map(c => ({ ...c, taskSummary: taskMap.get(String(c._id)) || { total: 0, completed: 0 } })));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { title, description, type, priority, team, dueAt } = req.body;
  if (!title?.trim()) return res.status(400).json({ message: 'Case title is required.' });
  const caseType = ['INCIDENT', 'SERVICE_REQUEST', 'GENERAL_TASK'].includes(type) ? type : 'INCIDENT';
  const caseDoc = await Case.create({
    companyId: req.companyId, caseNumber: await makeCaseNumber(req.companyId),
    title: title.trim(), description: description || '', type: caseType,
    priority: ['CRITICAL','HIGH','MEDIUM','LOW'].includes(priority) ? priority : 'MEDIUM',
    team: team?.trim() || req.user.team || 'Operations',
    createdBy: req.user._id, ownerId: req.user._id, dueAt: dueAt || null
  });
  await logActivity({ companyId: req.companyId, entityType: 'CASE', entityId: caseDoc._id, action: 'CASE_CREATED', performedBy: req.user._id, details: { caseNumber: caseDoc.caseNumber } });
  res.status(201).json(caseDoc);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const caseDoc = await Case.findOne({ _id: req.params.id, companyId: req.companyId }).lean();
  if (!caseDoc) return res.status(404).json({ message: 'Case not found.' });
  const tasks = await Task.find({ caseId: caseDoc._id, companyId: req.companyId }).sort({ createdAt: 1 }).lean();
  const userIds = [...new Set([caseDoc.createdBy, caseDoc.ownerId, ...tasks.flatMap(t => [t.assigneeId, t.createdBy])].filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: userIds }, companyId: req.companyId }).select('name email role').lean();
  const userMap = Object.fromEntries(users.map(u => [String(u._id), u]));
  const activities = await Activity.find({ companyId: req.companyId, $or: [{ entityType: 'CASE', entityId: caseDoc._id }, { entityType: 'TASK', entityId: { $in: tasks.map(t => t._id) } }] }).sort({ createdAt: -1 }).limit(100).lean();
  const enrichedTasks = tasks.map(t => ({ ...t, assignee: t.assigneeId ? userMap[String(t.assigneeId)] || null : null }));
  res.json({ ...caseDoc, createdByUser: userMap[String(caseDoc.createdBy)] || null, owner: userMap[String(caseDoc.ownerId)] || null, tasks: enrichedTasks, activities });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const caseDoc = await Case.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!caseDoc) return res.status(404).json({ message: 'Case not found.' });
  const old = {};
  const allowed = ['title', 'description', 'priority', 'status', 'team'];
  for (const key of allowed) if (req.body[key] !== undefined) { old[key] = caseDoc[key]; caseDoc[key] = req.body[key]; }
  if (req.body.status === 'RESOLVED') caseDoc.resolvedAt = new Date();
  if (req.body.status === 'CLOSED') caseDoc.closedAt = new Date();
  await caseDoc.save();
  await logActivity({ companyId: req.companyId, entityType: 'CASE', entityId: caseDoc._id, action: 'CASE_UPDATED', performedBy: req.user._id, details: { old, new: req.body } });
  res.json(caseDoc);
}));

router.post('/:id/tasks', asyncHandler(async (req, res) => {
  const caseDoc = await Case.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!caseDoc) return res.status(404).json({ message: 'Case not found.' });
  if (!req.body.title?.trim()) return res.status(400).json({ message: 'Task title is required.' });
  const task = await Task.create({
    companyId: req.companyId, caseId: caseDoc._id,
    taskNumber: await makeTaskNumber(req.companyId, caseDoc._id),
    title: req.body.title.trim(), description: req.body.description || '',
    priority: ['CRITICAL','HIGH','MEDIUM','LOW'].includes(req.body.priority) ? req.body.priority : caseDoc.priority,
    status: 'OPEN', createdBy: req.user._id, team: req.body.team || caseDoc.team,
    dueAt: req.body.dueAt || null
  });
  await Case.updateOne({ _id: caseDoc._id, companyId: req.companyId }, { status: caseDoc.status === 'OPEN' ? 'IN_PROGRESS' : caseDoc.status });
  await logActivity({ companyId: req.companyId, entityType: 'TASK', entityId: task._id, action: 'TASK_CREATED', performedBy: req.user._id, details: { caseId: caseDoc._id, title: task.title } });
  res.status(201).json(task);
}));
export default router;
