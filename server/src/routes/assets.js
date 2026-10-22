import { Router } from 'express';
import mongoose from 'mongoose';
import { Asset, AssetHistory, AssetWorkEvent, User } from '../models.js';
import { auth, asyncHandler } from '../middleware.js';

const router = Router();
router.use(auth);

const SYSTEM_TYPES = new Set(['SOE', 'MTC 22', 'MTC 21', '440', '445']);
const ASSET_STATUSES = new Set(['RECEIVED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'RETURNED']);
const isLead = (user) => ['MANAGER', 'TL', 'SL'].includes(user.role);
const detailFields = ['userName', 'employeeId', 'project', 'systemType'];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizedIssue = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const isRepeatIssue = (asset, issue) => Boolean(
  asset?.status === 'RETURNED' && normalizedIssue(asset.lastCompletedIssue) &&
  normalizedIssue(asset.lastCompletedIssue) === normalizedIssue(issue)
);
const hasActiveRepeatIssue = (asset) => Boolean(
  ['RECEIVED', 'IN_PROGRESS'].includes(asset?.status) && normalizedIssue(asset.lastCompletedIssue) &&
  normalizedIssue(asset.lastCompletedIssue) === normalizedIssue(asset.issue)
);
async function repeatHistoryCounts(companyId, assetIds) {
  if (!assetIds.length) return new Map();
  const objectIds = assetIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const rows = await AssetHistory.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId), assetId: { $in: objectIds }, action: 'REPEAT_ISSUE' } },
    { $group: { _id: '$assetId', count: { $sum: 1 } } }
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

function repeatIssueSummary(asset, historyCount = 0) {
  const repeatIssues = (asset?.repeatIssues || []).map((row) => ({
    issue: String(row.issue || ''),
    count: Number(row.count) || 0,
    status: row.status === 'OPEN' ? 'OPEN' : 'RESOLVED',
    firstReportedAt: row.firstReportedAt || null,
    lastReportedAt: row.lastReportedAt || null,
    resolvedAt: row.resolvedAt || null
  }));
  const fallbackCount = Math.max(historyCount, Number(asset?.repeatIssueCount) || 0);
  if (!repeatIssues.length && fallbackCount > 0) {
    const active = hasActiveRepeatIssue(asset);
    repeatIssues.push({
      issue: asset?.lastCompletedIssue || asset?.issue || 'Issue details unavailable',
      count: fallbackCount,
      status: active ? 'OPEN' : 'RESOLVED',
      firstReportedAt: null,
      lastReportedAt: asset?.updatedAt || null,
      resolvedAt: active ? null : asset?.lastCompletedAt || null
    });
  }
  const countFromRecords = repeatIssues.reduce((total, row) => total + row.count, 0);
  const totalCount = Math.max(Number(asset?.repeatIssueCount) || 0, countFromRecords, historyCount);
  const latest = [...repeatIssues].sort((a, b) => new Date(b.lastReportedAt || 0) - new Date(a.lastReportedAt || 0))[0] || null;
  const active = repeatIssues.length
    ? repeatIssues.some((row) => row.status === 'OPEN')
    : hasActiveRepeatIssue(asset);
  return {
    repeatIssue: active,
    repeatIssueCount: totalCount,
    repeatIssues,
    repeatIssueSummary: latest,
    repeatIssueStatus: latest?.status || (active ? 'OPEN' : totalCount ? 'RESOLVED' : 'NONE')
  };
}

async function repeatedIssueUpdate(previous, issue, companyId) {
  const records = (previous?.repeatIssues || []).map((row) => ({ ...row }));
  const historyCount = previous?._id
    ? await AssetHistory.countDocuments({ companyId, assetId: previous._id, action: 'REPEAT_ISSUE' })
    : 0;
  const now = new Date();
  const issueKey = normalizedIssue(issue);
  let record = records.find((row) => normalizedIssue(row.issue) === issueKey);
  if (!record) {
    const legacyCount = !records.length && normalizedIssue(previous?.lastCompletedIssue) === issueKey
      ? Math.max(Number(previous?.repeatIssueCount) || 0, historyCount)
      : 0;
    record = { issue, count: legacyCount, status: 'OPEN', firstReportedAt: now, lastReportedAt: now, resolvedAt: null };
    records.push(record);
  }
  const previousTotal = Math.max(
    Number(previous?.repeatIssueCount) || 0,
    records.reduce((total, row) => total + (Number(row.count) || 0), 0),
    historyCount
  );
  record.issue = issue;
  record.count = (Number(record.count) || 0) + 1;
  record.status = 'OPEN';
  record.lastReportedAt = now;
  record.resolvedAt = null;
  return {
    fields: { repeatIssues: records, repeatIssueCount: previousTotal + 1 },
    occurrence: record.count
  };
}
const normalizedHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const valueFor = (row, name) => {
  const wanted = normalizedHeader(name);
  const key = Object.keys(row || {}).find((candidate) => normalizedHeader(candidate) === wanted);
  return key === undefined ? '' : row[key];
};

