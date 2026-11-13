import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageUrl } from '../public/images.js';

process.env.DB_PATH = ':memory:';
const { db } = await import('../src/db.ts');
const { getProductImage } = await import('../src/images.ts');
const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 16, 255, 217]);
const response = () => new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg' } });

test('Kroger photos, including saved list URLs, load from our own server', () => {
  const url = imageUrl('https://www.kroger.com/product/images/medium/front/0000000004593');
  assert.equal(url, '/api/product-image?path=medium%2Ffront%2F0000000004593');
  assert.equal(imageUrl(url), url);
  assert.equal(imageUrl(null), '');
  assert.equal(imageUrl('https://f.wishabi.net/example.jpg'), 'https://f.wishabi.net/example.jpg');
});

test('the image endpoint rejects arbitrary URLs, traversal and unsupported paths before fetching', async () => {
  for (const path of ['https://example.com/photo.jpg', '../secret', 'medium/front/123?x=y', 'medium/front/123#x', 'medium/front/0000000004593/../x', 'medium/front/0000000004593\n']) {
    await assert.rejects(getProductImage(path, async () => assert.fail('Invalid paths must not fetch')), (e) => e.status === 400);
  }
});

test('valid photos are persisted and reused without forwarding mobile headers or credentials', async () => {
  let calls = 0;
  const path = 'medium/front/0000000004593';
  const image = await getProductImage(path, async (url, init) => {
    calls++;
    assert.equal(url, `https://www.kroger.com/product/images/${path}`);
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.deepEqual(init.headers, { Accept: 'image/jpeg' });
    return response();
  });
  assert.deepEqual(image.body, Buffer.from(jpeg));
  const cached = await getProductImage(path, async () => assert.fail('Must use the persisted cache'));
  assert.equal(calls, 1);
  assert.equal(cached.contentType, 'image/jpeg');
  assert.deepEqual(cached.body, jpeg);
});

test('temporary failures retry once and a successful retry is cached', async () => {
  let calls = 0;
  const image = await getProductImage('medium/front/0000000004046', async () => {
    if (++calls === 1) throw new TypeError('Network unavailable');
    return response();
  });
  assert.equal(calls, 2);
  assert.equal(image.contentType, 'image/jpeg');
});

test('cached photos remain usable when refreshing the image service fails', async () => {
  const path = 'medium/front/0000000004593';
  db.prepare('UPDATE product_images SET fetched_at = 0 WHERE path = ?').run(path);
  const image = await getProductImage(path, async () => { throw new TypeError('Offline'); });
  assert.equal(image.stale, true);
  assert.deepEqual(image.body, jpeg);
});

test('HTML error pages and oversized responses never poison the photo cache', async () => {
  for (const [id, result] of [
    ['0000000001111', () => new Response('<html>Temporary error</html>', { headers: { 'Content-Type': 'image/jpeg' } })],
    ['0000000002222', () => new Response('', { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '3000000' } })],
  ]) {
    const path = `medium/front/${id}`;
    await assert.rejects(getProductImage(path, async () => result()), (e) => e.status === 502);
    assert.equal(db.prepare('SELECT path FROM product_images WHERE path = ?').get(path), undefined);
  }
});

test('duplicate requests share one download and different downloads are limited to four', async () => {
  let calls = 0, active = 0, peak = 0;
  const fetchImage = async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return response();
  };
  const images = await Promise.all(Array.from({ length: 8 }, (_, i) => getProductImage(`medium/front/0000000008${String(Math.floor(i / 2)).padStart(3, '0')}`, fetchImage)));
  assert.equal(images.length, 8);
  assert.equal(calls, 4);
  assert.ok(peak <= 4);
});
