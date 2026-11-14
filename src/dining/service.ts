import { db } from '../db.ts';
import { config } from '../config.ts';
import { milesBetween, type Place } from '../geo.ts';
import { DAY, HOUR, mapPool } from '../http.ts';
import { DINING_BRANDS, DINING_SOURCES, diningBrand, type DiningSource } from './catalog.ts';
import { diningDay, parseDiningOffers, type DiningOffer } from './parse.ts';

type SourceState = { id: string; brand: string; label: string; url: string; status: 'ok' | 'empty' | 'blocked' | 'error'; checkedAt: number; successAt: number | null; error: string | null; offers: DiningOffer[]; parserVersion: number };
export type Restaurant = { id: string; name: string; brand: string | null; category: string; cuisine: string; address: string; lat: number; lng: number; distance: number; website: string | null; phone: string | null; hours: string | null; mapsUrl: string };
type PlacesState = { restaurants: Restaurant[]; checkedAt: number; successAt: number | null; error: string | null };
type Job = { running: boolean; startedAt: number; finishedAt?: number };
const sourceJobs = new Map<string, Promise<void>>();
const PARSER_VERSION = 3;
const jobs = new Map<string, Job>();
let placeQueue: Promise<unknown> = Promise.resolve();

function read<T>(key: string): T | null {
  const row = db.prepare('SELECT body FROM dining_cache WHERE key = ?').get(key) as { body: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.body); } catch { return null; }
}
function write(key: string, value: unknown) {
  db.prepare('INSERT OR REPLACE INTO dining_cache (key, body) VALUES (?, ?)').run(key, JSON.stringify(value));
}
export function safeDiningUrl(value: string | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export function restaurantsFromOSM(elements: any[], place: Pick<Place, 'lat' | 'lng'>, radius: number): Restaurant[] {
  const found = new Map<string, Restaurant>();
  for (const element of elements) {
    const tags = element.tags || {}, lat = Number(element.lat ?? element.center?.lat), lng = Number(element.lon ?? element.center?.lon);
    if (!tags.name || !Number.isFinite(lat) || !Number.isFinite(lng) || !['fast_food', 'restaurant', 'cafe', 'ice_cream'].includes(tags.amenity)) continue;
    if (['no', 'private'].includes(tags.access) || tags.disused === 'yes' || tags['disused:amenity']) continue;
    const exactDistance = milesBetween(place, { lat, lng });
    if (exactDistance > radius) continue;
    const brand = diningBrand(`${tags.brand || ''} ${tags.name}`);
    const address = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    const fullAddress = [address, tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', ');
    const normalized = `${tags.name.toLowerCase().replace(/\W/g, '')}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
    const restaurant: Restaurant = { id: `osm:${element.type}:${element.id}`, name: tags.name, brand: brand?.id || null,
      category: tags.amenity === 'fast_food' ? 'fast-food' : tags.amenity === 'restaurant' ? 'restaurant' : 'cafe',
      cuisine: String(tags.cuisine || '').replaceAll(';', ' · ').replaceAll('_', ' '), address: fullAddress,
      lat, lng, distance: Math.round(exactDistance * 10) / 10,
      website: safeDiningUrl(tags.website || tags['contact:website']) || brand?.url || null,
      phone: tags.phone || tags['contact:phone'] || null, hours: tags.opening_hours || null,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${tags.name} ${fullAddress || `${lat},${lng}`}`)}` };
    const prior = found.get(normalized);
    if (!prior || restaurant.address.length > prior.address.length) found.set(normalized, restaurant);
  }
  return [...found.values()].sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': config.userAgent, Accept: 'text/html' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Object.assign(new Error(`Official page returned HTTP ${response.status}.`), { status: response.status });
  const html = await response.text();
  if (html.length > 3_000_000 || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Unexpected response from the official offers page.');
  return html;
}
async function refreshSource(source: DiningSource, force: boolean) {
  const saved = read<SourceState>(`source:${source.id}`);
  const ttl = saved?.status === 'error' || saved?.status === 'blocked' ? HOUR : 6 * HOUR;
  // Even manual refresh respects a short cooldown, and blocked pages are never repeatedly retried.
  if (saved?.parserVersion === PARSER_VERSION && Date.now() - saved.checkedAt < (force ? 15 * 60_000 : ttl)) return;
  const existing = sourceJobs.get(source.id);
  if (existing) return existing;
  const task = (async () => {
    const checkedAt = Date.now();
    try {
      const offers = parseDiningOffers(await page(source.url), source, checkedAt);
      if (!offers.length && saved?.offers.length) throw new Error('No offers could be read. The page may have changed; previous offers need rechecking.');
      write(`source:${source.id}`, { ...source, status: offers.length ? 'ok' : 'empty', checkedAt, successAt: checkedAt, error: null, offers, parserVersion: PARSER_VERSION } satisfies SourceState);
    } catch (error: any) {
      write(`source:${source.id}`, { id: source.id, brand: source.brand, label: source.label, url: source.url,
        status: [401, 403].includes(error.status) ? 'blocked' : 'error', checkedAt, successAt: saved?.successAt || null,
        error: [401, 403].includes(error.status) ? 'This site does not allow automatic imports. Open its official page to check offers.' : error.message,
        offers: saved?.offers || [], parserVersion: PARSER_VERSION } satisfies SourceState);
    }
  })();
  sourceJobs.set(source.id, task);
  try { await task; } finally { sourceJobs.delete(source.id); }
}

async function refreshPlaces(place: Place, radius: number) {
  const key = `places:${place.zip}:${radius}`, saved = read<PlacesState>(key);
  const ttl = saved?.error ? HOUR : 7 * DAY;
  if (saved && Date.now() - saved.checkedAt < ttl) return;
  // Queries run one at a time and a successful area result is reused for a week.
  const task = placeQueue.catch(() => {}).then(async () => {
    const checkedAt = Date.now();
    try {
      const dLat = radius / 69, dLng = radius / (69 * Math.cos(place.lat * Math.PI / 180));
      const bbox = [place.lat - dLat, place.lng - dLng, place.lat + dLat, place.lng + dLng].map((n) => n.toFixed(5)).join(',');
      const query = `[out:json][timeout:20];nwr["amenity"~"^(fast_food|restaurant|cafe|ice_cream)$"](${bbox});out center tags;`;
      const url = new URL(config.diningOverpassUrl);
      url.searchParams.set('data', query);
      const response = await fetch(url, { headers: { 'User-Agent': config.userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error(`Restaurant map service returned HTTP ${response.status}.`);
      const body = await response.json() as { elements?: unknown[]; remark?: string };
      if (!Array.isArray(body.elements) || body.remark) throw new Error('Restaurant map service could not complete the area search.');
      write(key, { restaurants: restaurantsFromOSM(body.elements, place, radius), checkedAt, successAt: checkedAt, error: null } satisfies PlacesState);
    } catch (error: any) {
      write(key, { restaurants: saved?.restaurants || [], checkedAt, successAt: saved?.successAt || null, error: error.message } satisfies PlacesState);
    }
  });
  placeQueue = task;
  await task;
}

export function startDiningRefresh(place: Place, radius: number, force = false) {
  const key = `${place.zip}:${radius}`;
  if (jobs.get(key)?.running) return;
  const sources = DINING_SOURCES.map((source) => read<SourceState>(`source:${source.id}`));
  const places = read<PlacesState>(`places:${key}`);
  const needsRefresh = force || sources.some((s) => !s || s.parserVersion !== PARSER_VERSION || Date.now() - s.checkedAt >= (s.status === 'error' || s.status === 'blocked' ? HOUR : 6 * HOUR))
    || !places || Date.now() - places.checkedAt >= (places.error ? HOUR : 7 * DAY);
  if (!needsRefresh) return;
  const job: Job = { running: true, startedAt: Date.now() };
  jobs.set(key, job);
  Promise.all([mapPool(DINING_SOURCES, 3, (source) => refreshSource(source, force)), refreshPlaces(place, radius)])
    .catch((error) => console.error('Restaurant refresh:', error.message))
    .finally(() => { job.running = false; job.finishedAt = Date.now(); });
}

export function diningSnapshot(place: Place, radius: number) {
  const today = diningDay();
  const places = read<PlacesState>(`places:${place.zip}:${radius}`);
  const sources = DINING_SOURCES.map((source) => {
    const saved = read<SourceState>(`source:${source.id}`);
    return saved || { ...source, status: 'pending', checkedAt: null, successAt: null, error: null, offers: [] };
  });
  const offers = sources.flatMap((source) => source.offers.filter((offer) => (!offer.validTo || offer.validTo >= today) && Date.now() - offer.checkedAt < 7 * DAY)
    .map((offer) => ({ ...offer, stale: source.status !== 'ok' || Date.now() - offer.checkedAt > DAY })));
  return { place, radius, today, offers, restaurants: places?.restaurants || [],
    location: { status: places?.error ? places.successAt ? 'stale' : 'error' : places?.successAt ? 'ok' : 'pending', checkedAt: places?.successAt || null, error: places?.error || null },
    sources: sources.map(({ offers, ...source }) => ({ ...source, offerCount: offers.filter((o) => !o.validTo || o.validTo >= today).length })),
    brands: DINING_BRANDS.map(({ match, ...brand }) => brand), job: jobs.get(`${place.zip}:${radius}`) || null };
}
