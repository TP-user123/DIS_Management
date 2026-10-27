import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, Sun } from 'lucide-react';
import EventOccurrenceActions from './EventOccurrenceActions.jsx';
import EventLogButton from './EventLogButton.jsx';
import { eventOccurrenceRows, eventOccurrenceTone } from '../utils/eventOccurrences.js';
import { loadIndiaNationalHolidays } from '../utils/indiaHolidays.js';

const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const todayKey = () => dateKey(new Date());
const dateLabel = (key, options = { dateStyle: 'medium' }) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, options);
const monthLabel = (date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const eventStatusLabel = ({ event, occurrence, isAttendee }) => {
  const summary = (event.occurrenceSummaries || []).find((row) => row.dateKey === occurrence.dateKey);
  if (summary?.total) {
    if (summary.done === summary.total) return 'Done';
    if (summary.pending === summary.total) return 'Pending';
    if (summary.done || summary.pending) return 'In progress';
    if (summary.postponed) return 'Postponed';
    if (summary.cancelled) return 'Cancelled';
  }
  if (isAttendee) {
    if (occurrence.status === 'DONE') return 'Done';
    if (occurrence.status === 'CANCELLED') return 'Cancelled';
    if (occurrence.status === 'POSTPONED') return 'Postponed';
    return 'Pending';
  }
  return 'Event';
};
const getMonthGrid = (month) => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cellCount = first.getDay() + dayCount <= 35 ? 35 : 42;
  return Array.from({ length: cellCount }, () => {
    const day = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
    return day;
  });
};
const timeLabel = (date) => new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function IndiaEventsCalendar({
  events,
  eventsLoading,
  user,
  userId,
  eventActionKey,
  onOccurrenceAction,
  canManage,
  onEdit,
  onDelete
}) {
  const [displayMonth, setDisplayMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [holidays, setHolidays] = useState([]);
  const [holidaysLoading, setHolidaysLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const years = [displayMonth.getFullYear() - 1, displayMonth.getFullYear(), displayMonth.getFullYear() + 1];
    setHolidaysLoading(true);
    Promise.all(years.map(loadIndiaNationalHolidays)).then((results) => {
      if (active) setHolidays(results.flat());
    }).finally(() => {
      if (active) setHolidaysLoading(false);
    });
    return () => { active = false; };
  }, [displayMonth]);

  const days = useMemo(() => getMonthGrid(displayMonth), [displayMonth]);
  const assignedEventDates = useMemo(() => {
    const byDate = new Map();
    events.forEach((event) => {
      const isAttendee = event.audience === 'USER'
        ? (event.assignedUserIds || []).some((id) => String(id?._id || id) === String(userId))
        : event.team === user?.team;
      eventOccurrenceRows(event, userId).forEach((occurrence) => {
        const leadSummary = ['MANAGER', 'TL', 'SL'].includes(user?.role)
          ? (event.occurrenceSummaries || []).find((summary) => summary.dateKey === occurrence.dateKey)
          : null;
        const tone = leadSummary?.total && leadSummary.done === leadSummary.total
            ? 'done'
            : leadSummary?.pending
              ? (occurrence.dateKey <= todayKey() ? 'overdue' : 'upcoming')
              : isAttendee
                ? eventOccurrenceTone(occurrence)
                : 'unassigned';
        const eventEntry = {
          event,
          occurrence,
          isAttendee,
          tone,
          leadSummary
        };
        byDate.set(occurrence.dateKey, [...(byDate.get(occurrence.dateKey) || []), eventEntry]);
      });
    });
    byDate.forEach((items) => items.sort((a, b) => new Date(a.event.startsAt) - new Date(b.event.startsAt)));
    return byDate;
  }, [events, user?.role, user?.team, userId]);

  const holidaysByDate = useMemo(() => {
    const byDate = new Map();
    holidays.forEach((holiday) => byDate.set(holiday.date, [...(byDate.get(holiday.date) || []), holiday]));
    return byDate;
  }, [holidays]);

  const selectedEvents = assignedEventDates.get(selectedDate) || [];
  const selectedHolidays = holidaysByDate.get(selectedDate) || [];
  const changeMonth = (amount) => {
    const next = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + amount, 1);
    setDisplayMonth(next);
    setSelectedDate(dateKey(next));
  };
  const goToday = () => {
    const today = new Date();
    setDisplayMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(todayKey());
  };

  return (
    <section className="events-calendar-layout" aria-label="Events calendar">
      <div className="events-calendar-panel">
        <div className="events-calendar-toolbar">
          <div className="events-calendar-month">
            <span className="events-calendar-icon"><CalendarDays size={19} /></span>
            <div>
              <h2>{monthLabel(displayMonth)}</h2>
              <p>Events and nationwide India public holidays</p>
            </div>
          </div>
          <div className="events-calendar-navigation">
            <button className="btn btn-secondary btn-sm" type="button" onClick={goToday}>Today</button>
            <button className="icon-btn" type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={17} /></button>
            <button className="icon-btn" type="button" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={17} /></button>
          </div>
        </div>

        <div className="events-calendar-legend">
          <span><i className="is-event" /> Event</span>
          <span><i className="is-mine" /> Assigned to you</span>
          <span><i className="is-overdue" /> Needs update</span>
          <span><i className="is-done" /> Done</span>
          <span><i className="is-holiday" /> National holiday</span>
        </div>

        <div className="events-calendar-grid" role="grid" aria-label={monthLabel(displayMonth)}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => (
            <div className="events-calendar-weekday" role="columnheader" key={weekday}>{weekday}</div>
          ))}
          {days.map((day) => {
            const key = dateKey(day);
            const dayEvents = assignedEventDates.get(key) || [];
            const dayHolidays = holidaysByDate.get(key) || [];
            const hasMyEvent = dayEvents.some((entry) => entry.isAttendee);
            const visibleEvents = dayEvents.slice(0, 2);
            const extraCount = Math.max(0, dayEvents.length - visibleEvents.length) + Math.max(0, dayHolidays.length - 1);
            return (
              <div
                className={`events-calendar-day${day.getMonth() !== displayMonth.getMonth() ? ' is-outside' : ''}${key === todayKey() ? ' is-today' : ''}${key === selectedDate ? ' is-selected' : ''}${hasMyEvent ? ' has-my-event' : ''}`}
                role="gridcell"
                aria-selected={key === selectedDate}
                key={key}
              >
                <button className="events-calendar-day-number" type="button" onClick={() => setSelectedDate(key)} aria-label={`Select ${dateLabel(key, { dateStyle: 'full' })}${hasMyEvent ? ', has an event assigned to you' : ''}`}>
                  {day.getDate()}
                </button>
                <div className="events-calendar-day-items">
                  {dayHolidays.slice(0, 1).map((holiday) => (
                    <button className="events-calendar-holiday" type="button" key={`${holiday.date}-${holiday.name}`} title={holiday.name} onClick={() => setSelectedDate(key)}>
                      <Sun size={11} /> <span>{holiday.localName || holiday.name}</span>
                    </button>
                  ))}
                  {visibleEvents.map(({ event, occurrence, tone, isAttendee }) => (
                    <button
                      className={`events-calendar-event is-${tone}`}
                      type="button"
                      key={`${event._id}-${occurrence.dateKey}`}
                      title={`${event.title} - ${eventStatusLabel({ event, occurrence, isAttendee })}`}
                      onClick={() => setSelectedDate(key)}
                    >
                      <i /> <span>{event.title}</span>
                    </button>
                  ))}
                  {extraCount > 0 && <button type="button" className="events-calendar-more" onClick={() => setSelectedDate(key)}>+{extraCount} more</button>}
                </div>
              </div>
            );
          })}
        </div>
        {holidaysLoading && <div className="events-calendar-feed-state" role="status"><span className="dv-event-loading-spinner" /> Loading India holiday dates…</div>}
        {!holidaysLoading && !holidays.length && <div className="events-calendar-feed-state">National holiday dates could not be loaded.</div>}
      </div>

      <aside className="events-calendar-agenda">
        <div className="events-agenda-heading">
          <span className="page-kicker">DAY AGENDA</span>
          <h2>{dateLabel(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          <p>{selectedEvents.length} event{selectedEvents.length === 1 ? '' : 's'} · {selectedHolidays.length} holiday{selectedHolidays.length === 1 ? '' : 's'}</p>
        </div>

        {selectedHolidays.map((holiday) => (
          <div className="events-agenda-holiday" key={`${holiday.date}-${holiday.name}`}>
            <Sun size={17} />
            <div><strong>{holiday.localName || holiday.name}</strong><small>India national public holiday</small></div>
          </div>
        ))}

        {eventsLoading && <div className="events-agenda-empty" role="status"><span className="dv-event-loading-spinner" /> Loading events…</div>}
        {!eventsLoading && selectedEvents.map(({ event, occurrence, isAttendee, tone, leadSummary }) => {
          const isCreator = String(event.createdBy || event.creator?._id) === String(userId);
          const eventCanEdit = canManage && (user?.role === 'MANAGER' || isCreator);
          return (
            <article className={`events-agenda-event is-${tone}`} key={`${event._id}-${occurrence.dateKey}`}>
              <div className="events-agenda-event-heading">
                <span className="events-agenda-event-dot" />
                <h3>{event.title}</h3>
                <span className={`events-agenda-status is-${tone}`}>
                  {eventStatusLabel({ event, occurrence, isAttendee })}
                </span>
                <EventLogButton event={event} dateKey={selectedDate} userId={userId} userRole={user?.role} userTeam={user?.team} />
              </div>
              {event.description && <p>{event.description}</p>}
              <div className="events-agenda-meta">
                <span><Clock3 size={13} /> {timeLabel(event.startsAt)}{event.endsAt ? `–${timeLabel(event.endsAt)}` : ''}</span>
                {event.location && <span><MapPin size={13} /> {event.location}</span>}
              </div>
              {isAttendee && (
                <EventOccurrenceActions
                  event={event}
                  userId={userId}
                  onlyDateKey={selectedDate}
                  busy={eventActionKey === `${event._id}:${selectedDate}`}
                  onAction={onOccurrenceAction}
                />
              )}
              {eventCanEdit && (
                <div className="events-agenda-manage">
                  <button type="button" onClick={() => onEdit(event)}>Edit</button>
                  <button type="button" onClick={() => onDelete(event)}>Delete event</button>
                </div>
              )}
            </article>
          );
        })}

        {!eventsLoading && !selectedEvents.length && !selectedHolidays.length && (
          <div className="events-agenda-empty">No events or national holidays on this date.</div>
        )}

        <p className="events-calendar-source">Holiday dates are nationwide India listings; some company and state holidays may differ.</p>
      </aside>

    </section>
  );
}

