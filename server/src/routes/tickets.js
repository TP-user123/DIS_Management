import { Router } from 'express';
import { Ticket, User, Notification, Activity } from '../models.js';
import { auth, asyncHandler, permissionCheck, requirePermission } from '../middleware.js';
import { canAssign, ensureCompanyUser, logActivity } from '../utils.js';
 import { normalizeWorkflowStatus, ticketAgeDays } from '../ticketRules.js';

const router = Router();
router.use(auth, requirePermission('tickets:view'));

const statusNorm = s => String(s || 'Open').trim();
const priorityNorm = s => String(s || 'Medium').trim();
const WORKFLOW_STATUSES = ['OPEN', 'WIP', 'RESOLVED', 'REOPENED', 'ROUTED'];
const isResolved = s => normalizeWorkflowStatus(s) === 'RESOLVED';

router.get('/', asyncHandler(async (req, res) => {
  const f = { companyId: req.companyId };
  if (req.user.role === 'RE') f.assigneeId = req.user._id;

  if (req.query.status && req.query.status !== 'ALL') {
    if (req.query.status === 'OPEN') {
      f.$and = [...(f.$and || []), { $or: [{ workflowStatus: 'OPEN' }, { workflowStatus: { $exists: false } }] }];
    } else {
      f.workflowStatus = req.query.status;
    }
  }

  if (req.query.priority && req.query.priority !== 'ALL') f.priorityName = req.query.priority;
  if (req.query.assignedToMe === 'true') f.assigneeId = req.user._id;
  if (req.user.role !== 'RE' && req.query.unassigned === 'true') f.assigneeId = null;

  if (req.query.search) {
    const rx = { $regex: req.query.search, $options: 'i' };
    f.$or = [{ ticketNumber: rx }, { description: rx }, { item: rx }];
  }
  if (req.query.assigneeId && req.user.role !== 'RE') f.assigneeId = req.query.assigneeId;

  const rows = await Ticket.find(f).sort({ loggedDate: 1 }).limit(1000).lean();
  const ids = [...new Set(rows.flatMap(t => [t.assigneeId, t.assignedBy]).filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: ids }, companyId: req.companyId }).select('name role team shift').lean();
  const um = Object.fromEntries(users.map(u => [String(u._id), u]));
  const now = new Date();

  res.json(rows.map(t => ({
    ...t,
    workflowStatus: normalizeWorkflowStatus(t.workflowStatus || t.sourceStatus),
    assignee: um[String(t.assigneeId)] || null,
    assigner: um[String(t.assignedBy)] || null,
    ageDays: ticketAgeDays(t, now),
    isClosed: isResolved(t.workflowStatus || t.sourceStatus)
  })));
}));

// GET /api/tickets/:id/logs - Fetch complete activity/assignment history for ticket
router.get('/:id/logs', asyncHandler(async (req, res) => {
  const ticket = await Ticket.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });

  const activities = await Activity.find({
    companyId: req.companyId,
    entityType: 'TICKET',
    entityId: ticket._id
  }).sort({ createdAt: -1 }).limit(50).lean();

  const userIds = [...new Set(activities.flatMap(a => [a.performedBy, a.details?.assigneeId, a.details?.toUserId, a.details?.fromUserId]).filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: userIds }, companyId: req.companyId }).select('name role team').lean();
  const map = Object.fromEntries(users.map(u => [String(u._id), u]));

  res.json(activities.map(a => ({
    ...a,
    actor: map[String(a.performedBy)] || null,
    targetUser: map[String(a.details?.assigneeId || a.details?.toUserId)] || null,
    fromUser: map[String(a.details?.fromUserId)] || null
  })));
}));