function cleanAssetRow(row, rowNumber) {
  const assetId = String(valueFor(row, 'Asset ID') ?? '').trim();
  const userName = String(valueFor(row, 'User Name') ?? '').trim();
  const employeeId = String(valueFor(row, 'Employee ID') ?? '').trim();
  const project = String(valueFor(row, 'Project') ?? '').trim();
  const issue = String(valueFor(row, 'Issue') ?? '').trim();
  const rawSystemType = String(valueFor(row, 'System Type') ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  const systemType = rawSystemType.replace(/^MTC\s*(22|21)$/, 'MTC $1');
  const errors = [];
  if (!assetId) errors.push({ row: rowNumber, field: 'Asset ID', message: 'Asset ID is required.' });
  if (systemType && !SYSTEM_TYPES.has(systemType)) errors.push({ row: rowNumber, field: 'System Type', message: 'System Type must be SOE, MTC 22, MTC 21, 440, or 445 when provided.' });
  return { value: { assetId, assetKey: assetId.toUpperCase(), userName, employeeId, project, issue, systemType }, errors };
}

function deduplicateRows(rows) {
  const unique = new Map();
  for (const row of rows) {
    const previous = unique.get(row.assetKey);
    // An asset is assigned once per event; repeats replace the issue and can fill blank details.
    unique.set(row.assetKey, previous ? { ...previous, ...missingDetailUpdates(previous, row), issue: row.issue || previous.issue } : row);
  }
  return [...unique.values()];
}

function missingDetailUpdates(previous, row) {
  return Object.fromEntries(detailFields
    .filter((field) => !String(previous[field] || '').trim() && String(row[field] || '').trim())
    .map((field) => [field, row[field]]));
}

function detailChanges(previous, row) {
  return Object.fromEntries(Object.entries(missingDetailUpdates(previous, row))
    .map(([field, value]) => [field, { from: previous[field] || '', to: value }]));
}

function assignmentChanges(previous, assignedToId) {
  const from = previous?.assignedToId ? String(previous.assignedToId) : null;
  const to = assignedToId ? String(assignedToId) : null;
  return from === to ? {} : { assignedTo: { from, to } };
}

function issueChanges(previous, row) {
  const from = String(previous?.issue || '');
  const to = String(row?.issue || '');
  return to && from !== to ? { issue: { from, to } } : {};
}

function visibleAssetQuery(companyId, search, status) {
  const query = { companyId, isArchived: { $ne: true } };
  if (status && ASSET_STATUSES.has(status)) query.status = status;
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(escaped, 'i');
    query.$or = [
      { assetId: matcher }, { userName: matcher }, { employeeId: matcher },
      { project: matcher }, { issue: matcher }, { systemType: matcher }
    ];
  }
  return query;
}

async function appendHistory({ companyId, asset, action, userId, eventId = null, changes = {}, comment = '' }) {
  return AssetHistory.create({ companyId, assetId: asset._id, action, performedBy: userId, eventId, changes, comment });
}

function repeatHistoryDetails(history, fallbackIssue) {
  const details = new Map();
  const counters = new Map();
  const openCycles = new Map();
  for (const row of [...history].reverse()) {
    const repeat = row.changes?.repeatIssue || {};
    if (row.action === 'REPEAT_ISSUE') {
      const issue = repeat.issue || row.changes?.issue?.to || fallbackIssue || 'Issue details unavailable';
      const key = normalizedIssue(issue);
      const count = Number(repeat.count) || (counters.get(key) || 0) + 1;
      counters.set(key, Math.max(counters.get(key) || 0, count));
      const info = { issue, count, status: 'OPEN', reportedAt: row.createdAt, resolvedAt: null };
      details.set(String(row._id), info);
      openCycles.set(key, { info, historyId: String(row._id) });
    } else if (row.action === 'STATUS_UPDATED' && row.changes?.status?.to === 'READY_FOR_PICKUP') {
      for (const [key, cycle] of openCycles) {
        cycle.info.status = 'RESOLVED';
        cycle.info.resolvedAt = row.createdAt;
        details.set(cycle.historyId, cycle.info);
        openCycles.delete(key);
      }
    } else if (row.action === 'REPEAT_ISSUE_RESOLVED') {
      const issue = repeat.issue || fallbackIssue || 'Issue details unavailable';
      const key = normalizedIssue(issue);
      const count = Number(repeat.count) || counters.get(key) || 0;
      const cycle = openCycles.get(key);
      if (cycle && (!count || cycle.info.count === count)) {
        cycle.info.status = 'RESOLVED';
        cycle.info.resolvedAt = repeat.resolvedAt || row.createdAt;
        details.set(cycle.historyId, cycle.info);
        openCycles.delete(key);
      }
      details.set(String(row._id), {
        issue,
        count,
        status: 'RESOLVED',
        reportedAt: cycle?.info.reportedAt || null,
        resolvedAt: repeat.resolvedAt || row.createdAt
      });
    }
  }
  return details;
}

