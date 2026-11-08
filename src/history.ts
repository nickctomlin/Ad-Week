// Price history: one price per item per ad week, so the app can say "lowest in 8 weeks" and judge a
// sale against the item's own usual price. Deals are replaced every refresh; history is kept.
import { db } from './db.ts';
import { HOUR } from './http.ts';
import { matchAdName, parsePrice } from './normalize.ts';
import { classifyDept } from './departments.ts';
import { CHAINS, type Deal } from './sources/types.ts';

/** Strip sizes, symbols and punctuation so the same ad item matches from week to week. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/\(?\b\d+(\.\d+)?\s*-?\s*(\d+(\.\d+)?\s*)?(fl\.? ?oz|oz|lbs?|ct|count|pk|pack|gal|liter|l|ml)\b\.?\)?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Identifies the same item across weeks: Kroger's own product id, or chain + normalized ad name. */
export function historyKey(d: Pick<Deal, 'source' | 'chain' | 'item_name' | 'id'>): string {
  if (d.source === 'kroger-api') {
    // id = kroger:<locationId>:<itemId>:<canonical>; the item id is stable week to week.
    const itemId = d.id.split(':')[2];
    return `kapi:${itemId}`;
  }
  return `${d.chain}:${normalizeName(d.item_name)}`;
}

/** The Wednesday (local date, YYYY-MM-DD) that starts the ad week containing `date`. */
export function adWeek(date: Date | string): string {
  // Ad dates are stamped in the store's timezone; take the calendar date as written.
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T12:00:00`) : new Date(date);
  const back = (d.getDay() - 3 + 7) % 7; // 3 = Wednesday
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const upsert = db.prepare(`INSERT INTO price_history (week, item_key, chain, item_name, canonical, price, regular_price, unit_price, unit, is_sale)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(week, item_key) DO UPDATE SET
    price = min(price, excluded.price),
    regular_price = coalesce(excluded.regular_price, regular_price),
    unit_price = coalesce(min(unit_price, excluded.unit_price), unit_price, excluded.unit_price),
    is_sale = max(is_sale, excluded.is_sale)`);

/** Record this refresh's prices. Flyer deals count toward their ad's week; shelf prices toward this week. */
export function recordHistory(deals: Deal[]) {
  const thisWeek = adWeek(new Date());
  db.exec('BEGIN');
  try {
    for (const d of deals) {
      if (d.sale_price == null) continue; // coupon-only deals have no comparable price
      upsert.run(d.valid_from ? adWeek(d.valid_from) : thisWeek, historyKey(d), d.chain, d.item_name, d.canonical,
        d.sale_price, d.regular_price, d.unit_price, d.unit_price_unit, d.is_sale);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Past prices for these items over the last `weeks` ad weeks: key -> [[week, price], ...] oldest first. */
export function historyFor(keys: string[], weeks = 12): Map<string, [string, number][]> {
  const since = adWeek(new Date(Date.now() - weeks * 7 * 24 * HOUR));
  const wanted = new Set(keys);
  const out = new Map<string, [string, number][]>();
  const rows = db.prepare('SELECT item_key, week, price FROM price_history WHERE week >= ? ORDER BY week').all(since) as { item_key: string; week: string; price: number }[];
  for (const r of rows) {
    if (!wanted.has(r.item_key)) continue;
    if (!out.has(r.item_key)) out.set(r.item_key, []);
    out.get(r.item_key)!.push([r.week, r.price]);
  }
  return out;
}

/**
 * One-time head start: earlier weeks' flyer items are still in the HTTP cache (item details are cached
 * by id), so record their prices too. Runs only while the history table is empty.
 */
export function seedHistoryFromCache(): number {
  const has = db.prepare('SELECT 1 FROM price_history LIMIT 1').get();
  if (has) return 0;
  const rows = db.prepare("SELECT body FROM http_cache WHERE key LIKE 'https://backflipp.wishabi.com/flipp/items/%'").all() as { body: string }[];
  const deals: Deal[] = [];
  for (const { body } of rows) {
    let it: any;
    try { it = JSON.parse(body).item; } catch { continue; }
    const chain = CHAINS.find((c) => c.flippMerchant.toLowerCase() === String(it?.merchant || '').trim().toLowerCase());
    if (!chain || !it.name || !it.valid_from) continue;
    if (!matchAdName(it.name).length && !classifyDept(it.name)) continue; // groceries only
    const price = parsePrice({ current_price: it.current_price, pre_price_text: it.pre_price_text, price_text: it.price_text, sale_story: it.sale_story });
    if (!price) continue;
    deals.push({
      id: `flipp:seed:${it.id}`, source: 'flipp', chain: chain.id, store_id: null, zone: null, item_name: it.name,
      canonical: matchAdName(it.name)[0]?.canonical.key ?? null, category: 'other', dept: 'other',
      sale_price: price.price, promo_text: null, regular_price: null, sold_by: price.soldBy, pkg_qty: null,
      size_estimated: 0, unit_price: null, unit_price_unit: null, limit_qty: null, is_sale: 1, note: null,
      valid_from: it.valid_from, valid_to: it.valid_to, source_url: null, image_url: null, flyer_id: it.flyer_id ?? null,
      flyer_item_id: it.id, fetched_at: Date.now(),
    });
  }
  // Plus this week's Kroger shelf prices, which were pulled before history existed.
  deals.push(...(db.prepare("SELECT * FROM deals WHERE source = 'kroger-api'").all() as Deal[]));
  if (deals.length) recordHistory(deals);
  return deals.length;
}
