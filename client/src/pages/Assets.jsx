import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileSpreadsheet,
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
import Swal from '../utils/swal.js';

const headers = ['Asset ID', 'User Name', 'Employee ID', 'Project', 'Issue', 'System Type'];
const systemTypes = ['SOE', 'MTC 22', 'MTC 21', '440', '445'];
const statuses = ['RECEIVED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'RETURNED'];
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
  return ({
    RECEIVED: 'Received',
    IN_PROGRESS: 'In progress',
    READY_FOR_PICKUP: 'Ready for pickup',
    RETURNED: 'Returned to user'
  })[status] || String(status || '').replaceAll('_', ' ');
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
    ['Ready for pickup', summary.readyForPickup],
    ['Returned to user', summary.returnedToUser],
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
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${html(event.title)} - report</title><style>@page{size:landscape;margin:12mm}body{font:12px Arial,sans-serif;color:#233047}h1{font-size:22px;margin:0 0 5px}p{color:#68758a;margin:0 0 18px}.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:16px 0}.summary div{border:1px solid #dce3ed;border-radius:7px;padding:10px}.summary b,.summary span{display:block}.summary span{font-size:20px;font-weight:700;margin-top:5px}h2{font-size:15px;margin:20px 0 8px}table{width:100%;border-collapse:collapse;font-size:9px}th,td{border:1px solid #dce3ed;text-align:left;padding:6px;vertical-align:top}th{background:#f1f4f8}.repeat{background:#fff1ec}.repeat b{color:#a44333}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><h1>${html(event.title)}</h1><p>${html(event.description || 'Bulk software update or system support event')} | Created by ${html(event.createdBy?.name || 'Workspace user')} | ${event.scheduledAt ? `Planned ${html(new Date(event.scheduledAt).toLocaleString())}` : `Created ${html(new Date(event.createdAt).toLocaleString())}`}</p><div class="summary"><div>Total systems<span>${summary.total}</span></div><div>Ready for pickup<span>${summary.readyForPickup}</span></div><div>Returned to user<span>${summary.returnedToUser}</span></div><div>Pending<span>${summary.pending}</span></div><div>Worked on<span>${summary.worked}</span></div></div><h2>Engineer workload</h2><table><thead><tr><th>Engineer</th><th>Assigned</th><th>Worked on</th><th>Completed</th><th>Pending</th></tr></thead><tbody>${engineerRows || '<tr><td colspan="5">No engineer activity.</td></tr>'}</tbody></table><h2>System details</h2><table><thead><tr><th>Asset ID</th><th>User / Project</th><th>Issue</th><th>Assigned to</th><th>Worked by</th><th>Status</th><th>Last work note</th></tr></thead><tbody>${assetRows || '<tr><td colspan="7">No systems found.</td></tr>'}</tbody></table></body></html>`);
  printWindow.document.close();
  window.setTimeout(() => { printWindow.focus(); printWindow.print(); }, 300);
}

function historyActionLabel(action) {
  return ({
    ASSET_RECEIVED: 'Asset received',
    ISSUE_UPDATED: 'Issue updated',
    STATUS_UPDATED: 'Status updated',
    REPEAT_ISSUE: 'Repeat issue reported',
    REPEAT_ISSUE_RESOLVED: 'Repeat issue resolved',
    ASSET_REASSIGNED: 'Engineer assignment updated',
    ASSET_UNASSIGNED: 'Engineer unassigned',
    ASSET_ARCHIVED: 'Removed from active register'
  })[action] || String(action || 'Asset update').replaceAll('_', ' ');
}

function historyTransition(value, formatter = (x) => x) {
  if (!value || typeof value !== 'object') return '';
  return `${formatter(value.from || '—')} → ${formatter(value.to || '—')}`;
}

export default function Assets() {
  const { user } = useAuth();
  const userId = String(user?.id || user?._id || '');
  const isLead = ['MANAGER', 'TL', 'SL'].includes(user?.role);
  const canCreateEvent = isLead;
  const [assets, setAssets] = useState([]);
  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [mineOnly, setMineOnly] = useState(false);
  const [view, setView] = useState('assets');
  const [intakeOpen, setIntakeOpen] = useState(false);
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
  const [busy, setBusy] = useState(false);

  const showError = (title, message) => {
    setError(message);
    Swal.error(title, message);
  };

  const load = async (showAlert = true) => {
    setLoading(true);
    try {
      const [assetResponse, eventResponse] = await Promise.all([api.get('/assets'), api.get('/assets/events')]);
      setAssets(assetResponse.data);
      setEvents(eventResponse.data);
      setError('');
      return true;
    } catch (e) {
      const message = e.response?.data?.message || 'Could not load the shared asset register.';
      setError(message);
      if (showAlert) Swal.error('Asset desk unavailable', message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    if (isLead) {
      api.get('/team')
        .then((r) => setMembers(r.data.filter((m) => m.status === 'active' && m.role === 'RE')))
        .catch((e) => showError('Could not load engineers', e.response?.data?.message || 'Engineer assignment options could not be loaded.'));
    }
  }, []);

  const visibleAssets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assets.filter((asset) => {
      const isUnassigned = !asset.assignedToId?._id && !asset.assignedToId;
      const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'UNASSIGNED' ? isUnassigned : asset.status === statusFilter);
      const matchesAssignee = !mineOnly || String(asset.assignedToId?._id || asset.assignedToId || '') === userId;
      const haystack = [asset.assetId, asset.userName, asset.employeeId, asset.project, asset.issue, asset.systemType, asset.assignedToId?.name]
        .join(' ').toLowerCase();
      return matchesStatus && matchesAssignee && (!term || haystack.includes(term));
    });
  }, [assets, search, statusFilter, mineOnly, userId]);

  const assignableMembers = useMemo(() => members.filter((member) => (
    user?.role === 'MANAGER' ||
    (user?.role === 'TL' && member.team === user.team) ||
    (user?.role === 'SL' && member.team === user.team && member.shift === user.shift)
  )), [members, user]);

  const counts = useMemo(() => ({
    total: assets.length,
    working: assets.filter((a) => ['RECEIVED', 'IN_PROGRESS'].includes(a.status)).length,
    ready: assets.filter((a) => a.status === 'READY_FOR_PICKUP').length,
    returned: assets.filter((a) => a.status === 'RETURNED').length,
    unassigned: assets.filter((a) => !a.assignedToId?._id && !a.assignedToId).length,
    mine: assets.filter((a) => String(a.assignedToId?._id || a.assignedToId || '') === userId).length
  }), [assets, userId]);

  const allVisibleSelected = visibleAssets.length > 0 && visibleAssets.every((asset) => selectedAssetIds.includes(asset._id));

  const toggleAssetSelection = (assetId) => setSelectedAssetIds((current) => (
    current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]
  ));

  const toggleVisibleSelection = () => setSelectedAssetIds((current) => {
    if (allVisibleSelected) return current.filter((id) => !visibleAssets.some((asset) => asset._id === id));
    return [...new Set([...current, ...visibleAssets.map((asset) => asset._id)])];
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
      const refreshed = await load(false);
      if (refreshed) await Swal.success('Assets removed', data.message || 'The selected assets were removed from the active register.');
      else await Swal.error('Removed, but refresh failed', 'The assets were removed, but the register could not be refreshed.');
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
    if (!selectedAssetIds.length) return;
    if (!bulkAssigneeIds.length) {
      await Swal.error('Select engineers', 'Choose at least one Resolution Engineer to receive the selected systems.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.patch('/assets/bulk-assignment', {
        assetIds: selectedAssetIds,
        assigneeIds: bulkAssigneeIds
      });
      setBulkAssignmentOpen(false);
      setSelectedAssetIds([]);
      const refreshed = await load(false);
      if (refreshed) await Swal.success('System assignments updated', data.message);
      else await Swal.error('Assignments saved, but refresh failed', 'The assignments were saved, but the asset register could not be refreshed.');
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
    setIntakeForm(emptyIntake);
    setLookupQuery('');
    setLookupResults([]);
    setSelectedAsset(null);
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

  const submitIntake = async (e) => {
    e.preventDefault();
    if (!String(intakeForm.assetId || '').trim()) {
      showError('Asset ID required', 'Enter an Asset ID. All other asset details are optional.');
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
      const refreshed = await load(false);
      if (refreshed) {
        const repeatedIssue = data.repeatIssues?.find((row) => row.status === 'OPEN');
        if (repeatedIssue) {
          Swal.success('Repeat issue recorded', `${data.assetId}: ${repeatedIssue.issue} · repeat occurrence ${repeatedIssue.count}.`);
        } else {
          Swal.success(status === 201 ? 'Asset saved' : 'Asset issue updated', `${data.assetId} was saved to the shared register.`);
        }
      } else {
        Swal.error('Saved, but refresh failed', 'The intake was saved, but the shared register could not be refreshed.');
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
      await api.patch(`/assets/${asset._id}/status`, { status, comment });
      const refreshed = await load(false);
      if (refreshed && status === 'READY_FOR_PICKUP' && asset.repeatIssue) {
        const repeatedIssue = asset.repeatIssueSummary?.issue || asset.issue || 'The repeated issue';
        const repeatCount = asset.repeatIssueSummary?.count || asset.repeatIssueCount || 1;
        Swal.success('Repeated issue resolved', `${repeatedIssue} is resolved after ${repeatCount} repeat occurrence(s).`);
      } else if (refreshed) Swal.success('Asset status updated', `${asset.assetId} is now ${formatStatus(status)}.`);
      else Swal.error('Status saved, but refresh failed', 'The status was saved, but the register could not be refreshed.');
    } catch (e) {
      showError('Could not update status', e.response?.data?.message || 'Could not update asset status.');
    }
  };

  const changeAssignee = async (asset, assignedToId) => {
    const currentId = String(asset.assignedToId?._id || asset.assignedToId || '');
    if (currentId === assignedToId) return;
    setBusy(true);
    try {
      await api.patch(`/assets/${asset._id}/assignment`, { assignedToId: assignedToId || null });
      const refreshed = await load(false);
      if (refreshed) {
        const nextName = assignableMembers.find((member) => member._id === assignedToId)?.name;
        Swal.success(assignedToId ? 'Asset assigned' : 'Asset unassigned', assignedToId ? `${asset.assetId} is now assigned to ${nextName || 'the selected engineer'}.` : `${asset.assetId} is now unassigned.`);
      } else {
        Swal.error('Assignment saved, but refresh failed', 'The assignment was saved, but the register could not be refreshed.');
      }
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
      setHistoryRows(data);
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
      const refreshed = await load(false);
      if (refreshed) Swal.success('Bulk event removed', 'Its asset records and service history were kept.');
      else Swal.error('Event removed, refresh failed', 'The event was removed, but the list could not be refreshed.');
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
      <label>Issue<textarea rows="3" value={value.issue} onChange={(e) => setValue({ ...value, issue: e.target.value })} placeholder="Describe the reported issue or requested update (optional)" /></label>
      {includeAssignee && <label>Expected pickup date (optional)<input type="date" value={value.expectedPickupAt || ''} onChange={(e) => setValue({ ...value, expectedPickupAt: e.target.value })} /></label>}
      {includeAssignee && isLead && <label>Assign to engineer<select value={value.assignedToId} onChange={(e) => setValue({ ...value, assignedToId: e.target.value })}><option value="">Leave unassigned</option>{assignableMembers.map((m) => <option key={m._id} value={m._id}>{m.name} · {m.team}</option>)}</select></label>}
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
        <div className="metric-card"><div className="metric-top">In service <span className="metric-icon orange"><Wrench size={17} /></span></div><div className="metric-value">{counts.working}</div><div className="metric-note">Received or currently being worked on</div></div>
        <button type="button" className="metric-card asset-filter-card" onClick={() => { setView('assets'); setStatusFilter('READY_FOR_PICKUP'); setMineOnly(false); setSearch(''); }}><div className="metric-top">Ready for pickup <span className="metric-icon green"><CheckCircle2 size={17} /></span></div><div className="metric-value">{counts.ready}</div><div className="metric-note">Completed systems awaiting collection</div></button>
        <button type="button" className="metric-card asset-filter-card" onClick={() => { setView('assets'); setStatusFilter('RETURNED'); setMineOnly(false); setSearch(''); }}><div className="metric-top">Returned to user <span className="metric-icon green"><CheckCircle2 size={17} /></span></div><div className="metric-value">{counts.returned}</div><div className="metric-note">Systems handed back to their users</div></button>
        <button type="button" className="metric-card asset-filter-card" onClick={() => { setView('assets'); setStatusFilter('UNASSIGNED'); setMineOnly(false); setSearch(''); }}><div className="metric-top">Unassigned <span className="metric-icon orange"><UserRound size={17} /></span></div><div className="metric-value">{counts.unassigned}</div><div className="metric-note">Systems waiting for an engineer</div></button>
        <div className="metric-card"><div className="metric-top">Assigned to me <span className="metric-icon purple"><UserRound size={17} /></span></div><div className="metric-value">{counts.mine}</div><div className="metric-note">Current asset work assigned to you</div></div>
      </div>

      <section className="panel table-panel asset-register-panel">
        <div className="asset-tabs">
          <button className={view === 'assets' ? 'active' : ''} onClick={() => setView('assets')}><Laptop size={15} /> Asset register <span>{assets.length}</span></button>
          <button className={view === 'events' ? 'active' : ''} onClick={() => setView('events')}><CalendarDays size={15} /> Bulk events <span>{events.length}</span></button>
        </div>

        {view === 'assets' ? <>
          <div className="table-toolbar">
            <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset, user, employee, project…" /></div>
            <div className="filter-controls">
              {isLead && selectedAssetIds.length > 0 && <>
                <button className="btn btn-secondary btn-sm" disabled={busy || !assignableMembers.length} onClick={() => { setError(''); setBulkAssigneeIds([]); setBulkAssignmentOpen(true); }}><UserRound size={14} /> Distribute selected ({selectedAssetIds.length})</button>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => removeAssets(selectedAssetIds)}><Trash2 size={14} /> Remove selected ({selectedAssetIds.length})</button>
              </>}
              <label className="toggle-filter"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Assigned to me</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="ALL">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}<option value="UNASSIGNED">Unassigned</option></select>
              <button className="icon-btn" title="Refresh register" onClick={load}><RefreshCw size={16} /></button>
            </div>
          </div>
          <div className="table-scroll"><table>
            <thead><tr>{isLead && <th><input aria-label="Select all visible assets" type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleSelection} /></th>}<th>ASSET / USER</th><th>EMPLOYEE / PROJECT</th><th>SYSTEM</th><th>ISSUE / UPDATE</th><th>WORK EVENT</th><th>ASSIGNED TO</th><th>STATUS</th><th>HISTORY</th>{isLead && <th>REMOVE</th>}</tr></thead>
            <tbody>{visibleAssets.map((asset) => {
              const assignedToMe = String(asset.assignedToId?._id || asset.assignedToId || '') === userId;
              const canUpdate = user?.role === 'RE' && assignedToMe;
              return <tr key={asset._id} className={asset.repeatIssue ? 'asset-repeat-row' : asset.repeatIssueCount ? 'asset-repeat-resolved-row' : ''}>
                {isLead && <td><input aria-label={`Select asset ${asset.assetId}`} type="checkbox" checked={selectedAssetIds.includes(asset._id)} onChange={() => toggleAssetSelection(asset._id)} /></td>}
                <td><div className="asset-main-cell"><strong>{asset.assetId}</strong>{asset.repeatIssueCount > 0 && <span className={`asset-repeat-pill ${asset.repeatIssueSummary?.status === 'RESOLVED' ? 'is-resolved' : ''}`}>Repeat ×{asset.repeatIssueCount} · {asset.repeatIssueSummary?.status === 'OPEN' ? 'Open' : 'Resolved'}</span>}<span>{asset.userName}</span></div></td>
                <td><div className="asset-main-cell"><strong>{asset.employeeId}</strong><span>{asset.project}</span></div></td>
                <td><span className="badge badge-service_request">{asset.systemType}</span></td>
                <td><div className="asset-issue-cell"><span>{asset.issue}</span>{asset.repeatIssueSummary && <small className="asset-repeat-summary">Repeated issue: {asset.repeatIssueSummary.issue} · {asset.repeatIssueSummary.count} time(s) · {asset.repeatIssueSummary.status}</small>}<small>Updated {new Date(asset.updatedAt).toLocaleString()} by {asset.lastUpdatedBy?.name || 'workspace user'}{asset.expectedPickupAt ? ` · Pickup ${new Date(asset.expectedPickupAt).toLocaleDateString()}` : ''}</small></div></td>
                <td>{asset.eventId?.title || <span className="muted-cell">Walk-in</span>}</td>
                <td>{isLead ? <select className="inline-status asset-assignee-select" aria-label={`Assign ${asset.assetId}`} disabled={busy} value={asset.assignedToId?._id || asset.assignedToId || ''} onChange={(e) => changeAssignee(asset, e.target.value)}>
                  <option value="">Unassigned</option>
                  {asset.assignedToId?.name && !assignableMembers.some((member) => member._id === (asset.assignedToId?._id || asset.assignedToId)) && <option value={asset.assignedToId?._id || asset.assignedToId} disabled>{asset.assignedToId.name} (outside your assignment scope)</option>}
                  {assignableMembers.map((member) => <option key={member._id} value={member._id}>{member.name}</option>)}
                </select> : asset.assignedToId?.name || <span className="unassigned">Unassigned</span>}</td>
                <td>{canUpdate ? <select className="inline-status asset-status-select" disabled={busy} value={asset.status} onChange={(e) => changeStatus(asset, e.target.value)}>{statuses.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}</select> : <span className={`status-pill ${asset.status === 'READY_FOR_PICKUP' || asset.status === 'RETURNED' ? 'status-completed' : asset.status === 'IN_PROGRESS' ? 'status-wip' : 'status-open'}`}>{formatStatus(asset.status)}</span>}</td>
                <td><button className="btn btn-secondary btn-sm" onClick={() => showHistory(asset)}><History size={14} /> View</button></td>
                {isLead && <td><button className="btn btn-danger btn-sm" title={`Remove ${asset.assetId}`} disabled={busy} onClick={() => removeAssets([asset._id])}><Trash2 size={14} /> Remove</button></td>}
              </tr>;
            })}</tbody>
          </table></div>
          {!loading && !visibleAssets.length && <div className="empty-state compact"><div className="empty-icon"><Laptop size={21} /></div><strong>No matching assets</strong><p>Walk-in intakes and bulk event uploads appear in the shared register.</p></div>}
          <div className="table-footer"><span>{visibleAssets.length} asset(s) shown</span><span className="table-footer-right">Latest status and issue changes are visible to your workspace.</span></div>
        </> : <div className="asset-events-list">
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

      {intakeOpen && <Modal title="Walk-in asset intake" onClose={() => setIntakeOpen(false)}>
        <form className="form-stack modal-form" onSubmit={submitIntake}>
          <p className="muted-cell" style={{ margin: 0 }}>Search by Asset ID, Employee ID, or user name to fill saved details. Asset ID is the only required field; add the issue and any details missing from the register.</p>
          <div className="asset-lookup-box">
            <label>Find an existing system<input type="search" value={lookupQuery} onChange={(e) => setLookupQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findExistingAsset(); } }} placeholder="Asset ID, Employee ID, or user name" /></label>
            <button type="button" className="btn btn-secondary btn-sm" disabled={lookupBusy} onClick={findExistingAsset}>{lookupBusy ? 'Searching…' : 'Search register'}</button>
            {selectedAsset && <div className="asset-selected-match"><span>Using saved record <strong>{selectedAsset.assetId}</strong>{selectedAsset.userName ? ` · ${selectedAsset.userName}` : ''}</span><button type="button" onClick={() => { setSelectedAsset(null); setIntakeForm(emptyIntake); setLookupQuery(''); }}>Clear match</button></div>}
            {lookupResults.length > 0 && <div className="asset-lookup-results">{lookupResults.map((asset) => <button type="button" key={asset._id} onClick={() => selectExistingAsset(asset)}><strong>{asset.assetId}</strong><span>{[asset.userName, asset.employeeId, asset.project, asset.systemType].filter(Boolean).join(' · ') || 'No saved details yet'}</span></button>)}</div>}
          </div>
          {fields(intakeForm, setIntakeForm, true)}
          {error && <div className="error-box">{error}</div>}
          <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setIntakeOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save intake'}</button></div>
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

      {bulkAssignmentOpen && <Modal title={`Distribute ${selectedAssetIds.length} selected system(s)`} onClose={() => setBulkAssignmentOpen(false)}>
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
              <div className="metric-card"><div className="metric-top">Ready for pickup</div><div className="metric-value">{eventReport.summary.readyForPickup}</div><div className="metric-note">Completed and waiting for collection</div></div>
              <div className="metric-card"><div className="metric-top">Returned to user</div><div className="metric-value">{eventReport.summary.returnedToUser}</div><div className="metric-note">Handed back to the user</div></div>
              <div className="metric-card"><div className="metric-top">Pending</div><div className="metric-value">{eventReport.summary.pending}</div><div className="metric-note">Not completed yet</div></div>
              <div className="metric-card"><div className="metric-top">Worked on</div><div className="metric-value">{eventReport.summary.worked}</div><div className="metric-note">Systems with recorded engineer activity</div></div>
            </div>
            <section className="asset-event-report-section">
              <div className="panel-heading"><div><h3>Engineer workload</h3><p>Who received systems and who recorded work for this event.</p></div></div>
              {eventReport.engineers.length ? <div className="table-scroll"><table><thead><tr><th>ENGINEER</th><th>ASSIGNED</th><th>WORKED ON</th><th>COMPLETED</th><th>PENDING</th></tr></thead><tbody>{eventReport.engineers.map((person) => <tr key={person._id}><td><strong>{person.name}</strong><small className="work-table-sub">{person.role}</small></td><td>{person.assignedCount}</td><td>{person.workedCount}</td><td>{person.completedCount}</td><td>{person.pendingCount}</td></tr>)}</tbody></table></div> : <p className="muted-cell">No engineers were assigned and no work has been recorded for this event.</p>}
            </section>
            <section className="asset-event-report-section">
              <div className="panel-heading"><div><h3>System details</h3><p>Assignment, current event status, and the engineers who updated each system.</p></div><div className="asset-event-actions"><span className="count-pill">{eventReport.assets.length} systems</span>{isLead && eventReport.assets.some((asset) => !asset.assignedToId) && <button className="btn btn-secondary btn-sm" onClick={distributeUnassignedEventAssets}><UserRound size={14} /> Assign unassigned systems</button>}</div></div>
              {eventReport.assets.length ? <div className="table-scroll"><table><thead><tr><th>ASSET ID</th><th>USER / PROJECT</th><th>ISSUE</th><th>ASSIGNED TO</th><th>WORKED BY</th><th>STATUS</th><th>LAST WORK</th></tr></thead><tbody>{eventReport.assets.map((asset) => <tr key={asset._id} className={asset.repeatIssue ? 'asset-repeat-row' : asset.repeatIssueCount ? 'asset-repeat-resolved-row' : ''}>
                <td><strong>{asset.assetId}</strong>{asset.repeatIssueCount > 0 && <small className={`asset-repeat-pill ${asset.repeatIssueSummary?.status === 'RESOLVED' ? 'is-resolved' : ''}`}>Repeat ×{asset.repeatIssueCount} · {asset.repeatIssueSummary?.status === 'OPEN' ? 'Open' : 'Resolved'}</small>}{asset.isArchived && <small className="work-table-sub">Archived from active register</small>}</td>
                <td><div className="asset-main-cell"><strong>{asset.userName || asset.employeeId || 'No user details'}</strong><span>{[asset.employeeId, asset.project, asset.systemType].filter(Boolean).join(' | ')}</span></div></td>
                <td><div className="asset-issue-cell"><span>{asset.issue || '-'}</span>{asset.repeatIssueSummary && <small className="asset-repeat-summary">Repeated issue: {asset.repeatIssueSummary.issue} · {asset.repeatIssueSummary.count} time(s) · {asset.repeatIssueSummary.status}</small>}</div></td>
                <td>{asset.assignedTo?.name || <span className="unassigned">Unassigned</span>}</td>
                <td>{asset.workedBy.length ? asset.workedBy.map((person) => person.name).join(', ') : <span className="muted-cell">No work logged</span>}</td>
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
          {historyRows.length ? <div className="ticket-log-timeline">{historyRows.map((row) => <div className={`ticket-log-entry asset-history-entry ${['REPEAT_ISSUE', 'REPEAT_ISSUE_RESOLVED'].includes(row.action) ? 'is-repeat-issue' : ''}`} key={row._id}>
            <div className="ticket-log-dot" /><div className="ticket-log-content">
              <div className="ticket-log-header"><span className="ticket-log-title">{historyActionLabel(row.action)}</span><span className="ticket-log-time">{new Date(row.createdAt).toLocaleString()}</span></div>
              <div className="asset-history-byline">By <strong>{row.performedBy?.name || 'Workspace user'}</strong>{row.eventId?.title ? ` · ${row.eventId.title}` : ''}</div>
              <div className="asset-history-summary">
                {row.assignedToNames && <span><b>Assigned</b>{row.assignedToNames.from} → {row.assignedToNames.to}</span>}
                {row.changes?.status && <span><b>Status</b>{historyTransition(row.changes.status, formatStatus)}</span>}
                {row.changes?.issue && <span><b>Issue</b>{row.changes.issue.to || row.changes.issue.from || historyAsset.issue || '—'}</span>}
                {row.changes?.archive && <span><b>Register</b>Removed from active list; history kept</span>}
              </div>
              {row.repeatIssueInfo && <div className={`repeat-issue-callout ${row.repeatIssueInfo.status === 'RESOLVED' ? 'is-resolved' : ''}`}><strong>{row.repeatIssueInfo.status === 'RESOLVED' ? 'Repeated issue resolved' : 'Repeated issue reported'}</strong><span>{row.repeatIssueInfo.issue} · Repeat occurrence {row.repeatIssueInfo.count}{row.repeatIssueInfo.status === 'RESOLVED' ? ` · Resolved ${row.repeatIssueInfo.resolvedAt ? new Date(row.repeatIssueInfo.resolvedAt).toLocaleString() : ''}` : ''}</span></div>}
              {row.action === 'STATUS_UPDATED' && row.changes?.status?.to === 'IN_PROGRESS' && row.comment && <div className="asset-pending-note"><b>Pending reason</b><span>{row.comment}</span></div>}
              {row.action === 'STATUS_UPDATED' && row.changes?.status?.to === 'READY_FOR_PICKUP' && row.comment && <div className="asset-pending-note"><b>Completion note</b><span>{row.comment}</span></div>}
            </div>
          </div>)}</div> : <p className="muted-cell">No history has been recorded yet.</p>}
          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setHistoryAsset(null)}>Close</button></div>
        </div>
      </Modal>}
    </div>
  );
}