router.post('/manual', asyncHandler(async (req, res) => {
  const isEngineerCreate = req.user.role === 'RE';
  if (!isEngineerCreate && !(await permissionCheck(req, 'tickets:import'))) {
    return res.status(403).json({ message: 'You do not have permission to create tickets.' });
  }
  const ticketNumber = String(req.body.ticketNumber || '').trim();
  if (!ticketNumber) return res.status(400).json({ message: 'Ticket number is required.' });
  if (await Ticket.findOne({ companyId: req.companyId, ticketNumber })) {
    return res.status(409).json({ message: 'A ticket with this ticket number already exists.' });
  }

  const loggedDate = req.body.loggedDate ? new Date(req.body.loggedDate) : new Date();
  if (Number.isNaN(loggedDate.getTime())) return res.status(400).json({ message: 'Logged date is invalid.' });

  const assignmentUpdatedAt = isEngineerCreate ? new Date() : null;
  const ticket = await Ticket.create({
    companyId: req.companyId,
    ticketNumber,
    sourceStatus: isEngineerCreate ? 'Open' : String(req.body.sourceStatus || 'Open'),
    workflowStatus: 'OPEN',
    solutionProvider: isEngineerCreate ? '' : String(req.body.solutionProvider || ''),
    currentLevel: isEngineerCreate ? '' : String(req.body.currentLevel || ''),
    loggedDate,
    item: String(req.body.item || ''),
    requestType: String(req.body.requestType || 'Incident'),
    priorityName: String(req.body.priorityName || 'Medium'),
    description: String(req.body.description || ''),
    remarks: String(req.body.remarks || ''),
    assigneeId: isEngineerCreate ? req.user._id : null,
    assignedBy: isEngineerCreate ? req.user._id : null,
    assignmentUpdatedAt,
    createdBy: req.user._id,
    sourceRow: { entryMethod: req.body.requestType === 'Walk-in User' ? 'WALK_IN' : 'MANUAL' }
  });

  await logActivity({
    companyId: req.companyId,
    entityType: 'TICKET',
    entityId: ticket._id,
    action: 'TICKET_CREATED_MANUALLY',
    performedBy: req.user._id,
    comment: req.body.remarks || req.body.description || '',
    details: { ticketNumber, assigneeId: isEngineerCreate ? String(req.user._id) : null }
  });

  res.status(201).json({ message: 'Ticket created.', ticket });
}));

router.post('/distribute', requirePermission('tickets:assign'), asyncHandler(async (req, res) => {
  const ids = [...new Set((req.body.ticketIds || []).map(String))];
  const assigneeIds = [...new Set((req.body.assigneeIds || []).map(String))];
  const description = String(req.body.description || req.body.notes || '').trim();

  if (!ids.length) return res.status(400).json({ message: 'Select tickets to distribute.' });
  if (!assigneeIds.length) return res.status(400).json({ message: 'Select at least one team member.' });
  if (ids.length > 500) return res.status(400).json({ message: 'Distribute up to 500 tickets at a time.' });

  const users = [];
  for (const id of assigneeIds) {
    const u = await ensureCompanyUser(req.companyId, id);
    if (!u) return res.status(400).json({ message: 'One or more selected users are unavailable.' });
    if (!canAssign(req.user, u)) return res.status(403).json({ message: `Your role cannot assign tickets to ${u.name} under team/shift rules.` });
    users.push(u);
  }

  const rows = await Ticket.find({ _id: { $in: ids }, companyId: req.companyId });
  if (rows.length !== ids.length) return res.status(400).json({ message: 'Some selected tickets are missing or outside workspace.' });

  const resolved = rows.filter(t => t.workflowStatus === 'RESOLVED');
  if (resolved.length > 0) {
    return res.status(400).json({
      message: `Cannot distribute resolved tickets (${resolved.map(t => t.ticketNumber).slice(0, 3).join(', ')}). Resolved tickets remain locked to the resolving engineer to prevent work theft.`
    });
  }

  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  for (let i = users.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [users[i], users[j]] = [users[j], users[i]];
  }

  const counts = {};
  const batch = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const t = rows[i];
    const u = users[i % users.length];
    t.assigneeId = u._id;
    t.assignedBy = req.user._id;
    t.assignmentUpdatedAt = new Date();
    if (description) t.remarks = description;
    await t.save();

    counts[String(u._id)] = (counts[String(u._id)] || 0) + 1;

    await logActivity({
      companyId: req.companyId,
      entityType: 'TICKET',
      entityId: t._id,
      action: 'TICKET_RANDOMLY_DISTRIBUTED',
      performedBy: req.user._id,
      comment: description,
      details: { assigneeId: u._id, assigneeName: u.name, distributionBatch: batch }
    });

    try {
      await Notification.create({
        companyId: req.companyId,
        userId: u._id,
        type: 'TICKET',
        title: 'Tickets assigned to you',
        message: `${t.ticketNumber} has been assigned to you.${description ? ' Note: ' + description : ''}`,
        link: '/tickets',
        dedupeKey: `ticket-distributed-${t._id}-${batch}`
      });
    } catch {}
  }

  res.json({
    assigned: rows.length,
    distribution: users.map(u => ({ userId: u._id, name: u.name, count: counts[String(u._id)] || 0 })),
    message: `Distributed ${rows.length} tickets across ${users.length} selected users.`
  });
}));

