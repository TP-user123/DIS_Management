import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import Swal from '../utils/swal.js';
import IndiaEventsCalendar from '../components/IndiaEventsCalendar.jsx';
import './events-calendar.css';

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
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventActionKey, setEventActionKey] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setEventsLoading(true);
    try {
      const { data } = await api.get('/events');
      setEvents(data);
      setError('');
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load events.');
    } finally {
      setEventsLoading(false);
    }
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

  const handleOccurrenceAction = async (event, dateKey, action, postponedTo) => {
    if (action !== 'POSTPONE') {
      const isDone = action === 'DONE';
      const confirmation = await Swal.confirm(
        isDone ? 'Mark Event Date Done' : 'Cancel Event Date',
        `${isDone ? 'Mark' : 'Cancel'} ${new Date(`${dateKey}T00:00:00`).toLocaleDateString()} for “${event.title}”?`,
        isDone ? 'Mark Done' : 'Cancel Date'
      );
      if (!confirmation.isConfirmed) return false;
    }

    setEventActionKey(`${event._id}:${dateKey}`);
    try {
      await api.patch(`/events/${event._id}/occurrences/${dateKey}`, {
        action,
        ...(action === 'POSTPONE' ? { postponedTo } : {})
      });
      const title = action === 'DONE' ? 'Event Date Completed' : action === 'CANCEL' ? 'Event Date Cancelled' : 'Event Date Postponed';
      const message = action === 'POSTPONE'
        ? `${event.title} was moved to ${new Date(`${postponedTo}T00:00:00`).toLocaleDateString()}.`
        : `${event.title} on ${new Date(`${dateKey}T00:00:00`).toLocaleDateString()} was ${action === 'DONE' ? 'marked done' : 'cancelled'}.`;
      Swal.success(title, message);
      await load();
      return true;
    } catch (err) {
      Swal.error('Event Update Failed', err.response?.data?.message || 'Unable to update this event date.');
      return false;
    } finally {
      setEventActionKey('');
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

      <IndiaEventsCalendar
        events={events}
        eventsLoading={eventsLoading}
        user={user}
        userId={currentUserId}
        eventActionKey={eventActionKey}
        onOccurrenceAction={handleOccurrenceAction}
        canManage={canManage}
        onEdit={openEditModal}
        onDelete={handleDeleteEvent}
      />

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
                <div className="event-attendee-heading">
                  <span className="field-label">
                    Assign Attendees across all roles ({form.assignedUserIds.length} selected):
                  </span>
                  <div className="event-attendee-actions">
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

                <div className="event-attendee-list">
                  {members.map((m) => {
                    const id = m._id || m.id;
                    const isChecked = form.assignedUserIds.includes(id);

                    return (
                      <label
                        key={id}
                        className={`event-attendee-option${isChecked ? ' is-selected' : ''}`}
                      >
                        <input
                          className="event-attendee-checkbox"
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleUserAssignment(id)}
                        />
                        <div className="event-attendee-option-main">
                          <span className="event-attendee-name">
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
