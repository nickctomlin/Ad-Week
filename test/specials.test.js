import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { daysFromText, happyHourDays, chicagoWeekday, dailySpecialOnDay, filterSpecials, directionsUrl, safeUrl } from '../public/specials-model.js';

const data = JSON.parse(await readFile(new URL('../public/specials-data/plano-happy-hours.json', import.meta.url), 'utf8'));
test('expanded guide retains all 170 venues with distinct IDs and the supplied coordinates across six cities', () => {
  assert.equal(data.venues.length, 170);
  assert.equal(data.venue_count, data.venues.length);
  assert.equal(new Set(data.venues.map((v) => v.id)).size, data.venues.length);
  assert.deepEqual([...new Set(data.venues.map((v) => v.city))].sort(), ['Addison', 'Allen', 'Dallas', 'Frisco', 'Plano', 'Richardson']);
  for (const venue of data.venues) {
    assert.ok(venue.location.lat > 32.8 && venue.location.lat < 33.3, venue.name);
    assert.ok(venue.location.lng > -97 && venue.location.lng < -96.5, venue.name);
    assert.equal(venue.location.lat, venue.latitude, venue.name);
    assert.equal(venue.location.lng, venue.longitude, venue.name);
    assert.ok(venue.location.source);
  }
});
test('schedule filters cover abbreviated ranges, wraparound, nightly, and unknown schedules', () => {
  assert.deepEqual(daysFromText('Monday-Friday'), [1, 2, 3, 4, 5]);
  assert.deepEqual(daysFromText('Sunday–Wednesday'), [0, 1, 2, 3]);
  assert.deepEqual(daysFromText('Sat-Mon'), [0, 1, 6]);
  assert.deepEqual(daysFromText('Thursday, Sunday'), [0, 4]);
  assert.deepEqual(daysFromText('Weekdays'), [1, 2, 3, 4, 5]);
  assert.equal(daysFromText('Mon-Fri; nightly late night').length, 7);
  assert.deepEqual(daysFromText('Days not stated on official site'), []);
  assert.deepEqual(daysFromText('Daily (days not stated on specials page)'), []);
  assert.deepEqual(daysFromText('Days not stated on official site (closed Mondays)'), []);
  assert.ok(happyHourDays(data.venues.find((v) => v.name === "Truluck's")).includes(0));
});
test('dated specials apply to their published date and expire instead of repeating every week', () => {
  const special = data.venues.find((v) => v.name === 'Coco Beach Plano').daily_specials[0];
  assert.equal(special.on_date, '2026-11-16');
  assert.equal(dailySpecialOnDay(special, '1', new Date('2026-11-14T18:00:00Z')), true);
  assert.equal(dailySpecialOnDay(special, '2', new Date('2026-11-14T18:00:00Z')), false);
  assert.equal(dailySpecialOnDay(special, '', new Date('2026-11-17T18:00:00Z')), false);
  assert.equal(dailySpecialOnDay(special, '1', new Date('2026-11-23T18:00:00Z')), false);
  assert.equal(dailySpecialOnDay({ day: 'Monday', special: 'Weekly deal' }, '1'), true);
  const expiredVenue = { ...data.venues[0], happy_hour: null, daily_specials: [special] };
  assert.deepEqual(filterSpecials([expiredVenue], { now: new Date('2026-11-23T18:00:00Z') }), []);
});
test('today follows Plano time across UTC midnight', () => {
  assert.equal(chicagoWeekday(new Date('2026-11-15T02:00:00Z')), 6);
  assert.equal(chicagoWeekday(new Date('2026-11-15T07:00:00Z')), 0);
});
test('day, special type, search and saved filters combine and unknown hours are not invented', () => {
  const velvet = data.venues.find((v) => v.name === 'Velvet Taco');
  assert.deepEqual(filterSpecials(data.venues, { query: 'velvet chicken', day: '1', kind: 'daily' }), [velvet]);
  assert.deepEqual(filterSpecials(data.venues, { query: 'velvet', day: '2' }), []);
  assert.deepEqual(filterSpecials(data.venues, { query: 'Taqueria Los Angeles', day: '1' }), []);
  assert.equal(filterSpecials(data.venues, { query: 'Taqueria Los Angeles' }).length, 1);
  assert.deepEqual(filterSpecials(data.venues, { savedOnly: true, saved: [velvet.id] }), [velvet]);
  assert.deepEqual(filterSpecials(data.venues, { savedOnly: true }), []);
  assert.equal(filterSpecials(data.venues, { kind: 'happy-hour' }).length, data.venues.filter((v) => v.happy_hour).length);
  assert.equal(filterSpecials(data.venues, { query: 'fogo chao' }).length, 2);
  assert.equal(filterSpecials(data.venues, { query: 'Trulucks' }).length, 1);
  assert.ok(filterSpecials(data.venues, { query: 'Richardson' }).some((v) => v.city === 'Richardson'));
});
test('source URLs are restricted to HTTP and directions use the full supplied address', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('data:text/html,hello'), '#');
  const venue = data.venues[0];
  const url = new URL(directionsUrl(venue));
  assert.equal(url.searchParams.get('destination'), `${venue.name}, ${venue.address}`);
});
