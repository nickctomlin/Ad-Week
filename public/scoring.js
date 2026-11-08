// How good a deal is: an estimated percent off for *that item*, from the best evidence available.
// Shared by the Deals page and the tests (test/scoring.test.js). Pure functions only.
//
//   1. Its own regular price (printed in the ad, or Kroger's API)        -> exact % off
//   2. Coupon terms turned into a percentage (BOGO, "Save $2", "25% off")  -> estimated % off
//   3. Dinner ingredients only: price vs. the everyday price of an ordinary version of that
//      ingredient (Kroger's regular shelf prices, low end)                -> % below everyday
//
// Never compares an item to *other, pricier products*, so a cheap product isn't mistaken for a sale.

const WORDS = { one: 1, two: 2, three: 3, four: 4 };
const EVERYDAY_CAP = 40; // estimates never outrank a verified 41%+ markdown
const num = (s) => (s == null ? null : WORDS[s] ?? Number(s));

/**
 * Turn coupon wording into an estimated percent off the item, or null if there's nothing to measure.
 * `price` is the advertised price, used to weigh dollar-off coupons.
 */
export function couponPercent(text, price) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  let best = null;
  const take = (pct, label) => { if (pct > 0 && (!best || pct > best.pct)) best = { pct, label }; };

  // "Buy 1, get 1 free" (same item) = 50%; "buy 2 get 1 free" = 33%; buying a different item's freebie counts less.
  const free = t.match(/buy (one|two|three|four|\d)?\b[^.]{0,60}?get (one|two|\d)?\b[^.]{0,40}?free/);
  if (free) {
    const n = num(free[1]) ?? 1;
    const m = num(free[2]) ?? 1;
    const sameItem = /equal or lesser|get (one|1|two|2) free|bogo/.test(t);
    take(sameItem ? (m / (n + m)) * 100 : (0.7 * m / (n + m)) * 100, sameItem ? `buy ${n}, get ${m} free` : 'free item with purchase');
  }
  // "Buy 1, get 1 50% off" = 25%.
  const half = t.match(/buy (one|two|\d),? get (one|\d) (\d{1,2})% off/);
  if (half) {
    const n = num(half[1]);
    const m = num(half[2]);
    take(((m * Number(half[3])) / 100 / (n + m)) * 100, `buy ${n}, get ${m} ${half[3]}% off`);
  }
  // Plain "25% off" (not the BOGO wording above).
  const pct = t.match(/(?<!get (?:one|\d) )\b(\d{1,2})% off/);
  if (pct && !half) take(Number(pct[1]), `${pct[1]}% off`);
  // "Save $2 [when you buy 2]": weigh the per-item saving against the item's price.
  const save = t.match(/save (up to )?\$(\d+(?:\.\d+)?)/);
  if (save) {
    const each = num((t.match(/when you buy (one|two|three|four|\d)/) || [])[1]) || 1;
    const perItem = (Number(save[2]) * (save[1] ? 0.6 : 1)) / each; // "up to" is the best case
    if (price > 0) take((perItem / (price + perItem)) * 100, `save $${(perItem).toFixed(2)} per item`);
    else take(Math.min(15, perItem * 4), `save $${perItem.toFixed(2)} (item price unknown)`); // can't judge without a price
  }
  return best;
}

/**
 * Score one deal. Returns { score, basis } where score is an estimated % off (0–80) and basis says why.
 * `baselines` maps `${canonical}|${unit}` to an everyday unit price (see everydayBaselines in src/api.ts).
 */
export function scoreDeal(d, baselines = {}) {
  const candidates = [];
  if (d.regularPrice && d.salePrice != null && d.regularPrice > d.salePrice) {
    candidates.push({ score: (1 - d.salePrice / d.regularPrice) * 100, basis: `vs. its regular price of $${d.regularPrice.toFixed(2)}` });
  }
  // Its own usual price over the past weeks (needs 3+ weeks of history).
  const h = d.history;
  if (h && h.priorWeeks >= 3 && h.usual && d.salePrice != null && d.salePrice < h.usual) {
    candidates.push({ score: (1 - d.salePrice / h.usual) * 100, basis: `vs. its usual price of $${h.usual.toFixed(2)} (last ${h.priorWeeks} weeks)` });
  }
  const coupon = couponPercent(`${d.promoText || ''} ${d.note || ''}`, d.salePrice);
  if (coupon) candidates.push({ score: coupon.pct, basis: `from the deal terms (${coupon.label})` });
  // Only per-lb / per-item prices are comparable; "a package" of bread or cheese varies too much in size.
  // Capped below verified discounts, since it's an estimate.
  const everyday = d.canonical && (d.unitPriceUnit === 'lb' || d.unitPriceUnit === 'each') && baselines[`${d.canonical}|${d.unitPriceUnit}`];
  if (everyday && d.unitPrice != null && !d.sizeEstimated && d.unitPrice < everyday) {
    candidates.push({
      score: Math.min(EVERYDAY_CAP, (1 - d.unitPrice / everyday) * 100),
      basis: `vs. the everyday price of ${d.canonical} ($${everyday.toFixed(2)}/${d.unitPriceUnit})`,
    });
  }
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  return best ? { score: Math.round(Math.min(80, best.score)), basis: best.basis } : { score: 0, basis: null };
}

/**
 * "Lowest in N weeks" when this week's price beats every earlier week *and* the usual price
 * (so an item that costs the same every week isn't flagged every week). Null otherwise.
 */
export function lowestLabel(d) {
  const h = d.history;
  if (!h || h.priorWeeks < 2 || d.salePrice == null || h.low == null) return null;
  return d.salePrice <= h.low && d.salePrice < h.usual ? `Lowest in ${h.priorWeeks + 1} weeks` : null;
}

/** Rough dollars saved per item, for tie-breaking (bigger savings first). */
export function dollarsSaved(d) {
  if (d.regularPrice && d.salePrice != null) return Math.max(0, d.regularPrice - d.salePrice);
  if (d.salePrice != null && d.score) return (d.salePrice * d.score) / (100 - Math.min(d.score, 95));
  return 0;
}