async function validateAssignees(req, ids = []) {
  const uniqueIds = [...new Set(ids.map(String))];
  if (uniqueIds.some((id) => !mongoose.isValidObjectId(id))) return { error: 'One or more selected engineers are invalid.' };
  const users = uniqueIds.length
    ? await User.find({ _id: { $in: uniqueIds }, companyId: req.companyId, role: 'RE', status: 'active' }).select('_id name role team shift').lean()
    : [];
  if (users.length !== uniqueIds.length) return { error: 'Choose active Resolution Engineers from this workspace.' };
  if (req.user.role === 'TL' && users.some((u) => u.team !== req.user.team)) return { error: 'Team Leaders can assign assets only to engineers on their team.' };
  if (req.user.role === 'SL' && users.some((u) => u.team !== req.user.team || u.shift !== req.user.shift)) return { error: 'Shift Leads can assign assets only to engineers on their team and shift.' };
  return { users };
}

router.get('/', asyncHandler(async (req, res) => {
  const assets = await Asset.find(visibleAssetQuery(req.companyId, String(req.query.search || '').trim(), String(req.query.status || '')))
    .sort({ updatedAt: -1 })
    .populate('assignedToId', 'name role team')
    .populate('eventId', 'title scheduledAt')
    .populate('lastUpdatedBy', 'name role')
    .lean();
  const historyCounts = await repeatHistoryCounts(req.companyId, assets.map((asset) => asset._id));
  res.json(assets.map((asset) => ({ ...asset, ...repeatIssueSummary(asset, historyCounts.get(String(asset._id)) || 0) })));
}));

router.get('/lookup', asyncHandler(async (req, res) => {
  const search = String(req.query.q || '').trim().slice(0, 80);
  if (!search) return res.json([]);
  const matcher = new RegExp(escapeRegex(search), 'i');
  const assets = await Asset.find({
    companyId: req.companyId,
    isArchived: { $ne: true },
    $or: [{ assetId: matcher }, { employeeId: matcher }, { userName: matcher }]
  }).select('assetId userName employeeId project issue systemType status').sort({ updatedAt: -1 }).limit(20).lean();
  res.json(assets);
}));

router.get('/events', asyncHandler(async (req, res) => {
  const events = await AssetWorkEvent.find({ companyId: req.companyId, isArchived: { $ne: true } }).sort({ createdAt: -1 })
    .populate('assignedUserIds', 'name role team')
    .populate('createdBy', 'name role')
    .lean();
  res.json(events);
}));

router.delete('/events/:id', asyncHandler(async (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ message: 'Only a Manager, Team Leader, or Shift Lead can remove a bulk event.' });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Bulk event not found.' });
  const event = await AssetWorkEvent.findOne({ _id: req.params.id, companyId: req.companyId, isArchived: { $ne: true } });
  if (!event) return res.status(404).json({ message: 'Bulk event not found or already removed.' });
  event.isArchived = true;
  event.archivedAt = new Date();
  event.archivedBy = req.user._id;
  await event.save();
  res.json({ message: 'Bulk event removed from the event list. Asset records and service history were retained.' });
}));

