import { useEffect, useState, useMemo } from 'react';
import {
  ClipboardList,
  Plus,
  Search,
  ArrowRightLeft,
  History,
  CheckCircle2,
  Clock,
  UserCheck,
  Users,
  AlertTriangle,
  RefreshCw,
  Lock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  X
} from 'lucide-react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Pagination from '../components/Pagination.jsx';
import Swal from '../utils/swal.js';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

const emptyTaskForm = {
  title: '',
  description: '',
  category: 'OPERATIONAL',
  priority: 'MEDIUM',
  team: 'IT Support',
  location: '',
  frequency: 'ONE_TIME',
  dueAt: '',
  scheduleDates: [],
  assigneeId: ''
};

const getDateKey = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const getDateLabel = (value) => {
  const key = getDateKey(value);
  if (!key) return 'No date';
  return new Date(`${key}T00:00:00.000Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

const getNextScheduleOccurrence = (task) => [...(task.scheduleDates || [])]
  .filter((occurrence) => occurrence.status === 'PENDING')
  .sort((a, b) => getDateKey(a.date).localeCompare(getDateKey(b.date)))[0] || null;

function MultiDatePicker({ selectedDates, onChange }) {
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const monthName = visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const firstWeekday = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const today = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })();
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);

  const toggleDate = (dateKey) => {
    const nextDates = selectedDates.includes(dateKey)
      ? selectedDates.filter((date) => date !== dateKey)
      : [...selectedDates, dateKey];
    onChange(nextDates.sort());
  };

  return (
    <section className="task-date-picker" aria-label="Choose operational task dates">
      <div className="task-date-picker-heading">
        <div>
          <strong>Schedule dates</strong>
          <small>Select one or more dates. Each date becomes a task occurrence.</small>
        </div>
        <span className="task-date-count">{selectedDates.length} selected</span>
      </div>

      <div className="task-date-calendar">
        <div className="task-date-calendar-header">
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setVisibleMonth(new Date(year, month - 1, 1))}>
            <ChevronLeft size={17} />
          </button>
          <strong>{monthName}</strong>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setVisibleMonth(new Date(year, month + 1, 1))}>
            <ChevronRight size={17} />
          </button>
        </div>

        <div className="task-date-calendar-grid" role="group" aria-label={`${monthName} dates`}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
            <span className="task-date-weekday" key={day}>{day}</span>
          ))}
          {Array.from({ length: firstWeekday }, (_, index) => <span className="task-date-empty" key={`empty-${index}`} />)}
          {days.map((day) => {
            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isSelected = selectedDates.includes(dateKey);
            return (
              <button
                className={`task-date-day${isSelected ? ' is-selected' : ''}${dateKey === today ? ' is-today' : ''}`}
                type="button"
                key={dateKey}
                aria-label={new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'full' })}
                aria-pressed={isSelected}
                onClick={() => toggleDate(dateKey)}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      <div className="task-date-selection" aria-live="polite">
        {selectedDates.length ? selectedDates.map((dateKey) => (
          <span className="task-date-chip" key={dateKey}>
            <CalendarDays size={13} /> {getDateLabel(dateKey)}
            <button type="button" aria-label={`Remove ${getDateLabel(dateKey)}`} onClick={() => toggleDate(dateKey)}><X size={13} /></button>
          </span>
        )) : <small className="task-date-empty-hint">No dates selected yet.</small>}
      </div>
    </section>
  );
}

function TaskScheduleTimeline({ task, canAct, busy, postponeForm, onAction, onStartPostpone, onPostponeDateChange, onSavePostpone, onCancelPostpone }) {
  const schedule = [...(task.scheduleDates || [])].sort((a, b) => getDateKey(a.date).localeCompare(getDateKey(b.date)));
  if (!schedule.length) return <span>{task.dueAt ? getDateLabel(task.dueAt) : '—'}</span>;

  const nextOccurrence = getNextScheduleOccurrence(task);
  const isDue = nextOccurrence && getDateKey(nextOccurrence.date) <= getTodayKey();
  const isPostponing = postponeForm?.taskId === String(task._id)
    && postponeForm?.scheduleId === String(nextOccurrence?._id);
  const nextOccurrenceBusy = busy === `${task._id}:${nextOccurrence?._id}`;

  return (
    <div className="task-schedule-cell">
      <div className="task-schedule-next">
        <strong>{nextOccurrence ? getDateLabel(nextOccurrence.date) : 'All dates closed'}</strong>
        {nextOccurrence && <span className={`task-schedule-state${isDue ? ' is-due' : ''}`}>{isDue ? 'Due' : 'Upcoming'}</span>}
      </div>

      {nextOccurrence && canAct && isDue && !isPostponing && (
        <div className="task-schedule-actions">
          <button type="button" className="btn btn-secondary btn-xs" disabled={nextOccurrenceBusy} onClick={() => onStartPostpone(task, nextOccurrence)}>
            <Clock size={12} /> Postpone
          </button>
          <button type="button" className="btn btn-primary btn-xs" disabled={nextOccurrenceBusy} onClick={() => onAction(task, nextOccurrence, 'DONE')}>
            <CheckCircle2 size={12} /> Done
          </button>
          <button type="button" className="btn btn-danger-ghost btn-xs" disabled={nextOccurrenceBusy} onClick={() => onAction(task, nextOccurrence, 'CANCEL')}>
            <X size={12} /> Cancel
          </button>
        </div>
      )}

      {isPostponing && (
        <div className="task-postpone-control">
          <label>
            Move to
            <input type="date" min={postponeForm.minDate} value={postponeForm.date} onChange={(event) => onPostponeDateChange(event.target.value)} />
          </label>
          <button type="button" className="btn btn-primary btn-xs" disabled={!postponeForm.date || nextOccurrenceBusy} onClick={() => onSavePostpone(task, nextOccurrence)}>
            {nextOccurrenceBusy ? 'Saving…' : 'Save date'}
          </button>
          <button type="button" className="btn btn-secondary btn-xs" disabled={nextOccurrenceBusy} onClick={onCancelPostpone}>Cancel</button>
        </div>
      )}

      <details className="task-schedule-timeline">
        <summary>Timeline · {schedule.length} date{schedule.length === 1 ? '' : 's'}</summary>
        <ol>
          {schedule.map((occurrence) => (
            <li className={`is-${String(occurrence.status || 'pending').toLowerCase()}`} key={occurrence._id || getDateKey(occurrence.date)}>
              <span className="task-timeline-marker" />
              <div>
                <strong>{getDateLabel(occurrence.date)}</strong>
                <span>{occurrence.status === 'DONE' ? 'Done' : occurrence.status === 'CANCELLED' ? 'Cancelled' : 'Scheduled'}</span>
                {occurrence.history?.filter((entry) => entry.action === 'POSTPONED').map((entry, index) => (
                  <small key={`${entry.performedAt || index}-${index}`}>
                    Moved from {getDateLabel(entry.fromDate)} to {getDateLabel(entry.toDate)}
                  </small>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

export default function Tasks() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const currentUserId = String(user?.id || user?._id || '');
  const isLead = ['MANAGER', 'TL', 'SL'].includes(user?.role);
  const canCreate = isLead || (user?.permissions || []).includes('tasks:create');

  // Task list and filters
  const [items, setItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [mineOnly, setMineOnly] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(searchParams.get('unassigned') === 'true');
  const [taskPage, setTaskPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Create Task Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(emptyTaskForm);
  const [scheduleActionBusy, setScheduleActionBusy] = useState('');
  const [postponeForm, setPostponeForm] = useState(null);

  // SL/TL Direct Reassign Modal (Requirement 6)
  const [reassignTask, setReassignTask] = useState(null);
  const [reassignUserId, setReassignUserId] = useState('');
  const [reassignNote, setReassignNote] = useState('');

  // RE Multi-Recipient Handover Modal (Requirement 6)
  const [handoverTask, setHandoverTask] = useState(null);
  const [handoverForm, setHandoverForm] = useState({
    targetUserIds: [],
    reason: '',
    notes: ''
  });

  // History Modal
  const [historyTask, setHistoryTask] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);

  // States
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!location.state?.openCreate) return;
    if (canCreate) {
      setError('');
      setShowCreateModal(true);
    }
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [canCreate, location.key, location.pathname, location.search, location.state, navigate]);

  const load = ({ silent = false } = {}) => {
    if (!silent && !items.length) setLoading(true);
    api.get('/tasks', {
      params: {
        search,
        status: statusFilter,
        assignedToMe: mineOnly ? 'true' : 'false',
        unassigned: unassignedOnly ? 'true' : 'false'
      }
    })
      .then((r) => setItems(r.data))
      .catch((e) => setError(e.response?.data?.message || 'Unable to load tasks.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true });
    }, 15000);
    return () => window.clearInterval(refreshInterval);
  }, [search, statusFilter, mineOnly, unassignedOnly]);

  const taskPageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const paginatedTasks = useMemo(() => items.slice((taskPage - 1) * pageSize, taskPage * pageSize), [items, taskPage, pageSize]);

  useEffect(() => {
    setTaskPage(1);
  }, [search, statusFilter, mineOnly, unassignedOnly, pageSize]);

  useEffect(() => {
    if (taskPage > taskPageCount) setTaskPage(taskPageCount);
  }, [taskPage, taskPageCount]);

  useEffect(() => {
    api.get('/team')
      .then((r) => setMembers(r.data.filter((u) => u.status === 'active')))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setUnassignedOnly(searchParams.get('unassigned') === 'true');
  }, [searchParams]);

  // Create Task
  const handleCreate = async (e) => {
    e.preventDefault();
    if (createForm.category === 'OPERATIONAL' && !createForm.scheduleDates.length) {
      Swal.warning('Select a schedule date', 'Choose one or more dates for this operational task.');
      return;
    }
    setBusy(true);
    setError('');

    try {
      await api.post('/tasks', {
        ...createForm,
        scheduleDates: createForm.category === 'OPERATIONAL' ? createForm.scheduleDates : [],
        dueAt: createForm.category === 'OPERATIONAL'
          ? createForm.scheduleDates[0] || null
          : createForm.dueAt || null,
        assigneeId: createForm.assigneeId || null
      });
      Swal.success('Task Created', `Task "${createForm.title}" created successfully.`);
      setShowCreateModal(false);
      setCreateForm(emptyTaskForm);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to create task.');
    } finally {
      setBusy(false);
    }
  };

  const updateScheduleTask = (updatedTask) => {
    setItems((current) => current.map((item) => (
      item._id === updatedTask._id ? { ...item, ...updatedTask } : item
    )));
  };

  const handleScheduleAction = async (task, occurrence, action) => {
    if (getDateKey(occurrence.date) > getTodayKey()) {
      Swal.warning('Not due yet', `This occurrence is scheduled for ${getDateLabel(occurrence.date)}.`);
      return;
    }

    const actionLabel = action === 'DONE' ? 'mark this occurrence done' : 'cancel this occurrence';
    const confirmation = await Swal.confirm(
      action === 'DONE' ? 'Complete Scheduled Date' : 'Cancel Scheduled Date',
      `Are you sure you want to ${actionLabel} for ${getDateLabel(occurrence.date)}?`,
      action === 'DONE' ? 'Mark Done' : 'Cancel Date'
    );
    if (!confirmation.isConfirmed) return;

    const busyKey = `${task._id}:${occurrence._id}`;
    setScheduleActionBusy(busyKey);
    try {
      const { data } = await api.patch(`/tasks/${task._id}/schedule/${occurrence._id}`, { action });
      updateScheduleTask(data);
      const nextOccurrence = getNextScheduleOccurrence(data);
      Swal.success(
        'Schedule Updated',
        nextOccurrence
          ? `${getDateLabel(occurrence.date)} is ${action === 'DONE' ? 'done' : 'cancelled'}. Next date: ${getDateLabel(nextOccurrence.date)}.`
          : `${task.title} has no remaining scheduled dates.`
      );
    } catch (err) {
      Swal.error('Schedule Update Failed', err.response?.data?.message || 'Unable to update this scheduled date.');
    } finally {
      setScheduleActionBusy('');
    }
  };

  const startPostpone = (task, occurrence) => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    setPostponeForm({
      taskId: String(task._id),
      scheduleId: String(occurrence._id),
      date: '',
      minDate: getDateKey(tomorrow)
    });
  };

  const savePostpone = async (task, occurrence) => {
    if (!postponeForm?.date) return;
    const busyKey = `${task._id}:${occurrence._id}`;
    setScheduleActionBusy(busyKey);
    try {
      const { data } = await api.patch(`/tasks/${task._id}/schedule/${occurrence._id}`, {
        action: 'POSTPONE',
        date: postponeForm.date
      });
      updateScheduleTask(data);
      setPostponeForm(null);
      const nextOccurrence = getNextScheduleOccurrence(data);
      Swal.success(
        'Occurrence Postponed',
        nextOccurrence
          ? `Moved to ${getDateLabel(postponeForm.date)}. Next scheduled date: ${getDateLabel(nextOccurrence.date)}.`
          : `Moved to ${getDateLabel(postponeForm.date)}.`
      );
    } catch (err) {
      Swal.error('Unable to Postpone', err.response?.data?.message || 'Choose a valid future date and try again.');
    } finally {
      setScheduleActionBusy('');
    }
  };

  // Status Change with Confirmation (Requirement 9)
  const handleStatusChange = async (task, newStatus) => {
    if (newStatus === task.status) return;

    if (newStatus === 'COMPLETED' && task.scheduleDates?.length) {
      const nextOccurrence = getNextScheduleOccurrence(task);
      if (!nextOccurrence) return;
      await handleScheduleAction(task, nextOccurrence, 'DONE');
      return;
    }

    if (newStatus === 'COMPLETED') {
      const confirmRes = await Swal.confirm(
        'Complete Task',
        `Are you sure you want to mark "${task.title}" as COMPLETED?`,
        'Yes, Mark Completed'
      );
      if (!confirmRes.isConfirmed) return;
    }

    try {
      await api.patch(`/tasks/${task._id}`, { status: newStatus });
      Swal.success('Status Updated', `Task status set to ${newStatus}.`);
      load();
    } catch (err) {
      Swal.error('Error', err.response?.data?.message || 'Unable to update task status.');
    }
  };

  // SL / TL Direct Reassignment (Requirement 6 - Locked if completed to prevent credit theft)
  const submitLeadReassign = async (e) => {
    e.preventDefault();
    if (!reassignTask || !reassignUserId) return;

    if (reassignTask.status === 'COMPLETED') {
      Swal.error('Task Locked', 'Completed tasks are locked to the assigned engineer to prevent credit theft and cannot be reassigned.');
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post(`/tasks/${reassignTask._id}/assign`, {
        assigneeId: reassignUserId,
        description: reassignNote
      });
      const recipient = members.find((member) => String(member._id) === String(reassignUserId));
      setItems((current) => current.flatMap((item) => {
        if (item._id !== reassignTask._id) return [item];
        const updated = {
          ...item,
          ...data,
          assigneeId: String(data.assigneeId),
          assignee: recipient || item.assignee,
          assigner: user
        };
        if (unassignedOnly || (statusFilter !== 'ALL' && updated.status !== statusFilter) || (mineOnly && String(updated.assigneeId) !== currentUserId)) return [];
        return [updated];
      }));
      Swal.success('Task Reassigned', 'Task has been directly reassigned to the selected team member.');
      setReassignTask(null);
      setReassignUserId('');
      setReassignNote('');
    } catch (err) {
      Swal.error('Reassignment Failed', err.response?.data?.message || 'Unable to reassign task.');
    } finally {
      setBusy(false);
    }
  };

  // RE Multi-Recipient Handover (Requirement 6)
  const submitMultiHandover = async (e) => {
    e.preventDefault();
    if (!handoverTask) return;
    if (!handoverForm.targetUserIds.length) {
      Swal.warning('Selection Required', 'Please select at least one recipient (RE or SL/TL) for this handover.');
      return;
    }

    setBusy(true);
    try {
      await api.post(`/tasks/${handoverTask._id}/handovers`, {
        targetUserIds: handoverForm.targetUserIds,
        reason: handoverForm.reason,
        notes: handoverForm.notes
      });
      Swal.success(
        'Handover Broadcast',
        `Handover request sent to ${handoverForm.targetUserIds.length} candidate(s). Any one can accept and work on it.`
      );
      setHandoverTask(null);
      setHandoverForm({ targetUserIds: [], reason: '', notes: '' });
      load();
    } catch (err) {
      Swal.error('Handover Failed', err.response?.data?.message || 'Unable to create handover.');
    } finally {
      setBusy(false);
    }
  };

  const toggleHandoverUser = (userId) => {
    setHandoverForm((prev) => {
      const exists = prev.targetUserIds.includes(userId);
      return {
        ...prev,
        targetUserIds: exists
          ? prev.targetUserIds.filter((id) => id !== userId)
          : [...prev.targetUserIds, userId]
      };
    });
  };

  // View Task History
  const showHistory = async (task) => {
    setHistoryTask(task);
    setHistoryRows([]);
    try {
      const { data } = await api.get(`/tasks/${task._id}/activity`);
      setHistoryRows(data);
    } catch {
      setHistoryRows([]);
    }
  };

  return (
    <div className="page-stack">
      {/* Header */}
      <div className="welcome-row">
        <div>
          <div className="page-kicker">OPERATIONAL CONTINUITY</div>
          <h1>
            Operational tasks<span className="title-period">.</span>
          </h1>
          <p>
            Track system readiness, floor visits, and shift operations. Leads can reassign directly; engineers can broadcast handovers to multiple team members.
          </p>
        </div>

        <div className="header-actions">
          {canCreate && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setError('');
                setShowCreateModal(true);
              }}
            >
              <Plus size={17} /> Create task
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* Main Table Panel */}
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              placeholder="Search tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="filter-controls">
            {isLead && <label className="toggle-filter">
              <input type="checkbox" checked={unassignedOnly} onChange={(e) => {
                const enabled = e.target.checked;
                setUnassignedOnly(enabled);
                if (enabled) setMineOnly(false);
                setSearchParams(enabled ? { unassigned: 'true' } : {});
              }} />{' '}
              Unassigned only
            </label>}
            <label className="toggle-filter">
              <input
                type="checkbox"
                checked={mineOnly}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setMineOnly(enabled);
                  if (enabled && unassignedOnly) {
                    setUnassignedOnly(false);
                    setSearchParams({});
                  }
                }}
              />{' '}
              Assigned to me
            </label>

            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="ALL">All statuses</option>
              {['OPEN', 'ASSIGNED', 'WIP', 'PENDING', 'COMPLETED'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <button className="icon-btn" title="Refresh" onClick={load}>
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {loading && !items.length && <LoadingState title="Loading tasks" detail="Refreshing task assignments and status." />}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>TASK</th>
                <th>CATEGORY</th>
                <th>ASSIGNEE</th>
                <th>PRIORITY</th>
                <th>SCHEDULE / NEXT DATE</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTasks.map((t) => {
                const isAssignee = String(t.assigneeId || '') === currentUserId;
                const isCompleted = t.status === 'COMPLETED';

                return (
                  <tr key={t._id}>
                    <td>
                      <div className="table-title">
                        <span className="table-case-icon task-table-icon">
                          <ClipboardList size={16} />
                        </span>
                        <span>
                          <strong>{t.title}</strong>
                          <small>
                            {t.taskNumber}
                            {t.location ? ' · ' + t.location : ''}
                            {t.scheduleDates?.length ? ` · ${t.scheduleDates.length} scheduled date${t.scheduleDates.length === 1 ? '' : 's'}` : ''}
                            {t.frequency !== 'ONE_TIME' ? ' · ' + t.frequency.toLowerCase() : ''}
                          </small>
                        </span>
                      </div>
                    </td>

                    <td>{t.category?.replace('_', ' ') || 'Operational'}</td>

                    <td>
                      {t.assignee?.name ? (
                        <span>
                          <strong>{t.assignee.name}</strong>{' '}
                          <small style={{ color: '#64748b' }}>({t.assignee.role})</small>
                        </span>
                      ) : (
                        <span className="unassigned">Unassigned</span>
                      )}
                    </td>

                    <td>
                      <span className="case-priority">
                        <i className={`priority-dot ${String(t.priority).toLowerCase()}`} />
                        {t.priority}
                      </span>
                    </td>

                    <td className="task-schedule-table-cell">
                      <TaskScheduleTimeline
                        task={t}
                        canAct={isAssignee || isLead}
                        busy={scheduleActionBusy}
                        postponeForm={postponeForm}
                        onAction={handleScheduleAction}
                        onStartPostpone={startPostpone}
                        onPostponeDateChange={(date) => setPostponeForm((current) => current ? { ...current, date } : current)}
                        onSavePostpone={savePostpone}
                        onCancelPostpone={() => setPostponeForm(null)}
                      />
                    </td>

                    {/* Status Column: Completed is locked; Only assigned person can edit */}
                    <td>
                      {isCompleted ? (
                        <span
                          className="status-pill status-completed"
                          title="Completed task is locked to assignee to prevent credit theft."
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Lock size={12} /> COMPLETED
                        </span>
                      ) : isAssignee ? (
                        <select
                          className="inline-status"
                          value={t.status}
                          disabled={busy}
                          title="Change task status (Only assigned person can edit)"
                          onChange={(e) => handleStatusChange(t, e.target.value)}
                        >
                          <option>OPEN</option>
                          <option>ASSIGNED</option>
                          <option>WIP</option>
                          <option>PENDING</option>
                          <option>COMPLETED</option>
                        </select>
                      ) : (
                        <span
                          className={`status-pill ${
                            t.status === 'WIP'
                              ? 'status-wip'
                              : t.status === 'PENDING'
                              ? 'status-aging'
                              : 'status-open'
                          }`}
                          title={
                            t.assigneeId
                              ? `Assigned to ${t.assignee?.name || 'Engineer'}. Only the assigned person can edit this task.`
                              : 'Unassigned task.'
                          }
                        >
                          {t.status}
                        </span>
                      )}
                    </td>

                    {/* Actions: Reassign (SL/TL), Handover (RE), History */}
                    <td>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {/* History */}
                        <button
                          className="icon-btn"
                          title="View task audit history"
                          onClick={() => showHistory(t)}
                        >
                          <History size={15} />
                        </button>

                        {/* SL / TL / Manager Direct Reassignment (Incomplete tasks only; Completed tasks locked) */}
                        {isLead && (
                          isCompleted ? (
                            <span
                              title="Completed task is locked to assignee to prevent credit theft"
                              style={{ display: 'inline-flex', alignItems: 'center', color: '#94a3b8', padding: '6px' }}
                            >
                              <Lock size={15} />
                            </span>
                          ) : (
                            <button
                              className="icon-btn"
                              title="Reassign this incomplete task directly to another team member (SL/TL permission)"
                              onClick={() => {
                                setReassignTask(t);
                                setReassignUserId(t.assigneeId || '');
                                setReassignNote('');
                              }}
                            >
                              <Users size={15} style={{ color: '#0077b8' }} />
                            </button>
                          )
                        )}

                        {/* RE Handover to Multiple people (Requirement 6) */}
                        {isAssignee && t.status !== 'COMPLETED' && (
                          <button
                            className="btn btn-secondary btn-xs"
                            title="Hand over to multiple RE or SL/TL members"
                            onClick={() => {
                              setHandoverTask(t);
                              setHandoverForm({
                                targetUserIds: [],
                                reason: '',
                                notes: ''
                              });
                            }}
                          >
                            <ArrowRightLeft size={13} /> Handover
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && !items.length && (
          <div className="empty-state compact">
            <div className="empty-icon">
              <ClipboardList size={22} />
            </div>
            <strong>No tasks found</strong>
            <p>Operational tasks can be scheduled for routine and critical procedures.</p>
          </div>
        )}

        <Pagination
          page={taskPage}
          pageSize={pageSize}
          totalItems={items.length}
          itemLabel="tasks"
          note="Shift continuity is preserved through structured handovers and lead reassignments."
          onPageChange={setTaskPage}
          onPageSizeChange={setPageSize}
        />
      </section>

      {/* Lead Direct Reassignment Modal (Requirement 6) */}
      {reassignTask && (
        <Modal
          title={`Reassign Task · ${reassignTask.taskNumber}`}
          onClose={() => setReassignTask(null)}
        >
          <form className="form-stack modal-form" onSubmit={submitLeadReassign}>
            <p className="muted-cell" style={{ margin: 0 }}>
              As a Shift Lead, Team Leader, or Manager, you can reassign this task directly without requiring acceptance.
            </p>

            <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', fontSize: '12px' }}>
              <strong>{reassignTask.title}</strong>
              <div style={{ color: '#64748b', fontSize: '11px', marginTop: '4px' }}>
                Current assignee: {reassignTask.assignee?.name || 'Unassigned'}
              </div>
            </div>

            <label>
              Reassign To
              <select
                required
                value={reassignUserId}
                onChange={(e) => setReassignUserId(e.target.value)}
              >
                <option value="">Select team member…</option>
                {members.map((m) => (
                  <option key={m._id || m.id} value={m._id || m.id}>
                    {m.name} · {m.role} ({m.team})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Reassignment Instructions / Note
              <textarea
                rows="2"
                placeholder="Reason or instructions for the new engineer..."
                value={reassignNote}
                onChange={(e) => setReassignNote(e.target.value)}
              />
            </label>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setReassignTask(null)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || !reassignUserId}>
                {busy ? 'Reassigning…' : 'Confirm Reassign'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* RE Multi-Recipient Handover Modal (Requirement 6) */}
      {handoverTask && (
        <Modal
          title={`Broadcast Handover · ${handoverTask.taskNumber}`}
          onClose={() => setHandoverTask(null)}
        >
          <form className="form-stack modal-form" onSubmit={submitMultiHandover}>
            <p className="muted-cell" style={{ margin: 0 }}>
              Select multiple RE, SL, or TL members. Any one recipient can accept the handover and take ownership.
            </p>

            <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', fontSize: '12px' }}>
              <strong>{handoverTask.title}</strong>
            </div>

            <label>
              Select Candidates (RE or SL/TL) — Multiple Allowed:
              <div
                style={{
                  maxHeight: '160px',
                  overflowY: 'auto',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '8px',
                  display: 'grid',
                  gap: '6px'
                }}
              >
                {members
                  .filter((m) => String(m._id || m.id) !== currentUserId)
                  .map((m) => {
                    const id = m._id || m.id;
                    const isChecked = handoverForm.targetUserIds.includes(id);
                    return (
                      <label
                        key={id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          cursor: 'pointer',
                          padding: '4px 6px',
                          borderRadius: '6px',
                          background: isChecked ? '#eff6ff' : 'transparent'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleHandoverUser(id)}
                        />
                        <span style={{ fontSize: '12px', color: '#1e293b' }}>
                          <strong>{m.name}</strong> · <small style={{ color: '#64748b' }}>{m.role} ({m.team})</small>
                        </span>
                      </label>
                    );
                  })}
              </div>
            </label>

            <label>
              Reason for Handover
              <input
                required
                placeholder="e.g. Shift ending, complex escalation, urgent support..."
                value={handoverForm.reason}
                onChange={(e) => setHandoverForm({ ...handoverForm, reason: e.target.value })}
              />
            </label>

            <label>
              Work Status & Next Steps
              <textarea
                rows="3"
                placeholder="Work completed so far, what is pending, and next steps..."
                value={handoverForm.notes}
                onChange={(e) => setHandoverForm({ ...handoverForm, notes: e.target.value })}
              />
            </label>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setHandoverTask(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !handoverForm.targetUserIds.length}
              >
                {busy ? 'Broadcasting…' : `Send to ${handoverForm.targetUserIds.length} Members`}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Task Activity History Modal */}
      {historyTask && (
        <Modal
          title={`Task History · ${historyTask.taskNumber}`}
          onClose={() => setHistoryTask(null)}
        >
          <div className="form-stack modal-form">
            {historyRows.length ? (
              <div className="ticket-log-timeline">
                {historyRows.map((row) => (
                  <div className="ticket-log-entry" key={row._id}>
                    <div className="ticket-log-dot" />
                    <div className="ticket-log-content">
                      <div className="ticket-log-header">
                        <span className="ticket-log-title">
                          {String(row.action || 'Activity').replace(/_/g, ' ')}
                        </span>
                        <span className="ticket-log-time">
                          {new Date(row.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        By: <strong>{row.actor?.name || 'System User'}</strong>
                      </div>
                      {row.comment && (
                        <div className="ticket-log-desc">
                          {row.comment}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-cell">No activity history recorded for this task yet.</p>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setHistoryTask(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <Modal title="Create an operational task" onClose={() => setShowCreateModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleCreate}>
            <label>
              Task title
              <input
                required
                value={createForm.title}
                onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                placeholder="e.g. Morning server room checklist"
              />
            </label>

            <label>
              Instructions / Description
              <textarea
                rows="3"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder="Checklist, completion requirements, and instructions..."
              />
            </label>

            <div className="form-grid">
              <label>
                Category
                <select
                  value={createForm.category}
                  onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                >
                  <option value="OPERATIONAL">Operational task</option>
                  <option value="INCIDENT_FOLLOWUP">Incident follow-up</option>
                  <option value="GENERAL">General</option>
                </select>
              </label>

              <label>
                Priority
                <select
                  value={createForm.priority}
                  onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value })}
                >
                  {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-grid">
              <label>
                Floor / Location
                <input
                  value={createForm.location}
                  onChange={(e) => setCreateForm({ ...createForm, location: e.target.value })}
                  placeholder="e.g. Floor 3, Server Rack B"
                />
              </label>

              <label>
                Assign to
                <select
                  value={createForm.assigneeId}
                  onChange={(e) => setCreateForm({ ...createForm, assigneeId: e.target.value })}
                >
                  <option value="">Leave unassigned</option>
                  {members.map((m) => (
                    <option key={m._id || m.id} value={m._id || m.id}>
                      {m.name} · {m.role} ({m.team})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {createForm.category === 'OPERATIONAL' ? (
              <MultiDatePicker
                selectedDates={createForm.scheduleDates}
                onChange={(scheduleDates) => setCreateForm((current) => ({ ...current, scheduleDates }))}
              />
            ) : (
              <div className="form-grid">
                <label>
                  Frequency
                  <select
                    value={createForm.frequency}
                    onChange={(e) => setCreateForm({ ...createForm, frequency: e.target.value })}
                  >
                    <option value="ONE_TIME">One-time</option>
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="QUARTERLY">Quarterly</option>
                  </select>
                </label>

                <label>
                  Due date
                  <input
                    type="date"
                    value={createForm.dueAt}
                    onChange={(e) => setCreateForm({ ...createForm, dueAt: e.target.value })}
                  />
                </label>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create Task'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
