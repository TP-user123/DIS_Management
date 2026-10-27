const localDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateKeysInRange = (start, end) => {
  const first = localDateKey(start);
  const last = localDateKey(end || start);
  if (!first || !last || last < first) return [];
  const cursor = new Date(`${first}T00:00:00`);
  const final = new Date(`${last}T00:00:00`);
  const dates = [];
  while (cursor <= final && dates.length < 366) {
    dates.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

export const eventDateLabel = (dateKey) => new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
  dateStyle: 'medium'
});

export const eventOccurrenceRows = (event, userId) => {
  const baseDates = Array.isArray(event.occurrenceDates) && event.occurrenceDates.length
    ? [...new Set(event.occurrenceDates)]
    : dateKeysInRange(event.startsAt, event.endsAt || event.startsAt);
  const baseDateSet = new Set(baseDates);
  const updates = (event.myOccurrenceUpdates || event.occurrenceUpdates || [])
    .filter((update) => !userId || String(update.userId?._id || update.userId || '') === String(userId));
  const updateByDate = new Map(updates.map((update) => [update.dateKey, update]));
  const legacyCompleted = (event.completedByIds || []).some((id) => String(id?._id || id) === String(userId || ''));
  const allDates = new Set(baseDates);

  updates.forEach((update) => {
    if (update.additional || !baseDateSet.has(update.dateKey)) allDates.add(update.dateKey);
  });

  return [...allDates].sort().map((dateKey) => {
    const update = updateByDate.get(dateKey);
    return {
      dateKey,
      status: update?.status || (legacyCompleted && baseDateSet.has(dateKey) ? 'DONE' : 'PENDING'),
      postponedTo: update?.postponedTo || '',
      additional: Boolean(update?.additional)
    };
  });
};

export const eventOccurrenceTone = (occurrence) => {
  if (occurrence.status === 'DONE') return 'done';
  if (occurrence.status === 'CANCELLED') return 'cancelled';
  if (occurrence.status === 'POSTPONED') return 'postponed';
  return occurrence.dateKey <= localDateKey(new Date()) ? 'overdue' : 'upcoming';
};

export const eventOccurrenceDue = (event, dateKey) => {
  if (dateKey < localDateKey(new Date())) return true;
  if (dateKey > localDateKey(new Date())) return false;
  const endTime = new Date(event.endsAt || event.startsAt);
  if (Number.isNaN(endTime.getTime())) return false;
  const dueAt = new Date(`${dateKey}T${String(endTime.getUTCHours()).padStart(2, '0')}:${String(endTime.getUTCMinutes()).padStart(2, '0')}:00.000Z`);
  return Date.now() >= dueAt.getTime();
};

export const nextEventDate = (dateKey) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

