// HTTP server: JSON API + static frontend + scheduled refresh. Start: npm start
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { config, hasKroger, hasAnthropic } from './config.ts';
import { db } from './db.ts';
import { geocodeZip, UserError } from './geo.ts';
import { findStores } from './stores.ts';
import { startIngest, getJob, isStale, trackZip, refreshTracked } from './ingest.ts';
import { buildOffers, chainStatuses, dealsForDisplay, makePlan } from './api.ts';
import { HOUR } from './http.ts';
import { listFlyers, getFlyerItems, type FlyerItem } from './sources/flipp.ts';
import { CHAINS, CHAIN_BY_ID } from './sources/types.ts';
import { DEPARTMENTS } from './departments.ts';

const PUBLIC = join(config.root, 'public');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const RADII = [5, 10, 15, 25];

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  let s = '';
  for await (const chunk of req) s += chunk;
  try { return s ? JSON.parse(s) : {}; } catch { throw new UserError('Request body must be JSON.'); }
}

function parseRadius(v: string | null) {
  const r = Number(v || 10);
  if (!RADII.includes(r)) throw new UserError(`Radius must be one of ${RADII.join(', ')} miles.`);
  return r;
}

/** Resolve ZIP -> place + nearby stores (optionally restricted to selected ids). */
async function context(zip: string, radius: number, storeIds?: string[]) {
  const place = await geocodeZip(zip);
  const lookup = await findStores(place, radius);
  const selected = storeIds?.length ? lookup.stores.filter((s) => storeIds.includes(s.id)) : lookup.stores;
  return { place, lookup, selected };
}

function jobView(zip: string) {
  const j = getJob(zip);
  return j ? { running: j.running, log: j.log.slice(-6), error: j.error ?? null, startedAt: j.startedAt, finishedAt: j.finishedAt ?? null } : null;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const zip = url.searchParams.get('zip') || '';
  switch (`${req.method} ${url.pathname}`) {
    case 'GET /api/list': {
      const row = db.prepare("SELECT body, updated_at FROM lists WHERE id = 'default'").get() as { body: string; updated_at: number } | undefined;
      return send(res, 200, { items: row ? JSON.parse(row.body) : [], updatedAt: row?.updated_at ?? null });
    }

    case 'PUT /api/list': {
      const body = await readBody(req);
      if (!Array.isArray(body.items) || body.items.length > 1000) throw new UserError('List must be an array of up to 1000 items.');
      const json = JSON.stringify(body.items);
      if (json.length > 2_000_000) throw new UserError('List is too large to save.');
      const now = Date.now();
      db.prepare("INSERT OR REPLACE INTO lists (id, body, updated_at) VALUES ('default', ?, ?)").run(json, now);
      return send(res, 200, { updatedAt: now });
    }

    case 'GET /api/config':
      return send(res, 200, { kroger: hasKroger(), anthropic: hasAnthropic(), model: hasAnthropic() ? config.anthropicModel : null, radii: RADII });

    case 'GET /api/stores': {
      const radius = parseRadius(url.searchParams.get('radius'));
      const { place, lookup } = await context(zip, radius);
      trackZip(zip);
      if (isStale(zip)) startIngest(zip);
      if (!lookup.stores.length) {
        throw new UserError(`No ${CHAINS.map((c) => c.name).join(', ')} stores were found within ${radius} miles of ${zip}. Try a larger radius.`, 404);
      }
      return send(res, 200, { place, radius, stores: lookup.stores, chains: chainStatuses(zip, lookup.stores, lookup.errors), job: jobView(zip) });
    }

    case 'GET /api/status': {
      const radius = parseRadius(url.searchParams.get('radius'));
      const { lookup } = await context(zip, radius);
      return send(res, 200, { chains: chainStatuses(zip, lookup.stores, lookup.errors), job: jobView(zip) });
    }

    case 'POST /api/refresh': {
      await geocodeZip(zip);
      startIngest(zip, { force: true });
      return send(res, 202, { job: jobView(zip) });
    }

    case 'GET /api/deals': {
      const radius = parseRadius(url.searchParams.get('radius'));
      const ids = (url.searchParams.get('stores') || '').split(',').filter(Boolean);
      const { selected } = await context(zip, radius, ids);
      return send(res, 200, { deals: dealsForDisplay(zip, selected), departments: DEPARTMENTS });
    }

    case 'GET /api/flyers': {
      await geocodeZip(zip);
      let flyers;
      try {
        flyers = await listFlyers(zip);
      } catch (e: any) {
        throw new UserError(`The weekly-ad service is unavailable right now (${e.message}). Try again shortly.`, 503);
      }
      const out = [];
      for (const f of flyers) {
        const chain = CHAIN_BY_ID.get(f.chain)!;
        const { items } = await getFlyerItems(f).catch(() => ({ items: [] as FlyerItem[] }));
        out.push({ ...f, chainName: chain.name, color: chain.color, weeklyAdUrl: chain.weeklyAdUrl, itemCount: items.length, groceryCount: items.filter((i) => i.canonical).length });
      }
      return send(res, 200, { flyers: out });
    }

    case 'GET /api/flyer': {
      const id = Number(url.searchParams.get('id'));
      await geocodeZip(zip);
      // Only flyers that are current for this ZIP can be opened (no arbitrary proxying).
      const flyer = (await listFlyers(zip)).find((f) => f.id === id);
      if (!flyer) throw new UserError('That flyer is no longer current for this ZIP. Reload the Flyers tab.', 404);
      const chain = CHAIN_BY_ID.get(flyer.chain)!;
      const { pages, items } = await getFlyerItems(flyer);
      return send(res, 200, { flyer: { ...flyer, chainName: chain.name, color: chain.color, weeklyAdUrl: chain.weeklyAdUrl }, pages, items });
    }

    case 'POST /api/plan': {
      const body = await readBody(req);
      const radius = parseRadius(String(body.radius ?? 10));
      if (getJob(body.zip)?.running) throw new UserError("Still loading this week's deals for this ZIP. Try again in a few seconds.", 409);
      const { selected } = await context(String(body.zip || ''), radius, body.stores);
      if (!selected.length) throw new UserError('Select at least one store.');
      const plan = await makePlan(buildOffers(body.zip, selected), {
        budget: Number(body.budget), people: Number(body.people), dinners: Number(body.dinners),
        diet: body.diet === 'vegetarian' ? 'vegetarian' : 'anything',
        mode: body.mode === 'variety' ? 'variety' : 'prep',
        seed: body.seed != null ? Number(body.seed) : undefined,
        planIds: body.planIds, swapIndex: body.swapIndex != null ? Number(body.swapIndex) : undefined, rejected: body.rejected,
      });
      return send(res, 200, plan);
    }
  }
  send(res, 404, { error: 'Not found' });
}

async function serveStatic(res: ServerResponse, pathname: string) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(res, url.pathname);
  } catch (e: any) {
    if (e instanceof UserError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: `Something went wrong on the server: ${e.message}` });
  }
});

server.listen(config.port, () => {
  console.log(`Ad Week running at http://localhost:${config.port}`);
  console.log(`Kroger API: ${hasKroger() ? 'configured' : 'not configured (flyer data only)'} · Claude recipes: ${hasAnthropic() ? config.anthropicModel : 'not configured (built-in recipes)'}`);
});

// Scheduled ingestion: every 6 hours, refresh any recently used ZIP whose data is stale.
setTimeout(() => refreshTracked(), 10_000);
setInterval(() => refreshTracked(), 6 * HOUR);
