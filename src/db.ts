// SQLite storage (node:sqlite, built into Node 24+). One file, no native build.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.ts';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

// Deals are a cache of re-fetchable data, so schema changes just rebuild the table and force a re-ingest
// (raw HTTP responses stay cached, so this is fast).
const dealCols = new Set((db.prepare('PRAGMA table_info(deals)').all() as { name: string }[]).map((c) => c.name));
if (dealCols.size && !dealCols.has('dept')) {
  db.exec('DROP TABLE deals');
  db.exec("DROP TABLE IF EXISTS ingest_runs");
}

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS http_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,          -- 'kroger:<locationId>' or 'osm:<type><id>'
  chain TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  source TEXT NOT NULL,         -- 'kroger-api' | 'openstreetmap'
  updated_at INTEGER NOT NULL
);

-- Which stores were found around a ZIP (25 mi search), so lookups are cached.
CREATE TABLE IF NOT EXISTS zip_stores (
  zip TEXT NOT NULL,
  chain TEXT NOT NULL,
  store_id TEXT,                -- NULL row = searched, nothing found
  searched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS zip_stores_zip ON zip_stores(zip);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,         -- 'kroger-api' | 'flipp'
  chain TEXT NOT NULL,
  store_id TEXT,                -- set for store-level prices (Kroger API)
  zone TEXT,                    -- set for flyer prices: the ZIP the flyer was fetched for
  item_name TEXT NOT NULL,
  canonical TEXT,               -- dinner ingredient this prices; NULL = display-only deal (fruit, snacks...)
  category TEXT NOT NULL,
  dept TEXT NOT NULL,           -- store department for the Deals tab (see departments.ts)
  sale_price REAL,              -- price per sold unit (per lb if sold_by='weight', else per package); NULL = promo only
  promo_text TEXT,              -- e.g. "Buy 2 Get 1 Free" when the ad gives no single price
  regular_price REAL,
  sold_by TEXT NOT NULL,        -- 'weight' | 'package'
  pkg_qty REAL,                 -- package size in the canonical's base unit
  size_estimated INTEGER NOT NULL DEFAULT 0,
  unit_price REAL,
  unit_price_unit TEXT,
  limit_qty INTEGER,
  is_sale INTEGER NOT NULL,
  note TEXT,
  valid_from TEXT,
  valid_to TEXT,
  source_url TEXT,
  image_url TEXT,               -- ad clipping (flyers) or product photo (Kroger API)
  flyer_id INTEGER,
  flyer_item_id INTEGER,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS deals_zone ON deals(zone, chain);
CREATE INDEX IF NOT EXISTS deals_store ON deals(store_id);

-- One row per (source, scope) ingestion attempt; latest row wins for freshness.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  chain TEXT NOT NULL,
  scope TEXT NOT NULL,          -- ZIP for flyers, store id for Kroger API
  zip TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,         -- 'running' | 'ok' | 'empty' | 'error' | 'skipped'
  message TEXT,
  deal_count INTEGER DEFAULT 0,
  valid_to TEXT
);
CREATE INDEX IF NOT EXISTS ingest_runs_zip ON ingest_runs(zip, chain);

CREATE TABLE IF NOT EXISTS recipe_pools (
  key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Your shopping list (one list; Ad Week is single-user). Stored here so every device sees the same list.
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracked_zips (
  zip TEXT PRIMARY KEY,
  last_requested INTEGER NOT NULL
);
`);