router.get('/events/:id/report', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Asset event not found.' });
  const event = await AssetWorkEvent.findOne({ _id: req.params.id, companyId: req.companyId })
    .populate('assignedUserIds', 'name role team')
    .populate('createdBy', 'name role')
    .lean();
  if (!event) return res.status(404).json({ message: 'Asset event not found.' });

  const history = await AssetHistory.find({ companyId: req.companyId, eventId: event._id })
    .sort({ createdAt: 1, _id: 1 })
    .populate('performedBy', 'name role')
    .lean();
  const assetIds = [...new Set(history.map((row) => String(row.assetId)))];
  const eventAssigneeIds = (event.assignedUserIds || []).map((person) => String(person._id || person));
  const eventAssignmentByAsset = new Map(assetIds.map((id, index) => [
    id,
    eventAssigneeIds.length ? eventAssigneeIds[index % eventAssigneeIds.length] : ''
  ]));
  const assets = assetIds.length
    ? await Asset.find({ companyId: req.companyId, _id: { $in: assetIds } })
      .populate('assignedToId', 'name role team')
      .lean()
    : [];
  const repeatCounts = await repeatHistoryCounts(req.companyId, assetIds);
  const assetsById = new Map(assets.map((asset) => [String(asset._id), asset]));
  const historyByAsset = new Map();
  for (const row of history) {
    const id = String(row.assetId);
    if (!historyByAsset.has(id)) historyByAsset.set(id, []);
    historyByAsset.get(id).push(row);
  }

  const reportAssets = assetIds.map((id) => {
    const asset = assetsById.get(id);
    const rows = historyByAsset.get(id) || [];
    const isCurrentEvent = String(asset?.eventId || '') === String(event._id);
    const statusUpdates = rows.filter((row) => row.action === 'STATUS_UPDATED' && row.changes?.status?.to);
    const lastStatus = statusUpdates.length ? statusUpdates[statusUpdates.length - 1].changes.status.to : '';
    const status = isCurrentEvent ? asset.status : lastStatus || 'RECEIVED';
    const assignedChanges = rows.filter((row) => row.changes?.assignedTo && typeof row.changes.assignedTo === 'object');
    const lastAssignedChange = assignedChanges[assignedChanges.length - 1];
    const currentAssigneeId = String(asset?.assignedToId?._id || asset?.assignedToId || '');
    const repeatedIssue = repeatIssueSummary(asset, repeatCounts.get(id) || rows.filter((row) => row.action === 'REPEAT_ISSUE').length);
    const assignedUserId = isCurrentEvent
      ? currentAssigneeId
      : lastAssignedChange
        ? String(lastAssignedChange.changes.assignedTo.to || '')
        : String(eventAssignmentByAsset.get(id) || '');
    const workedRows = statusUpdates.filter((row) => row.performedBy?._id);
    const workedBy = [...new Map(workedRows.map((row) => [String(row.performedBy._id), {
      _id: String(row.performedBy._id), name: row.performedBy.name, role: row.performedBy.role
    }])).values()];
    const lastWork = statusUpdates[statusUpdates.length - 1] || null;
    return {
      _id: id,
      assetId: asset?.assetId || rows[0]?.changes?.assetId || 'Unknown asset',
      userName: asset?.userName || '',
      employeeId: asset?.employeeId || '',
      project: asset?.project || '',
      issue: asset?.issue || '',
      systemType: asset?.systemType || '',
      status,
      isArchived: Boolean(asset?.isArchived),
      ...repeatedIssue,
      assignedToId: assignedUserId,
      assignedTo: assignedUserId ? { _id: assignedUserId } : null,
      workedBy,
      lastWorkedAt: lastWork?.createdAt || null,
      lastWorkNote: lastWork?.comment || ''
    };
  }).sort((a, b) => a.assetId.localeCompare(b.assetId));

  const engineerIds = [...new Set([
    ...(event.assignedUserIds || []).map((person) => String(person._id || person)),
    ...reportAssets.flatMap((asset) => [asset.assignedToId, ...asset.workedBy.map((person) => person._id)]).filter(Boolean)
  ])];
  const engineers = engineerIds.length
    ? await User.find({ _id: { $in: engineerIds }, companyId: req.companyId }).select('name role team shift').lean()
    : [];
  const engineerById = new Map(engineers.map((person) => [String(person._id), person]));
  for (const asset of reportAssets) {
    if (asset.assignedToId) asset.assignedTo = engineerById.get(asset.assignedToId) || { _id: asset.assignedToId, name: 'Workspace user' };
    asset.workedBy = asset.workedBy.map((person) => engineerById.get(person._id) || person);
  }

  const isCompleted = (status) => ['READY_FOR_PICKUP', 'RETURNED'].includes(status);
  const summary = {
    total: reportAssets.length,
    completed: reportAssets.filter((asset) => isCompleted(asset.status)).length,
    readyForPickup: reportAssets.filter((asset) => asset.status === 'READY_FOR_PICKUP').length,
    returnedToUser: reportAssets.filter((asset) => asset.status === 'RETURNED').length,
    pending: reportAssets.filter((asset) => !isCompleted(asset.status)).length,
    worked: reportAssets.filter((asset) => asset.workedBy.length > 0).length
  };
  const engineerReport = engineerIds.map((id) => {
    const assigned = reportAssets.filter((asset) => asset.assignedToId === id);
    const worked = reportAssets.filter((asset) => asset.workedBy.some((person) => person._id === id));
    return {
      _id: id,
      name: engineerById.get(id)?.name || 'Workspace user',
      role: engineerById.get(id)?.role || 'RE',
      assignedCount: assigned.length,
      workedCount: worked.length,
      completedCount: worked.filter((asset) => isCompleted(asset.status)).length,
      pendingCount: assigned.filter((asset) => !isCompleted(asset.status)).length
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  res.json({ event, summary, engineers: engineerReport, assets: reportAssets });
}));

router.get('/events/:id/assets', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Asset event not found.' });
  const event = await AssetWorkEvent.findOne({ _id: req.params.id, companyId: req.companyId }).select('_id').lean();
  if (!event) return res.status(404).json({ message: 'Asset event not found.' });
  const assets = await Asset.find({ companyId: req.companyId, eventId: event._id, isArchived: { $ne: true } }).sort({ assetId: 1 })
    .populate('assignedToId', 'name role team')
    .lean();
  res.json(assets);
}));

