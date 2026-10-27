import { Router } from 'express';
import { Notification, Ticket } from '../models.js';
import { auth, asyncHandler, requirePermission } from '../middleware.js';

const router = Router();
router.use(auth, requirePermission('notifications:view'));

router.get('/', asyncHandler(async (req, res) => {
  const filter = { companyId: req.companyId, userId: req.user._id, dismissedAt: null };
  const items = await Notification.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  const now = Date.now();
  const tickets = await Ticket.find({ companyId: req.companyId, assigneeId: req.user._id })
    .select('ticketNumber workflowStatus sourceStatus loggedDate')
    .lean();
  const agedTickets = tickets.filter((ticket) => (
    Math.floor((now - new Date(ticket.loggedDate).getTime()) / 86400000) > 0 &&
    (ticket.workflowStatus || 'OPEN') !== 'RESOLVED'
  ));

  for (const ticket of agedTickets) {
    const days = Math.floor((now - new Date(ticket.loggedDate).getTime()) / 86400000);
    try {
      await Notification.create({
        companyId: req.companyId,
        userId: req.user._id,
        type: 'AGING',
        title: 'Ticket aging alert',
        message: `Ticket ${ticket.ticketNumber} is ${days} day(s) old and remains ${ticket.workflowStatus || 'OPEN'}.`,
        link: '/tickets',
        dedupeKey: `aging-${ticket._id}-${new Date().toISOString().slice(0, 10)}`
      });
    } catch {}
  }

  const freshItems = agedTickets.length
    ? await Notification.find(filter).sort({ createdAt: -1 }).limit(100).lean()
    : items;
  res.json(freshItems);
}));

router.patch('/:id/read', asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, companyId: req.companyId, userId: req.user._id, dismissedAt: null },
    { readAt: new Date() },
    { new: true }
  );
  if (!notification) return res.status(404).json({ message: 'Notification not found.' });
  res.json(notification);
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { companyId: req.companyId, userId: req.user._id, readAt: null, dismissedAt: null },
    { readAt: new Date() }
  );
  res.json({ message: 'All notifications marked as read.' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate({
    _id: req.params.id,
    companyId: req.companyId,
    userId: req.user._id,
    dismissedAt: null
  }, { dismissedAt: new Date() }, { new: true });
  if (!notification) return res.status(404).json({ message: 'Notification not found.' });
  res.json({ message: 'Notification deleted.' });
}));

export default router;
