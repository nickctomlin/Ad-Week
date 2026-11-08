import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, historyKey, adWeek } from '../src/history.ts';

test('the same ad item matches week to week despite sizes and symbols', () => {
  assert.equal(normalizeName('Signature SELECT® Russet Potatoes 5 lb.'), 'signature select russet potatoes');
  assert.equal(normalizeName('Signature SELECT Russet Potatoes, 5-lb'), 'signature select russet potatoes');
  assert.equal(normalizeName("Mrs. Baird's® Bread 20 oz."), 'mrs baird s bread');
});

test('Kroger shelf prices are keyed by product, not store', () => {
  const a = historyKey({ source: 'kroger-api', chain: 'kroger', item_name: 'x', id: 'kroger:03500698:0001111041700:ground beef' });
  const b = historyKey({ source: 'kroger-api', chain: 'kroger', item_name: 'x', id: 'kroger:03500522:0001111041700:ground beef' });
  assert.equal(a, b);
  assert.equal(historyKey({ source: 'flipp', chain: 'aldi', item_name: 'Fresh Black Angus Chuck Roast', id: 'flipp:75024:1:x' }), 'aldi:fresh black angus chuck roast');
});

test('ad weeks start on Wednesday', () => {
  assert.equal(adWeek('2026-11-04T00:00:00-05:00'), '2026-11-04'); // Wednesday
  assert.equal(adWeek('2026-11-10T23:59:59-06:00'), '2026-11-04'); // the following Tuesday
  assert.equal(adWeek('2026-11-11'), '2026-11-11');
});
