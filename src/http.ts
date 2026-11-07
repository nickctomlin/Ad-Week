// Polite HTTP: a per-host cap on concurrent requests plus a minimum gap between request starts,
// retries with backoff, and a SQLite response cache so repeat runs don't re-hit sources.
import { db } from './db.ts';
import { config } from './config.ts';

// max = requests in flight at once; gapMs = minimum time between request starts (sets the max rate).
const LIMITS: Record<string, { max: number; gapMs: number }> = {
  'nominatim.openstreetmap.org': { max: 1, gapMs: 1100 }, // Nominatim policy: max 1 req/s
  'backflipp.wishabi.com': { max: 4, gapMs: 125 }, // ≤ 8 req/s
  'api.kroger.com': { max: 6, gapMs: 60 },
  'api.zippopotam.us': { max: 2, gapMs: 200 },
};
const DEFAULT_LIMIT = { max: 2, gapMs: 300 };
const hosts = new Map<string, { active: number; queue: (() => void)[]; nextStart: number }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquire(host: string) {
  const lim = LIMITS[host] ?? DEFAULT_LIMIT;
  let h = hosts.get(host);
  if (!h) hosts.set(host, (h = { active: 0, queue: [], nextStart: 0 }));
  if (h.active < lim.max) h.active++;
  else await new Promise<void>((r) => h!.queue.push(r)); // a finishing request hands its slot over
  const now = Date.now();
  const start = Math.max(now, h.nextStart);
  h.nextStart = start + lim.gapMs;
  if (start > now) await sleep(start - now);
}

function release(host: string) {
  const h = hosts.get(host)!;
  const next = h.queue.shift();
  if (next) next();
  else h.active--;
}

/** Run `fn` over `items` with at most `size` running at once (results keep input order). */
export async function mapPool<T, R>(items: T[], size: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function fetchJson<T = any>(
  url: string,
  // refresh: skip the cached copy but still store the new response.
  opts: { cacheKey?: string; ttlMs?: number; init?: RequestInit; retries?: number; refresh?: boolean } = {},
): Promise<T> {
  const key = opts.cacheKey ?? url;
  if (opts.ttlMs && !opts.refresh) {
    const row = db.prepare('SELECT body, fetched_at FROM http_cache WHERE key = ?').get(key) as
      | { body: string; fetched_at: number }
      | undefined;
    if (row && Date.now() - row.fetched_at < opts.ttlMs) return JSON.parse(row.body);
  }
  const host = new URL(url).host;
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1)); // back off before a retry (no slot held)
    await acquire(host);
    let res: Response;
    let body: string;
    try {
      res = await fetch(url, {
        ...opts.init,
        headers: { 'User-Agent': config.userAgent, Accept: 'application/json', ...(opts.init?.headers || {}) },
        signal: AbortSignal.timeout(30_000),
      });
      body = await res.text();
    } catch (e) {
      lastErr = e; // network error / timeout: retry
      continue;
    } finally {
      release(host);
    }
    if (!res.ok) {
      const err = new HttpError(res.status, `${host} returned HTTP ${res.status}: ${body.slice(0, 300)}`);
      if (res.status !== 429 && res.status < 500) throw err; // only retry rate limits / server errors
      lastErr = err;
      continue;
    }
    const json = JSON.parse(body);
    if (opts.ttlMs) {
      db.prepare('INSERT OR REPLACE INTO http_cache (key, body, fetched_at) VALUES (?, ?, ?)').run(key, body, Date.now());
    }
    return json;
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
