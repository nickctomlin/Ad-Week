export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayPattern = '(?:sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)';
const dayIndex = (text) => WEEKDAYS.findIndex((day) => day.slice(0, 3).toLowerCase() === text.slice(0, 3).toLowerCase());
const searchText = (value) => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’‘]/g, '');

// Unknown schedules stay unknown. Time text may explicitly add another day,
// e.g. "Mon-Sat" with "Sun 2pm-6pm" or weekday + nightly happy hour.
export function daysFromText(text = '') {
  const value = text.toLowerCase().replace(/[–—]/g, '-');
  if (/\bdays? not stated\b|\bnot published\b/.test(value)) return [];
  if (/\b(daily|every day|every night|nightly)\b/.test(value)) return [0, 1, 2, 3, 4, 5, 6];
  const result = new Set();
  if (/\bweekdays\b/.test(value)) [1, 2, 3, 4, 5].forEach((d) => result.add(d));
  if (/\bweekends\b/.test(value)) [0, 6].forEach((d) => result.add(d));
  for (const match of value.matchAll(new RegExp(`\\b(${dayPattern})\\s*(?:-|to|through)\\s*(${dayPattern})\\b`, 'g'))) {
    let day = dayIndex(match[1]);
    const end = dayIndex(match[2]);
    for (let count = 0; count < 7; count++, day = (day + 1) % 7) { result.add(day); if (day === end) break; }
  }
  for (const match of value.matchAll(new RegExp(`\\b(${dayPattern})\\b`, 'g'))) result.add(dayIndex(match[1]));
  return [...result].sort();
}

export function happyHourDays(venue) {
  return venue.happy_hour ? [...new Set([...daysFromText(venue.happy_hour.days), ...daysFromText(venue.happy_hour.time)])] : [];
}

export function chicagoWeekday(date = new Date()) {
  return WEEKDAYS.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long' }).format(date));
}

export function dailySpecialOnDay(special, day = '', now = new Date()) {
  if (!special.on_date) return day === '' || daysFromText(special.day).includes(Number(day));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (special.on_date < today) return false;
  if (day === '') return true;
  const target = new Date(`${today}T12:00:00Z`);
  target.setUTCDate(target.getUTCDate() + (Number(day) - target.getUTCDay() + 7) % 7);
  return special.on_date === target.toISOString().slice(0, 10);
}

export function filterSpecials(venues, { query = '', day = '', kind = '', savedOnly = false, saved = [], now = new Date() } = {}) {
  const terms = searchText(query).trim().split(/\s+/).filter(Boolean);
  return venues.filter((venue) => {
    if (savedOnly && !saved.includes(venue.id)) return false;
    const hh = !!venue.happy_hour && (day === '' || happyHourDays(venue).includes(Number(day)));
    const daily = venue.daily_specials.some((special) => dailySpecialOnDay(special, day, now));
    if (kind === 'happy-hour' ? !hh : kind === 'daily' ? !daily : !hh && !daily) return false;
    const haystack = searchText([venue.name, venue.address, venue.city, venue.category, venue.happy_hour?.days, venue.happy_hour?.time,
      ...(venue.happy_hour?.deals || []), ...venue.daily_specials.flatMap((s) => [s.day, s.special])].join(' '));
    return terms.every((term) => haystack.includes(term));
  });
}

export const directionsUrl = (venue) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${venue.name}, ${venue.address}`)}`;
export const safeUrl = (value) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } };
