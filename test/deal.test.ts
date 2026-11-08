import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice } from '../src/normalize.ts';
import { buildGenericDeal, displayPriceUnit, type DealBase } from '../src/sources/deal.ts';

test('ALDI 2 lb apple bag keeps its package price and computes a per-pound comparison', () => {
  const raw = {
    name: 'Michigan Honeycrisp Apples',
    current_price: '1.99',
    price_text: 'Per 2-Lb. Bag',
  };
  const price = parsePrice(raw)!;
  const base: DealBase = {
    id: 'flipp:75024:1051401000', source: 'flipp', chain: 'aldi', store_id: null, zone: '75024',
    item_name: raw.name, sale_price: price.price, promo_text: null, regular_price: null,
    sold_by: price.soldBy, limit_qty: null, is_sale: 1, note: null,
    valid_from: null, valid_to: null, source_url: null, image_url: null,
    flyer_id: null, flyer_item_id: null, fetched_at: 0,
  };
  const deal = buildGenericDeal(base, 'produce', `${raw.name} ${raw.price_text}`);
  assert.equal(deal.sale_price, 1.99);
  assert.equal(deal.sold_by, 'package');
  assert.equal(deal.pkg_qty, 2);
  assert.equal(deal.unit_price, 1); // $1.99 / 2 = $0.995, rounded to the nearest cent
  assert.equal(deal.unit_price_unit, 'lb');
  assert.equal(displayPriceUnit(deal), 'pkg (2 lb)');
});

test('loose produce prices remain per pound', () => {
  const price = parsePrice({ current_price: '1.99', price_text: 'Per Lb.' })!;
  assert.equal(displayPriceUnit({ sold_by: price.soldBy, pkg_qty: null, unit_price_unit: 'lb' }), 'lb');
});