router.post('/import', requirePermission('tickets:import'), asyncHandler(async (req, res) => {
  const rows = req.body.rows;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ message: 'No ticket rows received. Upload an Excel file with ticket data.' });
  if (rows.length > 5000) return res.status(400).json({ message: 'Import is limited to 5,000 rows per upload.' });

  let created = 0, updated = 0, skipped = 0, aged = 0;
  const issues = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const get = (...keys) => {
      for (const k of keys) {
        const v = r[k] ?? r[k.toLowerCase()] ?? r[k.toLowerCase().replace(/\s+/g, '')];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
      }
      return '';
    };

    const number = String(get('Ticket Number', 'Ticket Number ', 'ticketNumber', 'Ticket ID')).trim();
    if (!number) {
      skipped++;
      issues.push(`Row ${i + 2}: missing Ticket Number`);
      continue;
    }

    let logged = get('Logged Date', 'Logged date', 'loggedDate');
    let date = logged ? new Date(logged) : new Date();
    if (Number.isNaN(date.getTime())) date = new Date();

    const data = {
      sourceStatus: statusNorm(get('Status', 'status')),
      solutionProvider: String(get('Solution Provider')),
      currentLevel: String(get('Current Level')),
      loggedDate: date,
      item: String(get('Item')),
      requestType: String(get('Request Type')),
      priorityName: priorityNorm(get('Priority Name', 'Priority', 'priorityName')),
      description: String(get('Description')),
      remarks: String(get('Remarks')),
      lastImportedAt: new Date(),
      sourceRow: r
    };

    let t = await Ticket.findOne({ companyId: req.companyId, ticketNumber: number });
    if (t) {
      Object.assign(t, data);
      if (!WORKFLOW_STATUSES.includes(t.workflowStatus)) t.workflowStatus = 'OPEN';
      await t.save();
      updated++;
    } else {
      t = await Ticket.create({ companyId: req.companyId, ticketNumber: number, ...data, workflowStatus: 'OPEN' });
      created++;
    }

    const age = Math.floor((Date.now() - new Date(t.loggedDate).getTime()) / 86400000);
    if (age > 0 && !isResolved(t.workflowStatus || 'OPEN') && t.assigneeId) {
      aged++;
      try {
        await Notification.create({
          companyId: req.companyId,
          userId: t.assigneeId,
          type: 'AGING',
          title: 'Aging ticket needs attention',
          message: `Ticket ${t.ticketNumber} has been open for ${age} day(s).`,
          link: '/tickets',
          dedupeKey: `aging-${t._id}-${new Date().toISOString().slice(0, 10)}`
        });
      } catch {}
    }
  }

  res.json({ message: 'Ticket import completed.', created, updated, skipped, aged, issues: issues.slice(0, 30) });
}));

