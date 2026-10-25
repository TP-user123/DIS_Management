import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileSpreadsheet,
  Handshake,
  History,
  Laptop,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserRound,
  Wrench
} from 'lucide-react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Swal from '../utils/swal.js';

const headers = ['Asset ID', 'User Name', 'Employee ID', 'Project', 'Issue', 'System Type'];
const systemTypes = ['SOE', 'MTC 22', 'MTC 21', '440', '445'];
const statuses = ['RECEIVED', 'IN_PROGRESS', 'READY_FOR_PICKUP'];
const activeStatuses = ['RECEIVED', 'IN_PROGRESS'];
const emptyRow = { assetId: '', userName: '', employeeId: '', project: '', issue: '', systemType: '' };
const emptyIntake = { ...emptyRow, assignedToId: '', expectedPickupAt: '' };
const emptyEvent = { title: '', description: '', scheduledAt: '', assigneeIds: [] };
const normalizeHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function downloadTemplate() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  sheet['!cols'] = [{ wch: 20 }, { wch: 26 }, { wch: 20 }, { wch: 22 }, { wch: 42 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Assets');
  const instructions = XLSX.utils.aoa_to_sheet([
    ['Asset upload instructions'],
    ['Fill one system per row in the Assets sheet. Keep all six column headers unchanged.'],
    ['Asset ID is required. User Name, Employee ID, Project, Issue, and System Type are optional.'],
    ['If System Type is supplied, it must be SOE, MTC 22, MTC 21, 440, or 445.'],
    ['Repeated Asset IDs are merged into one system; the last row supplies the issue, and optional details can fill previously blank fields.']
  ]);
  instructions['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions');
  XLSX.writeFile(workbook, 'asset-upload-template.xlsx');
  Swal.success('Template downloaded', 'Fill the Asset ID column for every row. The other fields are optional.');
}

function formatStatus(status) {
  const label = String(status || '').trim();
  const key = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (key.includes('READY_FOR_PICKUP') || ['RESOLVED', 'RETURNED'].includes(key)) return 'Resolved';
  if (['COMPLETED', 'DONE'].includes(key) || key.endsWith('_DONE')) return 'Completed';
  return ({ RECEIVED: 'Received', IN_PROGRESS: 'In progress' })[key] || label.replaceAll('_', ' ');
}

function formatIssueStatus(status) {
  if (String(status || '').toUpperCase() === 'RESOLVED') return 'Resolved';
  if (status === 'RECEIVED') return 'Pending';
  return formatStatus(status);
}

function eventReportFilename(event) {
  return String(event.title || 'bulk-event').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'bulk-event';
}

function downloadEventExcel(report) {
  if (!report) return;
  const { event, summary, engineers, assets } = report;
  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    ['Bulk event report', event.title],
    ['Created by', event.createdBy?.name || 'Workspace user'],
    ['Created at', new Date(event.createdAt).toLocaleString()],
    ['Planned for', event.scheduledAt ? new Date(event.scheduledAt).toLocaleString() : 'Not scheduled'],
    [], ['Summary', 'Count'],
    ['Total systems', summary.total],
    ['Resolved issues', (summary.readyForPickup || 0) + (summary.returnedToUser || 0)],
    ['Pending', summary.pending],
    ['Systems worked on', summary.worked]
  ];
  const engineerRows = [
    ['Engineer', 'Assigned systems', 'Worked on', 'Completed', 'Pending'],
    ...engineers.map((person) => [person.name, person.assignedCount, person.workedCount, person.completedCount, person.pendingCount])
  ];
  const assetRows = [
    ['Asset ID', 'User name', 'Employee ID', 'Project', 'Issue', 'System type', 'Assigned to', 'Worked by', 'Status', 'Repeat count (asset)', 'Repeated issue', 'Repeat count (issue)', 'Repeat status', 'Last worked at', 'Last work note', 'Archived'],
    ...assets.map((asset) => [
      asset.assetId, asset.userName, asset.employeeId, asset.project, asset.issue, asset.systemType,
      asset.assignedTo?.name || 'Unassigned', asset.workedBy.map((person) => person.name).join(', '),
      formatStatus(asset.status), asset.repeatIssueCount || 0, asset.repeatIssueSummary?.issue || '', asset.repeatIssueSummary?.count || 0, asset.repeatIssueStatus || 'NONE',
      asset.lastWorkedAt ? new Date(asset.lastWorkedAt).toLocaleString() : '', asset.lastWorkNote, asset.isArchived ? 'Yes' : 'No'
    ])
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 25 }, { wch: 48 }];
  const engineerSheet = XLSX.utils.aoa_to_sheet(engineerRows);
  engineerSheet['!cols'] = [{ wch: 26 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 14 }];
  const assetSheet = XLSX.utils.aoa_to_sheet(assetRows);
  assetSheet['!cols'] = [20, 24, 18, 22, 40, 16, 24, 28, 20, 18, 40, 18, 14, 24, 40, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(workbook, engineerSheet, 'Engineer workload');
  XLSX.utils.book_append_sheet(workbook, assetSheet, 'Systems');
  XLSX.writeFile(workbook, `${eventReportFilename(event)}-report.xlsx`);
  Swal.success('Excel report downloaded', 'The workbook has summary, engineer workload, and system detail sheets.');
}

function openEventPdf(report) {
  if (!report) return;
  const { event, summary, engineers, assets } = report;
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    Swal.error('PDF window blocked', 'Allow popups for this site, then select PDF again.');
    return;
  }
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const engineerRows = engineers.map((person) => `<tr><td>${html(person.name)}</td><td>${person.assignedCount}</td><td>${person.workedCount}</td><td>${person.completedCount}</td><td>${person.pendingCount}</td></tr>`).join('');
  const assetRows = assets.map((asset) => `<tr class="${asset.repeatIssueCount ? 'repeat' : ''}"><td>${html(asset.assetId)}${asset.repeatIssueCount ? ` <b>REPEAT ×${asset.repeatIssueCount}</b>` : ''}</td><td>${html(asset.userName)}<br>${html(asset.project)}</td><td>${html(asset.issue)}${asset.repeatIssueSummary ? `<br><small>Repeated: ${html(asset.repeatIssueSummary.issue)} ×${asset.repeatIssueSummary.count} · ${html(asset.repeatIssueSummary.status)}</small>` : ''}</td><td>${html(asset.assignedTo?.name || 'Unassigned')}</td><td>${html(asset.workedBy.map((person) => person.name).join(', ') || 'No work logged')}</td><td>${html(formatStatus(asset.status))}</td><td>${html(asset.lastWorkNote || '')}</td></tr>`).join('');
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${html(event.title)} - report</title><style>@page{size:landscape;margin:12mm}body{font:12px Arial,sans-serif;color:#233047}h1{font-size:22px;margin:0 0 5px}p{color:#68758a;margin:0 0 18px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.summary div{border:1px solid #dce3ed;border-radius:7px;padding:10px}.summary b,.summary span{display:block}.summary span{font-size:20px;font-weight:700;margin-top:5px}h2{font-size:15px;margin:20px 0 8px}table{width:100%;border-collapse:collapse;font-size:9px}th,td{border:1px solid #dce3ed;text-align:left;padding:6px;vertical-align:top}th{background:#f1f4f8}.repeat{background:#fff1ec}.repeat b{color:#a44333}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><h1>${html(event.title)}</h1><p>${html(event.description || 'Bulk software update or system support event')} | Created by ${html(event.createdBy?.name || 'Workspace user')} | ${event.scheduledAt ? `Planned ${html(new Date(event.scheduledAt).toLocaleString())}` : `Created ${html(new Date(event.createdAt).toLocaleString())}`}</p><div class="summary"><div>Total systems<span>${summary.total}</span></div><div>Resolved issue<span>${(summary.readyForPickup || 0) + (summary.returnedToUser || 0)}</span></div><div>Pending<span>${summary.pending}</span></div><div>Worked on<span>${summary.worked}</span></div></div><h2>Engineer workload</h2><table><thead><tr><th>Engineer</th><th>Assigned</th><th>Worked on</th><th>Completed</th><th>Pending</th></tr></thead><tbody>${engineerRows || '<tr><td colspan="5">No engineer activity.</td></tr>'}</tbody></table><h2>System details</h2><table><thead><tr><th>Asset ID</th><th>User / Project</th><th>Issue</th><th>Assigned to</th><th>Worked by</th><th>Status</th><th>Last work note</th></tr></thead><tbody>${assetRows || '<tr><td colspan="7">No systems found.</td></tr>'}</tbody></table></body></html>`);
  printWindow.document.close();
  window.setTimeout(() => { printWindow.focus(); printWindow.print(); }, 300);
}

function historyActionLabel(action, changes = {}) {
  if (action === 'ISSUE_CREATED') return `Issue #${changes.issueNumber || ''} reported`.trim();
  if (action === 'STATUS_UPDATED' && isResolvedStatus(historyStatusTo(changes))) {
    return `Issue #${changes.issueNumber || ''} resolved`.trim();
  }
  return ({
    ASSET_RECEIVED: 'Asset received',
    ASSET_DETAILS_UPDATED: 'Asset details updated',
    ISSUE_UPDATED: 'Issue updated',
    STATUS_UPDATED: 'Status updated',
    REPEAT_ISSUE: 'Repeat issue reported',
    REPEAT_ISSUE_RESOLVED: 'Repeat issue resolved',
    ASSET_REASSIGNED: 'Engineer assignment updated',
    ASSET_UNASSIGNED: 'Engineer unassigned',
    ASSET_ARCHIVED: 'Removed from active register'
  })[action] || String(action || 'Asset update').replaceAll('_', ' ');
}

