import { Router } from 'express';
import { AssetHistory, Case, Task, User, Handover } from '../models.js';
import { auth, asyncHandler } from '../middleware.js';

const router = Router();
router.use(auth);
router.get('/summary', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  const [cases, tasks, teamMembers, pendingHandovers, myTasks, unassignedTasks, assetIssuesResolved] = await Promise.all([
    Case.countDocuments({ companyId }),
    Task.countDocuments({ companyId }),
    User.countDocuments({ companyId, status: 'active' }),
    Handover.countDocuments({ companyId, toUserId: req.user._id, status: 'PENDING' }),
    Task.countDocuments({ companyId, assigneeId: req.user._id, status: { $ne: 'COMPLETED' } }),
    Task.countDocuments({ companyId, assigneeId: null, status: { $ne: 'COMPLETED' } }),
    AssetHistory.countDocuments({
      companyId,
      performedBy: req.user._id,
      action: 'STATUS_UPDATED',
      'changes.status.to': { $in: ['READY_FOR_PICKUP', 'RETURNED'] }
    })
  ]);
  const [openCases, inProgress, pending, resolved, completedTasks, highPriority] = await Promise.all([
    Case.countDocuments({ companyId, status: 'OPEN' }),
    Case.countDocuments({ companyId, status: 'IN_PROGRESS' }),
    Case.countDocuments({ companyId, status: 'PENDING' }),
    Case.countDocuments({ companyId, status: { $in: ['RESOLVED','CLOSED'] } }),
    Task.countDocuments({ companyId, status: 'COMPLETED' }),
    Task.countDocuments({ companyId, priority: { $in: ['CRITICAL','HIGH'] }, status: { $ne: 'COMPLETED' } })
  ]);
  res.json({ cases, tasks, teamMembers, pendingHandovers, myTasks, unassignedTasks, assetIssuesResolved, openCases, inProgress, pending, resolved, completedTasks, highPriority });
}));
export default router;
