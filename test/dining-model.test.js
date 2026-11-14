import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerOnDate, nextDiningDays, filteredDiningOffers, nearbyForOffer } from '../public/dining-model.js';
const offer = { id: 'fries', brand: 'wendys', title: 'Free Fries', description: 'Friday special', days: [5], price: null, priceLabel: 'Free with terms', minimumSpend: 5, appRequired: true, kind: 'special' };
const data = { offers: [offer, { ...offer, id: 'discount', days: null, priceLabel: '$3 off', minimumSpend: 20, kind: 'coupon' }], brands: [{ id: 'wendys', name: 'Wendy’s' }], restaurants: [{ id: 'near', brand: 'wendys', distance: 1.2 }], location: { status: 'ok' } };

test('day selection respects weekdays, exact promotion dates and calendar boundaries', () => {
  assert.equal(offerOnDate(offer, '2026-11-13'), true);
  assert.equal(offerOnDate(offer, '2026-11-14'), false);
  assert.equal(offerOnDate({ ...offer, days: null, validFrom: '2026-11-15', validTo: '2026-11-15' }, '2026-11-14'), false);
  assert.deepEqual(nextDiningDays('2026-12-29'), ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04']);
});
test('price filters do not confuse a discount or a later reward with a cheap meal', () => {
  assert.deepEqual(filteredDiningOffers(data, { underTen: true }).map((o) => o.id), ['fries']);
  assert.equal(filteredDiningOffers({ ...data, offers: [{ ...offer, delayedReward: true }] }, { underTen: true }).length, 0);
});
test('nearby filters use discovered branches and preserve national offers when discovery is unavailable', () => {
  assert.equal(filteredDiningOffers({ ...data, restaurants: [] }, { near: true }).length, 0);
  assert.equal(filteredDiningOffers({ ...data, restaurants: [], location: { status: 'error' } }, { near: true }).length, 2);
  assert.deepEqual(nearbyForOffer(offer, [{ brand: 'wendys', distance: 3 }, { brand: 'wendys', distance: 1 }]).map((r) => r.distance), [1, 3]);
});
test('search, saved, app requirements and specials filters combine without changing original offers', () => {
  assert.equal(filteredDiningOffers(data, { query: 'wendy fries', saved: true, savedIds: ['fries'], tab: 'specials', date: '2026-11-13' }).length, 1);
  assert.equal(filteredDiningOffers(data, { noApp: true }).length, 0);
  assert.equal(filteredDiningOffers(data, { query: "Wendy's fries" }).length, 2);
  assert.equal(data.offers.length, 2);
});
