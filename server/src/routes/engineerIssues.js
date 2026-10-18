import { Router } from 'express';
import { EngineerIssue, User, Notification, Activity } from '../models.js';
import { auth, asyncHandler } from '../middleware.js';
import { logActivity } from '../utils.js';

const router = Router();
router.use(auth);

// GET /api/engineer-issues - Strict 1-to-1 privacy
router.get('/', asyncHandler(async (req, res) => {
  const filter = { companyId: req.companyId };

  if (req.user.role === 'RE' || req.user.role === 'SL') {
    // RE and SL can ONLY see issues submitted by themselves
    filter.engineerId = req.user._id;
  } else if (req.user.role === 'TL') {
    // TL can only see issues assigned to them or within their team
    filter.$or = [{ tlId: req.user._id }, { team: req.user.team }];
  } else if (req.user.role === 'MANAGER') {
    // Manager has administrative oversight
  } else {
    // Other roles can only view issues submitted by themselves
    filter.engineerId = req.user._id;
  }

  const issues = await EngineerIssue.find(filter).sort({ createdAt: -1 }).limit(200).lean();

  const userIds = [...new Set(issues.flatMap(i => [i.engineerId, i.tlId, i.resolvedBy]).filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: userIds }, companyId: req.companyId }).select('name role team').lean();
  const userMap = Object.fromEntries(users.map(u => [String(u._id), u]));

  res.json(issues.map(i => ({
    ...i,
    engineer: userMap[String(i.engineerId)] || null,
    tl: userMap[String(i.tlId)] || null,
    resolver: userMap[String(i.resolvedBy)] || null
  })));
}));

// POST /api/engineer-issues - RE or SL creates a 1-to-1 complaint/issue for TL
router.post('/', asyncHandler(async (req, res) => {
  const { title, category, priority, description, tlId } = req.body;

  if (!title?.trim() || !description?.trim()) {
    return res.status(400).json({ message: 'Title and description of the issue are required.' });
  }

  let targetTlId = tlId || null;
  if (!targetTlId) {
    // Default to a TL in the user's team
    const teamTl = await User.findOne({ companyId: req.companyId, role: 'TL', team: req.user.team, status: 'active' });
    if (teamTl) targetTlId = teamTl._id;
  }

  const issue = await EngineerIssue.create({
    companyId: req.companyId,
    engineerId: req.user._id,
    tlId: targetTlId,
    team: req.user.team || 'IT Support',
    title: title.trim(),
    category: ['TECHNICAL_BLOCKER', 'TOOLING_ACCESS', 'WORKLOAD_SHIFT', 'PROCESS', 'OTHER'].includes(category) ? category : 'TECHNICAL_BLOCKER',
    priority: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(priority) ? priority : 'MEDIUM',
    description: description.trim(),
    status: 'OPEN'
  });

  await logActivity({
    companyId: req.companyId,
    entityType: 'ISSUE',
    entityId: issue._id,
    action: 'ENGINEER_ISSUE_SUBMITTED',
    performedBy: req.user._id,
    details: { title: issue.title, category: issue.category, priority: issue.priority, submitterRole: req.user.role }
  });

  // Notify the TL privately
  if (targetTlId) {
    const roleTitle = req.user.role === 'SL' ? 'Shift Lead' : 'Engineer';
    try {
      await Notification.create({
        companyId: req.companyId,
        userId: targetTlId,
        type: 'ISSUE',
        title: `${roleTitle} Issue Escalation (Private 1-to-1)`,
        message: `${req.user.name} (${req.user.role}) reported: "${issue.title}". Tap to review and respond.`,
        link: '/issues',
        dedupeKey: `issue-${issue._id}-${targetTlId}`
      });
    } catch {}
  }

  res.status(201).json({ message: 'Issue submitted privately to your Team Leader.', issue });
}));

// PATCH /api/engineer-issues/:id/respond - TL updates status & adds response
router.patch('/:id/respond', asyncHandler(async (req, res) => {
  const issue = await EngineerIssue.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!issue) return res.status(404).json({ message: 'Issue not found.' });

  // Only TL or Manager can respond
  if (!['MANAGER', 'TL'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Only Team Leaders or Managers can respond to engineer issues.' });
  }

  const { status, tlNotes } = req.body;

  if (status && ['OPEN', 'IN_REVIEW', 'RESOLVED'].includes(status)) {
    issue.status = status;
    if (status === 'RESOLVED') {
      issue.resolvedAt = new Date();
      issue.resolvedBy = req.user._id;
    }
  }

  if (tlNotes !== undefined) {
    issue.tlNotes = String(tlNotes).trim();
  }

  await issue.save();

  await logActivity({
    companyId: req.companyId,
    entityType: 'ISSUE',
    entityId: issue._id,
    action: 'ENGINEER_ISSUE_RESPONDED',
    performedBy: req.user._id,
    details: { status: issue.status, tlNotes: issue.tlNotes }
  });

  // Notify the reporting engineer
  try {
    await Notification.create({
      companyId: req.companyId,
      userId: issue.engineerId,
      type: 'ISSUE',
      title: 'Update on Your Reported Issue',
      message: `${req.user.name} (TL) updated your issue to "${issue.status}".`,
      link: '/issues',
      dedupeKey: `issue-update-${issue._id}-${Date.now()}`
    });
  } catch {}

  res.json({ message: 'Response submitted to engineer.', issue });
}));

export default router;
