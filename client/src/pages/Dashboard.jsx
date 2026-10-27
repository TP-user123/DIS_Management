
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Ticket,
  Zap,
  RefreshCw,
  Activity,
  TrendingUp,
  Laptop,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Swal from '../utils/swal.js';
import { eventOccurrenceRows } from '../utils/eventOccurrences.js';
import './dashboard-aging.css';
import './dashboard-visuals.css';

const COLORS = {
  open: 'var(--status-info)',
  wip: 'var(--status-warning)',
  resolved: 'var(--status-success)',
  reopened: 'var(--status-critical)',
  critical: 'var(--status-critical)',
  high: 'var(--status-warning)',
  medium: 'var(--color-accent)',
  low: 'var(--status-success)',
};

const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const hasValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const dateKey = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const nextTaskOccurrence = (task) => [...(task.scheduleDates || [])]
  .filter((occurrence) => occurrence.status === 'PENDING')
  .sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)))[0] || null;

const taskScheduleLabel = (task) => {
  const occurrence = nextTaskOccurrence(task);
  if (occurrence) {
    const label = new Date(`${dateKey(occurrence.date)}T00:00:00.000Z`).toLocaleDateString(undefined, {
      timeZone: 'UTC', dateStyle: 'medium'
    });
    return dateKey(occurrence.date) <= todayKey() ? `Due ${label}` : `Scheduled ${label}`;
  }
  return task.dueAt ? `Due ${new Date(task.dueAt).toLocaleDateString()}` : (task.priority || task.status || 'Assigned');
};

