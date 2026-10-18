import { useEffect, useState } from 'react';
import {
  CalendarDays,
  Plus,
  MapPin,
  Users,
  Edit2,
  Trash2,
  Clock,
  Check,
  ShieldCheck,
  UserCheck
} from 'lucide-react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import Swal from '../utils/swal.js';

const emptyEventForm = {
  title: '',
  description: '',
  startsAt: '',
  endsAt: '',
  location: '',
  audience: 'USER', // default to multi-user assignment
  team: 'IT Support',
  assignedUserIds: []
};

export default function Events() {
  const { user } = useAuth();
  const currentUserId = String(user?.id || user?._id || '');
  const canManage =
    user?.role === 'MANAGER' ||
    ['TL', 'SL'].includes(user?.role) ||
    (user?.permissions || []).includes('events:manage');

  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null); // null for create, ID for edit
  const [form, setForm] = useState(emptyEventForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    api.get('/events')
      .then((r) => setEvents(r.data))
      .catch((e) => setError(e.response?.data?.message || 'Could not load events.'));
  };

  useEffect(() => {
    load();
    api.get('/team')
      .then((r) => setMembers(r.data.filter((m) => m.status === 'active')))
      .catch(() => {});
  }, []);

  // Open Create Modal
  const openCreateModal = () => {
    setEditingEventId(null);
    setForm(emptyEventForm);
    setError('');
    setShowModal(true);
  };

  // Open Edit Modal (Requirement 7: Option to update event)
  const openEditModal = (ev) => {
    setEditingEventId(ev._id);
    setForm({
      title: ev.title || '',
      description: ev.description || '',
      startsAt: ev.startsAt ? new Date(ev.startsAt).toISOString().slice(0, 16) : '',
      endsAt: ev.endsAt ? new Date(ev.endsAt).toISOString().slice(0, 16) : '',
      location: ev.location || '',
      audience: ev.audience || 'USER',
      team: ev.team || 'IT Support',
      assignedUserIds: (ev.assignedUserIds || ev.assignees || []).map((x) => String(x._id || x))
    });
    setError('');
    setShowModal(true);
  };

  // Delete Event with SweetAlert Confirmation (Requirement 7 & Requirement 9)
  const handleDeleteEvent = async (ev) => {
    const confirmRes = await Swal.confirm(
      'Delete Event',
      `Are you sure you want to delete and cancel "${ev.title}"? Attendees will be notified.`,
      'Yes, Delete Event'
    );

    if (!confirmRes.isConfirmed) return;

    try {
      await api.delete(`/events/${ev._id}`);
      Swal.success('Event Deleted', `Event "${ev.title}" has been deleted.`);
      load();
    } catch (err) {
      Swal.error('Delete Failed', err.response?.data?.message || 'Unable to delete event.');
    }
  };

  // Submit Create or Edit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      if (editingEventId) {
        // Update Event
        await api.patch(`/events/${editingEventId}`, form);
        Swal.success('Event Updated', 'Event changes have been saved and attendees notified.');
      } else {
        // Create Event
        await api.post('/events', form);
        Swal.success(
          'Event Created',
          `Event created. ${form.assignedUserIds.length} attendee(s) notified.`
        );
      }
      setShowModal(false);
      setForm(emptyEventForm);
      setEditingEventId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save event.');
    } finally {
      setBusy(false);
    }
  };

  // Toggle user assignment (supports RE, Manager, SL, TL)
  const toggleUserAssignment = (userId) => {
    setForm((f) => {
      const exists = f.assignedUserIds.includes(userId);
      return {
        ...f,
        assignedUserIds: exists
          ? f.assignedUserIds.filter((id) => id !== userId)
          : [...f.assignedUserIds, userId]
      };
    });
  };

  // Select all users of a specific role
  const selectAllByRole = (role) => {
    const roleIds = members.filter((m) => m.role === role).map((m) => m._id || m.id);
    setForm((f) => {
      const allSelected = roleIds.every((id) => f.assignedUserIds.includes(id));
      return {
        ...f,
        assignedUserIds: allSelected
          ? f.assignedUserIds.filter((id) => !roleIds.includes(id))
          : [...new Set([...f.assignedUserIds, ...roleIds])]
      };
    });
  };

  return (
    <div className="page-stack">
      {/* Header */}
      <div className="welcome-row">
        <div>
          <div className="page-kicker">COLLABORATION & SCHEDULES</div>
          <h1>
            Events & schedules<span className="title-period">.</span>
          </h1>
          <p>
            Schedule team briefings, maintenance windows, and joint operational reviews. Assign multi-role attendees (RE, SL, TL, Manager) with automatic in-app alerts.
          </p>
        </div>

        {canManage && (
          <button className="btn btn-primary" onClick={openCreateModal}>
            <Plus size={17} /> Create event
          </button>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* Events Grid */}
      <div className="events-grid">
        {events.map((ev) => {
          const isCreator = String(ev.createdBy || ev.creator?._id) === currentUserId;
          const canEditThis = canManage || isCreator;
          const attendees = ev.assignees || [];

          return (
            <article className="event-card" key={ev._id}>
              <div className="event-card-top">
                <div className="event-date-large">
                  <strong>{new Date(ev.startsAt).getDate()}</strong>
                  <span>
                    {new Date(ev.startsAt)
                      .toLocaleDateString(undefined, { month: 'short' })
                      .toUpperCase()}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    className={`status-pill ${
                      ev.audience === 'USER' ? 'status-open' : 'status-completed'
                    }`}
                  >
                    {ev.audience === 'USER' ? 'Multi-Member Event' : 'Entire Team'}
                  </span>

                  {/* Edit and Delete Actions (Requirement 7) */}
                  {canEditThis && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        className="icon-btn"
                        title="Update / Edit Event"
                        onClick={() => openEditModal(ev)}
                      >
                        <Edit2 size={14} style={{ color: '#0077b8' }} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Delete / Cancel Event"
                        onClick={() => handleDeleteEvent(ev)}
                      >
                        <Trash2 size={14} style={{ color: '#dc2626' }} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <h3>{ev.title}</h3>
              <p>{ev.description || 'No additional description provided.'}</p>

              <div className="event-card-meta">
                <span>
                  <Clock size={15} />
                  {new Date(ev.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {ev.endsAt &&
                    ` – ${new Date(ev.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                </span>

                {ev.location && (
                  <span>
                    <MapPin size={15} /> {ev.location}
                  </span>
                )}

                {/* Assigned Multi-Role Attendees Display */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#475569', marginBottom: '6px' }}>
                    <Users size={14} style={{ color: '#0077b8' }} />
                    <strong>Assigned Attendees ({ev.audience === 'USER' ? attendees.length : 'All ' + (ev.team || 'Team')}):</strong>
                  </div>

                  {ev.audience === 'USER' ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {attendees.map((u) => (
                        <span
                          key={u._id || u.id}
                          className={`badge badge-${u.role?.toLowerCase() || 're'}`}
                          style={{ fontSize: '10px' }}
                        >
                          {u.name} ({u.role})
                        </span>
                      ))}
                      {!attendees.length && <small style={{ color: '#94a3b8' }}>None assigned</small>}
                    </div>
                  ) : (
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      Entire {ev.team || 'IT Support'} Team
                    </span>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {!events.length && (
          <div className="panel empty-state">
            <div className="empty-icon">
              <CalendarDays size={22} />
            </div>
            <strong>No events scheduled</strong>
            <p>Create an operational event and assign RE, SL, TL, or Managers to collaborate.</p>
          </div>
        )}
      </div>

      {/* Create / Edit Modal (Requirement 7) */}
      {showModal && (
        <Modal
          title={editingEventId ? 'Update Event Schedule' : 'Create Collaborative Event'}
          onClose={() => setShowModal(false)}
        >
          <form className="form-stack modal-form" onSubmit={handleSubmit}>
            <label>
              Event Title
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Shift Handover Briefing / System Health Review"
              />
            </label>

            <label>
              Description & Agenda
              <textarea
                rows="3"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Key topics, checklist items, and objectives..."
              />
            </label>

            <div className="form-grid">
              <label>
                Start Date & Time
                <input
                  type="datetime-local"
                  required
                  value={form.startsAt}
                  onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                />
              </label>

              <label>
                End Date & Time (Optional)
                <input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                />
              </label>
            </div>

            <div className="form-grid">
              <label>
                Audience Type
                <select
                  value={form.audience}
                  onChange={(e) => setForm({ ...form, audience: e.target.value })}
                >
                  <option value="USER">Specific Members (RE, SL, TL, Manager)</option>
                  <option value="TEAM">Entire Team</option>
                </select>
              </label>

              <label>
                Location / Virtual Room
                <input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Floor 3 Briefing Room / Teams Link"
                />
              </label>
            </div>

            {/* Multi-Role User Assignment Picker (Requirement 7) */}
            {form.audience === 'USER' ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span className="field-label" style={{ margin: 0 }}>
                    Assign Attendees across all roles ({form.assignedUserIds.length} selected):
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {['RE', 'SL', 'TL', 'MANAGER'].map((role) => (
                      <button
                        key={role}
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => selectAllByRole(role)}
                        title={`Select all ${role} members`}
                      >
                        + All {role}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    maxHeight: '190px',
                    overflowY: 'auto',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '8px',
                    display: 'grid',
                    gap: '6px',
                    background: '#ffffff'
                  }}
                >
                  {members.map((m) => {
                    const id = m._id || m.id;
                    const isChecked = form.assignedUserIds.includes(id);

                    return (
                      <label
                        key={id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          cursor: 'pointer',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          background: isChecked ? '#eff6ff' : 'transparent',
                          transition: 'background 0.12s ease'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleUserAssignment(id)}
                        />
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: '#1e293b' }}>
                            {m.name}
                          </span>
                          <span className={`badge badge-${m.role?.toLowerCase() || 're'}`}>
                            {m.role} · {m.team}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <small style={{ color: '#64748b', fontSize: '10px', marginTop: '4px', display: 'block' }}>
                  Selected members will automatically receive an in-app notification with event details.
                </small>
              </div>
            ) : (
              <label>
                Team Name
                <input
                  value={form.team}
                  onChange={(e) => setForm({ ...form, team: e.target.value })}
                  placeholder="e.g. IT Support"
                />
              </label>
            )}

            {error && <div className="error-box">{error}</div>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editingEventId ? 'Update Event' : 'Create Event'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
