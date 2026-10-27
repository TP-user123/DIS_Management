const holidayCache = new Map();

const fixedNationalHolidays = (year) => [
  { date: `${year}-01-26`, name: 'Republic Day', localName: 'Republic Day', countryCode: 'IN', global: true },
  { date: `${year}-08-15`, name: 'Independence Day', localName: 'Independence Day', countryCode: 'IN', global: true },
  { date: `${year}-10-02`, name: 'Gandhi Jayanti', localName: 'Gandhi Jayanti', countryCode: 'IN', global: true }
];

export const loadIndiaNationalHolidays = (year) => {
  if (holidayCache.has(year)) return holidayCache.get(year);

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/IN`, { signal: controller.signal });
      if (!response.ok) throw new Error('Holiday calendar unavailable');
      const holidays = await response.json();
      const nationwide = holidays.filter((holiday) =>
        (holiday.types || []).includes('Public') &&
        (holiday.global === true || !holiday.counties?.length)
      );
      const byDate = new Map(fixedNationalHolidays(year).map((holiday) => [holiday.date, holiday]));
      nationwide.forEach((holiday) => byDate.set(holiday.date, holiday));
      return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return fixedNationalHolidays(year);
    } finally {
      clearTimeout(timeout);
    }
  })();

  holidayCache.set(year, request);
  return request;
};