function PanelHeading({ title, subtitle, action }) {
  return (
    <div className="dv-panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function AssignedWorkPanel({ title, subtitle, to, itemCount, children }) {
  return (
    <article className="dv-panel dv-assigned-panel">
      <PanelHeading
        title={title}
        subtitle={subtitle}
        action={
          <Link className="dv-panel-link" to={to}>
            {itemCount > 5 ? 'Show more' : 'View all'} <ArrowRight size={15} />
          </Link>
        }
      />
      <div className="dv-assigned-list">{children}</div>
    </article>
  );
}

function AssignedWorkRow({ icon: Icon, title, description, meta, to, actionLabel, onAction, disabled, completed, actions }) {
  return (
    <div className={`dv-assigned-row${completed ? ' is-complete' : ''}${actions ? ' has-task-actions' : ''}`}>
      <span className="dv-assigned-icon"><Icon size={17} /></span>
      <div className="dv-assigned-copy">
        <Link to={to} title={title}>{title}</Link>
        {description && <span>{description}</span>}
        {meta && <small>{meta}</small>}
      </div>
      {actions}
      {!actions && actionLabel && (
        <button type="button" className="dv-done-button" onClick={onAction} disabled={disabled || completed}>
          <CheckCircle2 size={15} /> {completed ? 'Done' : actionLabel}
        </button>
      )}
    </div>
  );
}

function DashboardTaskScheduleActions({ task, canAct, busy, onAction }) {
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [postponeDate, setPostponeDate] = useState('');
  if (!task.scheduleDates?.length) return null;

  const occurrence = nextTaskOccurrence(task);
  if (!occurrence) return <span className="dv-task-schedule-closed">All dates closed</span>;

  const due = dateKey(occurrence.date) <= todayKey();
  const occurrenceDate = new Date(`${dateKey(occurrence.date)}T00:00:00.000Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC', dateStyle: 'medium'
  });
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const minDate = tomorrow.toISOString().slice(0, 10);
  const disabled = !canAct || !due || busy;

  const savePostpone = async () => {
    if (!postponeDate) return;
    const saved = await onAction(task, occurrence, 'POSTPONE', postponeDate);
    if (saved) {
      setPostponeOpen(false);
      setPostponeDate('');
    }
  };

  return (
    <div className="dv-task-schedule-actions">
      {!due && <span className="dv-task-schedule-upcoming">Next date {occurrenceDate}</span>}
      <div className="dv-task-action-buttons" aria-label={`Scheduled task actions for ${occurrenceDate}`}>
        <button type="button" className="dv-task-action is-postpone" aria-expanded={postponeOpen} aria-controls={`dashboard-postpone-${task._id}`} disabled={disabled} onClick={() => setPostponeOpen((open) => !open)}>
          <Clock3 size={13} /> Postpone
        </button>
        <button type="button" className="dv-task-action is-done" disabled={disabled} onClick={() => onAction(task, occurrence, 'DONE')}>
          <CheckCircle2 size={13} /> Done
        </button>
        <button type="button" className="dv-task-action is-cancel" disabled={disabled} onClick={() => onAction(task, occurrence, 'CANCEL')}>
          <X size={13} /> Cancel
        </button>
      </div>
      {postponeOpen && due && canAct && (
        <div className="dv-task-postpone-form" id={`dashboard-postpone-${task._id}`}>
          <label>
            New date
            <input type="date" min={minDate} value={postponeDate} onChange={(event) => setPostponeDate(event.target.value)} />
          </label>
          <button type="button" className="dv-task-action is-done" disabled={!postponeDate || busy} onClick={savePostpone}>
            {busy ? 'Saving…' : 'Save date'}
          </button>
          <button type="button" className="dv-task-action is-cancel" disabled={busy} onClick={() => setPostponeOpen(false)}>
            Close
          </button>
        </div>
      )}
      {busy && <span className="dv-task-action-progress" role="status">Updating schedule…</span>}
    </div>
  );
}

function EventLoadingState() {
  return (
    <div className="dv-event-loading" role="status" aria-label="Loading assigned events">
      <span className="dv-event-loading-spinner" />
      <span>Loading assigned events</span>
      <div className="dv-event-skeleton-lines" aria-hidden="true"><i /><i /><i /></div>
    </div>
  );
}

function MetricCard({ label, value, note, icon: Icon, tone, to, index = 0 }) {
  return (
    <Link
      to={to}
      className="dv-metric-card"
      style={{ '--card-index': index }}
    >
      <div className="dv-metric-top">
        <span>{label}</span>
        <span className={`dv-metric-icon ${tone}`}>
          <Icon size={19} />
        </span>
      </div>

      <strong className="dv-metric-value">{value ?? '—'}</strong>
      <span className="dv-metric-note">{note}</span>

      <span className="dv-metric-link">
        View details <ArrowRight size={14} />
      </span>
    </Link>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="dv-custom-tooltip">
      {label && <div className="dv-tooltip-label">{label}</div>}

      {payload.map((item, index) => (
        <div className="dv-tooltip-row" key={`${item.name}-${index}`}>
          <span
            className="dv-tooltip-dot"
            style={{ background: item.color || item.payload?.fill || 'var(--status-info)' }}
          />
          <span>{item.name || item.payload?.name || item.payload?.priority}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function getStatusData(stats) {
  const breakdown = stats?.statusBreakdown || [];

  const getCount = (status, fallback = 0) => {
    const entry = breakdown.find(
      (item) => item.status?.toUpperCase() === status
    );

    return safeNumber(entry?.count ?? fallback);
  };

  return [
    {
      name: 'Open',
      value: getCount('OPEN', stats?.open),
      color: COLORS.open,
    },
    {
      name: 'In progress',
      value: getCount('WIP'),
      color: COLORS.wip,
    },
    {
      name: 'Resolved',
      value: getCount('RESOLVED', stats?.closed),
      color: COLORS.resolved,
    },
    {
      name: 'Reopened',
      value: getCount('REOPENED'),
      color: COLORS.reopened,
    },
  ].filter((item) => item.value > 0);
}

export default function Dashboard() {
  const { user } = useAuth();
  const currentUserId = String(user?.id || user?._id || '');
  const isLeadDashboard = ['SL', 'TL'].includes(user?.role);
  const currentDate = new Date();
  const todayKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;

  const [summary, setSummary] = useState(null);
  const [ticketStats, setTicketStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [teamTasks, setTeamTasks] = useState([]);
  const [taskHandovers, setTaskHandovers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [assets, setAssets] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [pendingActions, setPendingActions] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setEventsLoading(true);
    setError('');

    try {
      const results = await Promise.allSettled([
          api.get('/dashboard/summary'),
          api.get('/tickets/summary'),
          api.get(isLeadDashboard ? '/tasks' : '/tasks?assignedToMe=true'),
          isLeadDashboard ? api.get('/tasks/handovers/inbox') : Promise.resolve({ data: [] }),
          api.get('/tickets?assignedToMe=true'),
          api.get('/events'),
          api.get('/assets?status=ACTIVE'),
        ]);

      const [summaryRes, ticketRes, taskRes, handoverRes, assignedTicketRes, eventRes, assetRes] = results;
      const responseData = (result) => result.status === 'fulfilled' ? result.value.data : null;
      const arrayData = (result) => {
        const data = responseData(result);
        return Array.isArray(data) ? data : data?.tasks || data?.tickets || data?.events || data?.assets || [];
      };
      const isMine = (value) => String(value?._id || value || '') === currentUserId;

      if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value.data);
      if (ticketRes.status === 'fulfilled') setTicketStats(ticketRes.value.data);

      if (taskRes.status === 'fulfilled') {
        const taskRows = arrayData(taskRes);
        setTasks(taskRows.filter((task) => isMine(task.assigneeId || task.assignee) && task.status !== 'COMPLETED'));
        setTeamTasks(isLeadDashboard ? taskRows.filter((task) => Boolean(task.assigneeId || task.assignee)) : []);
      }
      if (handoverRes.status === 'fulfilled') {
        setTaskHandovers(isLeadDashboard ? arrayData(handoverRes) : []);
      }
      if (assignedTicketRes.status === 'fulfilled') {
        setTickets(arrayData(assignedTicketRes).filter((ticket) => isMine(ticket.assigneeId) && (ticket.workflowStatus || 'OPEN') !== 'RESOLVED'));
      }
      if (assetRes.status === 'fulfilled') {
        setAssets(user?.role === 'RE'
          ? arrayData(assetRes).filter((asset) => isMine(asset.assignedToId) && ['RECEIVED', 'IN_PROGRESS'].includes(asset.status))
          : []);
      }
      if (eventRes.status === 'fulfilled') {
        setEvents(arrayData(eventRes)
          .filter((event) => {
            const dates = eventOccurrenceRows(event, currentUserId);
            const date = new Date(event.endsAt || event.startsAt).getTime();
            return dates.some((occurrence) => occurrence.dateKey === todayKey) && Number.isFinite(date);
          })
          .sort((a, b) => new Date(a.endsAt || a.startsAt).getTime() - new Date(b.endsAt || b.startsAt).getTime()));
      } else {
        setEvents([]);
      }
      setEventsLoading(false);

      const failedResult = results.find((result) => result.status === 'rejected');
      if (failedResult) {
        setError(failedResult.reason?.response?.data?.message || 'Some dashboard work could not be loaded. Please refresh to try again.');
      }

      setLastUpdated(new Date());
    } catch (err) {
      setEventsLoading(false);
      setError(
        err.response?.data?.message ||
          'Could not load dashboard data. Please try again.'
      );
    } finally {
      setEventsLoading(false);
      setLoading(false);
    }
  }, [currentUserId, isLeadDashboard, todayKey, user?.role, user?.team]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const nodes = document.querySelectorAll('.dv-dashboard [data-reveal]');
    if (!nodes.length) return undefined;

    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -28px 0px' });

    nodes.forEach((node) => {
      node.classList.add('dv-reveal');
      observer.observe(node);
    });

    return () => observer.disconnect();
  }, [tasks.length, tickets.length, assets.length, events.length, teamTasks.length, taskHandovers.length]);

  const role = user?.role;
  const hasAssignedWork = (!isLeadDashboard && tasks.length > 0) || tickets.length > 0 || assets.length > 0 || events.length > 0 || eventsLoading;
  const hasTeamOverview = isLeadDashboard && (teamTasks.length > 0 || taskHandovers.length > 0);
  const hasTeamOnlyQueue = hasTeamOverview && !hasAssignedWork;
  const hasAttentionTickets = Boolean(ticketStats?.agingTickets?.length);
  const hasPriorityContent = hasAttentionTickets || hasAssignedWork || hasTeamOverview;

  const runWorkAction = async (key, action, successTitle, successMessage) => {
    setPendingActions((current) => ({ ...current, [key]: true }));
    try {
      await action();
      Swal.success(successTitle, successMessage);
      await load();
      return true;
    } catch (err) {
      Swal.error('Update Failed', err.response?.data?.message || 'Unable to update this item.');
      return false;
    } finally {
      setPendingActions((current) => ({ ...current, [key]: false }));
    }
  };

  const handleTaskScheduleAction = async (task, occurrence, action, date) => {
    if (!occurrence || dateKey(occurrence.date) > todayKey()) {
      Swal.warning('Not due yet', `This task is scheduled for ${taskScheduleLabel(task).replace(/^(Due|Scheduled) /, '')}.`);
      return false;
    }
    if (action === 'POSTPONE' && (!date || date <= todayKey())) {
      Swal.warning('Choose a later date', 'A postponed task date must be after today.');
      return false;
    }

    if (action !== 'POSTPONE') {
      const isDone = action === 'DONE';
      const confirmation = await Swal.confirm(
        isDone ? 'Complete Scheduled Date' : 'Cancel Scheduled Date',
        `${isDone ? 'Mark' : 'Cancel'} the ${taskScheduleLabel(task).replace(/^Due /, '')} occurrence for "${task.title}"?`,
        isDone ? 'Mark Done' : 'Cancel Date'
      );
      if (!confirmation.isConfirmed) return false;
    }

    const payload = action === 'POSTPONE' ? { action, date } : { action };
    const title = action === 'DONE' ? 'Scheduled Date Completed' : action === 'CANCEL' ? 'Scheduled Date Cancelled' : 'Occurrence Postponed';
    const message = action === 'DONE'
      ? `${task.title}: this date is done and the dashboard now shows the next scheduled date.`
      : action === 'CANCEL'
        ? `${task.title}: this date was cancelled and the dashboard now shows the next scheduled date.`
        : `${task.title}: the occurrence was moved to ${new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, { timeZone: 'UTC', dateStyle: 'medium' })}.`;
    return runWorkAction(
      `task:${task._id}`,
      () => api.patch(`/tasks/${task._id}/schedule/${occurrence._id}`, payload),
      title,
      message
    );
  };

  const completeTask = async (task) => {
    const occurrence = nextTaskOccurrence(task);
    if (task.scheduleDates?.length && !occurrence) return;
    if (occurrence) {
      await handleTaskScheduleAction(task, occurrence, 'DONE');
      return;
    }

    const confirm = await Swal.confirm(
      'Complete Task',
      `Are you sure you want to mark "${task.title}" as COMPLETED?`,
      'Yes, Mark Completed'
    );
    if (!confirm.isConfirmed) return;
    await runWorkAction(`task:${task._id}`, () => api.patch(`/tasks/${task._id}`, { status: 'COMPLETED' }), 'Task Completed', `${task.title} is marked as complete.`);
  };

  const resolveTicket = async (ticket) => {
    const remarks = await Swal.prompt(
      'Resolve Ticket',
      `Add remarks for ticket ${ticket.ticketNumber}:`,
      'Briefly describe the resolution...',
      false
    );
    if (!remarks.isConfirmed) return;
    await runWorkAction(`ticket:${ticket._id}`, () => api.patch(`/tickets/${ticket._id}/status`, {
      status: 'RESOLVED',
      description: remarks.value || ''
    }), 'Ticket Resolved', `${ticket.ticketNumber} is marked as resolved.`);
  };

  const resolveAsset = async (asset) => {
    const note = await Swal.prompt('Add a completion note', 'Work completed (optional)', 'Briefly describe the fix or update');
    if (!note.isConfirmed) return;
    await runWorkAction(`asset:${asset._id}`, () => api.patch(`/assets/${asset._id}/status`, {
      status: 'READY_FOR_PICKUP',
      comment: String(note.value || '').trim()
    }), 'Asset Issue Resolved', `${asset.assetId} is ready for pickup.`);
  };

  const roleLabel = {
    RE: 'Resolution Engineer',
    SL: 'Shift Lead',
    TL: 'Team Leader',
    MANAGER: 'Operations Manager',
  }[role] || 'Operations Workspace';

  const statusData = useMemo(
    () => getStatusData(ticketStats),
    [ticketStats]
  );

  const priorityData = useMemo(
    () => [
      {
        priority: 'Critical',
        tickets: safeNumber(ticketStats?.critical),
        fill: COLORS.critical,
      },
      {
        priority: 'High',
        tickets: safeNumber(ticketStats?.high),
        fill: COLORS.high,
      },
      {
        priority: 'Medium',
        tickets: safeNumber(ticketStats?.medium),
        fill: COLORS.medium,
      },
      {
        priority: 'Low',
        tickets: safeNumber(ticketStats?.low),
        fill: COLORS.low,
      },
    ],
    [ticketStats]
  );

  const agingData = useMemo(() => {
    const tickets = ticketStats?.agingTickets || [];

    const groups = [
      { range: '1–2 days', min: 1, max: 2, count: 0 },
      { range: '3–4 days', min: 3, max: 4, count: 0 },
      { range: '5–7 days', min: 5, max: 7, count: 0 },
      { range: '8+ days', min: 8, max: Infinity, count: 0 },
    ];

    tickets.forEach((ticket) => {
      const age = safeNumber(ticket.ageDays);
      const group = groups.find(
        (item) => age >= item.min && age <= item.max
      );

      if (group) group.count += 1;
    });

    return groups;
  }, [ticketStats]);

  const total = safeNumber(ticketStats?.total);
  const aging = safeNumber(ticketStats?.aging);

  const resolutionRate =
    total > 0
      ? Math.round((safeNumber(ticketStats?.closed) / total) * 100)
      : 0;

  const showPriorityChart = priorityData.some(
    (item) => item.tickets > 0
  );

  const showAgingChart = agingData.some(
    (item) => item.count > 0
  );
  const hasMetricData = [
    ticketStats?.total,
    ticketStats?.open,
    ticketStats?.closed,
    ticketStats?.aging,
    role === 'RE' ? summary?.assetIssuesResolved : null,
    ['TL', 'SL'].includes(role) ? summary?.unassignedTasks : null,
  ].some(hasValue);
  const hasWorkPulseData = [ticketStats?.total, summary?.myTasks, summary?.completedTasks].some(hasValue);
  const hasAnalyticsData = statusData.length > 0 || showPriorityChart || showAgingChart || hasWorkPulseData;

  return (
    <main className="dv-dashboard">
      {/* Hero */}
      <section className="dv-hero">
        <div className="dv-hero-glow" />

        <div className="dv-hero-content">
          <div className="dv-eyebrow">
            <span className="dv-live-dot" />
            DIS / IT OPERATIONS
          </div>

          <h1>
            Operations at a glance<span>.</span>
          </h1>

          <p>
            A focused view of assigned work, open tickets, and team activity.
          </p>

          <div className="dv-hero-meta">
            <span className="dv-role-chip">{roleLabel} view</span>
            <span className="dv-role-chip">
              {role === 'RE' ? 'My assigned work' : 'Team operations'}
            </span>
          </div>
        </div>

        <div className="dv-hero-actions">
          <div className="dv-updated">
            <Activity size={15} />
            <span>
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : 'Awaiting data'}
            </span>
          </div>

          <button
            type="button"
            className="dv-refresh"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw
              size={16}
              className={loading ? 'dv-spinning' : ''}
            />
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </section>

      {hasPriorityContent && (
      <div className={`dv-priority-grid${hasAttentionTickets && (hasAssignedWork || hasTeamOverview) ? ' has-queue-panels' : ''}${hasAttentionTickets && hasTeamOnlyQueue ? ' has-team-only' : ''}`}>
      {hasAttentionTickets && (
      <section className="dv-panel dv-aging-panel" data-reveal>
        <PanelHeading
          title="Tickets requiring attention"
          subtitle="Open tickets older than one day"
          action={
            <Link className="dv-panel-link" to="/tickets">
              {ticketStats.agingTickets.length > 5 ? 'Show more' : 'Review queue'} <ArrowRight size={15} />
            </Link>
          }
        />

          <div className="dv-aging-list">
            {ticketStats.agingTickets.slice(0, 5).map((item) => (
              <Link
                to="/tickets"
                className="dv-aging-row"
                key={item._id}
                title={item.description || item.item || item.ticketNumber}
              >
                <span className="dv-ticket-number">{item.ticketNumber || 'Ticket'}</span>
                <span className="dv-ticket-description">
                  {item.item || item.description || 'Ticket needs resolution'}
                </span>
                <span className="dv-ticket-assignee">{item.assignee?.name || 'Unassigned'}</span>
                <span className="dv-ticket-age">
                  <AlertTriangle size={14} />
                  {item.ageDays ?? '—'} days
                </span>
              </Link>
            ))}
          </div>
      </section>
      )}



      {hasAssignedWork && (
        <section className="dv-assigned-work" aria-labelledby="dv-assigned-work-title" data-reveal>
          <div className="dv-section-title">
            <div>
              <span className="dv-section-kicker">YOUR QUEUE</span>
              <h2 id="dv-assigned-work-title">My assigned work</h2>
            </div>
            <span className="dv-muted">Complete or resolve items here</span>
          </div>

          <div className="dv-assigned-grid">
            {tickets.length > 0 && (
              <AssignedWorkPanel title="Assigned tickets" subtitle={`${tickets.length} open ticket${tickets.length === 1 ? '' : 's'}`} to="/tickets" itemCount={tickets.length}>
                {tickets.slice(0, 5).map((ticket) => (
                  <AssignedWorkRow
                    key={ticket._id}
                    icon={Ticket}
                    title={ticket.ticketNumber || 'Ticket'}
                    description={ticket.item || ticket.description || 'Assigned ticket'}
                    meta={`${ticket.priorityName || 'Normal priority'} · ${ticket.ageDays ?? '—'} days open`}
                    to="/tickets"
                    actionLabel="Resolve"
                    disabled={Boolean(pendingActions[`ticket:${ticket._id}`])}
                    onAction={() => resolveTicket(ticket)}
                  />
                ))}
              </AssignedWorkPanel>
            )}

            {tasks.length > 0 && !isLeadDashboard && (
              <AssignedWorkPanel title="Operational tasks" subtitle={`${tasks.length} active task${tasks.length === 1 ? '' : 's'}`} to="/tasks" itemCount={tasks.length}>
                {tasks.slice(0, 5).map((task) => {
                  const occurrence = nextTaskOccurrence(task);
                  const canComplete = !task.scheduleDates?.length || (occurrence && dateKey(occurrence.date) <= todayKey());
                  return (
                    <AssignedWorkRow
                      key={task._id}
                      icon={ClipboardList}
                      title={task.title}
                      description={task.description || task.taskNumber || 'Assigned operational task'}
                      meta={taskScheduleLabel(task)}
                      to="/tasks"
                      actionLabel={task.scheduleDates?.length ? undefined : 'Done'}
                      disabled={!canComplete || Boolean(pendingActions[`task:${task._id}`])}
                      actions={task.scheduleDates?.length ? (
                        <DashboardTaskScheduleActions
                          task={task}
                          canAct
                          busy={Boolean(pendingActions[`task:${task._id}`])}
                          onAction={handleTaskScheduleAction}
                        />
                      ) : undefined}
                      onAction={() => completeTask(task)}
                    />
                  );
                })}
              </AssignedWorkPanel>
            )}

            {assets.length > 0 && (
              <AssignedWorkPanel title="Asset desk issues" subtitle={`${assets.length} active issue${assets.length === 1 ? '' : 's'}`} to="/assets" itemCount={assets.length}>
                {assets.slice(0, 5).map((asset) => (
                  <AssignedWorkRow
                    key={asset._id}
                    icon={Laptop}
                    title={asset.assetId || 'Asset issue'}
                    description={asset.issue || asset.userName || 'Assigned asset issue'}
                    meta={`${asset.userName || asset.employeeId || 'User details unavailable'} · ${String(asset.status || 'RECEIVED').replaceAll('_', ' ')}`}
                    to="/assets"
                    actionLabel="Resolve"
                    disabled={Boolean(pendingActions[`asset:${asset._id}`]) || Boolean(asset.pendingHandoverId)}
                    onAction={() => resolveAsset(asset)}
                  />
                ))}
              </AssignedWorkPanel>
            )}

            {(events.length > 0 || eventsLoading) && (
              <AssignedWorkPanel
                title="Today's events"
                subtitle={eventsLoading && !events.length ? 'Checking today’s schedule' : `${events.length} event${events.length === 1 ? '' : 's'} today`}
                to="/events"
                itemCount={events.length}
              >
                <div className="dashboard-event-list">
                  {events.slice(0, 5).map((event) => (
                    <div className="dashboard-event-row" key={event._id}>
                      <span className="dashboard-event-icon"><CalendarDays size={16} /></span>
                      <div className="dashboard-event-copy">
                        <strong title={event.title}>{event.title}</strong>
                        <span><Clock3 size={12} /> {new Date(event.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  ))}
                  {eventsLoading && !events.length && <EventLoadingState />}
                </div>
                {eventsLoading && events.length > 0 && (
                  <div className="dv-event-refreshing" role="status">
                    <span className="dv-event-loading-spinner" /> Refreshing event assignments…
                  </div>
                )}
              </AssignedWorkPanel>
            )}
          </div>
        </section>
      )}

      {hasTeamOverview && (
        <section className="dv-team-operations" aria-labelledby="dv-team-operations-title" data-reveal>
          <div className="dv-section-title">
            <div>
              <span className="dv-section-kicker">TEAM OPERATIONS</span>
              <h2 id="dv-team-operations-title">Assignments and handovers</h2>
            </div>
            <span className="dv-muted">Team tasks and recent handover activity</span>
          </div>

          <div className="dv-assigned-grid">
            {teamTasks.length > 0 && (
              <AssignedWorkPanel
                title="Team assigned tasks"
                subtitle={`${teamTasks.length} assigned task${teamTasks.length === 1 ? '' : 's'}`}
                to="/tasks"
                itemCount={teamTasks.length}
              >
                {teamTasks.slice(0, 5).map((task) => {
                  const isAssignedToMe = String(task.assigneeId?._id || task.assigneeId || task.assignee?._id || '') === currentUserId;
                  const occurrence = nextTaskOccurrence(task);
                  const canComplete = !task.scheduleDates?.length || (occurrence && dateKey(occurrence.date) <= todayKey());
                  return (
                  <AssignedWorkRow
                    key={task._id}
                    icon={ClipboardList}
                    title={task.taskNumber || task.title || 'Assigned task'}
                    description={`${task.title || task.description || 'Operational task'} - ${taskScheduleLabel(task)}`}
                    meta={`${String(task.status || 'OPEN').replaceAll('_', ' ')} · Assigned to ${task.assignee?.name || 'Team member'}`}
                    to="/tasks"
                    actionLabel={!task.scheduleDates?.length && isAssignedToMe ? (canComplete ? 'Done' : 'Scheduled') : undefined}
                    disabled={!canComplete || Boolean(pendingActions[`task:${task._id}`]) || task.status === 'COMPLETED'}
                    actions={task.scheduleDates?.length ? (
                      <DashboardTaskScheduleActions
                        task={task}
                        canAct={isLeadDashboard}
                        busy={Boolean(pendingActions[`task:${task._id}`]) || task.status === 'COMPLETED'}
                        onAction={handleTaskScheduleAction}
                      />
                    ) : undefined}
                    completed={task.status === 'COMPLETED'}
                    onAction={() => completeTask(task)}
                  />
                  );
                })}
              </AssignedWorkPanel>
            )}

            {taskHandovers.length > 0 && (
              <AssignedWorkPanel
                title="Task handovers"
                subtitle={`${taskHandovers.length} handover${taskHandovers.length === 1 ? '' : 's'}`}
                to="/tasks"
                itemCount={taskHandovers.length}
              >
                {taskHandovers.slice(0, 5).map((handover) => (
                  <AssignedWorkRow
                    key={handover._id}
                    icon={ArrowRightLeft}
                    title={handover.task?.taskNumber || 'Task handover'}
                    description={handover.task?.title || handover.reason || 'Handover request'}
                    meta={`${String(handover.status || 'PENDING').replaceAll('_', ' ')} · From ${handover.fromUser?.name || 'Team member'} · To ${handover.targetUsers?.map((target) => target.name).filter(Boolean).join(', ') || handover.toUser?.name || 'Team'}`}
                    to="/tasks"
                  />
                ))}
              </AssignedWorkPanel>
            )}
          </div>
        </section>
      )}
      </div>
      )}



      {error && (
        <div className="dv-error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button type="button" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {/* Metrics */}
      {hasMetricData && (
      <section className="dv-section" data-reveal>
        <div className="dv-section-title">
          <div>
            <span className="dv-section-kicker">AT A GLANCE</span>
            <h2>Workspace overview</h2>
          </div>
          <span className="dv-muted">Live API statistics</span>
        </div>

        <div className="dv-metric-grid">
          {hasValue(ticketStats?.total) && (
          <MetricCard
            index={0}
            label="Total tickets"
            value={ticketStats?.total ?? '—'}
            note="Tickets in your workspace"
            icon={Ticket}
            tone="blue"
            to="/tickets"
          />
          )}

          {hasValue(ticketStats?.open) && (
          <MetricCard
            index={1}
            label="Open tickets"
            value={ticketStats?.open ?? '—'}
            note={`${safeNumber(ticketStats?.unassigned)} unassigned`}
            icon={Clock3}
            tone="orange"
            to="/tickets"
          />
          )}

          {hasValue(ticketStats?.closed) && (
          <MetricCard
            index={2}
            label="Resolved tickets"
            value={ticketStats?.closed ?? '—'}
            note={`${resolutionRate}% of total ticket records`}
            icon={CheckCircle2}
            tone="green"
            to="/tickets"
          />
          )}

          {hasValue(ticketStats?.aging) && (
          <MetricCard
            index={3}
            label="Aging tickets"
            value={ticketStats?.aging ?? '—'}
            note="Open for more than one day"
            icon={AlertTriangle}
            tone="red"
            to="/tickets"
          />
          )}

          {role === 'RE' && hasValue(summary?.assetIssuesResolved) && (
            <MetricCard
              index={4}
              label="Asset issues resolved"
              value={summary?.assetIssuesResolved ?? '—'}
              note="Resolution count from dashboard API"
              icon={CheckCircle2}
              tone="green"
              to="/reports"
            />
          )}

          {['TL', 'SL'].includes(role) && hasValue(summary?.unassignedTasks) && (
            <MetricCard
              index={4}
              label="Unassigned tasks"
              value={summary?.unassignedTasks ?? '—'}
              note="Tasks awaiting an engineer"
              icon={ClipboardList}
              tone="purple"
              to="/tasks?unassigned=true"
            />
          )}
        </div>
      </section>
      )}

      {/* Status and priority charts */}
      {hasAnalyticsData && (
      <section className="dv-chart-grid dv-dashboard-analytics" data-reveal>
        {statusData.length > 0 && (
        <article className="dv-panel">
          <PanelHeading
            title="Ticket status"
            subtitle="Distribution by current status"
            action={
              <span className="dv-chart-tag">OVERVIEW</span>
            }
          />

          {statusData.length > 0 ? (
            <div className="dv-donut-layout">
              <div className="dv-donut">
                <ResponsiveContainer width="100%" height={245}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={70}
                      outerRadius={98}
                      paddingAngle={4}
                      stroke="none"
                      isAnimationActive
                      animationDuration={900}
                      animationEasing="ease-out"
                    >
                      {statusData.map((item) => (
                        <Cell
                          key={item.name}
                          fill={item.color}
                        />
                      ))}
                    </Pie>

                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>

                <div className="dv-donut-center">
                  <strong>{total}</strong>
                  <span>Total tickets</span>
                </div>
              </div>

              <div className="dv-legend">
                {statusData.map((item) => (
                  <div className="dv-legend-row" key={item.name}>
                    <span
                      className="dv-legend-dot"
                      style={{ background: item.color }}
                    />
                    <span>{item.name}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="dv-chart-empty">
              {loading
                ? 'Loading ticket statistics…'
                : 'No status data available yet.'}
            </div>
          )}
        </article>

        )}
        {showPriorityChart && (
        <article className="dv-panel">
          <PanelHeading
            title="Priority breakdown"
            subtitle="Tickets grouped by priority"
            action={<Zap size={17} className="dv-heading-icon" />}
          />

          {showPriorityChart ? (
            <ResponsiveContainer width="100%" height={290}>
              <BarChart
                data={priorityData}
                margin={{ top: 12, right: 10, left: -18, bottom: 4 }}
              >
                <CartesianGrid
                  stroke="var(--chart-grid)"
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="priority"
                  tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />

                <YAxis
                  allowDecimals={false}
                  tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />

                <Tooltip content={<ChartTooltip />} />

                <Bar
                  dataKey="tickets"
                  name="Tickets"
                  radius={[7, 7, 0, 0]}
                  isAnimationActive
                  animationDuration={850}
                  animationEasing="ease-out"
                >
                  {priorityData.map((item) => (
                    <Cell
                      key={item.priority}
                      fill={item.fill}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="dv-chart-empty">
              {loading
                ? 'Loading priority data…'
                : 'No priority counts available. Check the tickets summary API.'}
            </div>
          )}
        </article>
        )}
      {/* Aging and work pulse */}
        {showAgingChart && (
        <article className="dv-panel">
          <PanelHeading
            title="Ticket aging"
            subtitle="Age distribution of returned aging-ticket records"
            action={<Clock3 size={17} className="dv-heading-icon" />}
          />

          {showAgingChart ? (
            <>
              <ResponsiveContainer width="100%" height={245}>
                <BarChart
                  data={agingData}
                  margin={{ top: 12, right: 10, left: -18, bottom: 4 }}
                >
                  <CartesianGrid
                    stroke="var(--chart-grid)"
                    strokeDasharray="3 3"
                    vertical={false}
                  />

                  <XAxis
                    dataKey="range"
                    tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />

                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />

                  <Tooltip content={<ChartTooltip />} />

                  <Bar
                    dataKey="count"
                    name="Tickets"
                    fill="var(--status-warning)"
                    radius={[7, 7, 0, 0]}
                    isAnimationActive
                    animationDuration={850}
                    animationEasing="ease-out"
                  />
                </BarChart>
              </ResponsiveContainer>

              <p className="dv-chart-footnote">
                Based on detailed aging records returned by the API.
                The chart may represent only a subset of all aging tickets.
              </p>
            </>
          ) : (
            <div className="dv-chart-empty">
              {loading
                ? 'Loading aging data…'
                : aging > 0
                ? 'Aging tickets exist, but detailed records are unavailable for grouping.'
                : 'No aging tickets to visualize.'}
            </div>
          )}
        </article>

        )}
        {hasWorkPulseData && (
        <article className="dv-panel">
          <PanelHeading
            title="My work pulse"
            subtitle="Your current operational activity"
            action={
              <TrendingUp
                size={17}
                className="dv-heading-icon"
              />
            }
          />

          <div className="dv-pulse-list">
            {hasValue(ticketStats?.total) && (
            <div className="dv-pulse-item">
              <span className="dv-pulse-icon blue">
                <Ticket size={18} />
              </span>
              <div className="dv-pulse-copy">
                <span>Workspace tickets</span>
                <strong>{ticketStats?.total ?? '—'}</strong>
              </div>
              <Link to="/tickets" aria-label="View tickets">
                <ArrowRight size={17} />
              </Link>
            </div>
            )}

            {hasValue(summary?.myTasks) && (
            <div className="dv-pulse-item">
              <span className="dv-pulse-icon orange">
                <ClipboardList size={18} />
              </span>
              <div className="dv-pulse-copy">
                <span>My active tasks</span>
                <strong>{summary?.myTasks ?? '—'}</strong>
              </div>
              <Link to="/tasks" aria-label="View tasks">
                <ArrowRight size={17} />
              </Link>
            </div>
            )}

            {hasValue(summary?.completedTasks) && (
            <div className="dv-pulse-item">
              <span className="dv-pulse-icon green">
                <CheckCircle2 size={18} />
              </span>
              <div className="dv-pulse-copy">
                <span>Tasks completed</span>
                <strong>{summary?.completedTasks ?? '—'}</strong>
              </div>
              <Link to="/tasks" aria-label="View completed tasks">
                <ArrowRight size={17} />
              </Link>
            </div>
            )}
          </div>

          <div className="dv-focus-tip">
            <span><AlertTriangle size={17} /></span>
            <div>
              <strong>Keep aging tickets visible</strong>
              <p>
                Review overdue tickets and follow your team's SLA procedures.
              </p>
              <Link to="/tickets">
                Review ticket queue <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </article>
        )}
      </section>
      )}
    </main>
  );
}