router.post('/intake', asyncHandler(async (req, res) => {
  const { value, errors } = cleanAssetRow(req.body || {}, 1);
  if (errors.length) return res.status(400).json({ message: 'Asset ID is required before saving.', errors });
  const expectedPickupAt = req.body.expectedPickupAt ? new Date(req.body.expectedPickupAt) : null;
  if (expectedPickupAt && Number.isNaN(expectedPickupAt.getTime())) return res.status(400).json({ message: 'Expected pickup date is invalid.' });

  let assignedToId = null;
  if (req.user.role === 'RE') assignedToId = req.user._id;
  if (req.body.assignedToId) {
    if (!isLead(req.user)) return res.status(403).json({ message: 'Only a lead can assign an asset to another engineer.' });
    const checked = await validateAssignees(req, [req.body.assignedToId]);
    if (checked.error) return res.status(400).json({ message: checked.error });
    assignedToId = checked.users[0]._id;
  }

  const previous = await Asset.findOne({ companyId: req.companyId, assetKey: value.assetKey }).lean();
  const repeatIssue = isRepeatIssue(previous, value.issue);
  const repeatUpdate = repeatIssue ? await repeatedIssueUpdate(previous, value.issue, req.companyId) : null;
  const intakeUpdates = { status: 'RECEIVED', assignedToId, eventId: null, expectedPickupAt, lastUpdatedBy: req.user._id, returnedAt: null, isArchived: false, archivedAt: null, archivedBy: null };
  if (repeatUpdate) Object.assign(intakeUpdates, repeatUpdate.fields);
  if (previous && value.issue) intakeUpdates.issue = value.issue;
  if (previous) Object.assign(intakeUpdates, missingDetailUpdates(previous, value));
  const insertFields = { companyId: req.companyId, assetId: value.assetId, assetKey: value.assetKey };
  if (!previous) Object.assign(insertFields, { userName: value.userName, employeeId: value.employeeId, project: value.project, systemType: value.systemType, issue: value.issue });
  const asset = await Asset.findOneAndUpdate(
    { companyId: req.companyId, assetKey: value.assetKey },
    {
      $setOnInsert: insertFields,
      $set: intakeUpdates
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );
  const wasExisting = Boolean(previous);
  await appendHistory({
    companyId: req.companyId,
    asset,
    action: repeatIssue ? 'REPEAT_ISSUE' : wasExisting ? 'ISSUE_UPDATED' : 'ASSET_RECEIVED',
    userId: req.user._id,
    changes: wasExisting
      ? {
          ...detailChanges(previous, value),
          ...issueChanges(previous, value),
          ...(repeatIssue ? { repeatIssue: { from: false, to: true, issue: value.issue, count: repeatUpdate.occurrence, status: 'OPEN' } } : {}),
          status: { from: previous.status, to: 'RECEIVED' },
          ...assignmentChanges(previous, assignedToId),
          event: { from: previous.eventId ? String(previous.eventId) : null, to: null },
          expectedPickupAt: { from: previous.expectedPickupAt || null, to: expectedPickupAt }
        }
      : { assetId: value.assetId, userName: value.userName, employeeId: value.employeeId, project: value.project, systemType: value.systemType, issue: { from: '', to: value.issue }, status: 'RECEIVED', assignedTo: { from: null, to: assignedToId ? String(assignedToId) : null }, expectedPickupAt },
    comment: repeatIssue
      ? 'Repeat issue reported after the asset was returned from completed work. Review the earlier completion and status entries below.'
      : wasExisting ? 'Walk-in intake for an existing asset; the issue was updated and any supplied details filled previously blank fields.' : 'Walk-in asset intake.'
  });
  const result = await Asset.findById(asset._id).populate('assignedToId', 'name role team').populate('eventId', 'title scheduledAt').lean();
  res.status(wasExisting ? 200 : 201).json(result);
}));

router.post('/events', asyncHandler(async (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ message: 'Only a Manager, Team Leader, or Shift Lead can create a bulk asset event.' });
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
  const sourceRows = Array.isArray(req.body.assets) ? req.body.assets : [];
  if (!title) return res.status(400).json({ message: 'Event title is required.' });
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ message: 'Event date and time are invalid.' });
  if (!sourceRows.length) return res.status(400).json({ message: 'Add at least one asset row to the event.' });
  if (sourceRows.length > 1000) return res.status(400).json({ message: 'An event can include up to 1,000 asset rows at a time.' });

  const errors = [];
  const normalizedRows = sourceRows.map((row, index) => {
    const cleaned = cleanAssetRow(row, Number(row?.rowNumber) || index + 2);
    errors.push(...cleaned.errors);
    return cleaned.value;
  });
  if (errors.length) return res.status(400).json({ message: 'Every row must have an Asset ID. Correct the listed cells and upload again; no assets were saved.', errors });

  const rows = deduplicateRows(normalizedRows);
  const checked = await validateAssignees(req, Array.isArray(req.body.assigneeIds) ? req.body.assigneeIds : []);
  if (checked.error) return res.status(400).json({ message: checked.error });
  const assignees = checked.users;

  const event = await AssetWorkEvent.create({
    companyId: req.companyId,
    title,
    description,
    scheduledAt,
    assetCount: rows.length,
    assignedUserIds: assignees.map((u) => u._id),
    createdBy: req.user._id
  });

  const imported = [];
  for (const [index, row] of rows.entries()) {
    const previous = await Asset.findOne({ companyId: req.companyId, assetKey: row.assetKey }).lean();
    const repeatIssue = isRepeatIssue(previous, row.issue);
    const repeatUpdate = repeatIssue ? await repeatedIssueUpdate(previous, row.issue, req.companyId) : null;
    const assignedToId = assignees.length ? assignees[index % assignees.length]._id : null;
    const eventAssetUpdates = { status: 'RECEIVED', assignedToId, eventId: event._id, expectedPickupAt: null, lastUpdatedBy: req.user._id, returnedAt: null, isArchived: false, archivedAt: null, archivedBy: null };
    if (repeatUpdate) Object.assign(eventAssetUpdates, repeatUpdate.fields);
    if (previous && row.issue) eventAssetUpdates.issue = row.issue;
    if (previous) Object.assign(eventAssetUpdates, missingDetailUpdates(previous, row));
    const insertFields = { companyId: req.companyId, assetId: row.assetId, assetKey: row.assetKey };
    if (!previous) Object.assign(insertFields, { userName: row.userName, employeeId: row.employeeId, project: row.project, systemType: row.systemType, issue: row.issue });
    const asset = await Asset.findOneAndUpdate(
      { companyId: req.companyId, assetKey: row.assetKey },
      {
        $setOnInsert: insertFields,
        $set: eventAssetUpdates
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    imported.push(asset._id);
    await appendHistory({
      companyId: req.companyId,
      asset,
      action: repeatIssue ? 'REPEAT_ISSUE' : previous ? 'ISSUE_UPDATED' : 'ASSET_RECEIVED',
      userId: req.user._id,
      eventId: event._id,
      changes: previous
        ? {
            ...detailChanges(previous, row),
            ...issueChanges(previous, row),
            ...(repeatIssue ? { repeatIssue: { from: false, to: true, issue: row.issue, count: repeatUpdate.occurrence, status: 'OPEN' } } : {}),
            status: { from: previous.status, to: 'RECEIVED' },
            ...assignmentChanges(previous, assignedToId),
            event: { from: previous.eventId ? String(previous.eventId) : null, to: String(event._id) },
            expectedPickupAt: { from: previous.expectedPickupAt || null, to: null }
          }
        : { assetId: row.assetId, userName: row.userName, employeeId: row.employeeId, project: row.project, systemType: row.systemType, issue: { from: '', to: row.issue }, status: 'RECEIVED', assignedTo: { from: null, to: assignedToId ? String(assignedToId) : null } },
      comment: repeatIssue
        ? `Repeat issue reported in event "${title}" after the asset was returned from completed work. Review its earlier history.`
        : previous ? `Added to event "${title}"; any supplied details filled previously blank fields.` : `Received through event "${title}".`
    });
  }

  const savedEvent = await AssetWorkEvent.findById(event._id)
    .populate('assignedUserIds', 'name role team')
    .populate('createdBy', 'name role')
    .lean();
  res.status(201).json({ event: savedEvent, importedCount: imported.length, duplicateRowsMerged: normalizedRows.length - rows.length });
}));