// POST /api/tickets/assign-bulk - Assign tickets with description applied in oneshot
router.post('/assign-bulk', requirePermission('tickets:assign'), asyncHandler(async (req, res) => {
  const ids = [...new Set((req.body.ticketIds || []).map(String))];
  const description = String(req.body.description || req.body.notes || '').trim();

  if (!ids.length) return res.status(400).json({ message: 'Select at least one ticket.' });
  if (ids.length > 500) return res.status(400).json({ message: 'Assign up to 500 tickets at a time.' });

  const target = await ensureCompanyUser(req.companyId, req.body.assigneeId);
  if (!target) return res.status(400).json({ message: 'Choose an active engineer.' });
  if (!canAssign(req.user, target)) return res.status(403).json({ message: 'Your role cannot assign tickets to this user under team/shift rules.' });

  const rows = await Ticket.find({ _id: { $in: ids }, companyId: req.companyId });
  if (rows.length !== ids.length) return res.status(400).json({ message: 'Some selected tickets are missing or outside workspace.' });

  const resolved = rows.filter(t => t.workflowStatus === 'RESOLVED');
  if (resolved.length > 0) {
    return res.status(400).json({
      message: `Cannot reassign resolved tickets (${resolved.map(t => t.ticketNumber).slice(0, 3).join(', ')}). They remain locked to the resolver to prevent work theft until reopened.`
    });
  }

  for (const t of rows) {
    const previousAssignee = t.assigneeId;
    t.assigneeId = target._id;
    t.assignedBy = req.user._id;
    t.assignmentUpdatedAt = new Date();
    if (description) t.remarks = description;
    await t.save();

    await logActivity({
      companyId: req.companyId,
      entityType: 'TICKET',
      entityId: t._id,
      action: 'TICKET_ASSIGNED',
      performedBy: req.user._id,
      comment: description,
      details: {
        fromUserId: previousAssignee,
        assigneeId: target._id,
        assigneeName: target.name,
        description
      }
    });

    const age = Math.floor((Date.now() - new Date(t.loggedDate).getTime()) / 86400000);
    if (age > 0 && !isResolved(t.workflowStatus || 'OPEN')) {
      try {
        await Notification.create({
          companyId: req.companyId,
          userId: target._id,
          type: 'AGING',
          title: 'Assigned aging ticket',
          message: `Ticket ${t.ticketNumber} is ${age} day(s) old and remains ${t.workflowStatus || 'OPEN'}.`,
          link: '/tickets',
          dedupeKey: `assigned-aging-${t._id}-${new Date().toISOString().slice(0, 10)}`
        });
      } catch {}
    }
  }

  await Notification.create({
    companyId: req.companyId,
    userId: target._id,
    type: 'TICKET',
    title: 'Tickets assigned to you',
    message: `${rows.length} ticket(s) assigned to you.${description ? ' Note: ' + description : ''}`,
    link: '/tickets',
    dedupeKey: `ticket-bulk-${Date.now()}`
  });

  res.json({ assigned: rows.length, assignee: target.name });
}));

