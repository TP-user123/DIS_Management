const DAY_MS = 86_400_000;

export function normalizePriority(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (['critical', 'urgent', 'p1', 'sev 1', 'severity 1', 'very high'].includes(key)) return 'Critical';
  if (['high', 'p2', 'sev 2', 'severity 2'].includes(key)) return 'High';
  if (['medium', 'moderate', 'normal', 'p3', 'sev 3', 'severity 3'].includes(key)) return 'Medium';
  if (['low', 'p4', 'sev 4', 'severity 4'].includes(key)) return 'Low';
  return 'Medium';
}

export function normalizeCategory(value, fallback = 'Uncategorized') {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return fallback;
  const key = normalized.toLowerCase();
  const known = new Map([
    ['incident', 'Incident'],
    ['service request', 'Service Request'],
    ['service_request', 'Service Request'],
    ['operational', 'Operational'],
    ['general task', 'General Task'],
    ['other', 'Other']
  ]);
  if (known.has(key)) return known.get(key);
  return normalized.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function normalizeWorkflowStatus(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['resolved', 'closed', 'complete', 'completed'].includes(key)) return 'RESOLVED';
  if (['work_in_progress', 'in_progress', 'wip', 'working'].includes(key)) return 'WIP';
  if (['reopen', 'reopened'].includes(key)) return 'REOPENED';
  if (['routed', 'assigned', 'escalated'].includes(key)) return 'ROUTED';
  return 'OPEN';
}

export function ticketAgeDays(ticket, now = new Date()) {
  const status = normalizeWorkflowStatus(ticket?.workflowStatus || ticket?.sourceStatus);
  const loggedDate = new Date(ticket?.loggedDate || ticket?.createdAt || now);
  const start = status === 'REOPENED'
    ? new Date(ticket?.reopenedAt || ticket?.ageStartedAt || loggedDate)
    : new Date(ticket?.ageStartedAt || loggedDate);
  const end = status === 'RESOLVED'
    ? new Date(ticket?.resolvedAt || ticket?.statusUpdatedAt || ticket?.updatedAt || now)
    : now;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / DAY_MS));
}

export function ticketFilterConditions({ status, category, priority, search }, assigneeIds = []) {
  const conditions = [];
  const statusValue = String(status || '').trim().toUpperCase();
  if (statusValue && statusValue !== 'ALL') {
    const sourceAliases = statusValue === 'OPEN' ? ['open', 'new']
      : statusValue === 'WIP' ? ['wip', 'work in progress', 'in progress', 'working']
        : statusValue === 'ROUTED' ? ['routed', 'assigned', 'escalated']
          : statusValue === 'RESOLVED' ? ['resolved', 'closed', 'complete', 'completed']
            : statusValue === 'REOPENED' ? ['reopen', 'reopened'] : [statusValue.toLowerCase()];
    const legacyStatus = sourceAliases.map((value) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
    const workflowMissing = { $or: [
      { workflowStatus: { $exists: false } },
      { workflowStatus: null },
      { workflowStatus: '' }
    ] };
    conditions.push({ $or: [
      { workflowStatus: { $in: legacyStatus } },
      { $and: [workflowMissing, { sourceStatus: { $in: legacyStatus } }] },
      ...(statusValue === 'OPEN' ? [{ $and: [workflowMissing, { $or: [
        { sourceStatus: { $exists: false } }, { sourceStatus: null }, { sourceStatus: '' }
      ] }] }] : [])
    ] });
  }

  const categoryValue = String(category || '').trim();
  if (categoryValue && categoryValue.toUpperCase() !== 'ALL') {
    const escaped = categoryValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(`^${escaped}$`, 'i');
    conditions.push({ $or: [{ category: matcher }, { requestType: matcher }] });
  }

  const priorityValue = String(priority || '').trim();
  if (priorityValue && priorityValue.toUpperCase() !== 'ALL') {
    const canonical = normalizePriority(priorityValue);
    const aliases = canonical === 'Critical' ? ['critical', 'urgent', 'p1', 'very high', 'sev 1', 'severity 1']
      : canonical === 'High' ? ['high', 'p2', 'sev 2', 'severity 2']
        : canonical === 'Low' ? ['low', 'p4', 'sev 4', 'severity 4'] : ['medium', 'moderate', 'normal', 'p3', 'sev 3', 'severity 3'];
    const priorityConditions = [{ priorityName: { $in: aliases.map((value) => new RegExp(`^${value}$`, 'i')) } }];
    if (canonical === 'Medium') priorityConditions.push({ priorityName: { $exists: false } }, { priorityName: null }, { priorityName: '' });
    conditions.push({ $or: priorityConditions });
  }

  const query = String(search || '').trim();
  if (query) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(escaped, 'i');
    conditions.push({ $or: [
      { ticketNumber: matcher }, { description: matcher }, { item: matcher }, { category: matcher },
      { requestType: matcher }, { priorityName: matcher }, { workflowStatus: matcher }, { sourceStatus: matcher },
      ...(assigneeIds.length ? [{ assigneeId: { $in: assigneeIds } }] : [])
    ] });
  }
  return conditions;
}

function normalizedHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeTicketImportRow(row = {}, now = new Date()) {
  const lookup = new Map(Object.entries(row).map(([key, value]) => [normalizedHeader(key), value]));
  const get = (...keys) => {
    for (const key of keys) {
      const value = lookup.get(normalizedHeader(key));
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return '';
  };
  const ticketNumber = String(get('Ticket Number', 'Ticket ID', 'ticketNumber')).trim();
  if (!ticketNumber) return { error: 'Ticket Number is required.' };

  let loggedDate = get('Logged Date', 'loggedDate', 'Created Date', 'Opened Date');
  if (typeof loggedDate === 'number' && Number.isFinite(loggedDate)) {
    loggedDate = new Date(Date.UTC(1899, 11, 30) + loggedDate * DAY_MS);
  } else if (loggedDate) {
    loggedDate = new Date(loggedDate);
  } else {
    loggedDate = new Date(now);
  }
  if (!(loggedDate instanceof Date) || Number.isNaN(loggedDate.getTime())) return { error: 'Logged Date is invalid.' };

  const requestType = String(get('Request Type', 'requestType')).trim();
  const category = normalizeCategory(get('Category', 'Ticket Category', 'Request Category', 'requestType', 'Item') || requestType);
  const priorityName = normalizePriority(get('Priority Name', 'Priority', 'priorityName'));
  const sourceStatus = String(get('Status', 'Source Status', 'status') || 'Open').trim();
  const workflowStatus = normalizeWorkflowStatus(get('Workflow Status', 'OpsDesk Status') || sourceStatus);
  const resolvedValue = get('Resolved At', 'Resolution Date', 'Closed At');
  const resolvedAt = resolvedValue
    ? typeof resolvedValue === 'number'
      ? new Date(Date.UTC(1899, 11, 30) + resolvedValue * DAY_MS)
      : new Date(resolvedValue)
    : null;
  if (resolvedValue && Number.isNaN(resolvedAt.getTime())) return { error: 'Resolved At is invalid.' };

  return {
    value: {
      ticketNumber,
      sourceStatus,
      workflowStatus,
      ...(resolvedValue ? { resolvedAt } : {}),
      category,
      requestType: requestType || category,
      priorityName,
      loggedDate,
      solutionProvider: String(get('Solution Provider')).trim(),
      currentLevel: String(get('Current Level')).trim(),
      item: String(get('Item')).trim(),
      description: String(get('Description')).trim(),
      remarks: String(get('Remarks')).trim(),
      sourceRow: row
    }
  };
}
