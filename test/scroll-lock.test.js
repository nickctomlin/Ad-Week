import test from 'node:test';
import assert from 'node:assert/strict';
import { lockPageScroll } from '../public/scroll-lock.js';

function fixture() {
  const body = { style: { position: '', top: '', left: '', right: '', width: '', overflow: '', paddingRight: '4px' } };
  const doc = { body, documentElement: { style: { overflow: '' }, clientWidth: 980 } };
  const restored = [];
  const win = { scrollX: 0, scrollY: 712, innerWidth: 1000, getComputedStyle: () => ({ paddingRight: '4px' }), scrollTo: (position) => restored.push(position) };
  return { doc, win, restored };
}
test('opening a modal fixes the background at its current position and closing restores it', () => {
  const { doc, win, restored } = fixture();
  const original = { ...doc.body.style };
  const release = lockPageScroll(win, doc);
  assert.equal(doc.body.style.position, 'fixed');
  assert.equal(doc.body.style.top, '-712px');
  assert.equal(doc.body.style.overflow, 'hidden');
  assert.equal(doc.documentElement.style.overflow, 'hidden');
  assert.equal(doc.body.style.paddingRight, '24px', 'compensate for the removed scrollbar');
  release();
  assert.deepEqual(doc.body.style, original);
  assert.equal(doc.documentElement.style.overflow, '');
  assert.deepEqual(restored, [{ left: 0, top: 712, behavior: 'instant' }]);
});
test('releasing twice is harmless, including when the native close event follows the close button', () => {
  const { doc, win, restored } = fixture();
  const release = lockPageScroll(win, doc);
  release(); release();
  assert.equal(restored.length, 1);
  assert.equal(doc.body.style.position, '');
});
test('navigating away releases the page without scrolling the new section to the previous position', () => {
  const { doc, win, restored } = fixture();
  const release = lockPageScroll(win, doc);
  release(false);
  assert.equal(doc.body.style.position, '');
  assert.equal(restored.length, 0);
});
test('a restaurant dialog over the full-screen map keeps the parent page locked until both close', () => {
  const { doc, win, restored } = fixture();
  const original = { ...doc.body.style };
  const exitMap = lockPageScroll(win, doc);
  win.scrollY = 0;
  const closeRestaurant = lockPageScroll(win, doc);
  closeRestaurant();
  assert.equal(doc.body.style.position, 'fixed');
  assert.equal(doc.body.style.top, '-712px');
  assert.equal(doc.documentElement.style.overflow, 'hidden');
  exitMap();
  assert.deepEqual(doc.body.style, original);
  assert.deepEqual(restored.map((position) => position.top), [0, 712]);
});