// PATCH /api/tickets/:id/status - status updates, lead-only reopening, and engineer restoration
router.patch('/:id/status', asyncHandler(async (req, res) => {
  const ticket = await Ticket.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });

  const isAssignee = ticket.assigneeId && String(ticket.assigneeId) === String(req.user._id);
  const isLead = ['MANAGER', 'TL', 'SL'].includes(req.user.role);
  const canRestore = req.user.role === 'MANAGER' || (req.user.role === 'RE' && isAssignee);
  const currentStatus = ticket.workflowStatus || 'OPEN';
  const requestedStatus = String(req.body.status || '').toUpperCase();
  const isRestoreAction = requestedStatus === 'RESTORE';
  let next = requestedStatus;
  if (next === 'REOPEN') next = 'REOPENED';

  if (isRestoreAction) {
    if (currentStatus !== 'RESOLVED') {
      return res.status(400).json({ message: 'Only a resolved ticket can be restored to its previous status.' });
    }
    if (!canRestore) {
      return res.status(403).json({ message: 'Only the assigned engineer can restore a resolved ticket to its previous status.' });
    }
    next = ['OPEN', 'WIP', 'REOPENED', 'ROUTED'].includes(ticket.statusBeforeResolution)
      ? ticket.statusBeforeResolution
      : 'OPEN';
  }

  const validStatuses = ['OPEN', 'WIP', 'RESOLVED', 'REOPENED'];
  if (!validStatuses.includes(next) && !(isRestoreAction && next === 'ROUTED')) {
    return res.status(400).json({ message: 'Status must be OPEN, WIP, RESOLVED, or REOPENED.' });
  }

  const isReopenAction = currentStatus === 'RESOLVED' && next === 'REOPENED' && !isRestoreAction;
  if (isReopenAction && !isLead) {
    return res.status(403).json({ message: 'Only a Team Leader, Shift Lead, or Manager can reopen a resolved ticket.' });
  }
  if (next === 'REOPENED' && !isLead && !isRestoreAction) {
    return res.status(403).json({ message: 'Only a Team Leader, Shift Lead, or Manager can reopen tickets.' });
  }

  // Leads can reopen any resolved ticket; other status changes remain restricted to its assignee.
  if (ticket.assigneeId && !isAssignee && !isReopenAction && !isRestoreAction) {
    return res.status(403).json({ message: 'This ticket is assigned to another engineer. Only the assigned person can edit or update this ticket.' });
  }

  if (!ticket.assigneeId && !isLead) {
    return res.status(403).json({ message: 'Only a lead can update an unassigned ticket.' });
  }

  // A resolved ticket can remain resolved, be reopened, or return to its last active status.
  if (currentStatus === 'RESOLVED') {
    if (!['RESOLVED', 'REOPENED'].includes(next) && !isRestoreAction) {
      return res.status(400).json({ message: 'A resolved ticket can only remain resolved, reopen, or restore its previous status.' });
    }
  }

  const description = String(req.body.description || req.body.remarks || '').trim();

  const statusAt = new Date();
  ticket.workflowStatus = next;
  ticket.statusUpdatedBy = req.user._id;
  ticket.statusUpdatedAt = statusAt;
  if (next === 'RESOLVED') {
    if (currentStatus !== 'RESOLVED') ticket.statusBeforeResolution = currentStatus;
    ticket.resolvedBy = req.user._id;
    ticket.resolvedAt = statusAt;
  } else if (isReopenAction || isRestoreAction) {
    ticket.reopenedAt = statusAt;
    ticket.ageStartedAt = statusAt;
    ticket.resolvedAt = null;
  }
  if (description) {
    ticket.remarks = description;
    ticket.statusRemarks = description;
  }
  await ticket.save();

  await logActivity({
    companyId: req.companyId,
    entityType: 'TICKET',
    entityId: ticket._id,
    action: isReopenAction ? 'TICKET_REOPENED' : isRestoreAction ? 'TICKET_STATUS_RESTORED' : 'TICKET_STATUS_CHANGED',
    performedBy: req.user._id,
    comment: description,
    details: {
      previousStatus: currentStatus,
      status: next,
      restoredPreviousStatus: isRestoreAction,
      description
    }
  });

  const statusNoticeUserIds = new Set(
    [ticket.assignedBy, (isReopenAction || isRestoreAction) ? ticket.assigneeId : null]
      .filter(Boolean)
      .map(String)
      .filter(id => id !== String(req.user._id))
  );
  for (const userId of statusNoticeUserIds) {
    try {
      await Notification.create({
        companyId: req.companyId,
        userId,
        type: 'TICKET',
        title: isReopenAction ? 'Ticket reopened by a lead' : isRestoreAction ? 'Ticket status restored' : 'Ticket status updated',
        message: `${ticket.ticketNumber} is now ${next}.${description ? ' Remarks: ' + description : ''}`,
        link: '/tickets',
        dedupeKey: `ticket-status-${ticket._id}-${next}-${userId}-${Date.now()}`
      });
    } catch {}
  }

  res.json({ message: 'Ticket status updated.', ticket });
}));

