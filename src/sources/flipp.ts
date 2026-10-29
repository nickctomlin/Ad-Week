// Weekly-ad flyers via Flipp's public consumer endpoints (the same data flipp.com and the
// retailers' own weekly-ad pages display). Unofficial: no SLA, may change without notice.
// One request lists flyers for a ZIP, one per flyer lists its items, and one per *matched*
// grocery item fetches details (unit text, regular price, purchase limit). Everything is cached.
import { fetchJson, DAY, HOUR } from '../http.ts';
import { matchAdName, parsePrice, parseLimit, round2 } from '../normalize.ts';
import { buildDeal, buildGenericDeal, type DealBase } from './deal.ts';
import { classifyDept, deptForCanonical } from '../departments.ts';
import { CHAINS, type ChainId, type Deal } from './types.ts';

const BASE = 'https://backflipp.wishabi.com/flipp';
const https = (u: string | null | undefined) => (u ? u.replace(/^http:\/\//, 'https://') : null);

export type FlyerMeta = {
  id: number; merchant: string; chain: ChainId; name: string; valid_from: string; valid_to: string;
  thumbnail: string | null; flippUrl: string;
};

const chainFor = (f: any) => CHAINS.find((c) => c.flippMerchant.toLowerCase() === String(f.merchant || '').trim().toLowerCase());
const isGroceryAd = (f: any) => !!chainFor(f) && String(f.categories_csv || '').includes('Groceries');

/**
 * Current grocery flyers for a ZIP. The list is cached for 6 hours, but the cached copy is discarded
 * as soon as any of our chains' ads in it has ended (that's when the next week's ad appears), and
 * `fresh` (Refresh deals / --force) always re-fetches it.
 */
export async function listFlyers(zip: string, opts: { fresh?: boolean } = {}): Promise<FlyerMeta[]> {
  const url = `${BASE}/flyers?locale=en-us&postal_code=${zip}`;
  let j = await fetchJson(url, { ttlMs: 6 * HOUR, refresh: opts.fresh });
  const now = Date.now();
  if (!opts.fresh && (j.flyers || []).some((f: any) => isGroceryAd(f) && Date.parse(f.valid_to) < now)) {
    j = await fetchJson(url, { ttlMs: 6 * HOUR, refresh: true });
  }
  const out: FlyerMeta[] = [];
  for (const f of j.flyers || []) {
    const chain = chainFor(f);
    if (!chain || !isGroceryAd(f)) continue;
    // Skip flyers that aren't in effect yet (e.g. next week's preview) or already ended.
    if (Date.parse(f.valid_from) > now || Date.parse(f.valid_to) < now) continue;
    out.push({
      id: f.id, merchant: f.merchant, chain: chain.id, name: f.name, valid_from: f.valid_from, valid_to: f.valid_to,
      thumbnail: https(f.thumbnail_url), flippUrl: `https://flipp.com/en-us/weekly_ad/${f.id}`,
    });
  }
  return out;
}

async function flyerJson(flyer: Pick<FlyerMeta, 'id' | 'valid_to'>) {
  const ttl = Math.max(HOUR, Date.parse(flyer.valid_to) - Date.now());
  return { j: await fetchJson(`${BASE}/flyers/${flyer.id}`, { ttlMs: ttl }), ttl };
}

export type FlyerItem = {
  id: number; name: string; price: string | null; image: string | null; page: number;
  canonical: string | null; flippUrl: string;
};

/** All items in a flyer, in reading order (page, then top-to-bottom, left-to-right). */
export async function getFlyerItems(flyer: FlyerMeta): Promise<{ pages: number; items: FlyerItem[] }> {
  const { j } = await flyerJson(flyer);
  const pages: { page: number; left: number; right: number }[] = (j.pages || []).map((p: any) => ({ page: p.page, left: p.left, right: p.right }));
  const pageOf = (x: number) => pages.find((p) => x >= p.left && x < p.right)?.page ?? 1;
  const items = (j.items || [])
    .filter((it: any) => it.name && it.cutout_image_url)
    .map((it: any) => ({
      id: it.id,
      name: it.name,
      price: it.price ? String(it.price) : null,
      image: https(it.cutout_image_url),
      page: pageOf((it.left + it.right) / 2),
      canonical: matchAdName(it.name)[0]?.canonical.key ?? null,
      flippUrl: `https://flipp.com/en-us/item/${it.id}`,
      _y: -it.top,
      _x: it.left,
    }))
    .sort((a: any, b: any) => a.page - b.page || a._y - b._y || a._x - b._x)
    .map(({ _x, _y, ...rest }: any) => rest as FlyerItem);
  return { pages: pages.length || 1, items };
}

/** Text describing a deal that has no single price ("Buy 2 Get 1 Free", "Save $3"). */
function promoText(d: any): string | null {
  const parts = [d.pre_price_text, d.price_text, d.sale_story].map((t: any) => String(t ?? '').trim()).filter(Boolean);
  if (d.dollars_off) parts.push(`$${d.dollars_off} off`);
  if (d.percent_off) parts.push(`${d.percent_off}% off`);
  return parts.length ? [...new Set(parts)].join(' · ') : null;
}

/**
 * Every grocery item in a flyer becomes a deal row: items that match a dinner ingredient get
 * planner-usable rows (one per ingredient), everything else (fruit, snacks, frozen, deli...) gets a
 * display-only row for the Deals tab. Non-grocery items and banner tiles are skipped.
 */
export async function fetchFlyerDeals(zip: string, flyer: FlyerMeta, onProgress?: (msg: string) => void): Promise<Deal[]> {
  const { j, ttl } = await flyerJson(flyer);
  const items: any[] = j.items || [];
  const candidates = items.filter((it) => it.name && (matchAdName(it.name).length || classifyDept(it.name)));
  onProgress?.(`${flyer.merchant} "${flyer.name}": ${items.length} items, ${candidates.length} grocery items`);

  const deals: Deal[] = [];
  let done = 0;
  for (const it of candidates) {
    if (++done % 40 === 0) onProgress?.(`${flyer.merchant}: read ${done} of ${candidates.length} grocery items`);
    let d: any;
    try {
      // Item details are immutable for the life of the flyer; cache by item id.
      d = (await fetchJson(`${BASE}/items/${it.id}`, { ttlMs: Math.max(ttl, 7 * DAY) })).item;
    } catch {
      continue; // one bad item shouldn't sink the flyer
    }
    if (!d) continue;
    const name: string = d.name || it.name;
    const price = parsePrice({ current_price: d.current_price ?? it.price, pre_price_text: d.pre_price_text, price_text: d.price_text, sale_story: d.sale_story });
    const promo = price ? null : promoText(d);
    if (!price && !promo) continue; // section headers and promo tiles carry neither
    const regular = price && d.original_price != null && Number(d.original_price) > price.price ? round2(Number(d.original_price) / (price.multiBuy || 1)) : null;
    const base: DealBase = {
      id: `flipp:${zip}:${it.id}`,
      source: 'flipp',
      chain: flyer.chain,
      store_id: null,
      zone: zip,
      item_name: name,
      sale_price: price?.price ?? null,
      promo_text: promo,
      regular_price: regular,
      sold_by: price?.soldBy ?? 'package',
      limit_qty: parseLimit(d.disclaimer_text, d.sale_story, d.price_text, d.description) ?? null,
      is_sale: 1, // everything in a weekly ad is an advertised price
      note: [price?.note, d.sale_story, d.disclaimer_text].filter(Boolean).join(' · ') || null,
      valid_from: d.valid_from || flyer.valid_from,
      valid_to: d.valid_to || flyer.valid_to,
      source_url: `https://flipp.com/en-us/item/${it.id}`,
      image_url: https(it.cutout_image_url), // the ad clipping itself, with the printed price
      flyer_id: flyer.id,
      flyer_item_id: it.id,
      fetched_at: Date.now(),
    };

    const matched = price ? matchAdName(name) : [];
    const dinner = matched
      .map(({ part, canonical }) => buildDeal({ ...base, id: `${base.id}:${canonical.key}`, sale_price: price!.price }, canonical, part + ' ' + (d.description || '')))
      .filter((x): x is Deal => !!x);
    if (dinner.length) deals.push(...dinner);
    else {
      // Display-only: not a dinner ingredient, or one advertised without a single price (e.g. BOGO).
      const can = matchAdName(name)[0]?.canonical;
      const sorted = classifyDept(name);
      const dept = sorted === 'other' && can ? deptForCanonical(can.key, can.category) : sorted;
      if (dept) deals.push(buildGenericDeal(base, dept, name + ' ' + (d.description || '')));
    }
  }
  return deals;
}
