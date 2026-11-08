import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesWatch, suggestWatch, watchKey } from '../public/watch.js';

// Item names below are from real DFW weekly ads.
const deal = (o) => ({ item: '', chainName: 'Kroger', canonicals: [], salePrice: null, unitPrice: null, unitPriceUnit: null, ...o });

test('an ingredient watch matches that ingredient at any store', () => {
  const w = { canonical: 'chicken breast' };
  assert.ok(matchesWatch(deal({ item: 'Fresh Family Pack Chicken Breasts', chainName: 'ALDI', canonicals: ['chicken breast'] }), w));
  assert.ok(!matchesWatch(deal({ item: 'Fresh Family Pack Chicken Drumsticks', canonicals: ['chicken drumsticks'] }), w));
});

test('a keyword watch needs every word', () => {
  const w = { query: 'blue bell ice cream' };
  assert.ok(matchesWatch(deal({ item: "Blue Bell Ice Cream Pint, Ben & Jerry's Ice Cream 14.4 oz. Pint" }), w));
  assert.ok(!matchesWatch(deal({ item: 'Kroger Ice Cream' }), w));
});

test('price targets compare unit prices when units match', () => {
  const w = { canonical: 'chicken breast', unit: 'lb', maxPrice: 2.5 };
  assert.ok(matchesWatch(deal({ canonicals: ['chicken breast'], salePrice: 9.99, unitPrice: 1.99, unitPriceUnit: 'lb' }), w)); // 5-lb pack at $1.99/lb
  assert.ok(!matchesWatch(deal({ canonicals: ['chicken breast'], salePrice: 2.77, unitPrice: 2.77, unitPriceUnit: 'lb' }), w));
  // Keyword watch with a target falls back to the item price.
  assert.ok(matchesWatch(deal({ item: 'Kroger Ice Cream', salePrice: 1.99 }), { query: 'ice cream', maxPrice: 2 }));
});

test('suggested watches: ingredient first, else a short keyword from the first product named', () => {
  assert.deepEqual(suggestWatch({ canonicals: ['ground beef'], unitPriceUnit: 'lb', title: '93% Lean Ground Beef' }), { label: 'ground beef', canonical: 'ground beef', unit: 'lb' });
  assert.equal(suggestWatch({ title: "Blue Bell Ice Cream Pint, Ben & Jerry's Ice Cream 14.4 oz. Pint" }).query, 'blue bell ice cream');
  assert.equal(suggestWatch({ title: 'Signature SELECT® Fresh Assorted Salsa 16 oz.' }).query, 'signature salsa');
});

test('watch keys de-duplicate equivalent watches', () => {
  assert.equal(watchKey({ query: 'Blue  Bell ice-cream' }), watchKey({ query: 'blue bell ice cream' }));
  assert.equal(watchKey({ canonical: 'eggs' }), 'canonical:eggs');
});
