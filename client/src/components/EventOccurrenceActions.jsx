import { useState } from 'react';
import { Ban, CalendarClock, Check, CircleCheck, Clock3 } from 'lucide-react';
import {
  eventDateLabel,
  eventOccurrenceDue,
  eventOccurrenceRows,
  eventOccurrenceTone,
  nextEventDate
} from '../utils/eventOccurrences.js';

const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const postponeMinDate = (dateKey) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextDay = nextEventDate(dateKey);
  return nextDay > localDateKey(tomorrow) ? nextDay : localDateKey(tomorrow);
};

export function EventStatusLegend() {
  return (
    <div className="event-status-legend" aria-label="Event status color key">
      <span><i className="is-upcoming" /> Scheduled</span>
      <span><i className="is-overdue" /> Due, needs update</span>
      <span><i className="is-done" /> Done</span>
      <span><i className="is-postponed" /> Postponed</span>
      <span><i className="is-cancelled" /> Cancelled</span>
    </div>
  );
}

export default function EventOccurrenceActions({ event, userId, busy, onAction, onlyDateKey }) {
  const [postponingDate, setPostponingDate] = useState('');
  const [newDate, setNewDate] = useState('');
  const rows = eventOccurrenceRows(event, userId).filter((occurrence) => !onlyDateKey || occurrence.dateKey === onlyDateKey);

  const openPostpone = (dateKey) => {
    setPostponingDate(dateKey);
    setNewDate(postponeMinDate(dateKey));
  };

  const savePostpone = async (dateKey) => {
    if (!newDate || newDate < postponeMinDate(dateKey)) return;
    const saved = await onAction(event, dateKey, 'POSTPONE', newDate);
    if (saved !== false) {
      setPostponingDate('');
      setNewDate('');
    }
  };

  return (
    <div className="event-occurrence-list" aria-label={`Dates for ${event.title}`}>
      {rows.map((occurrence) => {
        const tone = eventOccurrenceTone(occurrence);
        const pending = occurrence.status === 'PENDING';
        const due = eventOccurrenceDue(event, occurrence.dateKey);
        return (
          <div className={`event-occurrence-row is-${tone}`} key={occurrence.dateKey}>
            <div className="event-occurrence-summary">
              <span className="event-occurrence-date"><CalendarClock size={13} /> {eventDateLabel(occurrence.dateKey)}</span>
              <span className="event-occurrence-status">
                {tone === 'overdue' ? 'Needs update' : tone === 'upcoming' ? 'Scheduled' : tone === 'done' ? 'Done' : tone === 'postponed' ? `Postponed${occurrence.postponedTo ? ` → ${eventDateLabel(occurrence.postponedTo)}` : ''}` : 'Cancelled'}
              </span>
            </div>
            {pending && (postponingDate === occurrence.dateKey ? (
              <div className="event-postpone-form">
                <label>
                  New date
                  <input type="date" min={postponeMinDate(occurrence.dateKey)} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                </label>
                <button type="button" className="event-action-button is-postpone" disabled={busy || !newDate || newDate < postponeMinDate(occurrence.dateKey)} onClick={() => savePostpone(occurrence.dateKey)}><Check size={13} /> Save</button>
                <button type="button" className="event-action-button is-muted" disabled={busy} onClick={() => setPostponingDate('')}>Back</button>
              </div>
            ) : (
              <div className="event-occurrence-actions">
                <button type="button" className="event-action-button is-done" disabled={busy || !due} title={!due ? 'Available after the scheduled end time' : 'Mark this date done'} onClick={() => onAction(event, occurrence.dateKey, 'DONE')}><CircleCheck size={13} /> Done</button>
                <button type="button" className="event-action-button is-postpone" disabled={busy} onClick={() => openPostpone(occurrence.dateKey)}><Clock3 size={13} /> Postpone</button>
                <button type="button" className="event-action-button is-cancel" disabled={busy} onClick={() => onAction(event, occurrence.dateKey, 'CANCEL')}><Ban size={13} /> Cancel</button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

