import { useEffect, useState } from 'react';
import { ArrowRightLeft, Check, Clock3, X, UserCheck, Users, ShieldAlert } from 'lucide-react';
import api from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import Swal from '../utils/swal.js';

export default function Handovers() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const { user } = useAuth();
  const currentUserId = String(user?.id || user?._id || '');
  const isLead = ['MANAGER', 'TL', 'SL'].includes(user?.role);

  const load = () => {
    api.get('/tasks/handovers/inbox')
      .then((r) => setItems(r.data))
      .catch((e) => setError(e.response?.data?.message || 'Unable to load handovers.'));
  };

  useEffect(() => {
    load();
  }, []);

  // Respond with SweetAlert Confirmation (Requirement 9)
  const respond = async (id, status) => {
    const actionLabel = status === 'ACCEPTED' ? 'Accept Handover' : 'Reject Handover';
    const confirmMsg =
      status === 'ACCEPTED'
        ? 'Accepting will transfer this task to you and begin your work on it. Other broadcasted recipients will see you have taken it.'
        : 'Are you sure you want to decline this handover offer?';

    const confirmRes = await Swal.confirm(actionLabel, confirmMsg, status === 'ACCEPTED' ? 'Yes, Accept' : 'Decline');
    if (!confirmRes.isConfirmed) return;

    setBusy(id);
    setError('');

    try {
      await api.patch(`/tasks/handovers/${id}`, { status });
      Swal.success(
        status === 'ACCEPTED' ? 'Handover Accepted' : 'Handover Declined',
        status === 'ACCEPTED' ? 'Task is now assigned to you. You can begin working on it in Tasks.' : 'Decline recorded.'
      );
      await load();
    } catch (e) {
      Swal.error('Error', e.response?.data?.message || 'Unable to update handover.');
    } finally {
      setBusy('');
    }
  };

  const pendingAwaitingMe = items.filter((h) => {
    if (h.status !== 'PENDING') return false;
    const isTarget =
      String(h.toUserId) === currentUserId ||
      (h.targetUserIds || []).map(String).includes(currentUserId);
    return isTarget;
  });

  return (
    <div className="page-stack">
      {/* Header */}
      <div className="welcome-row">
        <div>
          <div className="page-kicker">SHIFT CONTINUITY & COOPERATIVE FLOW</div>
          <h1>
            Handovers<span className="title-period">.</span>
          </h1>
          <p>
            Review tasks handed over across shifts and engineers. Multi-candidate broadcast handovers allow any recipient to claim work and take ownership.
          </p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Handover Inbox</h2>
            <p>Broadcast handovers offered to you, initiated by you, or active across your shift.</p>
          </div>
          <span className="count-pill">{pendingAwaitingMe.length} awaiting your action</span>
        </div>

        {!items.length ? (
          <div className="empty-state">
            <div className="empty-icon">
              <ArrowRightLeft size={23} />
            </div>
            <strong>No handovers yet</strong>
            <p>Handover requests will appear here when work is transferred between engineers.</p>
          </div>
        ) : (
          <div className="handover-list">
            {items.map((h) => {
              const isTargetCandidate =
                String(h.toUserId) === currentUserId ||
                (h.targetUserIds || []).map(String).includes(currentUserId);
              const isInitiator = String(h.fromUserId) === currentUserId;
              const hasAccepted = h.status === 'ACCEPTED';
              const workerName = h.acceptedUser?.name || h.toUser?.name || 'Assigned Engineer';

              return (
                <div className="handover-row" key={h._id}>
                  <div className="handover-icon">
                    <ArrowRightLeft size={18} />
                  </div>

                  <div className="handover-main">
                    <div className="handover-title">
                      <strong>{h.task?.title || 'Operational Task'}</strong>{' '}
                      {h.task?.taskNumber && <small style={{ color: '#64748b' }}>({h.task.taskNumber})</small>}
                      <StatusBadge value={h.status} />
                    </div>

                    <div className="handover-route">
                      <span>
                        Offered by: <strong>{h.fromUser?.name || 'Engineer'}</strong>
                      </span>
                      <ArrowRightLeft size={14} />
                      <span>
                        Candidates: <strong>
                          {h.targetUsers?.length
                            ? h.targetUsers.map((u) => u.name).join(', ')
                            : h.toUser?.name || 'Team Members'}
                        </strong>
                      </span>
                    </div>

                    {/* Requirement 6: Display who accepted and is working on below */}
                    {hasAccepted && (
                      <div
                        style={{
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          margin: '8px 0',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          color: '#15803d',
                          fontSize: '12px'
                        }}
                      >
                        <UserCheck size={16} />
                        <span>
                          <strong>Accepted by {workerName}:</strong> Currently working on this task.
                          {h.acceptedAt && <small style={{ marginLeft: '6px', color: '#166534' }}>({new Date(h.acceptedAt).toLocaleTimeString()})</small>}
                        </span>
                      </div>
                    )}

                    <p>
                      <strong>Reason:</strong> {h.reason || 'Shift transition'}
                      {h.notes ? ` — Notes: ${h.notes}` : ''}
                    </p>

                    <span className="handover-time">
                      <Clock3 size={13} /> {new Date(h.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {/* Actions for Candidates */}
                  {h.status === 'PENDING' && (isTargetCandidate || isLead) && (
                    <div className="handover-actions">
                      <button
                        className="btn btn-success btn-sm"
                        disabled={busy === h._id}
                        onClick={() => respond(h._id, 'ACCEPTED')}
                      >
                        <Check size={15} /> Accept & Start Work
                      </button>
                      <button
                        className="btn btn-danger-ghost btn-sm"
                        disabled={busy === h._id}
                        onClick={() => respond(h._id, 'REJECTED')}
                      >
                        <X size={15} /> Decline
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
