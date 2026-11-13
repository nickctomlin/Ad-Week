import { test } from 'node:test';
import assert from 'node:assert/strict';

// Each test file runs in its own process. Never alter the user's database.
process.env.DB_PATH = ':memory:';
const { db } = await import('../src/db.ts');
const { sharedDeal, dealsForDisplay } = await import('../src/api.ts');
const { UserError } = await import('../src/geo.ts');

db.prepare(`INSERT INTO stores (id, chain, name, address, lat, lng, source, updated_at)
  VALUES (?, ?, ?, 'Plano, TX', 33, -97, 'test', 0)`).run('test:aldi', 'aldi', 'ALDI');
db.prepare(`INSERT INTO stores (id, chain, name, address, lat, lng, source, updated_at)
  VALUES (?, ?, ?, 'Plano, TX', 33, -97, 'test', 0)`).run('test:kroger', 'kroger', 'Kroger');
const insert = db.prepare(`INSERT INTO deals (id, source, chain, zone, item_name, category, dept,
  sale_price, sold_by, is_sale, fetched_at, valid_to, store_id)
  VALUES (?, 'flipp', 'aldi', '75024', 'Apples', 'produce', 'produce', 1.99, 'package', 1, 0, ?, ?)`);
insert.run('test:current', '2999-01-01T00:00:00Z', null);
insert.run('test:expired', '2000-01-01T00:00:00Z', null);
insert.run('test:store', null, 'test:aldi');

test('shared deals load without recipient setup or store selection', () => {
  assert.deepEqual(dealsForDisplay('75075', []), []);
  const { deal, zip } = sharedDeal('test:current', 'test:aldi');
  assert.equal(deal.dealId, 'test:current');
  assert.equal(deal.salePrice, 1.99);
  assert.equal(deal.chainName, 'ALDI');
  assert.equal(deal.store?.id, 'test:aldi');
  assert.equal(deal.store?.distance, null);
  assert.equal(zip, '75024');
});

test('shared deal stores are checked against the chain and store-specific offer', () => {
  assert.equal(sharedDeal('test:current', 'test:kroger').deal.store, null);
  assert.equal(sharedDeal('test:store', 'test:kroger').deal.store?.id, 'test:aldi');
});

test('missing and expired deals return a useful error instead of another ad', () => {
  assert.throws(() => sharedDeal('missing', null), (err: unknown) => err instanceof UserError && err.status === 404);
  assert.throws(() => sharedDeal('test:expired', null), (err: unknown) => err instanceof UserError && err.status === 410);
});
