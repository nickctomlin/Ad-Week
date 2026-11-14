import test from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentLocation, formatLocationAccuracy, placeUserLocation } from '../public/specials-location.js';

test('location is a single visitor-triggered request with bounded timeout and returns the device accuracy', async () => {
  let calls = 0;
  const geolocation = { getCurrentPosition(success, _failure, options) {
    calls++;
    assert.equal(options.timeout, 15000);
    assert.equal(options.enableHighAccuracy, true);
    assert.equal(options.maximumAge, 30000);
    success({ coords: { latitude: 33.02, longitude: -96.73, accuracy: 25 } });
  } };
  const position = await getCurrentLocation({ geolocation, secure: true });
  assert.deepEqual(position, { lat: 33.02, lng: -96.73, accuracy: 25 });
  assert.equal(calls, 1);
});
test('denial, unavailability and timeout explain what happened without breaking the map', async () => {
  for (const [code, message] of [[1, /Location access is off/], [2, /could not find/], [3, /too long/]]) {
    const geolocation = { getCurrentPosition(_success, failure) { failure({ code }); } };
    await assert.rejects(getCurrentLocation({ geolocation, secure: true }), message);
  }
});
test('insecure or unsupported browsers fail without requesting a location', async () => {
  let requested = false;
  await assert.rejects(getCurrentLocation({ secure: false, geolocation: { getCurrentPosition() { requested = true; } } }), /HTTPS/);
  assert.equal(requested, false);
  await assert.rejects(getCurrentLocation({ secure: true, geolocation: null }), /not available/);
});
test('invalid device coordinates are rejected and approximate locations get readable accuracy labels', async () => {
  await assert.rejects(getCurrentLocation({ secure: true, geolocation: { getCurrentPosition(success) { success({ coords: { latitude: NaN, longitude: -96.7, accuracy: 25 } }); } } }), /invalid location/);
  assert.equal(formatLocationAccuracy(25), '25 m');
  assert.equal(formatLocationAccuracy(1600), '1.6 km');
});

test('the location dot is separate from restaurant pins, recenters precisely, and replaces previous readings', () => {
  const calls = [], removed = [];
  const map = { invalidateSize() {}, setView(point, zoom) { calls.push({ point, zoom }); }, fitBounds(bounds, options) { calls.push({ bounds, options }); } };
  const layer = (kind, point, options) => ({ kind, point, options, addTo(target) { assert.equal(target, map); return this; }, bindTooltip(text) { this.tooltip = text; return this; }, getBounds() { return 'accuracy-bounds'; } });
  const L = { circle: (p, o) => layer('accuracy', p, o), marker: (p, o) => layer('dot', p, o), divIcon: (options) => options };
  const prior = { marker: { remove() { removed.push('old-dot'); } }, accuracy: { remove() { removed.push('old-accuracy'); } } };
  const result = placeUserLocation(L, map, { lat: 33.02, lng: -96.73, accuracy: 25 }, prior);
  assert.deepEqual(removed, ['old-dot', 'old-accuracy']);
  assert.equal(result.marker.options.icon.className, 'special-user-marker');
  assert.deepEqual(result.marker.point, [33.02, -96.73]);
  assert.equal(result.accuracy.options.radius, 25);
  assert.match(result.marker.tooltip, /25 m/);
  assert.deepEqual(calls, [{ point: [33.02, -96.73], zoom: 15 }]);
  calls.length = 0;
  placeUserLocation(L, map, { lat: 33.02, lng: -96.73, accuracy: 2000 });
  assert.deepEqual(calls, [{ bounds: 'accuracy-bounds', options: { padding: [24, 24], maxZoom: 15 } }]);
  calls.length = 0;
  placeUserLocation(L, map, { lat: 33.02, lng: -96.73, accuracy: 25 }, { center: false });
  assert.equal(calls.length, 0, 'a delayed response must not recenter a hidden map');
});