async function archiveAssets(req, res, assetIds) {
  if (!isLead(req.user)) return res.status(403).json({ message: 'Only a Manager, Team Leader, or Shift Lead can remove assets from the register.' });
  if (!Array.isArray(assetIds)) return res.status(400).json({ message: 'Select assets to remove.' });
  const uniqueIds = [...new Set(assetIds.map(String))];
  if (!uniqueIds.length) return res.status(400).json({ message: 'Select at least one asset to remove.' });
  if (uniqueIds.length > 1000 || uniqueIds.some((id) => !mongoose.isValidObjectId(id))) {
    return res.status(400).json({ message: 'The selected asset list is invalid.' });
  }
  const assets = await Asset.find({ _id: { $in: uniqueIds }, companyId: req.companyId, isArchived: { $ne: true } }).lean();
  if (assets.length !== uniqueIds.length) return res.status(404).json({ message: 'One or more selected assets are missing or already removed. Refresh the register and try again.' });
  const archivedAt = new Date();
  await Asset.updateMany(
    { _id: { $in: uniqueIds }, companyId: req.companyId, isArchived: { $ne: true } },
    { $set: { isArchived: true, archivedAt, archivedBy: req.user._id, lastUpdatedBy: req.user._id, assignedToId: null } }
  );
  await Promise.all(assets.map((asset) => appendHistory({
    companyId: req.companyId,
    asset,
    action: 'ASSET_ARCHIVED',
    userId: req.user._id,
    eventId: asset.eventId,
    changes: { archive: { from: false, to: true }, assignedTo: { from: asset.assignedToId ? String(asset.assignedToId) : null, to: null } },
    comment: 'Removed from the active asset register by a team lead. Earlier history is retained.'
  })));
  return res.json({ message: `${assets.length} asset(s) removed from the active register.`, count: assets.length });
}

router.delete('/', asyncHandler(async (req, res) => archiveAssets(req, res, req.body?.assetIds)));
router.delete('/:id', asyncHandler(async (req, res) => archiveAssets(req, res, [req.params.id])));

