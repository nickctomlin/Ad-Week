import { test } from 'node:test';
import assert from 'node:assert/strict';
import { couponPercent, scoreDeal, lowestLabel } from '../public/scoring.js';

// Deal wording below is copied from real DFW weekly ads.
const pct = (text, price) => Math.round(couponPercent(text, price)?.pct ?? 0);

test('buy-one-get-one offers become real percentages', () => {
  assert.equal(pct('BUY ONE, GET ONE FREE of equal or lesser value'), 50);
  assert.equal(pct('BUY 1, GET 1 FREE of equal or lesser value'), 50);
  assert.equal(pct('BUY ONE, GET ONE 50% OFF regular retail of equal or lesser value'), 25);
  assert.equal(pct('Buy two get one free'), 33);
});

test('a freebie of a different item counts for less than a true BOGO', () => {
  const p = pct('BUY two (2) H-E-B Tortilla Chips GET FREE! with yellow coupon in-store or online H-E-B Soft Drinks SAVE up to $2.98!');
  assert.ok(p > 0 && p < 33, `got ${p}`);
});

test('dollar coupons are weighed against the item price and the required quantity', () => {
  // $1 off a $3.99 item ≈ 20%; the same $1 off a $19.99 item ≈ 5%.
  assert.equal(pct('SAVE $1 with yellow coupon', 3.99), 20);
  assert.equal(pct('SAVE $1 with yellow coupon', 19.99), 5);
  // "$2 when you buy 2" is $1 per item.
  assert.equal(pct('SAVE $2 with yellow coupon WHEN YOU BUY 2', 3.99), 20);
  // No price to compare against: kept low so it can't top the list.
  assert.ok(pct('SAVE $2 with yellow coupon in-store or online') <= 15);
});

test('own regular price is used when known', () => {
  const s = scoreDeal({ salePrice: 8.99, regularPrice: 18.99, canonical: 'beef steak', unitPrice: 8.99, unitPriceUnit: 'lb' });
  assert.equal(s.score, 53);
  assert.match(s.basis, /regular price/);
});

test('a cheap product that is not on sale scores nothing', () => {
  // Everyday cheap version of this ingredient costs $0.50/lb; this item is $0.50/lb with no sale wording.
  const s = scoreDeal({ salePrice: 2.49, regularPrice: null, canonical: 'potatoes', unitPrice: 0.5, unitPriceUnit: 'lb' }, { 'potatoes|lb': 0.5 });
  assert.equal(s.score, 0);
});

test('a flyer price below the everyday price is credited, but capped', () => {
  const baselines = { 'chicken breast|lb': 2.29 };
  const s = scoreDeal({ salePrice: 1.99, regularPrice: null, canonical: 'chicken breast', unitPrice: 1.99, unitPriceUnit: 'lb' }, baselines);
  assert.equal(s.score, 13);
  assert.match(s.basis, /everyday price/);
  const huge = scoreDeal({ salePrice: 0.1, regularPrice: null, canonical: 'chicken breast', unitPrice: 0.1, unitPriceUnit: 'lb' }, baselines);
  assert.equal(huge.score, 40); // an estimate never outranks a verified bigger markdown
});

test('package prices are not compared to everyday prices (sizes vary)', () => {
  const s = scoreDeal({ salePrice: 0.99, canonical: 'bread', unitPrice: 0.99, unitPriceUnit: 'pkg' }, { 'bread|pkg': 2.99 });
  assert.equal(s.score, 0);
});

test('estimated package sizes are not compared to everyday prices', () => {
  const s = scoreDeal({ salePrice: 1, canonical: 'chicken breast', unitPrice: 1, unitPriceUnit: 'lb', sizeEstimated: true }, { 'chicken breast|lb': 2.29 });
  assert.equal(s.score, 0);
});

test("an item's own usual price is used once there are 3+ past weeks", () => {
  const history = { weeks: [], priorWeeks: 4, low: 3.49, usual: 3.99 };
  const s = scoreDeal({ salePrice: 1.99, history });
  assert.equal(s.score, 50);
  assert.match(s.basis, /usual price of \$3\.99 \(last 4 weeks\)/);
  // Too little history: ignored.
  assert.equal(scoreDeal({ salePrice: 1.99, history: { ...history, priorWeeks: 2 } }).score, 0);
});

test('"lowest in N weeks" needs a real drop, not a steady price', () => {
  assert.equal(lowestLabel({ salePrice: 2.99, history: { priorWeeks: 3, low: 3.49, usual: 3.99 } }), 'Lowest in 4 weeks');
  // Same price every week: not flagged.
  assert.equal(lowestLabel({ salePrice: 6.99, history: { priorWeeks: 3, low: 6.99, usual: 6.99 } }), null);
  // Not enough history yet.
  assert.equal(lowestLabel({ salePrice: 1, history: { priorWeeks: 1, low: 2, usual: 2 } }), null);
});
