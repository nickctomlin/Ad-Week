// Geocode a guide once at import time; browsers never call geocoding APIs.
// Usage: node scripts/geocode-specials.mjs [path/to/new-guide.json]
// Existing pins are retained. Run with network access; review unresolved matches.
import { readFile, writeFile } from 'node:fs/promises';
const destination = new URL('../public/specials-data/plano-happy-hours.json', import.meta.url);
const data = JSON.parse(await readFile(process.argv[2] || destination, 'utf8'));
if (!Array.isArray(data.venues)) throw new Error('Expected a guide with a venues array.');
const previous = JSON.parse(await readFile(destination, 'utf8').catch((error) => { if (error.code === 'ENOENT') return '{"venues":[]}'; throw error; }));
const savedIds = new Map(previous.venues.map((venue) => [venue.name, venue.id]));
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const streetFor = (venue) => venue.address.split(',')[0].replace(/\s+(?:Suite|Ste|#|2nd Floor).*$/i, '');
const inDfw = (lat, lng) => lat > 32 && lat < 34 && lng > -98 && lng < -95.5;
for (const venue of data.venues) {
  if (!venue.name || !venue.address || !Array.isArray(venue.daily_specials) || venue.happy_hour && !Array.isArray(venue.happy_hour.deals)) throw new Error(`Invalid restaurant record: ${venue.name || '(unnamed)'}`);
  venue.id = savedIds.get(venue.name) || venue.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  venue.city ||= venue.address.match(/,\s*([^,]+),\s*TX\b/)?.[1] || 'Plano';
  if (venue.latitude != null || venue.longitude != null) {
    if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude) || !inDfw(venue.latitude, venue.longitude)) throw new Error(`Invalid DFW coordinates: ${venue.name}`);
    venue.location = { lat: venue.latitude, lng: venue.longitude, source: 'Provided guide', precision: 'Provided coordinates', matched_address: venue.address };
  }
  for (const special of venue.daily_specials) {
    const namedDate = special.day.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
    if (!namedDate) continue;
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(namedDate[1].toLowerCase()) + 1;
    const year = Number(namedDate[3] || data.generated_date?.slice(0, 4));
    const value = `${year}-${String(month).padStart(2, '0')}-${namedDate[2].padStart(2, '0')}`;
    if (!Number.isInteger(year) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error(`Invalid special date: ${venue.name} / ${special.day}`);
    special.on_date = value;
  }
}
if (new Set(data.venues.map((venue) => venue.id)).size !== data.venues.length) throw new Error('Restaurant IDs must be unique.');
data.venue_count = data.venues.length;
const missing = data.venues.map((venue, id) => ({ venue, id })).filter(({ venue }) => !venue.location);
if (missing.length) {
  const csv = missing.map(({ venue, id }) => [id, streetFor(venue), venue.city, 'TX', venue.address.match(/\b75\d{3}\b/)?.[0] || ''].map(quote).join(',')).join('\n');
  const form = new FormData();
  form.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'addresses.csv');
  form.append('benchmark', '4');
  const response = await fetch('https://geocoding.geo.census.gov/geocoder/locations/addressbatch', { method: 'POST', body: form, signal: AbortSignal.timeout(110000) });
  if (!response.ok) throw new Error(`Census geocoder: HTTP ${response.status}`);
  const rows = (await response.text()).trim().split(/\r?\n/).map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replaceAll('""', '"')));
  for (const row of rows) {
    if (row[2] !== 'Match') continue;
    const [lng, lat] = row[5].split(',').map(Number);
    if (inDfw(lat, lng)) data.venues[Number(row[0])].location = { lat, lng, source: 'US Census Geocoder', precision: 'Address-range estimate', matched_address: row[4] };
  }
}
for (const venue of data.venues.filter((v) => !v.location)) {
  for (const params of [{ street: streetFor(venue), city: venue.city, state: 'Texas', country: 'USA' }, { q: `${venue.name} ${venue.city} Texas` }]) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({ ...params, format: 'jsonv2', limit: '3' });
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'AdWeek/0.1 (personal Plano restaurant map; one-time address import)' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const match = (await response.json()).find((m) => m.category !== 'highway' && inDfw(Number(m.lat), Number(m.lon)));
      if (match) venue.location = { lat: Number(match.lat), lng: Number(match.lon), source: 'OpenStreetMap / Nominatim', precision: 'Mapped venue or address', matched_address: match.display_name };
    } catch (error) { console.log(venue.name, error.message); }
    await new Promise((resolve) => setTimeout(resolve, 1100));
    if (venue.location) break;
  }
  console.log(venue.name, venue.location ? 'located' : 'UNRESOLVED');
}
await writeFile(destination, JSON.stringify(data, null, 2) + '\n');
console.log(`${data.venues.filter((v) => v.location).length}/${data.venues.length} locations imported. Review matched_address before publishing.`);
