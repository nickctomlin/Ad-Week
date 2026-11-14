import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapListController } from '../public/specials-map-list.js';

function harness() {
  let now = 0, id = 0, south = 0, north = 10000, boundsReads = 0;
  const timers = new Map(), renders = [], pending = [];
  const controller = createMapListController({
    getBounds() { boundsReads++; return { contains: ([lat, lng]) => lat >= south && lat <= north && lng === -96.7 }; },
    render: (page) => renders.push(page), pending: (value) => pending.push(value),
    setTimer(fn, delay) { timers.set(++id, { fn, at: now + delay }); return id; },
    clearTimer(key) { timers.delete(key); },
  });
  return { controller, renders, pending,
    bounds(from, to) { south = from; north = to; },
    get boundsReads() { return boundsReads; },
    tick(ms) { now += ms; for (const [key, timer] of [...timers]) { if (timer.at <= now) { timers.delete(key); timer.fn(); } } },
  };
}
const venues = (count) => Array.from({ length: count }, (_, index) => ({ id: `venue-${index}`, location: { lat: index, lng: -96.7 } }));

test('only map-visible locations are listed, including boundary pins, and invalid/missing points are excluded', () => {
  const h = harness();
  h.bounds(2, 4);
  h.controller.setVenues([...venues(10), { id: 'missing' }, { id: 'invalid', location: { lat: NaN, lng: -96.7 } }]);
  h.tick(249); assert.equal(h.renders.length, 0);
  h.tick(1);
  assert.deepEqual(h.renders[0].venues.map((v) => v.id), ['venue-2', 'venue-3', 'venue-4']);
  assert.equal(h.renders[0].total, 3);
});
test('continuous panning/zooming cancels pending work and updates only after the final 250 ms pause', () => {
  const h = harness();
  h.controller.setVenues(venues(100));
  for (let index = 0; index < 50; index++) {
    h.controller.moving(); h.bounds(index, index + 2); h.tick(700);
    assert.equal(h.boundsReads, 0, 'no bounds scans while moving');
    h.controller.settled(); h.tick(200);
  }
  assert.equal(h.renders.length, 0);
  h.tick(49); assert.equal(h.renders.length, 0);
  h.tick(1); assert.equal(h.renders.length, 1);
  assert.deepEqual(h.renders[0].venues.map((v) => v.id), ['venue-49', 'venue-50', 'venue-51']);
  assert.deepEqual(h.pending, [true, false]);
});
test('long result sets remain bounded to 20 rendered cards with pagination', () => {
  const h = harness();
  h.controller.setVenues(venues(10000)); h.tick(250);
  assert.equal(h.renders[0].total, 10000);
  assert.equal(h.renders[0].venues.length, 20);
  assert.equal(h.renders[0].pages, 500);
  h.controller.setPage(499);
  assert.equal(h.renders.at(-1).venues.length, 20);
  assert.equal(h.renders.at(-1).start, 9981);
  assert.equal(h.renders.at(-1).end, 10000);
});
test('unchanged viewport membership avoids redraws and keeps the current page', () => {
  const h = harness();
  h.controller.setVenues(venues(45)); h.tick(250);
  h.controller.setPage(1);
  for (let index = 0; index < 20; index++) { h.bounds(-index, 10000 + index); h.controller.moving(); h.controller.settled(); h.tick(250); }
  assert.equal(h.renders.length, 2);
  assert.equal(h.renders.at(-1).page, 1);
  h.controller.setVenues(venues(45), 'favorites changed'); h.tick(250);
  assert.equal(h.renders.length, 3);
  assert.equal(h.renders.at(-1).page, 1);
  h.bounds(30, 35); h.controller.settled(); h.tick(250);
  assert.equal(h.renders.at(-1).page, 0);
  assert.equal(h.renders.at(-1).total, 6);
});
test('filter changes during movement use only the latest candidates after the map stops', () => {
  const h = harness(), all = venues(100);
  h.controller.setVenues(all);
  h.controller.moving();
  h.controller.setVenues(all.slice(5, 10));
  h.controller.resume();
  h.tick(1000);
  assert.equal(h.boundsReads, 0);
  h.controller.setVenues(all.slice(30, 32));
  h.controller.settled(); h.tick(249);
  assert.equal(h.renders.length, 0);
  h.tick(1);
  assert.deepEqual(h.renders[0].venues.map((v) => v.id), ['venue-30', 'venue-31']);
  assert.equal(h.renders.length, 1);
});
test('hidden map views cancel pending updates and resume using current bounds', () => {
  const h = harness();
  h.controller.setVenues(venues(100)); h.tick(125);
  h.controller.suspend(); h.tick(1000);
  assert.equal(h.renders.length, 0);
  h.bounds(50, 51); h.controller.resume(); h.tick(250);
  assert.deepEqual(h.renders.at(-1).venues.map((v) => v.id), ['venue-50', 'venue-51']);
});
test('pin selection opens the relevant result page and an empty map area shows zero results', () => {
  const h = harness();
  h.controller.setVenues(venues(45)); h.tick(250);
  h.controller.reveal('venue-42'); h.tick(250);
  assert.equal(h.renders.at(-1).page, 2);
  assert.equal(h.renders.at(-1).focusId, 'venue-42');
  assert.equal(h.renders.at(-1).venues.length, 5);
  h.bounds(100, 110); h.controller.settled(); h.tick(250);
  assert.equal(h.renders.at(-1).total, 0);
  assert.deepEqual(h.renders.at(-1).venues, []);
});
