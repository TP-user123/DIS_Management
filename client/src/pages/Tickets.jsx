import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Upload,
  Search,
  RefreshCw,
  Users,
  Ticket as TicketIcon,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  Download,
  Plus,
  Shuffle,
  History,
  FileText,
  User,
  Calendar,
  Layers,
  ArrowRight,
  Lock
} from 'lucide-react';
import * as XLSX from 'xlsx';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import Swal from '../utils/swal.js';

const manualEmpty = {
  ticketNumber: '',
  sourceStatus: 'Open',
  loggedDate: new Date().toISOString().slice(0, 10),
  item: '',
  requestType: 'Incident',
  priorityName: 'Medium',
  description: '',
  remarks: '',
  currentLevel: ''
};

const normalizeExcelDate = (v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, d.S || 0)).toISOString();
  }
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (m) {
    let a = Number(m[1]),
      b = Number(m[2]),
      y = Number(m[3]),
      day,
      month;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      day = b;
      month = a;
    } else {
      day = a;
      month = b;
    }
    const d = new Date(Date.UTC(y, month - 1, day));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
};

const isResolved = (s) => s === 'RESOLVED';
const canShowAge = (ticket) => {
  const status = ticket.workflowStatus || 'OPEN';
  return status === 'OPEN' || status === 'WIP' || (!ticket.assigneeId && status !== 'RESOLVED');
};

export default function Tickets() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const currentUserId = String(user?.id || user?._id || '');
  const canAssignTickets = user?.role === 'MANAGER' || (user?.permissions || []).includes('tickets:assign');
  const canImport = user?.role === 'MANAGER' || (user?.permissions || []).includes('tickets:import');
  const canCreateTicket = canImport || user?.role === 'RE';
  const canReopenTicket = ['MANAGER', 'TL', 'SL'].includes(user?.role);

  // Core Data States
  const [items, setItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('ALL');
  const [ageing, setAgeing] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
const [pageSize, setPageSize] = useState(10);

  // Active Tab: 'my_queue' | 'assigned' | 'unassigned' | 'resolved' | 'reopened' | 'all'
  const [activeTab, setActiveTab] = useState('all');

  // Assignment Controls
  const [target, setTarget] = useState('');
  const [distributionUsers, setDistributionUsers] = useState([]);
  const [distributeOpen, setDistributeOpen] = useState(false);

  // Modals & History Drawer
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState(manualEmpty);
  const [detailTicket, setDetailTicket] = useState(null);
  const [ticketLogs, setTicketLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Feedback States
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!location.state?.openCreate) return;
    if (canCreateTicket) {
      setError('');
      setManualForm({ ...manualEmpty, requestType: location.state?.requestType || manualEmpty.requestType });
      setManualOpen(true);
    }
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [canCreateTicket, location.key, location.pathname, location.search, location.state, navigate]);

  // Eligible members for assignment based on role and team rules
  const eligibleMembers = useMemo(() => {
    return members.filter(
      (m) =>
        user?.role === 'MANAGER' ||
        (user?.role === 'TL' && ['SL', 'RE'].includes(m.role) && m.team === user.team) ||
        (user?.role === 'SL' && m.role === 'RE' && m.team === user.team && m.shift === user.shift) ||
        (user?.role === 'RE' && (user?.permissions || []).includes('tickets:assign') && m.role === 'RE' && m.team === user.team)
    );
  }, [members, user]);

  // Load Tickets from Server
  const load = () => {
    api.get('/tickets')
      .then((r) => setItems(r.data))
      .catch((e) => setError(e.response?.data?.message || 'Unable to load tickets.'));
  };

  useEffect(() => {
    load();
    api.get('/team')
      .then((r) => setMembers(r.data.filter((u) => u.status === 'active')))
      .catch(() => {});
  }, []);

  // Filtered Items by Tab, Priority, and Search
  const filteredItems = useMemo(() => {
    return items.filter((t) => {
      const status = t.workflowStatus || 'OPEN';
      const isMine = String(t.assigneeId || '') === currentUserId;
      const isUnassigned = !t.assigneeId;

      // Section tab separation
      if (activeTab === 'my_queue' && !isMine) return false;
      if (activeTab === 'assigned' && (isUnassigned || status === 'RESOLVED')) return false;
      if (activeTab === 'unassigned' && (!isUnassigned || status === 'RESOLVED')) return false;
      if (activeTab === 'resolved' && status !== 'RESOLVED') return false;
      if (activeTab === 'reopened' && status !== 'REOPENED') return false;

      // Priority filter
      if (priority !== 'ALL' && t.priorityName !== priority) return false;
      if (ageing !== 'ALL' && (!canShowAge(t) || Number(t.ageDays) !== Number(ageing))) return false;

      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchNumber = t.ticketNumber?.toLowerCase().includes(q);
        const matchDesc = t.description?.toLowerCase().includes(q);
        const matchItem = t.item?.toLowerCase().includes(q);
        const matchAssignee = t.assignee?.name?.toLowerCase().includes(q);
        return matchNumber || matchDesc || matchItem || matchAssignee;
      }

      return true;
    });
  }, [items, activeTab, priority, ageing, search, currentUserId]);

  const availableAges = useMemo(
    () => [...new Set(items.filter(canShowAge).map((ticket) => Number(ticket.ageDays)).filter((age) => Number.isFinite(age) && age >= 0))]
      .sort((first, second) => first - second),
    [items]
  );

  useEffect(() => {
    if (ageing !== 'ALL' && !availableAges.includes(Number(ageing))) setAgeing('ALL');
  }, [ageing, availableAges]);

  // Reset pagination when filters or tabs change
