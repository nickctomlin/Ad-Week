// Ingestion: pulls flyer deals (Flipp) for a ZIP and store-level prices (Kroger API) for the
// nearest Kroger stores, normalizes them, and stores them in SQLite.
// CLI:  npm run ingest -- 75024 75074      (add --force to ignore freshness)
import { db } from './db.ts';
import { config, hasKroger } from './config.ts';
import { geocodeZip } from './geo.ts';
import { findStores } from './stores.ts';
import { listFlyers, fetchFlyerDeals } from './sources/flipp.ts';
import { fetchKrogerPrices } from './sources/kroger.ts';
import { CHAINS, type ChainId, type Deal } from './sources/types.ts';
import { HOUR } from './http.ts';

export type Job = { zip: string; running: boolean; log: string[]; startedAt: number; finishedAt?: number; error?: string };
const jobs = new Map<string, Job>();
export const getJob = (zip: string) => jobs.get(zip);

const insertDeal = db.prepare(`INSERT OR REPLACE INTO deals
  (id, source, chain, store_id, zone, item_name, canonical, category, dept, sale_price, promo_text, regular_price, sold_by,
   pkg_qty, size_estimated, unit_price, unit_price_unit, limit_qty, is_sale, note, valid_from, valid_to, source_url,
   image_url, flyer_id, flyer_item_id, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function saveDeals(deals: Deal[]) {
  for (const d of deals) {
    insertDeal.run(d.id, d.source, d.chain, d.store_id, d.zone, d.item_name, d.canonical, d.category, d.dept, d.sale_price,
      d.promo_text, d.regular_price, d.sold_by, d.pkg_qty, d.size_estimated, d.unit_price, d.unit_price_unit, d.limit_qty,
      d.is_sale, d.note, d.valid_from, d.valid_to, d.source_url, d.image_url, d.flyer_id, d.flyer_item_id, d.fetched_at);
  }
}

function startRun(source: string, chain: string, scope: string, zip: string) {
  const r = db.prepare("INSERT INTO ingest_runs (source, chain, scope, zip, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')")
    .run(source, chain, scope, zip, Date.now());
  return Number(r.lastInsertRowid);
}
function endRun(id: number, status: string, message: string | null, count = 0, validTo: string | null = null) {
  db.prepare('UPDATE ingest_runs SET finished_at = ?, status = ?, message = ?, deal_count = ?, valid_to = ? WHERE id = ?')
    .run(Date.now(), status, message, count, validTo, id);
}

/** Latest finished run per (source, chain) for a ZIP. */
export function latestRuns(zip: string) {
  return db.prepare(`SELECT r.* FROM ingest_runs r
      JOIN (SELECT source, chain, scope, MAX(id) AS id FROM ingest_runs WHERE zip = ? AND status != 'running' GROUP BY source, chain, scope) m
      ON m.id = r.id ORDER BY r.chain, r.source`).all(zip) as any[];
}

export function isStale(zip: string): boolean {
  const runs = latestRuns(zip).filter((r) => r.source === 'flipp');
  if (!runs.length) return true;
  const oldest = Math.min(...runs.map((r) => r.finished_at));
  if (Date.now() - oldest > config.dealTtlHours * HOUR) return true;
  // A flyer expired since we last looked -> new week's ad is probably out.
  return runs.some((r) => r.valid_to && Date.parse(r.valid_to) < Date.now());
}

export function startIngest(zip: string, opts: { force?: boolean } = {}): Job {
  const existing = jobs.get(zip);
  if (existing?.running) return existing;
  const job: Job = { zip, running: true, log: [], startedAt: Date.now() };
  jobs.set(zip, job);
  ingestZip(zip, opts, (m) => job.log.push(m))
    .catch((e) => { job.error = e.message; job.log.push(`Error: ${e.message}`); })
    .finally(() => { job.running = false; job.finishedAt = Date.now(); });
  return job;
}

export async function ingestZip(zip: string, opts: { force?: boolean } = {}, log: (m: string) => void = console.log) {
  if (!opts.force && !isStale(zip)) { log(`${zip}: data is fresh, skipping (use --force to refresh)`); return; }
  const place = await geocodeZip(zip);
  log(`${zip}: ${place.city}, ${place.state}`);

  // 1) Weekly-ad flyers (all chains) for this ZIP.
  let flyers: Awaited<ReturnType<typeof listFlyers>> = [];
  let listed = false;
  try {
    flyers = await listFlyers(zip, { fresh: opts.force });
    listed = true;
    log(`Found ${flyers.length} current grocery flyers: ${flyers.map((f) => `${f.merchant} (${f.name})`).join(', ') || 'none'}`);
  } catch (e: any) {
    for (const c of CHAINS) { const id = startRun('flipp', c.id, zip, zip); endRun(id, 'error', `Flyer service unavailable: ${e.message}`); }
    log(`Flyer listing failed: ${e.message}`);
  }
  if (listed) {
    for (const chain of CHAINS) {
      const mine = flyers.filter((f) => f.chain === chain.id);
      const runId = startRun('flipp', chain.id, zip, zip);
      if (!mine.length) { endRun(runId, 'empty', `No current ${chain.name} weekly ad was found for ZIP ${zip}.`); continue; }
      try {
        const deals: Deal[] = [];
        for (const f of mine) deals.push(...(await fetchFlyerDeals(zip, f, log)));
        // Replace this chain's previous flyer deals for the zone atomically.
        db.exec('BEGIN');
        db.prepare("DELETE FROM deals WHERE source = 'flipp' AND zone = ? AND chain = ?").run(zip, chain.id);
        saveDeals(deals);
        db.exec('COMMIT');
        const validTo = mine.map((f) => f.valid_to).sort()[0];
        endRun(runId, deals.length ? 'ok' : 'empty', deals.length ? `${mine.length} flyer(s)` : 'Flyer had no matching grocery items.', deals.length, validTo);
        log(`${chain.name}: saved ${deals.length} normalized deals`);
      } catch (e: any) {
        try { db.exec('ROLLBACK'); } catch {}
        endRun(runId, 'error', e.message);
        log(`${chain.name}: flyer ingest failed: ${e.message}`);
      }
    }
  }

  // 2) Kroger store-level prices (official API) for the nearest Kroger stores.
  if (!hasKroger()) {
    const id = startRun('kroger-api', 'kroger', zip, zip);
    endRun(id, 'skipped', 'Kroger API keys not configured (KROGER_CLIENT_ID / KROGER_CLIENT_SECRET). Using Kroger weekly-ad flyer only.');
    return;
  }
  const { stores } = await findStores(place, 25);
  const krogers = stores.filter((s) => s.chain === 'kroger' && s.source === 'kroger-api').slice(0, config.krogerMaxStores);
  for (const s of krogers) {
    const runId = startRun('kroger-api', 'kroger', s.id, zip);
    try {
      const deals = await fetchKrogerPrices(s, log, { fresh: opts.force });
      db.exec('BEGIN');
      db.prepare("DELETE FROM deals WHERE source = 'kroger-api' AND store_id = ?").run(s.id);
      saveDeals(deals);
      db.exec('COMMIT');
      endRun(runId, deals.length ? 'ok' : 'empty', `${s.name}: ${deals.filter((d) => d.is_sale).length} on sale, ${deals.length} prices`, deals.length);
      log(`Kroger API ${s.name}: ${deals.length} prices (${deals.filter((d) => d.is_sale).length} on promo)`);
    } catch (e: any) {
      try { db.exec('ROLLBACK'); } catch {}
      endRun(runId, 'error', e.message);
      log(`Kroger API ${s.name}: ${e.message}`);
    }
  }
}

export function trackZip(zip: string) {
  db.prepare('INSERT OR REPLACE INTO tracked_zips (zip, last_requested) VALUES (?, ?)').run(zip, Date.now());
}

/** Scheduled refresh: re-ingest stale ZIPs that someone used in the last 14 days. */
export async function refreshTracked(log: (m: string) => void = console.log) {
  const zips = db.prepare('SELECT zip FROM tracked_zips WHERE last_requested > ?').all(Date.now() - 14 * 24 * HOUR) as { zip: string }[];
  for (const { zip } of zips) {
    if (isStale(zip) && !getJob(zip)?.running) {
      log(`[scheduler] refreshing ${zip}`);
      await ingestZip(zip, {}, (m) => log(`[scheduler] ${m}`)).catch((e) => log(`[scheduler] ${zip} failed: ${e.message}`));
    }
  }
}

// CLI entry
if (import.meta.main) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const zips = args.filter((a) => /^\d{5}$/.test(a));
  if (!zips.length) {
    console.log('Usage: npm run ingest -- <zip> [<zip> ...] [--force]');
    process.exit(1);
  }
  for (const z of zips) {
    trackZip(z);
    await ingestZip(z, { force }).catch((e) => console.error(`${z}: ${e.message}`));
  }
}
