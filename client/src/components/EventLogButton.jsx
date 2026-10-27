import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import Modal from './Modal.jsx';

const statusLabel = (status) => ({
  DONE: 'Done',
  CANCELLED: 'Cancelled',
  POSTPONED: 'Postponed',
  PENDING: 'Pending'
}[status] || 'Pending');

export default function EventLogButton({ event, dateKey, userId, userRole, userTeam }) {
  const [open, setOpen] = useState(false);
  const isLead = ['MANAGER', 'TL', 'SL'].includes(userRole);
  const isAttendee = event.audience === 'USER'
    ? (event.assignees || []).some((person) => String(person._id) === String(userId))
    : event.team === userTeam;

  const rows = useMemo(() => {
    const assignees = (event.assignees || []).filter((person) => (
      isLead || String(person._id) === String(userId)
    ));
    const updates = isLead ? (event.occurrenceUpdates || []) : (event.myOccurrenceUpdates || []);
    return assignees.map((person) => {
      const update = updates.find((row) => (
        String(row.userId?._id || row.userId) === String(person._id) && row.dateKey === dateKey
      ));
      const legacyDone = (event.completedByIds || []).some((id) => String(id?._id || id) === String(person._id));
      const status = update?.status || (legacyDone ? 'DONE' : 'PENDING');
      return { person, update, status };
    });
  }, [dateKey, event, isLead, userId]);

  if (!isLead && !isAttendee) return null;

  return <>
    <button
      className="event-log-button"
      type="button"
      aria-label={`View event log for ${event.title}`}
      title="View event log"
      onClick={() => setOpen(true)}
    >
      <History size={15} />
    </button>
    {open && <Modal title={`Event log · ${event.title}`} onClose={() => setOpen(false)} className="event-log-modal">
      <div className="event-log-content">
        <p className="event-log-date">{new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'full' })}</p>
        {rows.length ? <div className="event-log-list">
          {rows.map(({ person, update, status }) => <article className="event-log-row" key={person._id}>
            <div className="event-log-person"><span>{person.name?.slice(0, 1).toUpperCase() || 'U'}</span><strong>{person.name || 'Team member'}</strong></div>
            <div className="event-log-state">
              <b className={`event-log-status is-${status.toLowerCase()}`}>{statusLabel(status)}</b>
              <small>{status === 'POSTPONED' && update?.postponedTo ? `Moved to ${new Date(`${update.postponedTo}T00:00:00`).toLocaleDateString()}` : update?.updatedAt ? `Updated ${new Date(update.updatedAt).toLocaleString()}` : status === 'DONE' ? 'Completed' : 'No update yet'}</small>
            </div>
          </article>)}
        </div> : <div className="empty-state compact"><strong>No event log entries</strong><p>No attendee status has been recorded for this date.</p></div>}
      </div>
    </Modal>}
  </>;
}
