// Polite HTTP: one request at a time per host, minimum spacing, retries, and a
// SQLite response cache so repeat runs don't re-hit sources.
import { db } from './db.ts';
import { config } from './config.ts';

const lastHit = new Map<string, Promise<void>>();
const spacingMs: Record<string, number> = {
  'nominatim.openstreetmap.org': 1100, // Nominatim policy: max 1 req/s
  'backflipp.wishabi.com': 250,
  'api.kroger.com': 120,
  'api.zippopotam.us': 200,
};

async function throttle(host: string) {
  const prev = lastHit.get(host) ?? Promise.resolve();
  const gap = spacingMs[host] ?? 300;
  const next = prev.then(() => new Promise<void>((r) => setTimeout(r, gap)));
  lastHit.set(host, next);
  await prev;
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
    await throttle(host);
    try {
      const res = await fetch(url, {
        ...opts.init,
        headers: { 'User-Agent': config.userAgent, Accept: 'application/json', ...(opts.init?.headers || {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        const err = new HttpError(res.status, `${host} returned HTTP ${res.status}: ${text}`);
        // Only retry on rate limits / server errors.
        if (res.status === 429 || res.status >= 500) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        throw err;
      }
      const body = await res.text();
      const json = JSON.parse(body);
      if (opts.ttlMs) {
        db.prepare('INSERT OR REPLACE INTO http_cache (key, body, fetched_at) VALUES (?, ?, ?)').run(key, body, Date.now());
      }
      return json;
    } catch (e) {
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
