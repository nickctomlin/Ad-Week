import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DINING_SOURCES, diningBrand } from '../src/dining/catalog.ts';
import { normalizeOffer, parseDiningOffers, offerDays, diningDay } from '../src/dining/parse.ts';

process.env.DB_PATH = ':memory:';
const { restaurantsFromOSM, safeDiningUrl, diningSnapshot } = await import('../src/dining/service.ts');
const { db } = await import('../src/db.ts');
const source = DINING_SOURCES.find((s) => s.id === 'wendys')!;
const checkedAt = Date.parse('2026-11-13T18:00:00Z');

test('coupon discounts are not treated as meal prices and retain minimum purchases', () => {
  const offer = normalizeOffer({ title: '$3 Off $20+ Purchase', description: 'Use the app.', appRequired: true }, source, checkedAt)!;
  assert.equal(offer.price, null);
  assert.equal(offer.priceLabel, '$3 off');
  assert.equal(offer.minimumSpend, 20);
  assert.equal(offer.appRequired, true);
});

test('daily specials match the advertised day, including Fryday and weekdays', () => {
  assert.deepEqual(offerDays('Fryday - Free Fries'), [5]);
  assert.deepEqual(offerDays('Every Saturday or Sunday'), [0, 6]);
  assert.deepEqual(offerDays('Every weekday'), [1, 2, 3, 4, 5]);
  assert.equal(diningDay(new Date('2026-11-14T02:00:00Z')), '2026-11-13');
});

test('expired offers embedded in a live page are excluded, while future dated offers retain dates', () => {
  assert.equal(normalizeOffer({ title: '$0 delivery', description: 'Free delivery with $10 purchase.', terms: 'Valid through May 31, 2026.' }, source, checkedAt), null);
  const future = normalizeOffer({ title: 'Free Small Frosty', description: 'With purchase.', terms: 'Offer only available at participating U.S. locations on November 15, 2026.' }, source, checkedAt)!;
  assert.equal(future.validFrom, '2026-11-15');
  assert.equal(future.validTo, '2026-11-15');
  const dated = normalizeOffer({ title: 'Free fries', description: 'With $1 minimum purchase.', terms: 'Valid 1x/week thru 12/31/26.' }, source, checkedAt)!;
  assert.equal(dated.validTo, '2026-12-31');
});

test('deferred rewards and unknown qualifying purchases keep important redemption requirements', () => {
  const reward = normalizeOffer({ title: 'Free Nacho Fries', description: 'Use Apple Pay in the app. Reward on your next $10+ app purchase. Saturday or Sunday through 11/22.' }, source, checkedAt)!;
  assert.equal(reward.delayedReward, true);
  assert.equal(reward.minimumSpend, 10);
  assert.deepEqual(reward.days, [0, 6]);
  assert.equal(reward.validTo, '2026-11-22');
  const mixedDates = normalizeOffer({ title: 'Your New Gameday Tradition', description: 'Free fries on your next $10+ app purchase. Every Saturday or Sunday through 11/22.', terms: 'Between November 6, 2026 through November 22, 2026. Rewards members only.' }, source, checkedAt)!;
  assert.equal(mixedDates.validTo, '2026-11-22');
  assert.equal(mixedDates.validFrom, '2026-11-06');
  const drink = normalizeOffer({ title: '99-cent soft drink', description: 'With qualifying purchase.' }, source, checkedAt)!;
  assert.equal(drink.price, 0.99);
  assert.equal(drink.purchaseRequired, true);
  assert.equal(drink.minimumSpend, null);
});

test('Wendy’s duplicate responsive cards import once and retain real terms', () => {
  const card = `<div class="brick"><div class="field-highlightcard-cardheading">Fryday - Free Fry w/ $5 Purchase</div><div class="field-highlightcard-copy">Free fry with qualifying $5 purchase.</div></div>`;
  const offers = parseDiningOffers(`<main>${card}${card}</main>`, source, checkedAt);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].minimumSpend, 5);
  assert.equal(offers[0].appRequired, true);
  assert.equal(offers[0].sourceUrl, source.url);
});

test('McDonald’s marketing metadata is ignored and legal expiry is retained', () => {
  const html = `<div class="cmp-teaser" data-copy="Not an offer"><h2 class="cmp-teaser__title">Free medium Fries with $1 minimum purchase</h2><div class="cmp-teaser__description"><p>Get fries in the app.</p><p class="legal-pub">Valid 1x/week thru 12/31/26. Must opt in to Rewards.</p></div></div>`;
  const offers = parseDiningOffers(html, DINING_SOURCES.find((s) => s.id === 'mcdonalds')!, checkedAt);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].description, 'Get fries in the app.');
  assert.equal(offers[0].validTo, '2026-12-31');
  assert.ok(offers[0].terms.includes('Rewards'));
});

