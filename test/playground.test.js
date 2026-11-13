import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basketItem, listBasket, scenarioTotals, breakdown, recordedHistory, seedBasket } from '../public/playground-model.js';

const rows = [
  { id: 'apples', title: 'Apples', price: 1.99, original: 1.99, regular: 2.49, qty: 2, chain: 'ALDI', dept: 'Produce', included: true },
  { id: 'chicken', title: 'Chicken', price: 2.79, original: 2.79, regular: null, qty: 1.5, chain: 'Kroger', dept: 'Meat', included: true },
];

test('scenario arithmetic rounds unit prices and line costs without treating missing regular prices as savings', () => {
  const result = scenarioTotals(rows, { multiplier: 2, shift: -10, budget: 20 });
  assert.equal(result.rows[0].effectivePrice, 1.79);
  assert.equal(result.rows[0].total, 7.16);
  assert.equal(result.rows[1].total, 7.53);
  assert.equal(result.total, 14.69);
  assert.equal(result.remaining, 5.31);
  assert.equal(result.comparable, 1);
  assert.equal(result.saving, 2.8);
  assert.equal(result.original, 8.17);
});

test('excluded and zero-price items have correct budget and breakdown totals', () => {
  const result = scenarioTotals([{ ...rows[0], price: 0 }, { ...rows[1], included: false }], { budget: 10 });
  assert.equal(result.total, 0);
  assert.equal(result.count, 1);
  assert.equal(result.remaining, 10);
  assert.deepEqual(breakdown(result.rows, 'chain'), [{ name: 'ALDI', value: 0, count: 1 }]);
  assert.equal(scenarioTotals(rows, { budget: 1 }).remaining, -7.17);
});

test('the ripple effect compares quantity, multiplier and exclusion edits with the starting basket', () => {
  const items = [{ ...rows[0], originalQty: 2, qty: 4 }, { ...rows[1], originalQty: 1.5, included: false }];
  const result = scenarioTotals(items, { multiplier: 2, shift: 0 });
  assert.equal(result.original, 8.17);
  assert.equal(result.total, 15.92);
});

test('editing a scenario never mutates source deals, list quantities or recorded histories', () => {
  const deal = { dealId: 'apples', item: 'Apples', salePrice: 1.99, regularPrice: 2.49, chainName: 'ALDI', deptLabel: 'Produce', history: { weeks: [['2026-11-04', 2.49], ['2026-11-11', 1.99]] } };
  const item = basketItem(deal);
  item.price = 0.5;
  item.qty = 4;
  assert.equal(deal.salePrice, 1.99);
  assert.equal(deal.history.weeks[1][1], 1.99);
  const list = [{ id: 'apples', title: 'Apples', price: 1.99, qty: 3, chainName: 'ALDI' }, { id: 'coupon', title: 'Coupon only', price: null, qty: 1 }];
  const imported = listBasket(list, [deal]);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].originalQty, 3);
  imported[0].qty = 7;
  assert.equal(list[0].qty, 3);
});

test('history windows use calendar weeks, leave gaps and exclude future observations', () => {
  const item = { history: [['2026-09-02', 5], ['2026-10-21', 4], ['2026-11-04', 3], ['2026-11-11', 2], ['2026-11-18', 1]] };
  assert.deepEqual(recordedHistory(item, 4, new Date('2026-11-13T12:00:00')), [['2026-10-21', 4], ['2026-11-04', 3], ['2026-11-11', 2]]);
  assert.deepEqual(recordedHistory(null), []);
});

test('starter baskets use real priced deals and limit repeated departments and item names', () => {
  const deals = Array.from({ length: 12 }, (_, i) => ({ dealId: String(i), item: `Food ${i}`, salePrice: i + 1, dept: Math.floor(i / 3), deptLabel: `Aisle ${Math.floor(i / 3)}`, chainName: `Store ${i % 3}`, score: 30 - i }));
  deals.push({ dealId: 'coupon', item: 'Coupon', salePrice: null, dept: 'other' });
  const basket = seedBasket(deals);
  assert.equal(basket.length, 6);
  assert.ok(basket.every((item) => item.price > 0));
  assert.ok(Math.max(...Object.values(basket.reduce((groups, item) => ({ ...groups, [item.dept]: (groups[item.dept] || 0) + 1 }), {}))) <= 2);
});
