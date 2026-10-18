import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Ticket,
  Zap
} from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [ticketStats, setTicketStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');

  const load = () => {
    Promise.all([
      api.get('/dashboard/summary'),
      api.get('/tickets/summary'),
      api.get('/tasks'),
      api.get('/events')
    ])
      .then(([s, t, ts, e]) => {
        setSummary(s.data);
        setTicketStats(t.data);
        setTasks(ts.data.slice(0, 5));
        setEvents(e.data.slice(0, 3));
      })
      .catch((e) => setError(e.response?.data?.message || 'Could not load dashboard.'));
  };

  useEffect(() => {
    load();
  }, []);

  const metric = (label, value, note, Icon, tone, link) => (
    <Link to={link} className="metric-card metric-card-link">
      <div className="metric-top">
        <span>{label}</span>
        <span className={`metric-icon ${tone}`}>
          <Icon size={19} />
        </span>
      </div>
      <div className="metric-value">{value ?? '—'}</div>
      <div className="metric-note">{note}</div>
    </Link>
  );

  const total = Math.max(1, (ticketStats?.open || 0) + (ticketStats?.closed || 0));

  const roleBadge =
    user?.role === 'RE'
      ? 'Resolution Engineer view'
      : user?.role === 'SL'
      ? 'Shift Lead view'
      : user?.role === 'TL'
      ? 'Team Leader view'
      : 'Operations Manager view';

  return (
    <div className="page-stack">
      {/* Overview Welcome Row */}
      <div className="welcome-row">
        <div>
          <div className="page-kicker">ENTERPRISE IT SUPPORT OPERATIONS</div>
          <h1>
            Good work starts here<span className="title-period">.</span>
          </h1>
          <p>
            Real-time ticket queues, operational task tracking, and team schedules in one unified workspace.
          </p>
        </div>

        <div className="role-chip">
          <span className="green-dot" />
          {roleBadge}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* Top 4 Metric Cards */}
      <div className="metric-grid">
        {metric('Total Tickets', ticketStats?.total, 'Active workspace records', Ticket, 'blue', '/tickets')}
        {metric('Open Tickets', ticketStats?.open, `${ticketStats?.unassigned || 0} awaiting assignment`, Clock3, 'orange', '/tickets')}
        {metric('Resolved Tickets', ticketStats?.closed, 'Completed in OpsDesk', CheckCircle2, 'green', '/tickets')}
        {metric('Aging Tickets', ticketStats?.aging, `Oldest open: ${ticketStats?.oldestAge || 0} days`, AlertTriangle, 'orange', '/tickets')}
      </div>

      {/* Middle Dashboard Grid: Chart & My Pulse */}
      <div className="dashboard-grid">
        {/* Ticket Status Overview */}
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Ticket Status Overview</h2>
              <p>Current OpsDesk workflow distribution</p>
            </div>
            <Link className="text-link" to="/tickets">
              Open queue <ArrowRight size={15} />
            </Link>
          </div>

          <div className="donut-layout">
            <div
              className="donut-chart"
              style={{
                '--closed': `${((ticketStats?.closed || 0) / total) * 100}%`
              }}
            >
              <div>
                <strong>{ticketStats?.total ?? '—'}</strong>
                <span>Total tickets</span>
              </div>
            </div>

            <div className="chart-legend">
              <div>
                <i className="legend-dot open-dot" />
                <span>Open</span>
                <strong>
                  {ticketStats?.statusBreakdown?.find((s) => s.status === 'OPEN')?.count ??
                    ticketStats?.open ??
                    0}
                </strong>
              </div>
              <div>
                <i className="legend-dot aging-dot" />
                <span>Work in progress</span>
                <strong>
                  {ticketStats?.statusBreakdown?.find((s) => s.status === 'WIP')?.count ?? 0}
                </strong>
              </div>
              <div>
                <i className="legend-dot closed-dot" />
                <span>Resolved</span>
                <strong>
                  {ticketStats?.statusBreakdown?.find((s) => s.status === 'RESOLVED')?.count ??
                    ticketStats?.closed ??
                    0}
                </strong>
              </div>
              <div>
                <i className="legend-dot" style={{ background: '#ef4444' }} />
                <span>Reopened</span>
                <strong>
                  {ticketStats?.statusBreakdown?.find((s) => s.status === 'REOPENED')?.count ?? 0}
                </strong>
              </div>
              <div>
                <i className="legend-dot" style={{ background: '#d97706' }} />
                <span>Aging over 0 days</span>
                <strong>{ticketStats?.aging ?? 0}</strong>
              </div>
            </div>
          </div>

          <div className="priority-strip">
            <div>
              <span>Critical / Urgent</span>
              <strong>{ticketStats?.critical ?? 0}</strong>
            </div>
            <div>
              <span>High Priority</span>
              <strong>{ticketStats?.high ?? 0}</strong>
            </div>
            <div>
              <span>Unassigned Pool</span>
              <strong>{ticketStats?.unassigned ?? 0}</strong>
            </div>
          </div>
        </section>

        {/* My Work Pulse */}
        <section className="panel focus-panel">
          <div className="panel-heading">
            <div>
              <h2>My Work Pulse</h2>
              <p>Active responsibilities assigned to you</p>
            </div>
            <span className="pulse-icon">
              <Zap size={18} />
            </span>
          </div>

          <div className="pulse-stat">
            <div className="pulse-stat-icon blue-bg">
              <Ticket size={18} />
            </div>
            <div>
              <strong>{ticketStats?.total === undefined ? '—' : ticketStats.total}</strong>
              <span>Tickets in workspace</span>
            </div>
          </div>

          <div className="pulse-stat">
            <div className="pulse-stat-icon orange-bg">
              <ClipboardList size={18} />
            </div>
            <div>
              <strong>{summary?.myTasks ?? 0}</strong>
              <span>My active operational tasks</span>
            </div>
          </div>

          <div className="pulse-stat">
            <div className="pulse-stat-icon green-bg">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <strong>{summary?.completedTasks ?? 0}</strong>
              <span>Operational tasks completed</span>
            </div>
          </div>

          <div className="focus-tip">
            <div className="tip-mark">
              <AlertTriangle size={15} />
            </div>
            <div>
              <strong>Keep aging tickets visible</strong>
              <p>
                Open tickets older than one day require attention to maintain SLA compliance.
              </p>
              <Link to="/tickets">
                Review queue <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* Lower Dashboard Grid: Tasks & Events */}
      <div className="dashboard-grid lower-grid">
        <section className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <h2>Recent Operational Tasks</h2>
              <p>Ongoing maintenance and procedures</p>
            </div>
            <Link className="text-link" to="/tasks">
              View all tasks <ArrowRight size={15} />
            </Link>
          </div>

          {tasks.length ? (
            <div className="case-list">
              {tasks.map((t) => (
                <div className="case-row" key={t._id}>
                  <div className="case-type-icon">
                    <ClipboardList size={17} />
                  </div>
                  <div className="case-row-main">
                    <div className="case-row-title">{t.title}</div>
                    <div className="case-row-meta">
                      <span>{t.taskNumber}</span>
                      <span>·</span>
                      <span>{t.assignee?.name || 'Unassigned'}</span>
                    </div>
                  </div>
                  <span
                    className={`status-pill ${
                      t.status === 'COMPLETED' ? 'status-completed' : 'status-open'
                    }`}
                  >
                    {t.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>No tasks scheduled yet</strong>
              <p>Create a system checklist or operational task in the Tasks section.</p>
            </div>
          )}
        </section>

        <section className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <h2>Upcoming Team Events</h2>
              <p>Team briefings and maintenance windows</p>
            </div>
            <Link className="text-link" to="/events">
              View schedules <ArrowRight size={15} />
            </Link>
          </div>

          {events.length ? (
            <div className="event-mini-list">
              {events.map((e) => (
                <div className="event-mini" key={e._id}>
                  <div className="event-date">
                    <strong>{new Date(e.startsAt).getDate()}</strong>
                    <span>
                      {new Date(e.startsAt).toLocaleDateString(undefined, {
                        month: 'short'
                      })}
                    </span>
                  </div>
                  <div>
                    <b>{e.title}</b>
                    <small>
                      {new Date(e.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                      {e.audience === 'USER' ? 'Multi-Member' : 'Entire Team'}
                    </small>
                  </div>
                  <CalendarDays size={17} />
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>No upcoming events</strong>
              <p>Schedule a team briefing or maintenance review in the Events section.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