useEffect(() => {
  setCurrentPage(1);
}, [activeTab, priority, ageing, search, pageSize]);

// Calculate pagination
const totalPages = Math.max(
  1,
  Math.ceil(filteredItems.length / pageSize)
);

// Keep the current page valid when tickets are removed
useEffect(() => {
  if (currentPage > totalPages) {
    setCurrentPage(totalPages);
  }
}, [currentPage, totalPages]);

// Get tickets for the current page
const paginatedItems = useMemo(() => {
  const startIndex = (currentPage - 1) * pageSize;

  return filteredItems.slice(startIndex, startIndex + pageSize);
}, [filteredItems, currentPage, pageSize]);

const startItem = filteredItems.length
  ? (currentPage - 1) * pageSize + 1
  : 0;

const endItem = Math.min(
  currentPage * pageSize,
  filteredItems.length
);

  // Tab Counts for Instant Tab Badges
  const tabCounts = useMemo(() => {
    return {
      all: items.length,
      my_queue: items.filter((t) => String(t.assigneeId || '') === currentUserId).length,
      assigned: items.filter((t) => t.assigneeId && t.workflowStatus !== 'RESOLVED').length,
      unassigned: items.filter((t) => !t.assigneeId && t.workflowStatus !== 'RESOLVED').length,
      resolved: items.filter((t) => t.workflowStatus === 'RESOLVED').length,
      reopened: items.filter((t) => t.workflowStatus === 'REOPENED').length
    };
  }, [items, currentUserId]);

  // Overall Queue Metrics
  const stats = useMemo(() => ({
    total: items.length,
    open: items.filter((t) => !isResolved(t.workflowStatus || 'OPEN')).length,
    closed: items.filter((t) => isResolved(t.workflowStatus || 'OPEN')).length,
    aging: items.filter((t) => canShowAge(t) && Number(t.ageDays) > 1).length
  }), [items]);

  // Selection Toggle Handlers - Exclude resolved tickets to prevent credit theft
  const assignableFilteredItems = useMemo(() => {
    return filteredItems.filter((t) => (t.workflowStatus || 'OPEN') !== 'RESOLVED');
  }, [filteredItems]);

  const toggleSelect = (ticket) => {
    if ((ticket.workflowStatus || 'OPEN') === 'RESOLVED') {
      Swal.warning(
        'Ticket Locked',
        `Ticket ${ticket.ticketNumber} is resolved. Resolved tickets remain locked to the resolving engineer's work track and cannot be reassigned to prevent credit theft.`
      );
      return;
    }
    const id = ticket._id;
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const allFilteredSelected =
    assignableFilteredItems.length > 0 &&
    assignableFilteredItems.every((t) => selected.includes(t._id));

  const toggleSelectAll = (checked) => {
    if (checked) {
      const idsToAdd = assignableFilteredItems.map((t) => t._id);
      setSelected((prev) => [...new Set([...prev, ...idsToAdd])]);
    } else {
      const idsToRemove = new Set(filteredItems.map((t) => t._id));
      setSelected((prev) => prev.filter((id) => !idsToRemove.has(id)));
    }
  };

  // Open Ticket Audit Log / Details Modal
  const openTicketDetails = async (ticket) => {
    setDetailTicket(ticket);
    setTicketLogs([]);
    setLoadingLogs(true);
    try {
      const { data } = await api.get(`/tickets/${ticket._id}/logs`);
      setTicketLogs(data);
    } catch {
      // Graceful fallback if no logs yet
      setTicketLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Status changes ask for a note; only leads can reopen or restore resolved tickets.
  const changeStatus = async (ticket, nextStatus) => {
    const currentStatus = ticket.workflowStatus || 'OPEN';
    if (nextStatus === currentStatus) return;

    // Strict Condition check: Once resolved, only allow Reopen or keep Resolved
    if (currentStatus === 'RESOLVED' && !['REOPEN', 'REOPENED', 'RESTORE'].includes(nextStatus)) {
      Swal.error('Action Not Allowed', 'A resolved ticket can only be reopened or restored to its previous status.');
      return;
    }

    const labelMap = {
      OPEN: 'Open',
      WIP: 'Work In Progress',
      RESOLVED: 'Resolved',
      REOPEN: 'Reopen Ticket',
      REOPENED: 'Reopened',
      RESTORE: 'Restore previous status'
    };

    // Prompt for description via SweetAlert
    const promptRes = await Swal.prompt(
      `Mark as ${labelMap[nextStatus]}`,
      `Please provide remarks / reason for updating ticket ${ticket.ticketNumber} to ${labelMap[nextStatus]}:`,
      'Enter explanation, resolution notes, or reason for reopening...',
      false
    );

    if (!promptRes.isConfirmed) return; // User cancelled

    const description = promptRes.value || '';
    setBusy(true);
    setError('');

    try {
      const { data } = await api.patch(`/tickets/${ticket._id}/status`, {
        status: nextStatus,
        description
      });
      const updatedStatus = data.ticket?.workflowStatus || (nextStatus === 'REOPEN' ? 'REOPENED' : nextStatus);
      Swal.success('Status Updated', `Ticket ${ticket.ticketNumber} is now ${labelMap[updatedStatus] || updatedStatus}.`);
      await load();
      if (detailTicket && detailTicket._id === ticket._id) {
        openTicketDetails({ ...ticket, ...data.ticket, workflowStatus: updatedStatus });
      }
    } catch (e) {
      Swal.error('Update Failed', e.response?.data?.message || 'Unable to update ticket status.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  // Bulk Assignment Handler with SweetAlert Description Prompt (Applied in One-Shot)
  const assignBulk = async () => {
    if (!selected.length) {
      Swal.warning('No Tickets Selected', 'Please select at least one ticket to assign.');
      return;
    }

    const resolvedInSelection = items.filter((t) => selected.includes(t._id) && (t.workflowStatus || 'OPEN') === 'RESOLVED');
    if (resolvedInSelection.length > 0) {
      Swal.error('Action Blocked', 'Resolved tickets cannot be reassigned. They remain locked to the resolver to prevent work theft.');
      return;
    }

    if (!target) {
      Swal.warning('Select Assignee', 'Please choose an active engineer recipient from the dropdown.');
      return;
    }

    const targetUser = members.find((m) => String(m._id || m.id) === String(target));
    const targetName = targetUser?.name || 'Engineer';

    // SweetAlert prompt for assignment description
    const promptRes = await Swal.prompt(
      `Assign ${selected.length} Ticket(s)`,
      `Assignment notes or instructions for ${targetName}:`,
      'Enter work instructions, priority guidance, or assignment notes...',
      false
    );

    if (!promptRes.isConfirmed) return; // User cancelled

    const description = promptRes.value || '';
    setBusy(true);
    setError('');

    try {
      const { data } = await api.post('/tickets/assign-bulk', {
        ticketIds: selected,
        assigneeId: target,
        description
      });

      Swal.success(
        'Assignment Complete',
        `${data.assigned} ticket(s) successfully assigned to ${data.assignee} with your instructions applied in one shot.`
      );
      setSelected([]);
      setTarget('');
      await load();
    } catch (e) {
      Swal.error('Assignment Failed', e.response?.data?.message || 'Assignment failed.');
    } finally {
      setBusy(false);
    }
  };

  // Random Distribution Handler with SweetAlert
  const distributeRandomly = async () => {
    if (!selected.length) return Swal.warning('Selection Required', 'Select tickets to distribute.');

    const resolvedInSelection = items.filter((t) => selected.includes(t._id) && (t.workflowStatus || 'OPEN') === 'RESOLVED');
    if (resolvedInSelection.length > 0) {
      Swal.error('Action Blocked', 'Resolved tickets cannot be distributed. They remain locked to the resolver to prevent work theft.');
      return;
    }

    if (!distributionUsers.length) return Swal.warning('Selection Required', 'Select at least one team member.');

    const promptRes = await Swal.prompt(
      `Distribute ${selected.length} Tickets`,
      'Optional notes / instructions to attach to these distributed tickets:',
      'Enter distribution notes...',
      false
    );

    if (!promptRes.isConfirmed) return;

    setBusy(true);
    try {
      const { data } = await api.post('/tickets/distribute', {
        ticketIds: selected,
        assigneeIds: distributionUsers,
        description: promptRes.value || ''
      });

      Swal.success(
        'Tickets Distributed',
        data.message + ' ' + data.distribution.map((x) => `${x.name}: ${x.count}`).join(' · ')
      );
      setSelected([]);
      setDistributeOpen(false);
      setDistributionUsers([]);
      await load();
    } catch (e) {
      Swal.error('Distribution Failed', e.response?.data?.message || 'Unable to distribute tickets.');
    } finally {
      setBusy(false);
    }
  };

  // Excel Import Handler
  const importFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setNotice('');
    setBusy(true);

    try {
      const bytes = await file.arrayBuffer();
      const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
      const sheet = wb.Sheets.TicketList || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });

      for (const row of rows) {
        const key = Object.keys(row).find((k) => k.trim().toLowerCase() === 'logged date');
        if (key && row[key]) row[key] = normalizeExcelDate(row[key]);
      }

      if (!rows.length) {
        throw new Error('No ticket rows found. Ensure the Excel file contains data below the header row.');
      }

      const { data } = await api.post('/tickets/import', { rows });
      Swal.success(
        'Import Completed',
        `Processed ${data.created} new and ${data.updated} updated ticket(s). ${data.skipped ? data.skipped + ' skipped.' : ''}`
      );
      await load();
    } catch (err) {
      Swal.error('Import Failed', err.response?.data?.message || err.message || 'Excel import failed.');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  // Create Manual Ticket
  const createManual = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/tickets/manual', manualForm);
      Swal.success('Ticket Created', `Ticket ${data.ticket.ticketNumber} created successfully.`);
      setManualOpen(false);
      setManualForm(manualEmpty);
      await load();
    } catch (e) {
      setError(e.response?.data?.message || 'Unable to create ticket.');
    } finally {
      setBusy(false);
    }
  };

  // Export View CSV
  const exportCsv = () => {
    const csv = [
      ['Ticket Number', 'OpsDesk Status', 'Source Status', 'Priority', 'Logged Date', 'Age Days', 'Assignee', 'Description'],
      ...filteredItems.map((t) => [
        t.ticketNumber,
        t.workflowStatus || 'OPEN',
        t.sourceStatus,
        t.priorityName,
        new Date(t.loggedDate).toLocaleDateString(),
        canShowAge(t) ? t.ageDays : '',
        t.assignee?.name || 'Unassigned',
        t.description
      ])
    ]
      .map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','))
      .join('\n');

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `opsdesk-tickets-${activeTab}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page-stack">
      {/* Header Row */}
      <div className="welcome-row">
        <div>
          <div className="page-kicker">TICKET ORCHESTRATION</div>
          <h1>
            Ticket queue<span className="title-period">.</span>
          </h1>
          <p>
            Sectioned ticket queues, SweetAlert assignment with notes, and full historical audit logs.
          </p>
        </div>

        <div className="header-actions">
          <button
            className="btn btn-secondary"
            onClick={() => {
              setManualForm(manualEmpty);
              setManualOpen(true);
            }}
            disabled={!canCreateTicket}
          >
            <Plus size={16} /> Add ticket
          </button>

          {canImport && (
            <label className={`btn btn-primary ${busy ? 'disabled' : ''}`}>
              <Upload size={16} />
              {busy ? 'Processing…' : 'Import Excel'}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                disabled={busy}
                onChange={importFile}
              />
            </label>
          )}

          <button className="btn btn-secondary" onClick={exportCsv}>
            <Download size={16} /> Export view
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {notice && <div className="success-box">{notice}</div>}

      {/* Metric Cards */}
      <div className="metric-grid ticket-metrics">
        <div className="metric-card">
          <div className="metric-top">
            <span>Total Tickets</span>
            <span className="metric-icon blue"><TicketIcon size={18} /></span>
          </div>
          <div className="metric-value">{stats.total}</div>
          <div className="metric-note">Imported workspace records</div>
        </div>

        <div className="metric-card">
          <div className="metric-top">
            <span>Open & Active</span>
            <span className="metric-icon orange"><Clock3 size={18} /></span>
          </div>
          <div className="metric-value">{stats.open}</div>
          <div className="metric-note">Open, WIP or Reopened</div>
        </div>

        <div className="metric-card">
          <div className="metric-top">
            <span>Resolved</span>
            <span className="metric-icon green"><CheckCircle2 size={18} /></span>
          </div>
          <div className="metric-value">{stats.closed}</div>
          <div className="metric-note">Resolved in OpsDesk</div>
        </div>

        <div className="metric-card">
          <div className="metric-top">
            <span>Aging Tickets</span>
            <span className="metric-icon orange"><AlertTriangle size={18} /></span>
          </div>
          <div className="metric-value">{stats.aging}</div>
          <div className="metric-note">Active for more than 0 days</div>
        </div>
      </div>

      {/* Main Table Panel */}
      <section className="panel table-panel">
        {/* Section Tabs (Requirement 4: Don't merge user queue, assigned, resolved, reopen) */}
        <div className="ticket-tabs">
          <button
            className={`ticket-tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Tickets <span className="ticket-tab-count">{tabCounts.all}</span>
          </button>

          <button
            className={`ticket-tab ${activeTab === 'my_queue' ? 'active' : ''}`}
            onClick={() => setActiveTab('my_queue')}
          >
            My Queue <span className="ticket-tab-count">{tabCounts.my_queue}</span>
          </button>

          <button
            className={`ticket-tab ${activeTab === 'assigned' ? 'active' : ''}`}
            onClick={() => setActiveTab('assigned')}
          >
            Assigned (WIP) <span className="ticket-tab-count">{tabCounts.assigned}</span>
          </button>

          <button
            className={`ticket-tab ${activeTab === 'unassigned' ? 'active' : ''}`}
            onClick={() => setActiveTab('unassigned')}
          >
            Unassigned Pool <span className="ticket-tab-count">{tabCounts.unassigned}</span>
          </button>

          <button
            className={`ticket-tab ${activeTab === 'resolved' ? 'active' : ''}`}
            onClick={() => setActiveTab('resolved')}
          >
            Resolved <span className="ticket-tab-count">{tabCounts.resolved}</span>
          </button>

          <button
            className={`ticket-tab ${activeTab === 'reopened' ? 'active' : ''}`}
            onClick={() => setActiveTab('reopened')}
          >
            Reopened <span className="ticket-tab-count">{tabCounts.reopened}</span>
          </button>
        </div>

        {/* Toolbar & Filters (Route option completely removed) */}
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              placeholder="Search ticket ID, description, or engineer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="filter-controls">
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="ALL">All priorities</option>
              {['Critical', 'High', 'Medium', 'Low'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            <select
              aria-label="Filter tickets by age"
              value={ageing}
              onChange={(e) => setAgeing(e.target.value)}
            >
              <option value="ALL">Any age</option>
              {availableAges.map((age) => (
                <option key={age} value={age}>{age} day{age === 1 ? '' : 's'}</option>
              ))}
            </select>

            <button className="icon-btn" title="Refresh queue" onClick={load}>
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {/* Bulk Action Bar (Requirement 5: Popup asks for description applied in one shot) */}
        {canAssignTickets && (
          <div className="bulk-assign-bar">
            <div>
              <strong>Assign tickets</strong>
              <span> · {selected.length} selected</span>
            </div>

            <div className="bulk-actions">
              <select className="ticket-recipient-select" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose assignee…</option>
                {eligibleMembers.map((m) => (
                  <option key={m._id || m.id} value={m._id || m.id}>
                    {m.name} · {m.role} ({m.team})
                  </option>
                ))}
              </select>

              <button
                className="btn btn-primary btn-sm"
                disabled={busy || !selected.length || !target}
                onClick={assignBulk}
              >
                <Users size={15} /> Assign With Notes
              </button>

              <button
                className="btn btn-secondary btn-sm"
                disabled={busy || !selected.length}
                onClick={() => {
                  setDistributionUsers([]);
                  setDistributeOpen(true);
                }}
              >
                <Shuffle size={15} /> Distribute Randomly
              </button>
            </div>
          </div>
        )}

        {/* Ticket Table */}
        <div className="table-scroll">
          <table className="ticket-table">
            <thead>
              <tr>
                {canAssignTickets && (
                  <th>
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                    />
                  </th>
                )}
                <th>TICKET NUMBER</th>
                <th>OPSDESK STATUS</th>
                <th>PRIORITY</th>
                <th>AGE</th>
                <th>ASSIGNEE</th>
                <th>REQUEST TYPE</th>
                <th>LOGGED DATE</th>
                <th>HISTORY & LOGS</th>
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((t) => {
                const ticketStatus = t.workflowStatus || 'OPEN';
                const isAssignee = String(t.assigneeId || '') === currentUserId;
                const isTicketResolved = ticketStatus === 'RESOLVED';
                const ticketShowsAge = canShowAge(t);
                const canRestoreTicket = user?.role === 'MANAGER' || (user?.role === 'RE' && isAssignee);

                return (
                  <tr
                    key={t._id}
                    className={`${selected.includes(t._id) ? 'row-selected' : ''} clickable-row`}
                  >
                    {canAssignTickets && (
                      <td onClick={(e) => e.stopPropagation()}>
                        {isTicketResolved ? (
                          <span
                            title="Resolved ticket is locked to the resolving engineer to protect credit of work. Cannot be reassigned unless reopened."
                            style={{ display: 'inline-flex', alignItems: 'center', color: '#94a3b8', cursor: 'not-allowed' }}
                          >
                            <Lock size={15} />
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={selected.includes(t._id)}
                            onChange={() => toggleSelect(t)}
                          />
                        )}
                      </td>
                    )}

                    {/* Click ticket cell to open history & details */}
                    <td onClick={() => openTicketDetails(t)}>
                      <div className="table-title">
                        <span className="table-case-icon">
                          <TicketIcon size={15} />
                        </span>
                        <span>
                          <strong>{t.ticketNumber}</strong>
                          <small title={t.description}>
                            {t.description || t.item || 'No description'}
                            {t.sourceStatus ? ` · Source: ${t.sourceStatus}` : ''}
                          </small>
                        </span>
                      </div>
                    </td>

                    {/* Leads reopen resolved tickets; the assigned RE can restore the previous status. */}
                    <td onClick={(e) => e.stopPropagation()}>
                      {isTicketResolved ? (
                        canReopenTicket || canRestoreTicket ? (
                          <select
                            className="inline-status ticket-status-resolved"
                            value="RESOLVED"
                            disabled={busy}
                            onChange={(e) => changeStatus(t, e.target.value)}
                            title={canRestoreTicket && !canReopenTicket ? 'Restore this ticket to its previous status' : 'Reopen this ticket as a lead'}
                          >
                            <option value="RESOLVED">Resolved</option>
                            {canReopenTicket && <option value="REOPEN">Reopen Ticket</option>}
                            {canRestoreTicket && (
                              <option value="RESTORE">Restore previous status ({['OPEN', 'WIP', 'REOPENED', 'ROUTED'].includes(t.statusBeforeResolution) ? t.statusBeforeResolution : 'OPEN'})</option>
                            )}
                          </select>
                        ) : (
                          <span
                            className="status-pill status-completed"
                            title="A Team Leader or Shift Lead can reopen this ticket; the assigned engineer can restore its previous status."
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          >
                            <Lock size={12} /> Resolved
                          </span>
                        )
                      ) : isAssignee ? (
                        <select
                          className={`inline-status ticket-status-${ticketStatus.toLowerCase()}`}
                          value={ticketStatus}
                          disabled={busy}
                          onChange={(e) => changeStatus(t, e.target.value)}
                          title="Update status (SweetAlert prompt will record remarks)"
                        >
                          <option value="OPEN">Open</option>
                          <option value="WIP">Work in progress</option>
                          {ticketStatus === 'ROUTED' && <option value="ROUTED">Routed</option>}
                          <option value="RESOLVED">Resolved</option>
                          {ticketStatus === 'REOPENED' && (
                            <option value="REOPENED">Reopened</option>
                          )}
                        </select>
                      ) : (
                        <span
                          className={`status-pill ${
                            ticketStatus === 'WIP'
                              ? 'status-wip'
                              : ticketStatus === 'REOPENED'
                              ? 'status-reopened'
                              : ticketStatus === 'ROUTED'
                              ? 'status-routed'
                              : 'status-open'
                          }`}
                          title={
                            t.assigneeId
                              ? `Assigned to ${t.assignee?.name || 'Engineer'}. Only the assigned person can edit or change status.`
                              : 'Unassigned ticket. Select to assign to an engineer.'
                          }
                        >
                          {ticketStatus === 'WIP'
                            ? 'Work In Progress'
                            : ticketStatus === 'REOPENED'
                            ? 'Reopened'
                            : ticketStatus === 'ROUTED'
                            ? 'Routed'
                            : 'Open'}
                        </span>
                      )}
                    </td>

                    <td>
                      <span className="case-priority">
                        <i className={`priority-dot ${String(t.priorityName).toLowerCase()}`} />
                        {t.priorityName}
                      </span>
                    </td>

                    <td>
                      {ticketShowsAge
                        ? <span className={t.ageDays > 0 ? 'aging-number' : ''}>{t.ageDays} day{t.ageDays === 1 ? '' : 's'}</span>
                        : <span className="muted-cell">—</span>}
                    </td>

                    <td>
                      {t.assignee?.name || <span className="unassigned">Unassigned</span>}
                    </td>

                    <td>{t.requestType || '—'}</td>

                    <td className="muted-cell">
                      {new Date(t.loggedDate).toLocaleDateString()}
                    </td>

                    {/* View Full History Log Button */}
                    <td>
                      <button
                        className="btn btn-secondary btn-xs"
                        title="View earlier assignments and description logs"
                        onClick={() => openTicketDetails(t)}
                      >
                        <History size={13} /> View Logs
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!filteredItems.length && (
          <div className="empty-state compact">
            <div className="empty-icon">
              <TicketIcon size={22} />
            </div>
            <strong>No tickets in this section</strong>
            <p>
              {activeTab === 'my_queue'
                ? 'You currently have no tickets assigned to your queue.'
                : activeTab === 'resolved'
                ? 'No tickets have been marked as resolved yet.'
                : activeTab === 'reopened'
                ? 'No reopened tickets in the workspace.'
                : 'Import tickets via Excel or switch tabs to view active queues.'}
            </p>
          </div>
        )}

        
<div className="table-footer pagination-footer">
  <div className="pagination-info">
    <span>
      Showing <strong>{startItem}–{endItem}</strong> of{" "}
      <strong>{filteredItems.length}</strong> filtered tickets
    </span>

    <label className="page-size-control">
      Rows:
      <select
        value={pageSize}
        onChange={(e) => setPageSize(Number(e.target.value))}
      >
        <option value={10}>10</option>
        <option value={25}>25</option>
        <option value={50}>50</option>
        <option value={100}>100</option>
      </select>
    </label>
  </div>

  <div className="pagination-controls">
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      disabled={currentPage === 1}
      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
    >
      Previous
    </button>

    {Array.from({ length: totalPages }, (_, i) => i + 1)
      .filter(
        (page) =>
          page === 1 ||
          page === totalPages ||
          Math.abs(page - currentPage) <= 1
      )
      .map((page, index, pages) => (
        <span key={page} className="pagination-page-group">
          {index > 0 && pages[index - 1] !== page - 1 && (
            <span className="pagination-ellipsis">…</span>
          )}

          <button
            type="button"
            className={`btn btn-sm ${
              currentPage === page
                ? "btn-primary"
                : "btn-secondary"
            }`}
            aria-current={currentPage === page ? "page" : undefined}
            onClick={() => setCurrentPage(page)}
          >
            {page}
          </button>
        </span>
      ))}

    <button
      type="button"
      className="btn btn-secondary btn-sm"
      disabled={currentPage >= totalPages}
      onClick={() =>
        setCurrentPage((p) => Math.min(totalPages, p + 1))
      }
    >
      Next
    </button>
  </div>
</div>

      </section>

      {/* Ticket Details & Assignment History Modal (Requirement 5) */}
      {detailTicket && (
        <Modal
          title={`Ticket Audit & Activity History · ${detailTicket.ticketNumber}`}
          onClose={() => setDetailTicket(null)}
        >
          <div className="form-stack modal-form">
            {/* Ticket Core Metadata */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', background: '#f8fafc', padding: '12px', borderRadius: '10px' }}>
              <div>
                <small style={{ color: '#64748b', fontSize: '10px' }}>Status</small>
                <div style={{ fontWeight: '700', fontSize: '13px' }}>
                  {detailTicket.workflowStatus || 'OPEN'}
                </div>
              </div>
              <div>
                <small style={{ color: '#64748b', fontSize: '10px' }}>Priority</small>
                <div style={{ fontWeight: '700', fontSize: '13px' }}>
                  {detailTicket.priorityName}
                </div>
              </div>
              <div>
                <small style={{ color: '#64748b', fontSize: '10px' }}>Age</small>
                <div style={{ fontWeight: '700', fontSize: '13px' }}>
                  {canShowAge(detailTicket)
                    ? `${detailTicket.ageDays} day${detailTicket.ageDays === 1 ? '' : 's'}`
                    : '—'}
                </div>
              </div>
            </div>

            {/* Description & Remarks */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: '#475569' }}>Original Description</label>
              <p style={{ margin: '4px 0', fontSize: '12px', color: '#334155', background: '#ffffff', border: '1px solid #e2e8f0', padding: '10px', borderRadius: '8px', lineHeight: '1.5' }}>
                {detailTicket.description || 'No description provided.'}
              </p>
            </div>

            {detailTicket.remarks && (
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: '#475569' }}>Latest Remarks / Status Notes</label>
                <p style={{ margin: '4px 0', fontSize: '12px', color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd', padding: '10px', borderRadius: '8px' }}>
                  {detailTicket.remarks}
                </p>
              </div>
            )}

            {/* Full Chronological Assignment & Status Log (Requirement 5) */}
            <div style={{ marginTop: '8px' }}>
              <h3 style={{ fontSize: '13px', margin: '0 0 8px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <History size={16} /> Assignment & Workflow Audit Trail
              </h3>

              {loadingLogs ? (
                <p className="muted-cell">Loading activity history…</p>
              ) : ticketLogs.length ? (
                <div className="ticket-log-timeline">
                  {ticketLogs.map((log) => (
                    <div className="ticket-log-entry" key={log._id}>
                      <div className="ticket-log-dot" />
                      <div className="ticket-log-content">
                        <div className="ticket-log-header">
                          <span className="ticket-log-title">
                            {log.action?.replace(/_/g, ' ')}
                          </span>
                          <span className="ticket-log-time">
                            {new Date(log.createdAt).toLocaleString()}
                          </span>
                        </div>

                        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                          Performed by: <strong>{log.actor?.name || 'System User'}</strong>
                          {log.targetUser && (
                            <span>
                              {' '}→ Assigned to: <strong>{log.targetUser.name}</strong> ({log.targetUser.role})
                            </span>
                          )}
                          {log.details?.status && (
                            <span> · Status set to: <strong>{log.details.status}</strong></span>
                          )}
                        </div>

                        {/* Description / Remarks entered in SweetAlert */}
                        {(log.comment || log.details?.description) && (
                          <div className="ticket-log-desc">
                            <strong>Note / Remarks:</strong> {log.comment || log.details?.description}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                  No historical logs recorded for this ticket yet.
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn btn-secondary" onClick={() => setDetailTicket(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Manual Ticket Creation Modal */}
      {manualOpen && (
        <Modal title="Add ticket manually" onClose={() => setManualOpen(false)}>
          <form className="form-stack modal-form" onSubmit={createManual}>
            <label>
              Ticket number
              <input
                required
                value={manualForm.ticketNumber}
                onChange={(e) => setManualForm({ ...manualForm, ticketNumber: e.target.value })}
                placeholder="e.g. INC-10425"
              />
            </label>

            <div className="form-grid">
              <label>
                Request type
                <select
                  value={manualForm.requestType}
                  onChange={(e) => setManualForm({ ...manualForm, requestType: e.target.value })}
                >
                  <option>Incident</option>
                  <option>Service Request</option>
                  <option>Operational</option>
                  <option>Walk-in User</option>
                  <option>Other</option>
                </select>
              </label>

              <label>
                Priority
                <select
                  value={manualForm.priorityName}
                  onChange={(e) => setManualForm({ ...manualForm, priorityName: e.target.value })}
                >
                  {['Critical', 'High', 'Medium', 'Low'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-grid">
              <label>
                Logged date
                <input
                  type="date"
                  value={manualForm.loggedDate}
                  onChange={(e) => setManualForm({ ...manualForm, loggedDate: e.target.value })}
                  required
                />
              </label>
              {user?.role !== 'RE' && (
                <label>
                  Current level
                  <input
                    value={manualForm.currentLevel}
                    onChange={(e) => setManualForm({ ...manualForm, currentLevel: e.target.value })}
                    placeholder="e.g. L1"
                  />
                </label>
              )}
            </div>

            {user?.role === 'RE' && (
              <div className="ticket-self-assignee" aria-label="Assigned to you">
                <User size={15} /> Assigned to you: <strong>{user.name}</strong>
              </div>
            )}

            <label>
              Item / system
              <input
                value={manualForm.item}
                onChange={(e) => setManualForm({ ...manualForm, item: e.target.value })}
                placeholder="Laptop, VPN, database, network..."
              />
            </label>

            <label>
              Description
              <textarea
                rows="3"
                value={manualForm.description}
                onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
                placeholder="Details of the issue..."
              />
            </label>

            <label>
              Remarks
              <textarea
                rows="2"
                value={manualForm.remarks}
                onChange={(e) => setManualForm({ ...manualForm, remarks: e.target.value })}
                placeholder="Initial remarks or notes..."
              />
            </label>

            {error && <div className="error-box">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setManualOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Create ticket'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Random Distribution Modal */}
      {distributeOpen && (
        <Modal
          title={`Distribute ${selected.length} selected tickets`}
          onClose={() => setDistributeOpen(false)}
        >
          <div className="form-stack modal-form">
            <p className="muted-cell">
              Select multiple team members. Tickets are shuffled and assigned as evenly as possible.
            </p>

            <label>
              Team members (Ctrl-click to select multiple)
              <select
                multiple
                size="7"
                value={distributionUsers}
                onChange={(e) =>
                  setDistributionUsers(Array.from(e.target.selectedOptions, (o) => o.value))
                }
              >
                {eligibleMembers
                  .filter((m) => m.status === 'active')
                  .map((m) => (
                    <option key={m._id || m.id} value={m._id || m.id}>
                      {m.name} · {m.role} · {m.team}
                    </option>
                  ))}
              </select>
            </label>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDistributeOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !distributionUsers.length}
                onClick={distributeRandomly}
              >
                {busy ? 'Distributing…' : 'Distribute Tickets'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
