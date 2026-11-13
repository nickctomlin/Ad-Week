import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealShareData, shareDeal } from '../public/sharing.js';

const item = { title: 'Apples & pears', price: 1.99, priceUnit: 'pkg (2 lb)', chainName: 'ALDI', listId: 'flipp:75024:123:apples & pears', store: { id: 'osm:n123' } };

test('a shared deal link keeps the exact deal and store and removes unrelated filters', () => {
  const data = dealShareData(item, 'https://adweek.example/#deals?aisle=snacks', '75024');
  const url = new URL(data.url);
  assert.equal(url.origin, 'https://adweek.example');
  assert.equal(url.pathname, '/');
  const params = new URLSearchParams(url.hash.split('?')[1]);
  assert.equal(params.get('deal'), item.listId);
  assert.equal(params.get('store'), item.store.id);
  assert.equal(params.has('aisle'), false);
  assert.match(data.text, /\$1.99 \/ pkg \(2 lb\)/);
});

test('flyer links preserve the source ZIP even when the recipient uses a different one', () => {
  const data = dealShareData({ title: 'Buy 2 get 1 free', promo: 'Buy 2 get 1 free', listId: 'flyer:456', flyerId: 123, flyerItemId: 456, shareZip: '75024' }, 'https://adweek.example/', '75075');
  const params = new URLSearchParams(new URL(data.url).hash.split('?')[1]);
  assert.equal(params.get('zip'), '75024');
  assert.equal(params.get('flyer'), '123');
  assert.equal(params.get('item'), '456');
  assert.equal(params.has('deal'), false);
  assert.ok(!data.text.includes('$0.00'));
  assert.equal(dealShareData({ title: 'No identity' }, 'https://adweek.example/', ''), null);
});

test('native sharing is invoked immediately with the message and URL', async () => {
  const data = dealShareData(item, 'https://adweek.example/', '75024');
  let shared;
  const result = shareDeal(data, { share: (value) => { shared = value; return Promise.resolve(); } });
  assert.deepEqual(shared, data); // no awaited work before navigator.share (required by iOS)
  assert.equal(await result, 'shared');
});

test('cancelling the native sheet does not write to the clipboard', async () => {
  const result = await shareDeal({}, {
    share: async () => { throw new DOMException('Cancelled', 'AbortError'); },
    clipboard: { writeText: () => assert.fail('Cancellation must not copy') },
  });
  assert.equal(result, 'cancelled');
});

test('unavailable or blocked native sharing falls back to the exact URL', async () => {
  for (const share of [undefined, async () => { throw new DOMException('Blocked', 'NotAllowedError'); }]) {
    let copied;
    const data = dealShareData(item, 'https://adweek.example/', '75024');
    assert.equal(await shareDeal(data, { share, clipboard: { writeText: async (text) => { copied = text; } } }), 'copied');
    assert.equal(copied, data.url);
  }
  assert.equal(await shareDeal({ url: 'http://adweek.example/' }, {}), 'manual');
});
