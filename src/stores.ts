// Store discovery. Kroger stores come from the official Kroger Locations API when keys are
// configured; every other chain (and Kroger without keys) comes from OpenStreetMap via Nominatim.
// Searches cover 25 miles around the ZIP and are cached; the UI radius filters locally.
import { db } from './db.ts';
import { fetchJson, DAY } from './http.ts';
import { milesBetween, type Place } from './geo.ts';
import { hasKroger } from './config.ts';
import { findKrogerStores } from './sources/kroger.ts';
import { CHAINS, type ChainId, type ChainInfo, type Store } from './sources/types.ts';

const SEARCH_MILES = 25;
const CACHE_MS = 30 * DAY;

export type StoreWithDistance = Store & { distance: number };
export type StoreLookup = { stores: StoreWithDistance[]; errors: Partial<Record<ChainId, string>> };

async function osmStores(place: Place, chain: ChainInfo): Promise<Store[]> {
  const dLat = SEARCH_MILES / 69;
  const dLng = SEARCH_MILES / (69 * Math.cos((place.lat * Math.PI) / 180));
  const viewbox = [place.lng - dLng, place.lat + dLat, place.lng + dLng, place.lat - dLat].map((n) => n.toFixed(4)).join(',');
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(chain.osmName)}&format=jsonv2&limit=50&bounded=1&viewbox=${viewbox}&addressdetails=1`;
  const rows: any[] = await fetchJson(url, { ttlMs: CACHE_MS });
  const out: Store[] = [];
  for (const r of rows) {
    const name = r.name || '';
    if (!chain.osmMatch.test(name) || chain.osmExclude?.test(name)) continue;
    if (!['supermarket', 'department_store', 'grocery', 'general', 'wholesale', 'convenience'].includes(r.type)) continue;
    const a = r.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const city = a.city || a.town || a.village || a.suburb || '';
    out.push({
      id: `osm:${r.osm_type?.[0] ?? 'x'}${r.osm_id}`,
      chain: chain.id,
      name,
      address: [street, city, a.state === 'Texas' ? 'TX' : a.state, a.postcode].filter(Boolean).join(', '),
      lat: Number(r.lat),
      lng: Number(r.lon),
      source: 'openstreetmap',
    });
  }
  return out;
}

function saveStores(zip: string, chain: ChainId, stores: Store[]) {
  const now = Date.now();
  db.prepare('DELETE FROM zip_stores WHERE zip = ? AND chain = ?').run(zip, chain);
  const up = db.prepare('INSERT OR REPLACE INTO stores (id, chain, name, address, lat, lng, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const link = db.prepare('INSERT INTO zip_stores (zip, chain, store_id, searched_at) VALUES (?, ?, ?, ?)');
  if (!stores.length) link.run(zip, chain, null, now);
  for (const s of stores) {
    up.run(s.id, s.chain, s.name, s.address, s.lat, s.lng, s.source, now);
    link.run(zip, chain, s.id, now);
  }
}

function cachedStores(zip: string, chain: ChainId, wantSource: string): Store[] | undefined {
  const rows = db
    .prepare('SELECT zs.searched_at, s.* FROM zip_stores zs LEFT JOIN stores s ON s.id = zs.store_id WHERE zs.zip = ? AND zs.chain = ?')
    .all(zip, chain) as any[];
  if (!rows.length || Date.now() - rows[0].searched_at > CACHE_MS) return undefined;
  const stores = rows.filter((r) => r.id) as Store[];
  // Re-search Kroger if keys were added since the OSM-only lookup.
  if (stores.length && stores[0].source !== wantSource) return undefined;
  return stores;
}

export async function findStores(place: Place, radius: number): Promise<StoreLookup> {
  const all: Store[] = [];
  const errors: StoreLookup['errors'] = {};
  for (const chain of CHAINS) {
    const useApi = chain.id === 'kroger' && hasKroger();
    let stores = cachedStores(place.zip, chain.id, useApi ? 'kroger-api' : 'openstreetmap');
    if (!stores) {
      try {
        stores = useApi ? await findKrogerStores(place.zip, SEARCH_MILES) : await osmStores(place, chain);
        saveStores(place.zip, chain.id, stores);
      } catch (e: any) {
        errors[chain.id] = `Store lookup failed: ${e.message}`;
        stores = [];
      }
    }
    all.push(...stores);
  }
  const stores = all
    .map((s) => ({ ...s, distance: Math.round(milesBetween(place, s) * 10) / 10 }))
    .filter((s) => s.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
  return { stores, errors };
}
