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
  Lock
} from 'lucide-react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Swal from '../utils/swal.js';
import { useSearchParams } from 'react-router-dom';

const emptyTaskForm = {
  title: '',
  description: '',
  category: 'OPERATIONAL',
  priority: 'MEDIUM',
  team: 'IT Support',
  location: '',
  frequency: 'ONE_TIME',
  dueAt: '',
  assigneeId: ''
};

export default function Tasks() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUserId = String(user?.id || user?._id || '');
  const isLead = ['MANAGER', 'TL', 'SL'].includes(user?.role);
  const canCreate = user?.role === 'MANAGER' || (user?.permissions || []).includes('tasks:create');

  // Task list and filters
  const [items, setItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [mineOnly, setMineOnly] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(searchParams.get('unassigned') === 'true');

  // Create Task Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(emptyTaskForm);

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
    setBusy(true);
    setError('');

    try {
      await api.post('/tasks', {
        ...createForm,
        dueAt: createForm.dueAt || null,
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

  // Status Change with Confirmation (Requirement 9)
  const handleStatusChange = async (task, newStatus) => {
    if (newStatus === task.status) return;

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
                <th>DUE DATE</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
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

                    <td>{t.dueAt ? new Date(t.dueAt).toLocaleDateString() : '—'}</td>

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

        <div className="table-footer">
          <span>{items.length} task(s) in view</span>
          <span className="table-footer-right">
            Shift continuity is preserved through structured handovers and lead reassignments.
          </span>
        </div>
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
            </div>

            <div className="form-grid">
              <label>
                Due date
                <input
                  type="date"
                  value={createForm.dueAt}
                  onChange={(e) => setCreateForm({ ...createForm, dueAt: e.target.value })}
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