router.patch('/:id/assignment', requirePermission('tickets:assign'), asyncHandler(async (req, res) => {
  const ticket = await Ticket.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });

  if (ticket.workflowStatus === 'RESOLVED') {
    return res.status(400).json({ message: 'Cannot reassign a resolved ticket. Resolved tickets remain locked to the resolver until reopened.' });
  }

  const description = String(req.body.description || req.body.notes || '').trim();

  if (!req.body.assigneeId) {
    ticket.assigneeId = null;
    ticket.assignedBy = req.user._id;
    ticket.assignmentUpdatedAt = new Date();
    await ticket.save();
    return res.json(ticket);
  }

  const target = await ensureCompanyUser(req.companyId, req.body.assigneeId);
  if (!target) return res.status(400).json({ message: 'Choose an active user.' });
  if (!canAssign(req.user, target)) return res.status(403).json({ message: 'Your role cannot assign to this user.' });

  const prev = ticket.assigneeId;
  ticket.assigneeId = target._id;
  ticket.assignedBy = req.user._id;
  ticket.assignmentUpdatedAt = new Date();
  if (description) ticket.remarks = description;
  await ticket.save();

  await logActivity({
    companyId: req.companyId,
    entityType: 'TICKET',
    entityId: ticket._id,
    action: 'TICKET_ASSIGNED',
    performedBy: req.user._id,
    comment: description,
    details: { fromUserId: prev, assigneeId: target._id, assigneeName: target.name, description }
  });

  await Notification.create({
    companyId: req.companyId,
    userId: target._id,
    type: 'TICKET',
    title: 'Ticket assigned to you',
    message: `Ticket ${ticket.ticketNumber} has been assigned to you.${description ? ' Note: ' + description : ''}`,
    link: '/tickets',
    dedupeKey: `ticket-${ticket._id}-${Date.now()}`
  });

  res.json(ticket);
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const filter = { companyId: req.companyId };
  if (req.user.role === 'RE') filter.assigneeId = req.user._id;

  const all = await Ticket.find(filter).select('ticketNumber item description workflowStatus sourceStatus priorityName loggedDate ageStartedAt reopenedAt resolvedAt statusUpdatedAt assigneeId').lean();
  const status = t => normalizeWorkflowStatus(t.workflowStatus || t.sourceStatus);
  const open = all.filter(t => !isResolved(status(t)));
  const ageRelevant = t => status(t) === 'OPEN' || status(t) === 'WIP' || (!t.assigneeId && !isResolved(status(t)));
  const now = new Date();
  const age = t => ticketAgeDays(t, now);
  const agingCandidates = open.filter(ageRelevant);
  const agingRows = agingCandidates.filter(t => age(t) > 1).sort((a, b) => age(b) - age(a));
  const assigneeIds = [...new Set(agingRows.map(t => String(t.assigneeId || '')).filter(Boolean))];
  const assignees = assigneeIds.length
    ? await User.find({ _id: { $in: assigneeIds }, companyId: req.companyId }).select('_id name role').lean()
    : [];
  const assigneeById = new Map(assignees.map(person => [String(person._id), person]));

  res.json({
    total: all.length,
    open: open.length,
    closed: all.length - open.length,
    unassigned: all.filter(t => !t.assigneeId && !isResolved(status(t))).length,
    aging: agingRows.length,
    oldestAge: agingCandidates.length ? Math.max(...agingCandidates.map(age)) : 0,
    agingTickets: agingRows.slice(0, 10).map(t => ({
      _id: t._id,
      ticketNumber: t.ticketNumber,
      item: t.item,
      description: t.description,
      priorityName: t.priorityName,
      workflowStatus: status(t),
      ageDays: age(t),
      assignee: assigneeById.get(String(t.assigneeId || '')) || null
    })),
    critical: open.filter(t => /critical|urgent/i.test(t.priorityName)).length,
    high: open.filter(t => /high/i.test(t.priorityName)).length,
    statusBreakdown: ['OPEN', 'WIP', 'RESOLVED', 'REOPENED'].map(s => ({
      status: s,
      label: ({ OPEN: 'Open', WIP: 'Work in progress', RESOLVED: 'Resolved', REOPENED: 'Reopened' }[s]),
      count: all.filter(t => status(t) === s).length
    }))
  });
}));

export default router;