router.patch('/bulk-assignment', asyncHandler(async (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ message: 'Only a Manager, Team Leader, or Shift Lead can distribute asset work.' });
  if (!Array.isArray(req.body.assetIds) || !req.body.assetIds.length) return res.status(400).json({ message: 'Select at least one asset to assign.' });
  const uniqueAssetIds = [...new Set(req.body.assetIds.map(String))];
  if (uniqueAssetIds.length > 1000 || uniqueAssetIds.some((id) => !mongoose.isValidObjectId(id))) {
    return res.status(400).json({ message: 'The selected asset list is invalid.' });
  }

  const checked = await validateAssignees(req, Array.isArray(req.body.assigneeIds) ? req.body.assigneeIds : []);
  if (checked.error) return res.status(400).json({ message: checked.error });
  if (!checked.users.length) return res.status(400).json({ message: 'Select at least one active Resolution Engineer.' });

  const assets = await Asset.find({ _id: { $in: uniqueAssetIds }, companyId: req.companyId, isArchived: { $ne: true } }).lean();
  if (assets.length !== uniqueAssetIds.length) return res.status(404).json({ message: 'One or more selected assets are missing or removed. Refresh the register and try again.' });
  const assetById = new Map(assets.map((asset) => [String(asset._id), asset]));
  const orderedAssets = uniqueAssetIds.map((id) => assetById.get(id));
  const assignments = orderedAssets.map((asset, index) => ({
    asset,
    assignee: checked.users[index % checked.users.length]
  }));
  const changedAssignments = assignments.filter(({ asset, assignee }) => String(asset.assignedToId || '') !== String(assignee._id));
  if (!changedAssignments.length) return res.json({ assignedCount: 0, message: 'The selected systems are already assigned to those engineers.' });

  const assignedAt = new Date();
  await Asset.bulkWrite(changedAssignments.map(({ asset, assignee }) => ({
    updateOne: {
      filter: { _id: asset._id, companyId: req.companyId, isArchived: { $ne: true } },
      update: { $set: { assignedToId: assignee._id, lastUpdatedBy: req.user._id, updatedAt: assignedAt } }
    }
  })));
  await AssetHistory.insertMany(changedAssignments.map(({ asset, assignee }) => ({
    companyId: req.companyId,
    assetId: asset._id,
    action: 'ASSET_REASSIGNED',
    performedBy: req.user._id,
    eventId: asset.eventId || null,
    changes: { assignedTo: { from: asset.assignedToId ? String(asset.assignedToId) : null, to: String(assignee._id) } },
    comment: 'Asset assigned by round-robin distribution.'
  })));

  const eventAssignees = new Map();
  for (const { asset, assignee } of changedAssignments) {
    if (!asset.eventId) continue;
    const eventId = String(asset.eventId);
    if (!eventAssignees.has(eventId)) eventAssignees.set(eventId, new Set());
    eventAssignees.get(eventId).add(String(assignee._id));
  }
  await Promise.all([...eventAssignees].map(([eventId, assigneeIds]) => AssetWorkEvent.updateOne(
    { _id: eventId, companyId: req.companyId },
    { $addToSet: { assignedUserIds: { $each: [...assigneeIds] } } }
  )));

  res.json({ assignedCount: changedAssignments.length, message: `${changedAssignments.length} system(s) distributed across ${checked.users.length} engineer(s).` });
}));

router.patch('/:id/assignment', asyncHandler(async (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ message: 'Only a Manager, Team Leader, or Shift Lead can assign or unassign an asset.' });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Asset not found.' });
  const asset = await Asset.findOne({ _id: req.params.id, companyId: req.companyId, isArchived: { $ne: true } });
  if (!asset) return res.status(404).json({ message: 'Asset not found.' });

  let assignedToId = null;
  if (req.body.assignedToId) {
    const checked = await validateAssignees(req, [req.body.assignedToId]);
    if (checked.error) return res.status(400).json({ message: checked.error });
    assignedToId = checked.users[0]._id;
  }

  const previousAssigneeId = asset.assignedToId ? String(asset.assignedToId) : null;
  const nextAssigneeId = assignedToId ? String(assignedToId) : null;
  if (previousAssigneeId === nextAssigneeId) {
    const unchanged = await Asset.findById(asset._id).populate('assignedToId', 'name role team').populate('eventId', 'title scheduledAt').lean();
    return res.json(unchanged);
  }

  asset.assignedToId = assignedToId;
  asset.lastUpdatedBy = req.user._id;
  await asset.save();
  await appendHistory({
    companyId: req.companyId,
    asset,
    action: assignedToId ? 'ASSET_REASSIGNED' : 'ASSET_UNASSIGNED',
    userId: req.user._id,
    eventId: asset.eventId,
    changes: { assignedTo: { from: previousAssigneeId, to: nextAssigneeId } },
    comment: assignedToId ? 'Asset assignment updated by a team lead.' : 'Asset unassigned from its engineer by a team lead.'
  });
  if (assignedToId && asset.eventId) {
    await AssetWorkEvent.updateOne(
      { _id: asset.eventId, companyId: req.companyId },
      { $addToSet: { assignedUserIds: assignedToId } }
    );
  }
  const result = await Asset.findById(asset._id).populate('assignedToId', 'name role team').populate('eventId', 'title scheduledAt').populate('lastUpdatedBy', 'name role').lean();
  return res.json(result);
}));

