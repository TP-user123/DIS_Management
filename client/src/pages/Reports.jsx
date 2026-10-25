import { useEffect, useMemo, useState } from 'react';
import {
  Activity, CalendarDays, CheckCircle2, ClipboardList, Download, FileText,
  Handshake, Laptop, RefreshCw, Send, UserRound, Users
} from 'lucide-react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Swal from '../utils/swal.js';

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateStart(value) {
  return new Date(`${value}T00:00:00`).toISOString();
}

function nextDate(value) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return localDate(date);
}

function weekStart(value) {
  const date = new Date(`${value}T00:00:00`);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return localDate(date);
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function exportReport(report, selectedUserId, period) {
  const userRows = report.users.map((member) => [
    member.name, member.role, member.team, member.shift,
    member.assetIssuesCompleted, member.assetIssuesPending,
    member.ticketResolvedCount, member.ticketPendingCount, member.walkInIssueCount,
    (member.assignedEvents || []).map((event) => event.title).join('; ')
  ]);
  const rows = [
    ['User', 'Role', 'Team', 'Shift', 'Asset issues resolved total', 'Asset issues pending', 'Tickets resolved', 'Tickets pending', 'Walk-in issues in range', 'Assigned events in range'],
    ...userRows
  ];
  const selected = report.users.find((member) => String(member._id) === String(selectedUserId));
  if (selected) {
    rows.push([], [`Activity for ${selected.name}`], ['Time', 'Source', 'Activity', 'Item', 'Status', 'Note']);
    selected.timeline.forEach((entry) => rows.push([
      new Date(entry.createdAt).toLocaleString(), entry.source, entry.title, entry.subject, entry.status, entry.note
    ]));
  }
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `work-tracker-${period}-${localDate(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const { user } = useAuth();
  const userId = String(user?.id || user?._id || '');
  const isLead = ['MANAGER', 'TL', 'SL'].includes(user?.role);
  const today = localDate(new Date());
  const [period, setPeriod] = useState('today');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reportUserId, setReportUserId] = useState(isLead ? 'all' : userId);
  const [selectedUserId, setSelectedUserId] = useState(userId);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workNote, setWorkNote] = useState('');
  const [blocker, setBlocker] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const load = async () => {
    if (!fromDate || !toDate) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/reports/workload', {
        params: {
          from: localDateStart(fromDate),
          to: localDateStart(nextDate(toDate)),
          userId: reportUserId || 'all'
        }
      });
      setReport(data);
      if (!data.users.some((member) => String(member._id) === String(selectedUserId))) {
        setSelectedUserId(data.users[0] ? String(data.users[0]._id) : '');
      }
    } catch (e) {
      const message = e.response?.data?.message || 'Could not load the work tracker.';
      setReport(null);
      setError(message);
      await Swal.error('Report unavailable', message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [fromDate, toDate, reportUserId]);

  const members = report?.users || [];
  const selectedMember = useMemo(
    () => members.find((member) => String(member._id) === String(selectedUserId)) || null,
    [members, selectedUserId]
  );
  const workEntryGroups = useMemo(() => {
    const groups = new Map();
    const labels = {
      TASK: 'Task activity',
      TICKET: 'Ticket activity',
      CASE: 'Case activity',
      HANDOVER: 'Handover activity',
      'WORK NOTE': 'Work notes',
      EVENT: 'Other event activity',
      ACTIVITY: 'Other activity'
    };
    for (const entry of selectedMember?.timeline || []) {
      const isAsset = entry.source === 'ASSET';
      const key = isAsset && entry.eventId ? `event:${entry.eventId}` : isAsset ? 'walk-in-assets' : `source:${entry.source || 'ACTIVITY'}`;
      const title = isAsset ? (entry.eventTitle || 'Walk-in asset work') : (labels[entry.source] || `${entry.source || 'Other'} activity`);
      if (!groups.has(key)) groups.set(key, { key, title, entries: [] });
      groups.get(key).entries.push(entry);
    }
    return [...groups.values()].sort((a, b) => new Date(b.entries[0]?.createdAt || 0) - new Date(a.entries[0]?.createdAt || 0));
  }, [selectedMember]);

  const setToday = () => {
    const value = localDate(new Date());
    setPeriod('today');
    setFromDate(value);
    setToDate(value);
  };

  const setThisWeek = () => {
    const value = localDate(new Date());
    setPeriod('week');
    setFromDate(weekStart(value));
    setToDate(value);
  };

  const setCustom = () => setPeriod('custom');

  const addWorkNote = async (event) => {
    event.preventDefault();
    if (!workNote.trim()) return;
    setSavingNote(true);
    try {
      await api.post('/work-reports', {
        title: 'Daily work log',
        summary: workNote.trim(),
        completedWork: workNote.trim(),
        blockers: blocker.trim()
      });
      setWorkNote('');
      setBlocker('');
      await load();
      await Swal.success('Work saved', 'Your work note was added to the daily tracker.');
    } catch (e) {
      await Swal.error('Could not save work', e.response?.data?.message || 'Your work note could not be saved.');
    } finally {
      setSavingNote(false);
    }
  };

  const download = () => {
    if (report) {
      exportReport(report, selectedUserId, period);
      Swal.success('Report exported', 'The work tracker report was downloaded as a CSV file.');
    }
  };

  const dateCaption = period === 'today'
    ? new Date(`${fromDate}T00:00:00`).toLocaleDateString()
    : `${new Date(`${fromDate}T00:00:00`).toLocaleDateString()} – ${new Date(`${toDate}T00:00:00`).toLocaleDateString()}`;

  return (
    <div className="page-stack">
      <div className="welcome-row">
        <div>
          <div className="page-kicker">TEAM VISIBILITY</div>
          <h1>Work tracker<span className="title-period">.</span></h1>
          <p>Review daily activity, open tasks and handovers for your team, or keep your own work log.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={download} disabled={!report}><Download size={16} /> Export report</button>
          <button className="btn btn-secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>
        </div>
      </div>

      <section className="panel work-filter-panel">
        <div className="work-period-tabs" role="tablist" aria-label="Report period">
          <button className={period === 'today' ? 'active' : ''} onClick={setToday}><CalendarDays size={15} /> Today</button>
          <button className={period === 'week' ? 'active' : ''} onClick={setThisWeek}><CalendarDays size={15} /> This week</button>
          <button className={period === 'custom' ? 'active' : ''} onClick={setCustom}><CalendarDays size={15} /> Custom dates</button>
        </div>
        {period === 'custom' && <div className="work-filter-fields">
          <label>From<input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label>To<input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} /></label>
        </div>}
        <label className="work-member-filter">Report for
          <select value={reportUserId} onChange={(e) => { setReportUserId(e.target.value); if (e.target.value !== 'all') setSelectedUserId(e.target.value); }}>
            <option value="all">All visible team members</option>
            {members.map((member) => <option key={member._id} value={member._id}>{member.name} · {member.role}</option>)}
          </select>
        </label>
        <span className="work-date-caption">{dateCaption}</span>
      </section>

      {error && <div className="error-box">{error}</div>}
      {loading && <LoadingState title="Loading work tracker" detail="Collecting assignments, work history and issue credits." />}

      {!loading && report && <>
        {reportUserId === 'all' && <section className="panel table-panel work-members-panel">
          <div className="panel-heading"><div><h2>Team report</h2><p>Select a person to open their activity, assignments and handovers for {dateCaption}.</p></div><span className="count-pill">{members.length} people</span></div>
          {members.length ? <div className="table-scroll"><table>
            <thead><tr><th>TEAM MEMBER</th><th>ROLE / TEAM</th><th>ASSET ISSUES</th><th>TICKETS</th><th>WALK-IN</th><th>EVENTS</th></tr></thead>
            <tbody>{members.map((member) => <tr key={member._id} className={selectedUserId === String(member._id) ? 'row-selected' : ''} onClick={() => setSelectedUserId(String(member._id))}>
              <td><button className="work-person-link" onClick={() => setSelectedUserId(String(member._id))}><span className="report-avatar">{member.name.slice(0, 1).toUpperCase()}</span><strong>{member.name}</strong></button></td>
              <td>{member.role}<small className="work-table-sub">{member.team}{member.shift ? ` · ${member.shift}` : ''}</small></td>
              <td><span className="work-count-good">Completed {member.assetIssuesCompleted}</span><small className={member.assetIssuesPending ? 'work-number-warn work-table-sub' : 'work-table-sub'}>Pending {member.assetIssuesPending}</small></td>
              <td><span className="work-count-good">Resolved {member.ticketResolvedCount}</span><small className={member.ticketPendingCount ? 'work-number-warn work-table-sub' : 'work-table-sub'}>Pending {member.ticketPendingCount} of {member.ticketCount}</small></td>
              <td>{member.walkInIssueCount}</td>
              <td><span>{member.eventCount}</span>{member.assignedEvents?.length > 0 && <small className="work-table-sub">{member.assignedEvents.map((event) => event.title).join(', ')}</small>}</td>
            </tr>)}</tbody>
          </table></div> : <div className="empty-state compact"><Users size={22} /><strong>No visible team members</strong><p>No activity is available for the selected scope.</p></div>}
        </section>}

        {selectedMember && <>
          <section className="work-person-banner">
            <div className="work-person-avatar"><UserRound size={22} /></div>
            <div><span>WORK SUMMARY · {dateCaption}</span><h2>{selectedMember.name}</h2><p>{selectedMember.role} · {selectedMember.team}{selectedMember.shift ? ` · ${selectedMember.shift} shift` : ''}</p></div>
            <button className="btn btn-secondary btn-sm" onClick={() => setReportUserId(String(selectedMember._id))}>View this user only</button>
          </section>

          <section className="workload-overview" aria-label={`Work summary for ${selectedMember.name}`}>
            <div className="workload-overview-heading"><div><h3>Current workload</h3><p>Asset completion credit is lifetime; pending counts show current assignments. Tickets show their current status.</p></div><span className="work-period-badge">{dateCaption}</span></div>
            <div className="metric-grid work-metric-grid">
              <article className="metric-card workload-card"><div className="metric-top">Asset issues <span className="metric-icon green"><CheckCircle2 size={17} /></span></div><div className="workload-count-pair"><span><strong>{selectedMember.assetIssuesCompleted}</strong><small>Completed total</small></span><span><strong>{selectedMember.assetIssuesPending}</strong><small>Pending now</small></span></div></article>
              <article className="metric-card workload-card"><div className="metric-top">Tickets <span className="metric-icon blue"><ClipboardList size={17} /></span></div><div className="workload-count-pair"><span><strong>{selectedMember.ticketResolvedCount}</strong><small>Resolved</small></span><span><strong>{selectedMember.ticketPendingCount}</strong><small>Pending</small></span></div><div className="metric-note">{selectedMember.ticketCount} currently assigned</div></article>
              <article className="metric-card workload-card"><div className="metric-top">Walk-in issues <span className="metric-icon orange"><Laptop size={17} /></span></div><div className="metric-value">{selectedMember.walkInIssueCount}</div><div className="metric-note">Active walk-ins plus issues handled in this period</div></article>
              <article className="metric-card workload-card"><div className="metric-top">Assigned events <span className="metric-icon purple"><CalendarDays size={17} /></span></div><div className="metric-value">{selectedMember.eventCount}</div><div className="work-event-titles">{selectedMember.assignedEvents?.length ? selectedMember.assignedEvents.map((event) => <span key={event._id}>{event.title}</span>) : <span>No events assigned in this period</span>}</div></article>
            </div>
          </section>

          <div className="report-grid work-detail-grid">
            <section id="assigned-tasks-detail" className="panel work-detail-panel work-drilldown-panel">
              <div className="panel-heading"><div><h2>Assigned tasks</h2><p>Tasks currently assigned to {selectedMember.name}.</p></div><span className="count-pill">{selectedMember.assignedTasks.length}</span></div>
              {selectedMember.assignedTasks.length ? <div className="work-task-list">{selectedMember.assignedTasks.map((task) => <article className="work-task-row" key={task._id}>
                <div className="work-task-mark"><ClipboardList size={15} /></div><div className="work-task-main"><strong>{task.taskNumber} &middot; {task.title}</strong><small>{task.priority} priority{task.assignedBy ? ` | Assigned by ${task.assignedBy}` : ''}{task.dueAt ? ` | Due ${new Date(task.dueAt).toLocaleDateString()}` : ''}</small></div><span className={`status-pill ${task.status === 'COMPLETED' ? 'status-completed' : task.status === 'WIP' ? 'status-wip' : 'status-open'}`}>{task.status.replaceAll('_', ' ')}</span>
              </article>)}</div> : <div className="empty-state compact"><ClipboardList size={20} /><strong>No assigned tasks</strong><p>No tasks are currently assigned to this user.</p></div>}
            </section>

            <section id="incomplete-tasks-detail" className="panel work-detail-panel work-drilldown-panel">
              <div className="panel-heading"><div><h2>Incomplete tasks</h2><p>Tasks still open or in progress for {selectedMember.name}.</p></div><span className="count-pill">{selectedMember.incompleteTaskCount}</span></div>
              {selectedMember.incompleteTasks.length ? <div className="work-task-list">{selectedMember.incompleteTasks.map((task) => <article className="work-task-row" key={task._id}>
                <div className="work-task-mark"><ClipboardList size={15} /></div><div className="work-task-main"><strong>{task.taskNumber} &middot; {task.title}</strong><small>{task.priority} priority{task.assignedBy ? ` | Assigned by ${task.assignedBy}` : ''}{task.dueAt ? ` | Due ${new Date(task.dueAt).toLocaleDateString()}` : ''}</small></div><span className={`status-pill ${task.status === 'WIP' ? 'status-wip' : 'status-open'}`}>{task.status.replaceAll('_', ' ')}</span>
              </article>)}</div> : <div className="empty-state compact"><CheckCircle2 size={20} /><strong>No incomplete tasks</strong><p>There is no open assigned task right now.</p></div>}
            </section>

            <section id="completed-tasks-detail" className="panel work-detail-panel work-drilldown-panel">
              <div className="panel-heading"><div><h2>Completed tasks</h2><p>Tasks completed during {dateCaption}.</p></div><span className="count-pill">{selectedMember.completedTasks.length}</span></div>
              {selectedMember.completedTasks.length ? <div className="work-task-list">{selectedMember.completedTasks.map((task) => <article className="work-task-row" key={task._id}>
                <div className="work-task-mark"><CheckCircle2 size={15} /></div><div className="work-task-main"><strong>{task.taskNumber} &middot; {task.title}</strong><small>{task.priority} priority{task.assignedBy ? ` | Assigned by ${task.assignedBy}` : ''}{task.completedAt ? ` | Completed ${new Date(task.completedAt).toLocaleString()}` : ''}</small></div><span className="status-pill status-completed">COMPLETED</span>
              </article>)}</div> : <div className="empty-state compact"><CheckCircle2 size={20} /><strong>No completed tasks in this period</strong><p>Completed tasks will appear here.</p></div>}
            </section>

            <section id="handovers-detail" className="panel work-detail-panel work-drilldown-panel">
              <div className="panel-heading"><div><h2>Handovers</h2><p>Work offered, received and accepted during this date range.</p></div><span className="count-pill">{selectedMember.handovers.length}</span></div>
              {selectedMember.handovers.length ? <div className="work-handover-list">{selectedMember.handovers.map((handover) => <article className="work-handover-row" key={handover._id}>
                <div><strong>{handover.task?.taskNumber || 'Task'}{handover.task?.title ? ` | ${handover.task.title}` : ''}</strong><small>{handover.direction} &middot; {new Date(handover.createdAt).toLocaleString()}</small><small>{handover.direction === 'SENT' ? `From you${handover.targetUsers.length ? ` to ${handover.targetUsers.join(', ')}` : ''}` : handover.direction === 'ACCEPTED' ? `Accepted by ${handover.acceptedBy || selectedMember.name}` : `From ${handover.fromUser || handover.initiatedBy || 'a teammate'}`}</small>{(handover.reason || handover.notes) && <p>{handover.reason || handover.notes}</p>}</div><span className={`status-pill ${handover.status === 'ACCEPTED' ? 'status-completed' : handover.status === 'PENDING' ? 'status-open' : 'status-wip'}`}>{handover.status}</span>
              </article>)}</div> : <div className="empty-state compact"><Handshake size={20} /><strong>No handovers in this period</strong><p>Handover activity will appear here.</p></div>}
            </section>
          </div>

          <section id="work-entries-detail" className="panel work-timeline-panel work-drilldown-panel">
            <div className="panel-heading"><div><h2>Daily activity</h2><p>Work is grouped by bulk event, walk-in intake, task, ticket and other activity. Expand a group to see its entries.</p></div><span className="count-pill">{selectedMember.timeline.length} entries in {workEntryGroups.length} groups</span></div>
            {workEntryGroups.length ? <div className="work-entry-groups">{workEntryGroups.map((group) => <details className="work-entry-group" key={group.key}>
              <summary><div><strong>{group.title}</strong><small>{group.key.startsWith('event:') ? 'Bulk event work' : group.key === 'walk-in-assets' ? 'Walk-in asset work' : 'Work entries'}</small></div><span className="count-pill">{group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}</span><time>Latest {new Date(group.entries[0].createdAt).toLocaleString()}</time></summary>
              <div className="work-timeline">{group.entries.map((entry) => <article className={`work-timeline-entry ${entry.repeatIssue ? 'is-repeat-issue' : ''}`} key={entry._id}>
                <span className="work-timeline-dot" /><div className="work-timeline-content"><div className="work-timeline-head"><div><strong>{entry.title}</strong>{entry.source && <span className="work-source-pill">{entry.source}</span>}</div><time>{new Date(entry.createdAt).toLocaleString()}</time></div>
                  {entry.subject && <p>{entry.subject}</p>}{entry.status && <span className={`status-pill ${entry.status === 'COMPLETED' || entry.status === 'RESOLVED' || entry.status === 'RETURNED' ? 'status-completed' : entry.status === 'WIP' || entry.status === 'IN_PROGRESS' ? 'status-wip' : 'status-open'}`}>{String(entry.status).replaceAll('_', ' ')}</span>}{entry.note && <small>{entry.note}</small>}
                  {entry.repeatIssue && <div className={`repeat-issue-callout ${entry.repeatIssueStatus === 'RESOLVED' ? 'is-resolved' : ''}`}><strong>{entry.repeatIssueStatus === 'RESOLVED' ? 'Repeated issue resolved' : 'Repeated issue reported'}</strong><span>{entry.repeatIssueText || entry.subject}{entry.repeatIssueCount ? ` · Repeat occurrence ${entry.repeatIssueCount}` : ''}</span></div>}
                </div></article>)}</div>
            </details>)}</div> : <div className="empty-state compact"><Activity size={20} /><strong>No activity for this period</strong><p>Task, ticket, asset and handover updates will appear here. Add a work note below for work done outside OpsDesk.</p></div>}
          </section>

        </>}

        {selectedUserId === userId && fromDate <= today && toDate >= today && <section className="panel work-note-panel">
          <div className="panel-heading"><div><h2>Log work for today</h2><p>Add a note for work that was completed outside a tracked task, ticket or asset.</p></div><span className="metric-icon blue"><FileText size={17} /></span></div>
          <form className="work-note-form" onSubmit={addWorkNote}>
            <label>What did you work on?<textarea rows="3" required value={workNote} onChange={(e) => setWorkNote(e.target.value)} placeholder="Describe the work you completed today" /></label>
            <label>Blocker or handover note (optional)<textarea rows="2" value={blocker} onChange={(e) => setBlocker(e.target.value)} placeholder="Anything pending or handed over to the next shift?" /></label>
            <button className="btn btn-primary" disabled={savingNote || !workNote.trim()}>{savingNote ? 'Saving…' : 'Save work note'} <Send size={15} /></button>
          </form>
        </section>}
      </>}

      {!loading && !report && <section className="panel empty-state"><Activity size={23} /><strong>Report could not be generated</strong><p>Try refreshing the work tracker.</p></section>}
    </div>
  );
}
