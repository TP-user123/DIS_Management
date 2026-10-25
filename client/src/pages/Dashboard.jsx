
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Ticket,
  Zap,
  RefreshCw,
  Activity,
  TrendingUp,
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
import './dashboard-aging.css';
import './dashboard-visuals.css';

const COLORS = {
  open: '#60a5fa',
  wip: '#fbbf24',
  resolved: '#34d399',
  reopened: '#f87171',
  critical: '#f87171',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#34d399',
};

const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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
            style={{ background: item.color || item.payload?.fill || '#60a5fa' }}
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

  const [summary, setSummary] = useState(null);
  const [ticketStats, setTicketStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [summaryRes, ticketRes, taskRes, eventRes] =
        await Promise.all([
          api.get('/dashboard/summary'),
          api.get('/tickets/summary'),
          api.get('/tasks'),
          api.get('/events'),
        ]);

      const taskData = Array.isArray(taskRes.data)
        ? taskRes.data
        : taskRes.data?.tasks || [];

      const eventData = Array.isArray(eventRes.data)
        ? eventRes.data
        : eventRes.data?.events || [];

      setSummary(summaryRes.data);
      setTicketStats(ticketRes.data);

      setTasks(taskData.slice(0, 5));

      setEvents(
        eventData
          .filter((event) => {
            const date = new Date(event.startsAt).getTime();
            return Number.isFinite(date) && date >= Date.now();
          })
          .sort(
            (a, b) =>
              new Date(a.startsAt).getTime() -
              new Date(b.startsAt).getTime()
          )
          .slice(0, 3)
      );

      setLastUpdated(new Date());
    } catch (err) {
      setError(
        err.response?.data?.message ||
          'Could not load dashboard data. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const role = user?.role;
  const isLead = ['MANAGER', 'TL', 'SL'].includes(role);

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

  return (
    <main className="dv-dashboard">
      {/* Hero */}
      <section className="dv-hero">
        <div className="dv-hero-glow" />

        <div className="dv-hero-content">
          <div className="dv-eyebrow">
            <span className="dv-live-dot" />
            OPSDESK · IT OPERATIONS
          </div>

          <h1>
            Good work starts here<span>.</span>
          </h1>

          <p>
            Your operational command center for tickets, priorities,
            tasks, and team activity.
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
      <section className="dv-section">
        <div className="dv-section-title">
          <div>
            <span className="dv-section-kicker">AT A GLANCE</span>
            <h2>Workspace overview</h2>
          </div>
          <span className="dv-muted">Live API statistics</span>
        </div>

        <div className="dv-metric-grid">
          <MetricCard
            index={0}
            label="Total tickets"
            value={ticketStats?.total ?? '—'}
            note="Tickets in your workspace"
            icon={Ticket}
            tone="blue"
            to="/tickets"
          />

          <MetricCard
            index={1}
            label="Open tickets"
            value={ticketStats?.open ?? '—'}
            note={`${safeNumber(ticketStats?.unassigned)} unassigned`}
            icon={Clock3}
            tone="orange"
            to="/tickets"
          />

          <MetricCard
            index={2}
            label="Resolved tickets"
            value={ticketStats?.closed ?? '—'}
            note={`${resolutionRate}% of total ticket records`}
            icon={CheckCircle2}
            tone="green"
            to="/tickets"
          />

          <MetricCard
            index={3}
            label="Aging tickets"
            value={ticketStats?.aging ?? '—'}
            note="Open for more than one day"
            icon={AlertTriangle}
            tone="red"
            to="/tickets"
          />

          {role === 'RE' && (
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

          {['TL', 'SL'].includes(role) && (
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

      {/* Status and priority charts */}
      <section className="dv-chart-grid">
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
                  stroke="#344256"
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="priority"
                  tick={{ fill: '#d1dbea', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />

                <YAxis
                  allowDecimals={false}
                  tick={{ fill: '#d1dbea', fontSize: 12 }}
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
      </section>

      {/* Aging and work pulse */}
      <section className="dv-chart-grid dv-chart-grid-secondary">
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
                    stroke="#344256"
                    strokeDasharray="3 3"
                    vertical={false}
                  />

                  <XAxis
                    dataKey="range"
                    tick={{ fill: '#d1dbea', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />

                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#d1dbea', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />

                  <Tooltip content={<ChartTooltip />} />

                  <Bar
                    dataKey="count"
                    name="Tickets"
                    fill="#fb923c"
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
      </section>

      {/* Aging ticket list */}
      {isLead && (
        <section className="dv-panel dv-aging-panel">
          <PanelHeading
            title="Tickets requiring attention"
            subtitle="Open tickets older than one day"
            action={
              <Link className="dv-panel-link" to="/tickets">
                Review queue <ArrowRight size={15} />
              </Link>
            }
          />

          {ticketStats?.agingTickets?.length ? (
            <div className="dv-aging-list">
              {ticketStats.agingTickets.map((item) => (
                <Link
                  to="/tickets"
                  className="dv-aging-row"
                  key={item._id}
                  title={
                    item.description ||
                    item.item ||
                    item.ticketNumber
                  }
                >
                  <span className="dv-ticket-number">
                    {item.ticketNumber || 'Ticket'}
                  </span>

                  <span className="dv-ticket-description">
                    {item.item ||
                      item.description ||
                      'Ticket needs resolution'}
                  </span>

                  <span className="dv-ticket-assignee">
                    {item.assignee?.name || 'Unassigned'}
                  </span>

                  <span className="dv-ticket-age">
                    <AlertTriangle size={14} />
                    {item.ageDays ?? '—'} days
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="dv-chart-empty">
              <CheckCircle2 size={21} />
              <strong>No detailed aging tickets to display</strong>
              <span>
                {aging > 0
                  ? 'The API reports aging tickets but did not return their details.'
                  : 'No tickets older than one day were reported.'}
              </span>
            </div>
          )}
        </section>
      )}

      {/* Tasks and events */}
      <section className="dv-bottom-grid">
        <article className="dv-panel">
          <PanelHeading
            title="Recent operational tasks"
            subtitle="Latest tasks returned by the tasks API"
            action={
              <Link className="dv-panel-link" to="/tasks">
                View all <ArrowRight size={15} />
              </Link>
            }
          />

          {tasks.length ? (
            <div className="dv-task-list">
              {tasks.map((task) => (
                <div className="dv-task-row" key={task._id}>
                  <span className="dv-task-icon">
                    <ClipboardList size={17} />
                  </span>

                  <div className="dv-task-copy">
                    <strong>{task.title}</strong>
                    <span>
                      {task.taskNumber || 'Task'} ·{' '}
                      {task.assignee?.name || 'Unassigned'}
                    </span>
                  </div>

                  <span
                    className={`dv-status-badge ${
                      task.status === 'COMPLETED'
                        ? 'complete'
                        : 'pending'
                    }`}
                  >
                    {task.status || 'OPEN'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="dv-chart-empty">
              {loading
                ? 'Loading tasks…'
                : 'No operational tasks found.'}
            </div>
          )}
        </article>

        <article className="dv-panel">
          <PanelHeading
            title="Upcoming team events"
            subtitle="The next scheduled team activities"
            action={
              <Link className="dv-panel-link" to="/events">
                View schedule <ArrowRight size={15} />
              </Link>
            }
          />

          {events.length ? (
            <div className="dv-event-list">
              {events.map((event) => {
                const date = new Date(event.startsAt);

                return (
                  <div className="dv-event-row" key={event._id}>
                    <div className="dv-event-date">
                      <strong>{date.getDate()}</strong>
                      <span>
                        {date.toLocaleDateString(undefined, {
                          month: 'short',
                        })}
                      </span>
                    </div>

                    <div className="dv-event-copy">
                      <strong>{event.title}</strong>
                      <span>
                        {date.toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {' · '}
                        {event.audience === 'USER'
                          ? 'Selected members'
                          : 'Entire team'}
                      </span>
                    </div>

                    <CalendarDays
                      size={17}
                      className="dv-event-calendar"
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="dv-chart-empty">
              {loading ? 'Loading events…' : 'No upcoming events.'}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
