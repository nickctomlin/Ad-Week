// Official Kroger Developer API (https://developer.kroger.com).
// OAuth2 client credentials -> /v1/locations (stores near a ZIP) and
// /v1/products?filter.locationId= (store-level regular + promo prices).
import { config } from '../config.ts';
import { fetchJson, HttpError, DAY, HOUR } from '../http.ts';
import { CANONICALS, matchCanonical, parseLimit, round2 } from '../normalize.ts';
import { buildDeal } from './deal.ts';
import type { Deal, Store } from './types.ts';

const API = 'https://api.kroger.com/v1';
let token: { value: string; expires: number } | undefined;

async function getToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const basic = Buffer.from(`${config.krogerClientId}:${config.krogerClientSecret}`).toString('base64');
  try {
    const j = await fetchJson(`${API}/connect/oauth2/token`, {
      init: {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=product.compact',
      },
      retries: 1,
    });
    token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
    return token.value;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 400)) {
      throw new Error('Kroger API rejected the credentials. Check KROGER_CLIENT_ID / KROGER_CLIENT_SECRET in .env (Production app, scope product.compact).');
    }
    throw e;
  }
}

async function kget(path: string, ttlMs: number, refresh = false) {
  const t = await getToken();
  return fetchJson(`${API}${path}`, { ttlMs, refresh, cacheKey: `kroger:${path}`, init: { headers: { Authorization: `Bearer ${t}` } } });
}

export async function findKrogerStores(zip: string, radiusMiles = 25): Promise<Store[]> {
  const j = await kget(`/locations?filter.zipCode.near=${zip}&filter.radiusInMiles=${radiusMiles}&filter.limit=50&filter.chain=KROGER`, 30 * DAY);
  return (j.data || []).map((l: any) => ({
    id: `kroger:${l.locationId}`,
    chain: 'kroger' as const,
    name: l.name || 'Kroger',
    address: [l.address?.addressLine1, l.address?.city, l.address?.state, l.address?.zipCode].filter(Boolean).join(', '),
    lat: l.geolocation?.latitude,
    lng: l.geolocation?.longitude,
    source: 'kroger-api',
  }));
}

function productImage(p: any): string | null {
  const imgs: any[] = p.images || [];
  const front = imgs.find((i) => i.perspective === 'front') ?? imgs[0];
  const sizes: any[] = front?.sizes || [];
  return (sizes.find((s) => s.size === 'medium') ?? sizes.find((s) => s.size === 'large') ?? sizes[0])?.url ?? null;
}

/** Price every canonical ingredient at one store. Returns sale *and* regular-price rows. */
export async function fetchKrogerPrices(store: Store, onProgress?: (msg: string) => void, opts: { fresh?: boolean } = {}): Promise<Deal[]> {
  const locationId = store.id.replace(/^kroger:/, '');
  const out: Deal[] = [];
  let done = 0;
  for (const can of CANONICALS) {
    const term = encodeURIComponent(can.search);
    const j = await kget(`/products?filter.term=${term}&filter.locationId=${locationId}&filter.limit=25`, 12 * HOUR, opts.fresh);
    for (const p of j.data || []) {
      // Descriptions usually already start with the brand ("Kroger® Ground Pork"); don't repeat it.
      const desc = String(p.description || '');
      const name = p.brand && !desc.toLowerCase().startsWith(String(p.brand).toLowerCase()) ? `${p.brand} ${desc}` : desc;
      if (matchCanonical(p.description || '')?.key !== can.key) continue;
      for (const item of p.items || []) {
        const regular = Number(item.price?.regular) || 0;
        const promo = Number(item.price?.promo) || 0;
        if (!regular && !promo) continue; // no price at this store
        const onSale = promo > 0 && (!regular || promo < regular);
        const price = onSale ? promo : regular;
        const deal = buildDeal(
          {
            id: `kroger:${locationId}:${item.itemId || p.productId}:${can.key}`,
            source: 'kroger-api',
            chain: 'kroger',
            store_id: store.id,
            zone: null,
            item_name: `${name}${item.size ? ` (${item.size})` : ''}`,
            sale_price: round2(price),
            promo_text: null,
            regular_price: regular ? round2(regular) : null,
            sold_by: item.soldBy === 'WEIGHT' ? 'weight' : 'package',
            limit_qty: parseLimit(desc) ?? null, // no API field, but descriptions say e.g. "(limit 2 At Sale Price)"
            is_sale: onSale ? 1 : 0,
            note: onSale ? null : 'regular shelf price',
            valid_from: null,
            valid_to: null, // promo end dates are not exposed by the public Products API
            source_url: `https://www.kroger.com/p/${p.productId}`,
            image_url: productImage(p),
            flyer_id: null,
            flyer_item_id: null,
            fetched_at: Date.now(),
          },
          can,
          item.size || '',
        );
        if (deal) out.push(deal);
      }
    }
    if (++done % 10 === 0) onProgress?.(`${store.name}: priced ${done}/${CANONICALS.length} ingredients`);
  }
  return out;
}