test('one-day featured campaigns are imported once and scheduled only on their published date', () => {
  const card = `<div class="brick--up-promo-sub"><div class="field-uppromo-header">Frosty Day</div><div class="field-uppromo-copy">Free Small Frosty with purchase on 11/15.</div><div class="field-uppromo-legal-line">Offer only available at participating U.S. Wendy’s on November 15, 2026. App required.</div></div>`;
  const offers = parseDiningOffers(card + card, source, checkedAt);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].validFrom, '2026-11-15');
  assert.equal(offers[0].validTo, '2026-11-15');
  assert.equal(offers[0].kind, 'special');
});

test('public CMS data is parsed as JSON without executing scripts and expired campaigns are dropped', () => {
  const published = { fields: { title: [{ fields: { text: 'Order delivery for $0' } }], description: 'Use promo code DELIVERY with $10 purchase.', descriptionCTA: { fields: { message: 'Valid through May 31, 2026.' } } } };
  const payload = JSON.stringify([1, `1:${JSON.stringify(published)}\n`]);
  const html = `<script>self.__next_f.push(${payload})</script>`;
  assert.deepEqual(parseDiningOffers(html, DINING_SOURCES.find((s) => s.id === 'sonic')!, checkedAt), []);
});

test('active public CMS offers deduplicate repeated server-rendered data', () => {
  const published = { fields: { title: [{ fields: { text: '$1.99 Snack Wrap' } }], description: 'Get a snack wrap for $1.99.', descriptionCTA: { fields: { message: 'At participating locations. Limited time.' } } } };
  const payload = JSON.stringify([1, `1:${JSON.stringify(published)}\n2:${JSON.stringify(published)}\n`]);
  const offers = parseDiningOffers(`<script>self.__next_f.push(${payload})</script>`, DINING_SOURCES.find((s) => s.id === 'sonic')!, checkedAt);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 1.99);
});

test('split UTF-8 CMS text records retain casual dining prices without executing page code', () => {
  const raw = JSON.stringify({ component: { name: 'Text', options: { text: '<p>Chili’s 3 for Me® with fries for just $10.99.</p>' } } });
  const record = `9:T${Buffer.byteLength(raw).toString(16)},${raw}a:[]\n`;
  const scripts = [record.slice(0, 40), record.slice(40)].map((chunk) => `<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`).join('');
  const offers = parseDiningOffers(scripts, DINING_SOURCES.find((s) => s.id === 'chilis')!, checkedAt);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 10.99);
  assert.ok(offers[0].description.includes('Chili’s'));
});

test('nearby restaurants include independents, respect exact radius and reject unsafe website URLs', () => {
  const element = (id: number, name: string, lat: number, more = {}) => ({ id, type: 'node', lat, lon: -96.8, tags: { name, amenity: 'restaurant', ...more } });
  const places = restaurantsFromOSM([
    element(1, 'Local Noodle House', 33.08, { website: 'javascript:alert(1)' }),
    element(2, 'Wendy’s', 33.081), element(3, 'Too Far', 34), element(4, 'Private Kitchen', 33.08, { access: 'private' }),
  ], { lat: 33.08, lng: -96.8 }, 5);
  assert.equal(places.length, 2);
  assert.equal(places.find((p) => p.name === 'Wendy’s')?.brand, 'wendys');
  assert.equal(places.find((p) => p.name === 'Local Noodle House')?.website, null);
  assert.equal(safeDiningUrl('https://user:password@example.com'), null);
  assert.equal(diningBrand('McDonald’s')?.id, 'mcdonalds');
});

test('failed imports retain marked previous offers but expired and week-old offers never show', () => {
  const now = Date.now();
  const offer = normalizeOffer({ title: '$5 meal', description: 'Limited time.' }, source, now)!;
  const expired = { ...offer, id: 'expired', validTo: '2000-01-01' };
  const old = { ...offer, id: 'old', checkedAt: now - 8 * 86400000 };
  db.prepare('INSERT OR REPLACE INTO dining_cache (key, body) VALUES (?, ?)').run('source:wendys', JSON.stringify({ ...source, checkedAt: now, successAt: now - 1000, status: 'error', offers: [offer, expired, old] }));
  const snapshot = diningSnapshot({ zip: '75024', city: 'Plano', state: 'TX', lat: 33.08, lng: -96.8 }, 10);
  assert.equal(snapshot.offers.length, 1);
  assert.equal(snapshot.offers[0].stale, true);
});