router.patch('/:id/status', asyncHandler(async (req, res) => {
  const status = String(req.body.status || '').toUpperCase();
  if (!ASSET_STATUSES.has(status)) return res.status(400).json({ message: 'Choose a valid asset status.' });
  const asset = await Asset.findOne({ _id: req.params.id, companyId: req.companyId, isArchived: { $ne: true } });
  if (!asset) return res.status(404).json({ message: 'Asset not found.' });
  const isAssignedEngineer = req.user.role === 'RE' && String(asset.assignedToId || '') === String(req.user._id);
  if (!isAssignedEngineer) return res.status(403).json({ message: 'Only the Resolution Engineer currently assigned to this system can update its status.' });
  if (asset.status === 'RETURNED' && status !== 'RECEIVED') return res.status(400).json({ message: 'A returned asset can only be checked in again as RECEIVED.' });
  if (asset.status === status) return res.json(asset);
  const from = asset.status;
  const statusUpdatedAt = new Date();
  const previousPickupDate = asset.expectedPickupAt;
  const storedRepeatIssues = (asset.repeatIssues || []).map((row) => typeof row.toObject === 'function' ? row.toObject() : row);
  const hadActiveRepeatIssue = storedRepeatIssues.length
    ? storedRepeatIssues.some((row) => row.status === 'OPEN')
    : hasActiveRepeatIssue(asset);
  const previousLastCompletedAt = asset.lastCompletedAt;
  const resolvedRepeatIssues = [];
  asset.status = status;
  if (status === 'READY_FOR_PICKUP') {
    asset.lastCompletedAt = statusUpdatedAt;
    asset.lastCompletedIssue = asset.issue || '';
    const repeatRecords = storedRepeatIssues.map((row) => ({ ...row }));
    if (hadActiveRepeatIssue && !repeatRecords.some((row) => row.status === 'OPEN')) {
      const historyCount = await AssetHistory.countDocuments({ companyId: req.companyId, assetId: asset._id, action: 'REPEAT_ISSUE' });
      repeatRecords.push({
        issue: asset.lastCompletedIssue || 'Issue details unavailable',
        count: Math.max(Number(asset.repeatIssueCount) || 0, historyCount, 1),
        status: 'OPEN',
        firstReportedAt: previousLastCompletedAt || asset.updatedAt || statusUpdatedAt,
        lastReportedAt: previousLastCompletedAt || asset.updatedAt || statusUpdatedAt,
        resolvedAt: null
      });
    }
    for (const repeat of repeatRecords) {
      if (repeat.status !== 'OPEN') continue;
      repeat.status = 'RESOLVED';
      repeat.resolvedAt = statusUpdatedAt;
      resolvedRepeatIssues.push({ issue: repeat.issue, count: repeat.count });
    }
    asset.repeatIssues = repeatRecords;
    asset.repeatIssueCount = Math.max(Number(asset.repeatIssueCount) || 0, repeatRecords.reduce((total, row) => total + (Number(row.count) || 0), 0));
  }
  asset.lastUpdatedBy = req.user._id;
  asset.returnedAt = status === 'RETURNED' ? new Date() : null;
  if (status === 'RETURNED') asset.expectedPickupAt = null;
  await asset.save();
  await appendHistory({
    companyId: req.companyId,
    asset,
    action: 'STATUS_UPDATED',
    userId: req.user._id,
    eventId: asset.eventId,
    changes: {
      status: { from, to: status },
      ...(status === 'RETURNED' && previousPickupDate ? { expectedPickupAt: { from: previousPickupDate, to: null } } : {})
    },
    comment: String(req.body.comment || '').trim()
  });
  for (const repeat of resolvedRepeatIssues) {
    await appendHistory({
      companyId: req.companyId,
      asset,
      action: 'REPEAT_ISSUE_RESOLVED',
      userId: req.user._id,
      eventId: asset.eventId,
      changes: { repeatIssue: { issue: repeat.issue, count: repeat.count, status: { from: 'OPEN', to: 'RESOLVED' }, resolvedAt: statusUpdatedAt } },
      comment: `Repeated issue resolved: ${repeat.issue}. It has repeated ${repeat.count} time(s).`
    });
  }
  const result = await Asset.findById(asset._id).populate('assignedToId', 'name role team').populate('eventId', 'title scheduledAt').populate('lastUpdatedBy', 'name role').lean();
  res.json(result);
}));

router.get('/:id/history', asyncHandler(async (req, res) => {
  const asset = await Asset.findOne({ _id: req.params.id, companyId: req.companyId }).select('_id issue lastCompletedIssue').lean();
  if (!asset) return res.status(404).json({ message: 'Asset not found.' });
  const history = await AssetHistory.find({ companyId: req.companyId, assetId: asset._id }).sort({ createdAt: -1, _id: -1 })
    .populate('performedBy', 'name role')
    .populate('eventId', 'title')
    .lean();
  const repeatDetails = repeatHistoryDetails(history, asset.lastCompletedIssue || asset.issue);
  const assigneeIds = [...new Set(history.flatMap((row) => {
    const assigned = row.changes?.assignedTo;
    return assigned && typeof assigned === 'object' ? [assigned.from, assigned.to].filter(Boolean).map(String) : [];
  }))];
  const assignees = assigneeIds.length
    ? await User.find({ _id: { $in: assigneeIds }, companyId: req.companyId }).select('name role').lean()
    : [];
  const assigneeNames = new Map(assignees.map((person) => [String(person._id), person.name]));
  res.json(history.map((row) => {
    const assigned = row.changes?.assignedTo;
    return {
      ...row,
      repeatIssueInfo: repeatDetails.get(String(row._id)) || null,
      assignedToNames: assigned && typeof assigned === 'object' ? {
        from: assigned.from ? assigneeNames.get(String(assigned.from)) || 'Unassigned' : 'Unassigned',
        to: assigned.to ? assigneeNames.get(String(assigned.to)) || 'Unassigned' : 'Unassigned'
      } : null
    };
  }));
}));

export default router;