function historyStatusTo(changes) {
  const status = changes?.status;
  return status && typeof status === 'object' ? status.to : status;
}

function isResolvedStatus(status) {
  const key = String(status || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return key.includes('READY_FOR_PICKUP') || ['RESOLVED', 'RETURNED', 'COMPLETED', 'DONE'].includes(key) || key.endsWith('_DONE');
}

function historyTransition(value, formatter = (x) => x) {
  if (value == null || value === '') return '';
  if (typeof value !== 'object') return formatter(value);
  return `${formatter(value.from || '\u2014')} \u2192 ${formatter(value.to || '\u2014')}`;
}

export default function Assets() {
  const { user } = useAuth();
  const userId = String(user?.id || user?._id || '');
  const isLead = ['MANAGER', 'TL', 'SL'].includes(user?.role);
  const canCreateEvent = isLead;
  const [assets, setAssets] = useState([]);
  const [issueSummary, setIssueSummary] = useState({ totalIssues: 0, activeIssues: 0, resolvedIssues: 0, myActiveIssues: 0, myResolvedIssues: 0 });
  const [issueRows, setIssueRows] = useState([]);
  const [issueQueueLoading, setIssueQueueLoading] = useState(false);
  const [issueQueueError, setIssueQueueError] = useState('');
  const [events, setEvents] = useState([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [mineOnly, setMineOnly] = useState(false);
  const [view, setView] = useState('assets');
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [newIssueMode, setNewIssueMode] = useState(false);
  const [intakeForm, setIntakeForm] = useState(emptyIntake);
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [manualRow, setManualRow] = useState(emptyRow);
  const [eventRows, setEventRows] = useState([]);
  const [historyAsset, setHistoryAsset] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [bulkAssignmentOpen, setBulkAssignmentOpen] = useState(false);
  const [bulkAssigneeIds, setBulkAssigneeIds] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventReport, setEventReport] = useState(null);
  const [eventAssetsLoading, setEventAssetsLoading] = useState(false);
  const [handoverOptions, setHandoverOptions] = useState([]);
  const [handoverAsset, setHandoverAsset] = useState(null);
  const [handoverForm, setHandoverForm] = useState({ toUserId: '', reason: '', notes: '' });
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  const showError = (title, message) => {
    setError(message);
    Swal.error(title, message);
  };

  const upsertAsset = (updated) => {
    if (!updated?._id) return;
    setAssets((current) => {
      const index = current.findIndex((asset) => asset._id === updated._id);
      if (index < 0) return [updated, ...current];
      return current.map((asset) => {
        if (asset._id !== updated._id) return asset;
        return {
          ...asset,
          ...updated,
          ...(updated.pendingHandoverId === null ? { pendingHandovers: [] } : {})
        };
      });
    });
  };

  const refreshIssueSummary = () => {
    api.get('/assets/issues/summary').then(({ data }) => setIssueSummary(data)).catch(() => {});
  };

  const load = async (showAlert = true) => {
    const isInitialLoad = assets.length === 0;
    if (isInitialLoad) setLoading(true);
    else setRefreshing(true);
    try {
      const assetResponse = await api.get('/assets');
      setAssets(assetResponse.data);
      refreshIssueSummary();
      setError('');
      return true;
    } catch (e) {
      const message = e.response?.data?.message || 'Could not load the shared asset register.';
      setError(message);
      if (showAlert) Swal.error('Asset desk unavailable', message);
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadEvents = async (showAlert = false) => {
    if (eventsLoading || eventsLoaded) return;
    setEventsLoading(true);
    try {
      const { data } = await api.get('/assets/events');
      setEvents(data);
      setEventsLoaded(true);
    } catch (e) {
      const message = e.response?.data?.message || 'Could not load bulk asset events.';
      setError(message);
      if (showAlert) Swal.error('Events unavailable', message);
    } finally {
      setEventsLoading(false);
    }
  };

  const loadIssueQueue = async (showLoading = false) => {
    if (showLoading && !issueRows.length) setIssueQueueLoading(true);
    try {
      const { data } = await api.get('/assets/issues');
      setIssueRows(data);
      setIssueQueueError('');
    } catch (e) {
      setIssueQueueError(e.response?.data?.message || 'Could not load the issue queue.');
    } finally {
      setIssueQueueLoading(false);
    }
  };

  const openEvents = () => {
    setView('events');
    loadEvents(true);
  };

  const openIssueQueue = (status = 'ALL', assignedToMe = false) => {
    setView('issues');
    setStatusFilter(status);
    setMineOnly(assignedToMe);
    setSearch('');
  };

  useEffect(() => {
    if (view !== 'issues') return undefined;
    loadIssueQueue(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadIssueQueue(false);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [view]);

  useEffect(() => {
    load();
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      api.get('/assets').then(({ data }) => setAssets(data)).catch(() => {});
      refreshIssueSummary();
    }, 15000);
    if (isLead) {
      api.get('/team')
        .then((r) => setMembers(r.data.filter((m) => m.status === 'active' && m.role === 'RE')))
        .catch((e) => showError('Could not load engineers', e.response?.data?.message || 'Engineer assignment options could not be loaded.'));
    }
    if (user?.role === 'RE') {
      api.get('/assets/handover-options')
        .then((r) => setHandoverOptions(r.data))
        .catch(() => {});
    }
    return () => window.clearInterval(refreshInterval);
  }, []);

  const visibleAssets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assets.filter((asset) => {
      const isUnassigned = !asset.assignedToId?._id && !asset.assignedToId;
      const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'UNASSIGNED'
        ? isUnassigned
        : statusFilter === 'RESOLVED' || statusFilter === 'COMPLETED'
          ? ['READY_FOR_PICKUP', 'RETURNED'].includes(asset.status)
          : asset.status === statusFilter);
      const matchesAssignee = !mineOnly || String(asset.assignedToId?._id || asset.assignedToId || '') === userId;
      const haystack = [asset.assetId, asset.userName, asset.employeeId, asset.project, asset.issue, asset.systemType, asset.assignedToId?.name]
        .join(' ').toLowerCase();
      return matchesStatus && matchesAssignee && (!term || haystack.includes(term));
    });
  }, [assets, search, statusFilter, mineOnly, userId]);

  const visibleIssueRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return issueRows.filter((row) => {
      const isResolved = row.status === 'RESOLVED';
      const assignedToId = String(row.assignedTo?._id || row.assignedTo || '');
      const resolvedById = String(row.resolvedBy?._id || row.resolvedBy || '');
      const matchesStatus = statusFilter === 'ALL' ||
        (statusFilter === 'UNASSIGNED' ? !assignedToId :
          statusFilter === 'ACTIVE' ? !isResolved :
            statusFilter === 'RESOLVED' || statusFilter === 'COMPLETED' || statusFilter === 'READY_FOR_PICKUP' || statusFilter === 'RETURNED'
              ? isResolved
              : row.status === statusFilter);
      const matchesAssignee = !mineOnly || assignedToId === userId || (user?.role === 'RE' && resolvedById === userId);
      const haystack = [
        row.asset?.assetId, row.asset?.userName, row.asset?.employeeId, row.asset?.project,
        row.asset?.systemType, row.asset?.event?.title, row.issue, row.assignedTo?.name, row.resolvedBy?.name
      ].join(' ').toLowerCase();
      return matchesStatus && matchesAssignee && (!term || haystack.includes(term));
    });
  }, [issueRows, search, statusFilter, mineOnly, userId, user?.role]);

  const assignableMembers = useMemo(() => members.filter((member) => (
    user?.role === 'MANAGER' ||
    (user?.role === 'TL' && member.team === user.team) ||
    (user?.role === 'SL' && member.team === user.team && member.shift === user.shift)
  )), [members, user]);

  const counts = useMemo(() => ({
    total: assets.length,
    working: user?.role === 'RE' ? issueSummary.myActiveIssues : issueSummary.activeIssues,
    resolved: user?.role === 'RE' ? issueSummary.myResolvedIssues : issueSummary.resolvedIssues,
    unassigned: assets.filter((a) => !a.assignedToId?._id && !a.assignedToId).length,
    mine: assets.filter((a) => String(a.assignedToId?._id || a.assignedToId || '') === userId).length
  }), [assets, issueSummary, user?.role, userId]);

  const issueQueueCounts = useMemo(() => ({
    total: issueRows.length,
    active: issueRows.filter((row) => row.status !== 'RESOLVED').length,
    resolved: issueRows.filter((row) => row.status === 'RESOLVED').length,
    myResolved: issueRows.filter((row) => String(row.resolvedBy?._id || row.resolvedBy || '') === userId).length
  }), [issueRows, userId]);

  const visibleAssignableAssets = visibleAssets.filter((asset) => activeStatuses.includes(asset.status));
  const selectedAssignableAssetIds = selectedAssetIds.filter((id) => {
    const asset = assets.find((row) => row._id === id);
    return asset && activeStatuses.includes(asset.status);
  });
  const allVisibleSelected = visibleAssignableAssets.length > 0 && visibleAssignableAssets.every((asset) => selectedAssetIds.includes(asset._id));

  const toggleAssetSelection = (assetId) => setSelectedAssetIds((current) => (
    current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]
  ));

  const toggleVisibleSelection = () => setSelectedAssetIds((current) => {
    if (allVisibleSelected) return current.filter((id) => !visibleAssignableAssets.some((asset) => asset._id === id));
    return [...new Set([...current, ...visibleAssignableAssets.map((asset) => asset._id)])];
  });

  const removeAssets = async (assetIds) => {
    if (!isLead || !assetIds.length) return;
    const confirmed = await Swal.confirm(
      assetIds.length === 1 ? 'Remove this asset?' : `Remove ${assetIds.length} assets?`,
      'They will disappear from the active register. Their service history will be retained.',
      assetIds.length === 1 ? 'Remove asset' : 'Remove assets'
    );
    if (!confirmed.isConfirmed) return;
    setBusy(true);
    try {
      const { data } = assetIds.length === 1
        ? await api.delete(`/assets/${assetIds[0]}`)
        : await api.delete('/assets', { data: { assetIds } });
      setSelectedAssetIds((current) => current.filter((id) => !assetIds.includes(id)));
      setAssets((current) => current.filter((asset) => !assetIds.includes(asset._id)));
      refreshIssueSummary();
      await Swal.success('Assets removed', data.message || 'The selected assets were removed from the active register.');
    } catch (e) {
      showError('Could not remove assets', e.response?.data?.message || 'The selected assets could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleBulkAssignee = (id) => setBulkAssigneeIds((current) => (
    current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
  ));

  const distributeSelectedAssets = async (event) => {
    event.preventDefault();
    if (!selectedAssignableAssetIds.length) return;
    if (!bulkAssigneeIds.length) {
      await Swal.error('Select engineers', 'Choose at least one Resolution Engineer to receive the selected systems.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.patch('/assets/bulk-assignment', {
        assetIds: selectedAssignableAssetIds,
        assigneeIds: bulkAssigneeIds
      });
      setBulkAssignmentOpen(false);
      setSelectedAssetIds([]);
      const assignments = new Map((data.assignments || []).map((row) => [String(row.assetId), row]));
      setAssets((current) => current.map((asset) => {
        const assignment = assignments.get(String(asset._id));
        return assignment ? { ...asset, assignedToId: assignment.assignee, pendingHandoverId: null, pendingHandovers: [], updatedAt: assignment.updatedAt || asset.updatedAt } : asset;
      }));
      refreshIssueSummary();
      setEventsLoaded(false);
      await Swal.success('System assignments updated', data.message);
    } catch (e) {
      showError('Could not distribute systems', e.response?.data?.message || 'The selected systems could not be assigned.');
    } finally {
      setBusy(false);
    }
  };

  const openEvent = () => {
    setEventForm(emptyEvent);
    setEventRows([]);
    setManualRow(emptyRow);
    setError('');
    setEventOpen(true);
  };

  const openIntake = () => {
    setError('');
    setNewIssueMode(false);
    setIntakeForm(emptyIntake);
    setLookupQuery('');
    setLookupResults([]);
    setSelectedAsset(null);
    setIntakeOpen(true);
  };

  const openNextIssue = (asset) => {
    setError('');
    setNewIssueMode(true);
    setSelectedAsset(asset);
    setLookupQuery(asset.assetId || '');
    setLookupResults([]);
    setIntakeForm({
      ...emptyIntake,
      assetId: asset.assetId || '',
      userName: asset.userName || '',
      employeeId: asset.employeeId || '',
      project: asset.project || '',
      systemType: asset.systemType || '',
      issue: '',
      assignedToId: ''
    });
    setIntakeOpen(true);
  };

  const handleWorkbook = async (file) => {
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      const sheet = workbook.Sheets.Assets || workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('The workbook has no worksheet.');
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
      const head = (matrix[0] || []).map(normalizeHeader);
      const missingAssetId = !head.includes(normalizeHeader('Asset ID'));
      if (missingAssetId) throw new Error('The Asset ID column is required. Download the supplied template to get the correct headers.');
      const positions = Object.fromEntries(headers.map((name) => [name, head.indexOf(normalizeHeader(name))]));
      const rows = matrix.slice(1).flatMap((cells, index) => {
        if (!cells.some((cell) => String(cell ?? '').trim())) return [];
        return [{
          rowNumber: index + 2,
          assetId: String(cells[positions['Asset ID']] ?? '').trim(),
          userName: String(cells[positions['User Name']] ?? '').trim(),
          employeeId: String(cells[positions['Employee ID']] ?? '').trim(),
          project: String(cells[positions.Project] ?? '').trim(),
          issue: String(cells[positions.Issue] ?? '').trim(),
          systemType: String(cells[positions['System Type']] ?? '').trim()
        }];
      });
      if (!rows.length) throw new Error('No asset rows were found beneath the header.');
      setEventRows(rows);
      setError('');
      Swal.success('Spreadsheet loaded', `${rows.length} row(s) are ready for validation. Only Asset ID is required.`);
    } catch (e) {
      showError('Spreadsheet issue', e.message || 'Could not read this spreadsheet.');
    }
  };

  const addManualRow = () => {
    if (!String(manualRow.assetId || '').trim()) {
      const message = 'Asset ID is required. The other asset details are optional.';
      setError(message);
      Swal.error('Asset ID required', message);
      return;
    }
    setEventRows((rows) => [...rows, { ...manualRow, rowNumber: `Manual ${rows.length + 1}` }]);
    setManualRow(emptyRow);
    setError('');
    Swal.success('System added', 'The system was added to this event. Only Asset ID is required.');
  };

  const findExistingAsset = async () => {
    const query = lookupQuery.trim();
    if (!query) {
      showError('Enter a search value', 'Search by Asset ID, Employee ID, or user name.');
      return;
    }
    setLookupBusy(true);
    try {
      const { data } = await api.get('/assets/lookup', { params: { q: query } });
      setLookupResults(data);
      if (!data.length) Swal.error('No saved system found', 'Search by the Asset ID if the register has no employee ID or name yet. You can also enter a new Asset ID manually.');
    } catch (e) {
      showError('System lookup failed', e.response?.data?.message || 'Could not search the shared asset register.');
    } finally {
      setLookupBusy(false);
    }
  };

  const selectExistingAsset = (asset) => {
    setSelectedAsset(asset);
    setIntakeForm((form) => ({
      ...form,
      assetId: asset.assetId || '',
      userName: asset.userName || '',
      employeeId: asset.employeeId || '',
      project: asset.project || '',
      issue: '',
      systemType: asset.systemType || '',
      expectedPickupAt: '',
      assignedToId: ''
    }));
    setLookupQuery(`${asset.assetId}${asset.userName ? ` · ${asset.userName}` : ''}`);
    setLookupResults([]);
    Swal.success('System found', 'Saved details have been filled. Add the issue and any details missing from this asset record.');
  };

  const openHandover = (asset) => {
    setHandoverAsset(asset);
    setHandoverForm({ toUserId: '', reason: '', notes: '' });
  };

  const submitHandover = async (event) => {
    event.preventDefault();
    if (!handoverAsset || !handoverForm.toUserId || !handoverForm.reason.trim()) return;
    setHandoverBusy(true);
    try {
      const { data } = await api.post(`/assets/${handoverAsset._id}/handovers`, handoverForm);
      const recipient = handoverOptions.find((person) => person._id === handoverForm.toUserId);
      upsertAsset({
        ...handoverAsset,
        pendingHandoverId: data._id,
        pendingHandovers: [...(handoverAsset.pendingHandovers || []), {
          _id: data._id,
          assetId: handoverAsset._id,
          fromUserId: { _id: userId, name: user?.name || 'You' },
          toUserId: recipient || { _id: handoverForm.toUserId, name: 'Selected engineer' },
          reason: handoverForm.reason,
          createdAt: data.createdAt || new Date().toISOString()
        }]
      });
      setHandoverAsset(null);
      await Swal.success('Handover requested', `${handoverAsset.assetId} is waiting for ${recipient?.name || 'the selected engineer'} to accept.`);
    } catch (e) {
      showError('Could not hand over asset', e.response?.data?.message || 'The handover could not be created.');
    } finally {
      setHandoverBusy(false);
    }
  };

  const respondToHandover = async (asset, handover, status) => {
    let reason = '';
    if (status === 'REJECTED') {
      const response = await Swal.prompt('Decline asset handover', 'Add a reason for declining this handover.', 'Reason for declining');
      if (!response.isConfirmed || !String(response.value || '').trim()) return;
      reason = String(response.value).trim();
    }
    setHandoverBusy(true);
    try {
      await api.patch(`/assets/handovers/${handover._id}`, { status, reason });
      setAssets((current) => current.map((row) => {
        if (row._id !== asset._id) return row;
        const pendingHandovers = (row.pendingHandovers || []).filter((candidate) => candidate._id !== handover._id);
        return {
          ...row,
          pendingHandovers,
          pendingHandoverId: pendingHandovers[0]?._id || null,
          ...(status === 'ACCEPTED' ? { assignedToId: { _id: userId, name: user?.name || 'You', role: 'RE' } } : {})
        };
      }));
      refreshIssueSummary();
      await Swal.success(status === 'ACCEPTED' ? 'Handover accepted' : 'Handover declined', status === 'ACCEPTED' ? `You now own Issue #${asset.currentIssueNumber || 1} for ${asset.assetId}.` : 'The asset remains with its current engineer.');
    } catch (e) {
      showError(status === 'ACCEPTED' ? 'Could not accept handover' : 'Could not decline handover', e.response?.data?.message || 'The handover response could not be saved.');
    } finally {
      setHandoverBusy(false);
    }
  };

  const submitIntake = async (e) => {
    e.preventDefault();
    if (!String(intakeForm.assetId || '').trim()) {
      showError('Asset ID required', 'Enter an Asset ID. All other asset details are optional.');
      return;
    }
    if (newIssueMode && !String(intakeForm.issue || '').trim()) {
      showError('Issue description required', 'Describe the new issue before assigning the system.');
      return;
    }
    if (newIssueMode && !intakeForm.assignedToId) {
      showError('Choose an engineer', 'Assign this new issue to a Resolution Engineer.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data, status } = await api.post('/assets/intake', intakeForm);
      setIntakeOpen(false);
      setIntakeForm(emptyIntake);
      setSelectedAsset(null);
      setLookupQuery('');
      setNewIssueMode(false);
      upsertAsset(data);
      refreshIssueSummary();
      const repeatedIssue = data.repeatIssues?.find((row) => row.status === 'OPEN');
      if (newIssueMode) {
        Swal.success(`Issue #${data.currentIssueNumber || data.issueSequence} assigned`, `${data.assetId} is assigned to ${data.assignedToId?.name || 'the selected engineer'}. Earlier issue credits remain unchanged.`);
      } else if (repeatedIssue) {
        Swal.success('Repeat issue recorded', `${data.assetId}: ${repeatedIssue.issue} · repeat occurrence ${repeatedIssue.count}.`);
      } else {
        Swal.success(status === 201 ? 'Asset saved' : 'Asset issue updated', `${data.assetId} was saved to the shared register.`);
      }
    } catch (err) {
      const errors = err.response?.data?.errors || [];
      showError('Could not save intake', errors.length ? errors.map((x) => `Row ${x.row}, ${x.field}: ${x.message}`).join(' ') : (err.response?.data?.message || 'Could not save the asset intake.'));
    } finally {
      setBusy(false);
    }
  };

  const submitEvent = async (e) => {
    e.preventDefault();
    if (!String(eventForm.title || '').trim()) {
      showError('Event name required', 'Enter a name for this bulk asset event.');
      return;
    }
    if (!eventRows.length) {
      showError('No systems added', 'Upload a spreadsheet or add at least one system manually.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/assets/events', { ...eventForm, scheduledAt: eventForm.scheduledAt || null, assets: eventRows });
      setEventOpen(false);
      const refreshed = await load(false);
      setEvents((current) => [data.event, ...current.filter((event) => event._id !== data.event._id)]);
      setEventsLoaded(true);
      setView('events');
      if (refreshed) {
        Swal.success('Asset event created', `${data.importedCount} unique system(s) added. ${data.duplicateRowsMerged} repeated row(s) merged.`);
      } else {
        Swal.error('Event saved, but refresh failed', 'The event and assets were saved, but the register could not be refreshed.');
      }
    } catch (err) {
      const errors = err.response?.data?.errors || [];
      showError('Could not create event', errors.length ? `${err.response?.data?.message || 'Correct these rows:'} ${errors.map((x) => `Row ${x.row}, ${x.field}: ${x.message}`).join(' ')}` : (err.response?.data?.message || 'Could not create the asset event.'));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (asset, status) => {
    if (status === asset.status) return;
    let comment = '';
    if (status === 'IN_PROGRESS') {
      const note = await Swal.prompt('Add a work status note', 'Why is this still in progress?', 'Explain the pending work or blocker', true);
      if (!note.isConfirmed) return;
      comment = String(note.value || '').trim();
    } else if (status === 'READY_FOR_PICKUP') {
      const note = await Swal.prompt('Add a completion note', 'Work completed (optional)', 'Briefly describe the fix or update');
      if (!note.isConfirmed) return;
      comment = String(note.value || '').trim();
    }
    try {
      const { data } = await api.patch(`/assets/${asset._id}/status`, { status, comment });
      upsertAsset(data);
      refreshIssueSummary();
      if (status === 'READY_FOR_PICKUP' && asset.repeatIssue) {
        const repeatedIssue = asset.repeatIssueSummary?.issue || asset.issue || 'The repeated issue';
        const repeatCount = asset.repeatIssueSummary?.count || asset.repeatIssueCount || 1;
        Swal.success('Repeated issue resolved', `${repeatedIssue} is resolved after ${repeatCount} repeat occurrence(s).`);
      } else Swal.success('Asset status updated', `${asset.assetId} is now ${formatStatus(status)}.`);
    } catch (e) {
      showError('Could not update status', e.response?.data?.message || 'Could not update asset status.');
    }
  };

  const changeAssignee = async (asset, assignedToId) => {
    const currentId = String(asset.assignedToId?._id || asset.assignedToId || '');
    if (currentId === assignedToId) return;
    setBusy(true);
    try {
      const { data } = await api.patch(`/assets/${asset._id}/assignment`, { assignedToId: assignedToId || null });
      upsertAsset(data);
      refreshIssueSummary();
      const nextName = assignableMembers.find((member) => member._id === assignedToId)?.name;
      Swal.success(assignedToId ? 'Asset assigned' : 'Asset unassigned', assignedToId ? `${asset.assetId} is now assigned to ${nextName || 'the selected engineer'}.` : `${asset.assetId} is now unassigned.`);
    } catch (e) {
      showError('Could not update assignment', e.response?.data?.message || 'The asset assignment could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  const showHistory = async (asset) => {
    setHistoryAsset(asset);
    setHistoryRows([]);
    try {
      const { data } = await api.get(`/assets/${asset._id}/history`);
      setHistoryAsset({ ...asset, issueHistory: data.issueHistory || [] });
      setHistoryRows(data.history || []);
    } catch (e) {
      showError('Could not load history', e.response?.data?.message || 'Could not load the asset history.');
    }
  };

  const showEventReport = async (event) => {
    setSelectedEvent(event);
    setEventReport(null);
    setEventAssetsLoading(true);
    try {
      const { data } = await api.get(`/assets/events/${event._id}/report`);
      setEventReport(data);
    } catch (e) {
      showError('Could not load event report', e.response?.data?.message || 'Could not load the report for this event.');
      setSelectedEvent(null);
    } finally {
      setEventAssetsLoading(false);
    }
  };

  const distributeUnassignedEventAssets = () => {
    const unassignedIds = (eventReport?.assets || [])
      .filter((asset) => !asset.assignedToId)
      .map((asset) => asset._id);
    if (!unassignedIds.length) return;
    setSelectedEvent(null);
    setSelectedAssetIds(unassignedIds);
    setBulkAssigneeIds([]);
    setError('');
    setBulkAssignmentOpen(true);
  };

  const deleteEvent = async (event) => {
    const confirmed = await Swal.confirm(
      'Remove bulk event?',
      `Remove "${event.title}" from the event list? The shared assets and their service history will be retained.`,
      'Remove event'
    );
    if (!confirmed.isConfirmed) return;
    setBusy(true);
    try {
      await api.delete(`/assets/events/${event._id}`);
      setEvents((current) => current.filter((row) => row._id !== event._id));
      Swal.success('Bulk event removed', 'Its asset records and service history were kept.');
    } catch (e) {
      showError('Could not remove event', e.response?.data?.message || 'The bulk event could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleAssignee = (id) => setEventForm((form) => ({
    ...form,
    assigneeIds: form.assigneeIds.includes(id) ? form.assigneeIds.filter((x) => x !== id) : [...form.assigneeIds, id]
  }));

  const fields = (value, setValue, includeAssignee = false) => (
    <>
      <div className="form-grid">
        <label>Asset ID<input disabled={includeAssignee && Boolean(selectedAsset)} value={value.assetId} onChange={(e) => setValue({ ...value, assetId: e.target.value })} placeholder="e.g. AST-00421" /></label>
        <label>User Name<input disabled={includeAssignee && Boolean(selectedAsset?.userName)} value={value.userName} onChange={(e) => setValue({ ...value, userName: e.target.value })} /></label>
        <label>Employee ID<input disabled={includeAssignee && Boolean(selectedAsset?.employeeId)} value={value.employeeId} onChange={(e) => setValue({ ...value, employeeId: e.target.value })} /></label>
        <label>Project<input disabled={includeAssignee && Boolean(selectedAsset?.project)} value={value.project} onChange={(e) => setValue({ ...value, project: e.target.value })} /></label>
        <label>System Type<select disabled={includeAssignee && Boolean(selectedAsset?.systemType)} value={value.systemType} onChange={(e) => setValue({ ...value, systemType: e.target.value })}><option value="">Optional</option>{systemTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
      </div>
      <label>{newIssueMode && includeAssignee ? 'New issue description' : 'Issue'}<textarea rows="3" required={newIssueMode && includeAssignee} value={value.issue} onChange={(e) => setValue({ ...value, issue: e.target.value })} placeholder={newIssueMode && includeAssignee ? 'Describe what needs to be resolved' : 'Describe the reported issue or requested update (optional)'} /></label>
      {includeAssignee && <label>Expected pickup date (optional)<input type="date" value={value.expectedPickupAt || ''} onChange={(e) => setValue({ ...value, expectedPickupAt: e.target.value })} /></label>}
      {includeAssignee && isLead && <label>Assign to engineer<select required={newIssueMode} value={value.assignedToId} onChange={(e) => setValue({ ...value, assignedToId: e.target.value })}><option value="">{newIssueMode ? 'Choose an engineer' : 'Leave unassigned'}</option>{assignableMembers.map((m) => <option key={m._id} value={m._id}>{m.name} · {m.team}</option>)}</select></label>}
    </>
  );

  return (
    <div className="page-stack">
      <div className="welcome-row">
        <div>
          <div className="page-kicker">SHARED INVENTORY & WORK</div>
          <h1>Asset desk<span className="title-period">.</span></h1>
          <p>Register walk-in issues, coordinate bulk software updates, and review each system’s shared service history.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={downloadTemplate}><Download size={16} /> Excel template</button>
          <button className="btn btn-primary" onClick={openIntake}><Plus size={16} /> Walk-in intake</button>
          {canCreateEvent && <button className="btn btn-primary" onClick={openEvent}><CalendarDays size={16} /> Create bulk event</button>}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="metric-grid">
        <div className="metric-card"><div className="metric-top">Assets on register <span className="metric-icon blue"><Laptop size={17} /></span></div><div className="metric-value">{counts.total}</div><div className="metric-note">Unique Asset IDs across this workspace</div></div>
        <button type="button" className="metric-card asset-filter-card" onClick={() => openIssueQueue('ACTIVE', user?.role === 'RE')}><div className="metric-top">{user?.role === 'RE' ? 'My active issues' : 'Active issues'} <span className="metric-icon orange"><Wrench size={17} /></span></div><div className="metric-value">{counts.working}</div><div className="metric-note">Current unresolved issue cycles</div></button>
        <button type="button" className="metric-card asset-filter-card" onClick={() => openIssueQueue('RESOLVED', user?.role === 'RE')}><div className="metric-top">{user?.role === 'RE' ? 'Resolved by me' : 'Resolved issues'} <span className="metric-icon green"><CheckCircle2 size={17} /></span></div><div className="metric-value">{counts.resolved}</div><div className="metric-note">Completed issue cycles with resolver credit</div></button>
        <button type="button" className="metric-card asset-filter-card" onClick={() => { setView('assets'); setStatusFilter('UNASSIGNED'); setMineOnly(false); setSearch(''); }}><div className="metric-top">Unassigned <span className="metric-icon orange"><UserRound size={17} /></span></div><div className="metric-value">{counts.unassigned}</div><div className="metric-note">Systems waiting for an engineer</div></button>
        <div className="metric-card"><div className="metric-top">Assigned to me <span className="metric-icon purple"><UserRound size={17} /></span></div><div className="metric-value">{counts.mine}</div><div className="metric-note">Current asset work assigned to you</div></div>
      </div>

      <section className="panel table-panel asset-register-panel">
        <div className="asset-tabs">
        <button className={view === 'assets' && statusFilter !== 'RESOLVED' && statusFilter !== 'COMPLETED' ? 'active' : ''} onClick={() => { setView('assets'); setStatusFilter('ALL'); }}><Laptop size={15} /> Asset register <span>{assets.length}</span></button>
        <button className={view === 'assets' && (statusFilter === 'RESOLVED' || statusFilter === 'COMPLETED') ? 'active' : ''} onClick={() => { setView('assets'); setStatusFilter('COMPLETED'); setMineOnly(false); }}><CheckCircle2 size={15} /> Completed <span>{assets.filter((asset) => ['READY_FOR_PICKUP', 'RETURNED'].includes(asset.status)).length}</span></button>
        <button className={view === 'issues' ? 'active' : ''} onClick={() => openIssueQueue()}><ClipboardList size={15} /> Issue queue <span>{issueSummary.totalIssues}</span></button>
        <button className={view === 'events' ? 'active' : ''} onClick={openEvents}><CalendarDays size={15} /> Bulk events <span>{events.length}</span></button>
        </div>

      {view === 'issues' ? issueQueueLoading && !issueRows.length ? <LoadingState title="Loading issue queue" detail="Collecting each issue cycle, current assignee, and resolver." /> : <div className="asset-issue-queue">
          <div className="metric-grid asset-issue-queue-metrics">
            <div className="metric-card"><div className="metric-top">All issues</div><div className="metric-value">{issueQueueCounts.total}</div><div className="metric-note">One row for each issue on an asset</div></div>
            <div className="metric-card"><div className="metric-top">Pending issues</div><div className="metric-value">{issueQueueCounts.active}</div><div className="metric-note">Received or in progress</div></div>
            <div className="metric-card"><div className="metric-top">Resolved issues · global</div><div className="metric-value">{issueQueueCounts.resolved}</div><div className="metric-note">Resolved issue cycles across the workspace</div></div>
            {user?.role === 'RE' && <div className="metric-card"><div className="metric-top">Resolved by me</div><div className="metric-value">{issueQueueCounts.myResolved}</div><div className="metric-note">Issues credited to your resolution work</div></div>}
          </div>
          {issueQueueError && <div className="error-box">{issueQueueError}</div>}
          <div className="table-toolbar">
            <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset, issue, engineer, or project…" /></div>
            <div className="filter-controls">
              <label className="toggle-filter"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> {user?.role === 'RE' ? 'Assigned to me or resolved by me' : 'Assigned to me'}</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="ALL">All issue statuses</option><option value="ACTIVE">Active issues</option><option value="RECEIVED">Received</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved issue</option><option value="UNASSIGNED">Unassigned</option></select>
              <button className="icon-btn" title="Refresh issue queue" onClick={() => loadIssueQueue(false)}><RefreshCw size={16} /></button>
            </div>
          </div>
          <div className="table-scroll"><table>
            <thead><tr><th>ASSET</th><th>ISSUE</th><th>ASSIGNED TO</th><th>STATUS</th><th>RESOLVED BY</th><th>REPORTED / RESOLVED</th><th>HISTORY</th></tr></thead>
            <tbody>{visibleIssueRows.map((row) => {
              const resolved = row.status === 'RESOLVED';
              return <tr key={row._id}>
                <td><div className="asset-main-cell"><strong>{row.asset?.assetId}</strong><span>{[row.asset?.userName, row.asset?.employeeId, row.asset?.project].filter(Boolean).join(' · ') || 'No user details'}</span>{row.asset?.isArchived && <small className="work-table-sub">Archived from active register</small>}</div></td>
                <td><div className="asset-issue-cell"><strong>Issue #{row.issueNumber}{row.isCurrent && <span className="work-source-pill">CURRENT</span>}</strong><span>{row.issue || 'No issue description'}</span>{row.resolutionComment && <small>{row.resolutionComment}</small>}</div></td>
                <td>{row.assignedTo?.name || <span className="unassigned">Unassigned</span>}</td>
                <td><span className={`status-pill ${resolved ? 'status-completed' : row.status === 'IN_PROGRESS' ? 'status-wip' : 'status-open'}`}>{formatIssueStatus(row.status)}</span></td>
                <td>{row.resolvedBy?.name || <span className="muted-cell">Pending</span>}</td>
                <td><div className="asset-issue-cell"><small>{row.reportedAt ? `Reported ${new Date(row.reportedAt).toLocaleDateString()}` : 'Reported date unavailable'}</small>{row.resolvedAt && <small>Resolved {new Date(row.resolvedAt).toLocaleDateString()}</small>}</div></td>
                <td><button className="btn btn-secondary btn-sm" onClick={() => showHistory({ ...row.asset, issue: row.issue })}><History size={14} /> View</button></td>
              </tr>;
            })}</tbody>
          </table></div>
          {!issueQueueLoading && !visibleIssueRows.length && <div className="empty-state compact"><div className="empty-icon"><ClipboardList size={21} /></div><strong>No matching issues</strong><p>Reported and resolved issue cycles will appear here separately for each asset.</p></div>}
          <div className="table-footer"><span>{visibleIssueRows.length} issue(s) shown</span><span className="table-footer-right">Each issue keeps its own assignee, status, and resolver credit.</span></div>
        </div> : view === 'assets' ? loading && !assets.length ? <LoadingState title="Loading asset register" detail="Getting the latest asset assignments and issue status." /> : <>
          <div className="table-toolbar">
            <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset, user, employee, project…" /></div>
            <div className="filter-controls">
              {isLead && selectedAssetIds.length > 0 && <>
                <button className="btn btn-secondary btn-sm" disabled={busy || !assignableMembers.length || !selectedAssignableAssetIds.length} onClick={() => { setError(''); setBulkAssigneeIds([]); setBulkAssignmentOpen(true); }}><UserRound size={14} /> Distribute selected ({selectedAssignableAssetIds.length})</button>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => removeAssets(selectedAssetIds)}><Trash2 size={14} /> Remove selected ({selectedAssetIds.length})</button>
              </>}
              <label className="toggle-filter"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Assigned to me</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="ALL">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}<option value="COMPLETED">Completed</option><option value="UNASSIGNED">Unassigned</option></select>
              <button className="icon-btn" title="Refresh register" onClick={() => load()} disabled={refreshing}><RefreshCw className={refreshing ? 'is-spinning' : ''} size={16} /></button>
            </div>
          </div>
          <div className="table-scroll"><table>
            <thead><tr>{isLead && <th><input aria-label="Select all visible assets" type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleSelection} /></th>}<th>ASSET / USER</th><th>EMPLOYEE / PROJECT</th><th>SYSTEM</th><th>ISSUE / UPDATE</th><th>WORK EVENT</th><th>ASSIGNED TO</th><th>STATUS</th><th>HISTORY</th>{isLead && <th>REMOVE</th>}</tr></thead>
            <tbody>{visibleAssets.map((asset) => {
              const assignedToMe = String(asset.assignedToId?._id || asset.assignedToId || '') === userId;
              const canUpdate = user?.role === 'RE' && assignedToMe;
              const resolved = ['READY_FOR_PICKUP', 'RETURNED'].includes(asset.status);
              const issueNumber = asset.currentIssueNumber || asset.issueSequence || asset.issueHistoryCount || (asset.issue ? 1 : null);
              const incomingHandover = (asset.pendingHandovers || []).find((handover) => String(handover.toUserId?._id || handover.toUserId || '') === userId);
              const outgoingHandover = (asset.pendingHandovers || []).find((handover) => String(handover.fromUserId?._id || handover.fromUserId || '') === userId);
              const resolverName = asset.currentIssueResolvedById?.name;
              return <tr key={asset._id} className={asset.repeatIssue ? 'asset-repeat-row' : asset.repeatIssueCount ? 'asset-repeat-resolved-row' : ''}>
                {isLead && <td><input aria-label={`Select asset ${asset.assetId}`} type="checkbox" checked={selectedAssetIds.includes(asset._id)} onChange={() => toggleAssetSelection(asset._id)} /></td>}
                <td><div className="asset-main-cell"><strong>{asset.assetId}</strong>{asset.repeatIssueCount > 0 && <span className={`asset-repeat-pill ${asset.repeatIssueSummary?.status === 'RESOLVED' ? 'is-resolved' : ''}`}>Repeat ×{asset.repeatIssueCount} · {asset.repeatIssueSummary?.status === 'OPEN' ? 'Open' : 'Resolved'}</span>}<span>{asset.userName}</span></div></td>
                <td><div className="asset-main-cell"><strong>{asset.employeeId}</strong><span>{asset.project}</span></div></td>
                <td><span className="badge badge-service_request">{asset.systemType}</span></td>
                <td><div className="asset-issue-cell">{issueNumber && <strong>Issue #{issueNumber}</strong>}<span>{asset.issue || 'No active issue recorded'}</span>{resolved && resolverName && <small>Resolved by <strong>{resolverName}</strong>{asset.currentIssueResolvedAt ? ` · ${new Date(asset.currentIssueResolvedAt).toLocaleString()}` : ''}</small>}{asset.repeatIssueSummary && <small className="asset-repeat-summary">Repeated issue: {asset.repeatIssueSummary.issue} · {asset.repeatIssueSummary.count} time(s) · {asset.repeatIssueSummary.status}</small>}<small>Updated {new Date(asset.updatedAt).toLocaleString()} by {asset.lastUpdatedBy?.name || 'workspace user'}{asset.expectedPickupAt ? ` · Pickup ${new Date(asset.expectedPickupAt).toLocaleDateString()}` : ''}</small>{isLead && resolved && <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !assignableMembers.length} onClick={() => openNextIssue(asset)}><Plus size={13} /> Report next issue</button>}</div></td>
                <td>{asset.eventId?.title || <span className="muted-cell">Walk-in</span>}</td>
                <td>{incomingHandover && user?.role === 'RE' ? <div className="asset-handover-controls"><strong>{asset.assignedToId?.name || 'Teammate'} offered this issue</strong><div><button type="button" className="btn btn-success btn-xs" disabled={handoverBusy} onClick={() => respondToHandover(asset, incomingHandover, 'ACCEPTED')}>Accept</button><button type="button" className="btn btn-secondary btn-xs" disabled={handoverBusy} onClick={() => respondToHandover(asset, incomingHandover, 'REJECTED')}>Decline</button></div></div> : isLead && !resolved ? <select className="inline-status asset-assignee-select" aria-label={`Assign ${asset.assetId}`} disabled={busy} value={asset.assignedToId?._id || asset.assignedToId || ''} onChange={(e) => changeAssignee(asset, e.target.value)}>
                  <option value="">Unassigned</option>
                  {asset.assignedToId?.name && !assignableMembers.some((member) => member._id === (asset.assignedToId?._id || asset.assignedToId)) && <option value={asset.assignedToId?._id || asset.assignedToId} disabled>{asset.assignedToId.name} (outside your assignment scope)</option>}
                  {assignableMembers.map((member) => <option key={member._id} value={member._id}>{member.name}</option>)}
                </select> : <div className="asset-issue-cell"><span>{asset.assignedToId?.name || <span className="unassigned">Unassigned</span>}</span>{isLead && resolved && <small>Assignment locked after resolution</small>}{user?.role === 'RE' && assignedToMe && !resolved && asset.issue && (outgoingHandover ? <small className="asset-handover-pending">Handover requested to {outgoingHandover.toUserId?.name || 'another RE'}</small> : <button type="button" className="btn btn-secondary btn-xs" disabled={handoverBusy || !handoverOptions.length} onClick={() => openHandover(asset)}><Handshake size={13} /> Hand over</button>)}</div>}</td>
              <td>{canUpdate && !resolved && !asset.pendingHandoverId ? <select className="inline-status asset-status-select" disabled={busy} value={asset.status} onChange={(e) => changeStatus(asset, e.target.value)}>{statuses.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}</select> : <span className={`status-pill ${resolved ? 'status-completed' : asset.status === 'IN_PROGRESS' ? 'status-wip' : 'status-open'}`}>{formatStatus(asset.status)}</span>}</td>
                <td><button className="btn btn-secondary btn-sm" onClick={() => showHistory(asset)}><History size={14} /> View</button></td>
                {isLead && <td><button className="btn btn-danger btn-sm" title={`Remove ${asset.assetId}`} disabled={busy} onClick={() => removeAssets([asset._id])}><Trash2 size={14} /> Remove</button></td>}
              </tr>;
            })}</tbody>
          </table></div>
          {!loading && !visibleAssets.length && <div className="empty-state compact"><div className="empty-icon"><Laptop size={21} /></div><strong>No matching assets</strong><p>Walk-in intakes and bulk event uploads appear in the shared register.</p></div>}
          <div className="table-footer"><span>{visibleAssets.length} asset(s) shown</span><span className="table-footer-right">Latest status and issue changes are visible to your workspace.</span></div>
      </> : eventsLoading && !eventsLoaded ? <LoadingState title="Loading bulk events" detail="Getting the latest event list." /> : <div className="asset-events-list">
          {events.map((event) => <article className="asset-event-card" key={event._id}>
            <div className="asset-event-icon"><CalendarDays size={18} /></div>
            <div className="asset-event-content"><div className="asset-event-title"><strong>{event.title}</strong><span>{event.assetCount} systems</span></div>
              <p>{event.description || 'Bulk software update or system support event'}</p>
              <div className="asset-event-meta"><span><Clock3 size={13} />{event.scheduledAt ? new Date(event.scheduledAt).toLocaleString() : `Created ${new Date(event.createdAt).toLocaleDateString()}`}</span><span>Created by {event.createdBy?.name || 'Workspace user'}</span><span>Assigned: {(event.assignedUserIds || []).map((u) => u.name).join(', ') || 'Unassigned'}</span></div>
              <div className="asset-event-actions"><button className="btn btn-secondary btn-sm asset-event-view" onClick={() => showEventReport(event)}>View report</button>{isLead && <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => deleteEvent(event)}><Trash2 size={14} /> Remove event</button>}</div>
            </div>
          </article>)}
          {!events.length && <div className="empty-state compact"><div className="empty-icon"><CalendarDays size={21} /></div><strong>No bulk events yet</strong><p>Create an update event, add systems by spreadsheet or manual entry, and split the workload across engineers.</p></div>}
        </div>}
      </section>

      {handoverAsset && <Modal title={`Hand over Issue #${handoverAsset.currentIssueNumber || handoverAsset.issueSequence || 1}`} onClose={() => { if (!handoverBusy) setHandoverAsset(null); }}>
        <form className="form-stack modal-form" onSubmit={submitHandover}>
          <p className="muted-cell" style={{ margin: 0 }}>{handoverAsset.assetId} · {handoverAsset.issue || 'Active asset issue'}. The receiving RE must accept before ownership changes.</p>
          <label>Receiving engineer<select required value={handoverForm.toUserId} onChange={(event) => setHandoverForm({ ...handoverForm, toUserId: event.target.value })}><option value="">Choose an RE</option>{handoverOptions.map((person) => <option key={person._id} value={person._id}>{person.name} · {person.team} · {person.shift}</option>)}</select></label>
          {!handoverOptions.length && <p className="form-help">No other active RE is available in your team and shift.</p>}
          <label>Reason<textarea rows="2" required value={handoverForm.reason} onChange={(event) => setHandoverForm({ ...handoverForm, reason: event.target.value })} placeholder="Explain why this issue is being handed over" /></label>
          <label>Notes (optional)<textarea rows="2" value={handoverForm.notes} onChange={(event) => setHandoverForm({ ...handoverForm, notes: event.target.value })} placeholder="Add work completed or remaining steps" /></label>
          <div className="modal-actions"><button type="button" className="btn btn-secondary" disabled={handoverBusy} onClick={() => setHandoverAsset(null)}>Cancel</button><button className="btn btn-primary" disabled={handoverBusy || !handoverForm.toUserId || !handoverForm.reason.trim()}>{handoverBusy ? 'Sending…' : 'Send handover'}</button></div>
        </form>
      </Modal>}

      {intakeOpen && <Modal title={newIssueMode ? `Report next issue · ${selectedAsset?.assetId || ''}` : 'Walk-in asset intake'} onClose={() => { setIntakeOpen(false); setNewIssueMode(false); }}>
        <form className="form-stack modal-form" onSubmit={submitIntake}>
          <p className="muted-cell" style={{ margin: 0 }}>{newIssueMode ? `This creates Issue #${(selectedAsset?.issueSequence || selectedAsset?.currentIssueNumber || selectedAsset?.issueHistory?.length || 1) + 1}. The prior issue and its resolver stay in the history. Choose the engineer who will work on this new issue.` : 'Search by Asset ID, Employee ID, or user name to fill saved details. Asset ID is the only required field; add the issue and any details missing from the register.'}</p>
          {!newIssueMode && <div className="asset-lookup-box">
            <label>Find an existing system<input type="search" value={lookupQuery} onChange={(e) => setLookupQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findExistingAsset(); } }} placeholder="Asset ID, Employee ID, or user name" /></label>
            <button type="button" className="btn btn-secondary btn-sm" disabled={lookupBusy} onClick={findExistingAsset}>{lookupBusy ? 'Searching…' : 'Search register'}</button>
            {selectedAsset && <div className="asset-selected-match"><span>Using saved record <strong>{selectedAsset.assetId}</strong>{selectedAsset.userName ? ` · ${selectedAsset.userName}` : ''}</span><button type="button" onClick={() => { setSelectedAsset(null); setIntakeForm(emptyIntake); setLookupQuery(''); }}>Clear match</button></div>}
            {lookupResults.length > 0 && <div className="asset-lookup-results">{lookupResults.map((asset) => <button type="button" key={asset._id} onClick={() => selectExistingAsset(asset)}><strong>{asset.assetId}</strong><span>{[asset.userName, asset.employeeId, asset.project, asset.systemType].filter(Boolean).join(' · ') || 'No saved details yet'}</span></button>)}</div>}
          </div>}
          {fields(intakeForm, setIntakeForm, true)}
          {error && <div className="error-box">{error}</div>}
          <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => { setIntakeOpen(false); setNewIssueMode(false); }}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : newIssueMode ? 'Create and assign issue' : 'Save intake'}</button></div>
        </form>
      </Modal>}

      {eventOpen && <Modal title="Create bulk asset event" onClose={() => setEventOpen(false)}>
        <form className="form-stack modal-form asset-event-form" onSubmit={submitEvent}>
          <p className="muted-cell" style={{ margin: 0 }}>Create a software update or maintenance event. Asset ID is the only required asset field. If System Type is supplied, it must match one of the listed types.</p>
          <label>Event name<input value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} placeholder="e.g. Cortex update – Project Alpha" /></label>
          <label>Details<textarea rows="2" value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} placeholder="Update details or instructions" /></label>
          <label>Planned date and time<input type="datetime-local" value={eventForm.scheduledAt} onChange={(e) => setEventForm({ ...eventForm, scheduledAt: e.target.value })} /></label>

          <div className="asset-upload-box">
            <div className="asset-upload-heading"><FileSpreadsheet size={17} /><div><strong>Upload spreadsheet</strong><small>Use the six columns in the downloadable template.</small></div><label className="btn btn-secondary btn-sm"><Upload size={14} /> Choose file<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; handleWorkbook(file); }} /></label></div>
            <div className="asset-upload-count">{eventRows.length} row(s) added · {new Set(eventRows.map((row) => String(row.assetId || '').trim().toUpperCase()).filter(Boolean)).size} unique Asset ID(s)</div>
            {eventRows.length > 0 && <div className="asset-preview-list">{eventRows.slice(0, 8).map((row, index) => <div key={`${row.assetId}-${index}`}><span>{row.assetId || 'Missing Asset ID'}</span><span>{row.userName || 'No user'} · {row.systemType || 'No type'}</span><button type="button" aria-label={`Remove row ${index + 1}`} onClick={() => setEventRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>Remove</button></div>)}{eventRows.length > 8 && <small>and {eventRows.length - 8} more row(s)</small>}</div>}
          </div>

          <div className="asset-manual-entry"><strong>Or add a system manually</strong>{fields(manualRow, setManualRow)}<button type="button" className="btn btn-secondary btn-sm asset-add-row" onClick={addManualRow}><Plus size={14} /> Add to event</button></div>

          <div className="asset-assignee-box"><div><strong>Distribute systems across engineers</strong><small>Select Resolution Engineers. Unique assets are assigned in balanced round-robin order.</small></div><div className="asset-engineer-grid">{assignableMembers.map((member) => <label key={member._id}><input type="checkbox" checked={eventForm.assigneeIds.includes(member._id)} onChange={() => toggleAssignee(member._id)} /><span>{member.name}<small>{member.team} · {member.shift}</small></span></label>)}</div>{!assignableMembers.length && <small>No active Resolution Engineers are available in your team list.</small>}</div>
          {error && <div className="error-box">{error}</div>}
          <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setEventOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Validating and saving…' : `Create event · ${eventRows.length} row(s)`}</button></div>
        </form>
      </Modal>}

      {bulkAssignmentOpen && <Modal title={`Distribute ${selectedAssignableAssetIds.length} selected system(s)`} onClose={() => setBulkAssignmentOpen(false)}>
        <form className="form-stack modal-form" onSubmit={distributeSelectedAssets}>
          <p className="muted-cell" style={{ margin: 0 }}>Selected systems, including systems from existing bulk events, will be assigned in round-robin order. Their event and service history stay attached.</p>
          <div className="asset-assignee-box">
            <div><strong>Choose Resolution Engineers</strong><small>Selected systems are distributed as evenly as possible across this list.</small></div>
            <div className="asset-engineer-grid">{assignableMembers.map((member) => <label key={member._id}>
              <input type="checkbox" checked={bulkAssigneeIds.includes(member._id)} onChange={() => toggleBulkAssignee(member._id)} />
              <span>{member.name}<small>{member.team} · {member.shift}</small></span>
            </label>)}</div>
            {!assignableMembers.length && <small>No active Resolution Engineers are available in your assignment scope.</small>}
          </div>
          {error && <div className="error-box">{error}</div>}
          <div className="modal-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setBulkAssignmentOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy || !bulkAssigneeIds.length}>{busy ? 'Assigning systems…' : 'Assign round-robin'}</button></div>
        </form>
      </Modal>}

      {selectedEvent && <Modal className="asset-event-report-modal" title={`Event report - ${selectedEvent.title}`} onClose={() => setSelectedEvent(null)}>
        <div className="form-stack modal-form asset-event-report">
          {eventAssetsLoading ? <p className="muted-cell">Preparing event report...</p> : eventReport ? <>
            <p className="muted-cell" style={{ margin: 0 }}>{eventReport.event.description || 'Bulk software update or system support event'} | Created by {eventReport.event.createdBy?.name || 'Workspace user'} | {eventReport.event.scheduledAt ? `Planned ${new Date(eventReport.event.scheduledAt).toLocaleString()}` : `Created ${new Date(eventReport.event.createdAt).toLocaleString()}`}</p>
            <div className="metric-grid asset-event-report-metrics">
              <div className="metric-card"><div className="metric-top">Total systems</div><div className="metric-value">{eventReport.summary.total}</div><div className="metric-note">Unique assets in this event</div></div>
              <div className="metric-card"><div className="metric-top">Resolved issue</div><div className="metric-value">{(eventReport.summary.readyForPickup || 0) + (eventReport.summary.returnedToUser || 0)}</div><div className="metric-note">Resolved assets in this event</div></div>
              <div className="metric-card"><div className="metric-top">Pending</div><div className="metric-value">{eventReport.summary.pending}</div><div className="metric-note">Not completed yet</div></div>
              <div className="metric-card"><div className="metric-top">Worked on</div><div className="metric-value">{eventReport.summary.worked}</div><div className="metric-note">Systems with recorded engineer activity</div></div>
            </div>
            <section className="asset-event-report-section">
              <div className="panel-heading"><div><h3>Engineer workload</h3><p>Who received systems and who recorded work for this event.</p></div></div>
              {eventReport.engineers.length ? <div className="table-scroll"><table><thead><tr><th>ENGINEER</th><th>ASSIGNED</th><th>WORKED ON</th><th>COMPLETED</th><th>PENDING</th></tr></thead><tbody>{eventReport.engineers.map((person) => <tr key={person._id}><td><strong>{person.name}</strong><small className="work-table-sub">{person.role}</small></td><td>{person.assignedCount}</td><td>{person.workedCount}</td><td>{person.completedCount}</td><td>{person.pendingCount}</td></tr>)}</tbody></table></div> : <p className="muted-cell">No engineers were assigned and no work has been recorded for this event.</p>}
            </section>
            <section className="asset-event-report-section">
              <div className="panel-heading"><div><h3>System details</h3><p>Assignment, current event status, and the engineers who updated each system.</p></div><div className="asset-event-actions"><span className="count-pill">{eventReport.assets.length} systems</span>{isLead && eventReport.assets.some((asset) => !asset.assignedToId) && <button className="btn btn-secondary btn-sm" onClick={distributeUnassignedEventAssets}><UserRound size={14} /> Assign unassigned systems</button>}</div></div>
              {eventReport.assets.length ? <div className="table-scroll"><table><thead><tr><th>ASSET ID</th><th>USER / PROJECT</th><th>ISSUE</th><th>ASSIGNED TO</th><th>WORKED BY</th><th>RESOLUTION CREDIT</th><th>STATUS</th><th>LAST WORK</th></tr></thead><tbody>{eventReport.assets.map((asset) => <tr key={asset._id} className={asset.repeatIssue ? 'asset-repeat-row' : asset.repeatIssueCount ? 'asset-repeat-resolved-row' : ''}>
                <td><strong>{asset.assetId}</strong>{asset.repeatIssueCount > 0 && <small className={`asset-repeat-pill ${asset.repeatIssueSummary?.status === 'RESOLVED' ? 'is-resolved' : ''}`}>Repeat ×{asset.repeatIssueCount} · {asset.repeatIssueSummary?.status === 'OPEN' ? 'Open' : 'Resolved'}</small>}{asset.isArchived && <small className="work-table-sub">Archived from active register</small>}</td>
                <td><div className="asset-main-cell"><strong>{asset.userName || asset.employeeId || 'No user details'}</strong><span>{[asset.employeeId, asset.project, asset.systemType].filter(Boolean).join(' | ')}</span></div></td>
                <td><div className="asset-issue-cell"><span>{asset.issue || '-'}</span>{asset.repeatIssueSummary && <small className="asset-repeat-summary">Repeated issue: {asset.repeatIssueSummary.issue} · {asset.repeatIssueSummary.count} time(s) · {asset.repeatIssueSummary.status}</small>}</div></td>
                <td>{asset.assignedTo?.name || <span className="unassigned">Unassigned</span>}</td>
                <td>{asset.workedBy.length ? asset.workedBy.map((person) => person.name).join(', ') : <span className="muted-cell">No work logged</span>}</td>
                <td>{asset.resolvedIssues?.length ? <div className="asset-issue-cell">{asset.resolvedIssues.map((issue, index) => <small key={`${issue.issueNumber}-${index}`}><strong>Issue #{issue.issueNumber || '?'}</strong> · {issue.resolvedBy?.name || 'Resolver not recorded'}{issue.resolvedAt ? ` · ${new Date(issue.resolvedAt).toLocaleDateString()}` : ''}</small>)}</div> : <span className="muted-cell">No resolution credit yet</span>}</td>
                <td><span className={`status-pill ${asset.status === 'READY_FOR_PICKUP' || asset.status === 'RETURNED' ? 'status-completed' : asset.status === 'IN_PROGRESS' ? 'status-wip' : 'status-open'}`}>{formatStatus(asset.status)}</span></td>
                <td><div className="asset-issue-cell"><span>{asset.lastWorkedAt ? new Date(asset.lastWorkedAt).toLocaleString() : '-'}</span>{asset.lastWorkNote && <small>{asset.lastWorkNote}</small>}</div></td>
              </tr>)}</tbody></table></div> : <p className="muted-cell">No systems were found in this event.</p>}
            </section>
            <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setSelectedEvent(null)}>Close</button><button className="btn btn-secondary" title="Open print options, then choose Save as PDF" onClick={() => openEventPdf(eventReport)}>Print / Save PDF</button><button className="btn btn-primary" onClick={() => downloadEventExcel(eventReport)}><Download size={15} /> Download Excel</button></div>
          </> : <p className="muted-cell">The event report could not be loaded.</p>}
        </div>
      </Modal>}

      {historyAsset && <Modal title={`Asset history · ${historyAsset.assetId}`} onClose={() => setHistoryAsset(null)}>
        <div className="form-stack modal-form"><p className="muted-cell" style={{ margin: 0 }}>{[historyAsset.userName, historyAsset.employeeId, historyAsset.project].filter(Boolean).join(' · ') || 'Shared asset service log'}</p>
          {historyAsset.issueHistory?.length > 0 && <section className="asset-event-report-section">
            <div className="panel-heading"><div><h3>Issue resolution credits</h3><p>Each issue has its own assignment and resolver record.</p></div></div>
            <div className="asset-issue-cycle-list">{[...historyAsset.issueHistory].sort((a, b) => a.issueNumber - b.issueNumber).map((cycle) => <article className="asset-issue-cycle" key={cycle.issueNumber}>
              <div className="asset-issue-cycle-heading"><strong>Issue #{cycle.issueNumber}</strong><span className={`status-pill ${cycle.status === 'RESOLVED' ? 'status-completed' : cycle.status === 'IN_PROGRESS' ? 'status-wip' : 'status-open'}`}>{cycle.status === 'RESOLVED' ? 'Resolved issue' : formatStatus(cycle.status)}</span></div>
              <p>{cycle.issue}</p>
              <div className="asset-history-summary"><span><b>Assigned to</b>{cycle.assignedToId?.name || 'Unassigned'}</span><span><b>Reported</b>{cycle.reportedAt ? new Date(cycle.reportedAt).toLocaleString() : 'Legacy record'}</span>
                {cycle.status === 'RESOLVED' && <span><b>Resolved by</b>{cycle.resolvedById?.name || 'Resolver not recorded'}</span>}
                {cycle.resolvedAt && <span><b>Resolved at</b>{new Date(cycle.resolvedAt).toLocaleString()}</span>}
                {cycle.resolutionComment && <span><b>Resolution note</b>{cycle.resolutionComment}</span>}
              </div>
            </article>)}</div>
          </section>}
          {historyRows.length ? <div className="ticket-log-timeline">{historyRows.map((row) => <div className={`ticket-log-entry asset-history-entry ${['REPEAT_ISSUE', 'REPEAT_ISSUE_RESOLVED'].includes(row.action) ? 'is-repeat-issue' : ''}`} key={row._id}>
            <div className="ticket-log-dot" /><div className="ticket-log-content">
              <div className="ticket-log-header"><span className="ticket-log-title">{historyActionLabel(row.action, row.changes)}</span><span className="ticket-log-time">{new Date(row.createdAt).toLocaleString()}</span></div>
              <div className="asset-history-byline">{row.action === 'STATUS_UPDATED' && isResolvedStatus(historyStatusTo(row.changes)) ? 'Resolved by' : 'By'} <strong>{row.performedBy?.name || 'Workspace user'}</strong>{row.changes?.issueNumber ? ` · Issue #${row.changes.issueNumber}` : ''}{row.eventId?.title ? ` · ${row.eventId.title}` : ''}</div>
              <div className="asset-history-summary">
                {row.assignedToNames && <span><b>Assigned</b>{row.assignedToNames.from} → {row.assignedToNames.to}</span>}
                {row.changes?.status && <span><b>Status</b>{historyTransition(row.changes.status, formatStatus)}</span>}
                {row.changes?.issue && <span><b>Issue</b>{row.changes.issue.to || row.changes.issue.from || historyAsset.issue || '—'}</span>}
                {row.changes?.archive && <span><b>Register</b>Removed from active list; history kept</span>}
              </div>
              {row.repeatIssueInfo && <div className={`repeat-issue-callout ${row.repeatIssueInfo.status === 'RESOLVED' ? 'is-resolved' : ''}`}><strong>{row.repeatIssueInfo.status === 'RESOLVED' ? 'Repeated issue resolved' : 'Repeated issue reported'}</strong><span>{row.repeatIssueInfo.issue} · Repeat occurrence {row.repeatIssueInfo.count}{row.repeatIssueInfo.status === 'RESOLVED' ? ` · Resolved ${row.repeatIssueInfo.resolvedAt ? new Date(row.repeatIssueInfo.resolvedAt).toLocaleString() : ''}` : ''}</span></div>}
              {row.action === 'STATUS_UPDATED' && formatStatus(historyStatusTo(row.changes)) === 'In progress' && row.comment && <div className="asset-pending-note"><b>Pending reason</b><span>{row.comment}</span></div>}
              {row.action === 'STATUS_UPDATED' && isResolvedStatus(historyStatusTo(row.changes)) && row.comment && <div className="asset-pending-note"><b>Completion note</b><span>{row.comment}</span></div>}
            </div>
          </div>)}</div> : <p className="muted-cell">No history has been recorded yet.</p>}
          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setHistoryAsset(null)}>Close</button></div>
        </div>
      </Modal>}
    </div>
  );
}
