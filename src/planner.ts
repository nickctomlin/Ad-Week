// Deterministic pricing + budget optimization. The LLM never sets a price: every cost here is
// computed from deal rows. Pure functions — tested in test/planner.test.ts.
import { CANONICAL_BY_KEY, plateLb } from './normalize.ts';
import type { Recipe } from './recipes.ts';

export type OfferStore = { id: string; chain: string; name: string; address: string; distance: number };

/** A deal as available at one specific store. */
export type Offer = {
  dealId: string;
  canonical: string;
  itemName: string;
  price: number; // per lb if soldBy=weight, else per package
  regularPrice: number | null;
  soldBy: 'weight' | 'package';
  pkgQty: number | null; // package size in canonical base unit
  sizeEstimated: boolean;
  limit: number | null;
  isSale: boolean;
  validTo: string | null;
  store: OfferStore;
  // For display/verification only; never used in pricing.
  imageUrl?: string | null;
  sourceUrl?: string | null;
  flyerId?: number | null;
  flyerItemId?: number | null;
  note?: string | null;
};

export type PurchaseLine = {
  offer: Offer;
  packages: number | null; // null for by-weight purchases
  qty: number; // amount bought, in base unit (lb for weight items)
  cost: number;
  note?: string;
};

export type Purchase = { canonical: string; needed: number; unit: string; lines: PurchaseLine[]; cost: number; warnings: string[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-9;

/** Cost to buy `qty` (base units) from one offer, ignoring limits. */
export function costAt(offer: Offer, qty: number): { packages: number | null; qty: number; cost: number } | undefined {
  const can = CANONICAL_BY_KEY.get(offer.canonical);
  if (!can || qty <= 0) return undefined;
  if (offer.soldBy === 'weight') {
    // Priced per lb: convert counted items via typical weight.
    const lbs = can.unit === 'lb' ? qty : can.eachLb ? qty * can.eachLb : undefined;
    if (lbs == null) return undefined;
    return { packages: null, qty: lbs, cost: r2(lbs * offer.price) };
  }
  const per = offer.pkgQty && offer.pkgQty > 0 ? offer.pkgQty : 1;
  const packages = Math.ceil(qty / per - EPS); // round up to whole packages
  return { packages, qty: packages * per, cost: r2(packages * offer.price) };
}

/**
 * Buy `qty` of a canonical as cheaply as possible from the given offers, respecting purchase
 * limits: buy up to the limit at the best offer, then fill the remainder from the next best.
 */
export function priceNeed(canonical: string, qty: number, offers: Offer[]): Purchase | undefined {
  const can = CANONICAL_BY_KEY.get(canonical);
  if (!can) return undefined;
  const ranked = offers
    .filter((o) => o.canonical === canonical)
    .map((o) => ({ o, c: costAt(o, qty) }))
    .filter((x) => x.c)
    .sort((a, b) => a.c!.cost - b.c!.cost || a.o.store.distance - b.o.store.distance);
  if (!ranked.length) return undefined;

  const lines: PurchaseLine[] = [];
  const warnings: string[] = [];
  let remaining = qty;
  for (const { o } of ranked) {
    if (remaining <= EPS) break;
    const full = costAt(o, remaining)!;
    if (o.limit && full.packages != null && full.packages > o.limit) {
      const per = o.pkgQty && o.pkgQty > 0 ? o.pkgQty : 1;
      lines.push({ offer: o, packages: o.limit, qty: o.limit * per, cost: r2(o.limit * o.price), note: `limit ${o.limit}` });
      remaining -= o.limit * per;
      continue;
    }
    lines.push({ offer: o, ...full, note: o.limit && full.packages == null ? `ad says limit ${o.limit}` : undefined });
    remaining = 0;
  }
  if (remaining > EPS) {
    // Every offer is capped. Buy the rest at the best offer's regular price if we know it.
    const best = ranked[0].o;
    const per = best.pkgQty && best.pkgQty > 0 ? best.pkgQty : 1;
    const packages = Math.ceil(remaining / per - EPS);
    const unitCost = best.regularPrice ?? best.price;
    lines.push({ offer: best, packages, qty: packages * per, cost: r2(packages * unitCost), note: best.regularPrice ? 'over limit, regular price' : 'over limit' });
    if (!best.regularPrice) warnings.push(`Need more ${canonical} than the sale limit allows; extra priced at sale price because the regular price is unknown.`);
  }
  return { canonical, needed: qty, unit: can.unit, lines, cost: r2(lines.reduce((s, l) => s + l.cost, 0)), warnings };
}

export const PORTION_MIN_LB = 0.75;
export const PORTION_MAX_LB = 1;

/** Pounds of food per serving a recipe provides as written. */
export function plateLbPerServing(r: Recipe): number {
  return r.ingredients.reduce((s, i) => s + i.qty * plateLb(i.canonical), 0) / r.servings;
}

const byHalfPound = (canonical: string) => {
  const can = CANONICAL_BY_KEY.get(canonical);
  return can?.unit === 'lb' && (can.category === 'protein' || can.category === 'produce');
};

/** Round a quantity the way you'd shop for it: meat and produce to the nearest half pound, counts to whole items. */
export function shopQty(canonical: string, qty: number): number {
  const can = CANONICAL_BY_KEY.get(canonical);
  if (!can) return qty;
  if (byHalfPound(canonical)) return Math.max(0.5, Math.round(qty * 2 + EPS) / 2);
  if (can.unit === 'lb') return Math.max(0.25, Math.round(qty * 4 + EPS) / 4); // dry grains
  if (can.unit === 'each') return Math.max(1, Math.round(qty + EPS));
  return Math.max(1, Math.ceil(qty - EPS)); // packages
}

/**
 * Re-portion a recipe for `servings` servings: scale it so each serving is 0.75–1 lb of food, round to
 * shoppable amounts, then nudge half-pound items until the rounded batch is back inside the range
 * (trim sides before protein; add protein first when short).
 */
export function portionRecipe(r: Recipe, servings: number): Recipe & { plateLb: number } {
  const per = plateLbPerServing(r);
  const target = per > 0 ? Math.min(PORTION_MAX_LB, Math.max(PORTION_MIN_LB, per)) : 0;
  const factor = (per > 0 ? target / per : 1) * (servings / r.servings);
  const ingredients = r.ingredients.map((i) => ({ canonical: i.canonical, qty: shopQty(i.canonical, i.qty * factor) }));
  const out = { ...r, servings, ingredients };

  if (per > 0) {
    const isProtein = (c: string) => !!CANONICAL_BY_KEY.get(c)?.protein;
    const adjustable = ingredients.filter((i) => byHalfPound(i.canonical));
    for (let guard = 0; guard < 200 && plateLbPerServing(out) > PORTION_MAX_LB + EPS; guard++) {
      const cut = adjustable.filter((i) => i.qty > 0.5).sort((a, b) => Number(isProtein(a.canonical)) - Number(isProtein(b.canonical)) || b.qty - a.qty)[0];
      if (!cut) break;
      cut.qty -= 0.5;
    }
    for (let guard = 0; guard < 200 && plateLbPerServing(out) < PORTION_MIN_LB - EPS; guard++) {
      const add = adjustable.sort((a, b) => Number(isProtein(b.canonical)) - Number(isProtein(a.canonical)) || a.qty - b.qty)[0];
      if (!add) break;
      add.qty += 0.5;
    }
  }
  return { ...out, plateLb: Math.round(plateLbPerServing(out) * 100) / 100 };
}

/** Total base-unit quantity of each canonical needed for the meals at `people` servings each. */
export function aggregateNeeds(meals: Recipe[], people: number): Map<string, number> {
  const needs = new Map<string, number>();
  for (const m of meals) {
    const scale = people / m.servings;
    for (const ing of m.ingredients) needs.set(ing.canonical, (needs.get(ing.canonical) ?? 0) + ing.qty * scale);
  }
  return needs;
}

export type ShoppingList = {
  mode: 'best' | 'one-store';
  purchases: Purchase[];
  missing: string[];
  total: number;
  store?: OfferStore; // one-store mode
  warnings: string[];
};

export function buildList(meals: Recipe[], people: number, offers: Offer[]): ShoppingList {
  const purchases: Purchase[] = [];
  const missing: string[] = [];
  for (const [canonical, qty] of aggregateNeeds(meals, people)) {
    const p = priceNeed(canonical, qty, offers);
    if (p) purchases.push(p);
    else missing.push(canonical);
  }
  return {
    mode: 'best',
    purchases,
    missing,
    total: r2(purchases.reduce((s, p) => s + p.cost, 0)),
    warnings: purchases.flatMap((p) => p.warnings),
  };
}

/** Cheapest single stop: fewest missing items first, then lowest total, then nearest. */
export function buildOneStoreList(meals: Recipe[], people: number, offers: Offer[]): ShoppingList | undefined {
  const byStore = new Map<string, Offer[]>();
  for (const o of offers) byStore.set(o.store.id, [...(byStore.get(o.store.id) ?? []), o]);
  let best: ShoppingList | undefined;
  for (const storeOffers of byStore.values()) {
    const list = buildList(meals, people, storeOffers);
    const cand = { ...list, mode: 'one-store' as const, store: storeOffers[0].store };
    if (
      !best ||
      cand.missing.length < best.missing.length ||
      (cand.missing.length === best.missing.length && (cand.total < best.total - EPS || (Math.abs(cand.total - best.total) < EPS && cand.store.distance < best.store!.distance)))
    ) best = cand;
  }
  return best;
}

/** Split shared purchase cost across meals by each meal's share of the quantity. */
export function mealCosts(meals: Recipe[], people: number, list: ShoppingList): number[] {
  const needs = aggregateNeeds(meals, people);
  const costOf = new Map(list.purchases.map((p) => [p.canonical, p.cost]));
  return meals.map((m) =>
    r2(m.ingredients.reduce((s, ing) => s + ((ing.qty * people) / m.servings / needs.get(ing.canonical)!) * (costOf.get(ing.canonical) ?? 0), 0)),
  );
}

/** Ingredients of a recipe with no current price at the selected stores. */
export function unpriced(r: Recipe, offers: Offer[]): string[] {
  const have = new Set(offers.map((o) => o.canonical));
  return r.ingredients.filter((i) => !have.has(i.canonical)).map((i) => i.canonical);
}

// Flyers only list what's on sale, so staples (rice, onions...) often have no price. A recipe is
// usable if its main protein is priced and at most MAX_UNPRICED side ingredients aren't; those are
// listed as "no current price" and never given a made-up price.
export const MAX_UNPRICED = 2;
// Ranking-only penalty per unpriced ingredient, so fully priced recipes win when costs are close.
const UNPRICED_PENALTY = 3;

export function isPriceable(r: Recipe, offers: Offer[]): boolean {
  const missing = unpriced(r, offers);
  if (missing.length > MAX_UNPRICED || missing.length === r.ingredients.length) return false;
  const proteins = r.ingredients.filter((i) => CANONICAL_BY_KEY.get(i.canonical)?.protein);
  return proteins.length === 0 || proteins.some((i) => !missing.includes(i.canonical));
}

// Small seeded PRNG so "shuffle" is reproducible.
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 2 ** 32);
}

export type PlanOptions = {
  dinners: number;
  people: number;
  maxPerProtein?: number;
  seed?: number; // set to shuffle: pick randomly among the 3 cheapest next meals
  fixed?: Recipe[]; // meals to keep (swap)
  exclude?: string[]; // recipe ids not to use
};

/**
 * Greedy budget optimizer: repeatedly add the recipe with the lowest *marginal* cost given the
 * shopping list so far (so recipes that share packages are rewarded), subject to variety rules.
 */
export function choosePlan(pool: Recipe[], offers: Offer[], opts: PlanOptions): Recipe[] {
  const maxPer = opts.maxPerProtein ?? 2;
  const rand = opts.seed != null ? rng(opts.seed) : undefined;
  const plan = [...(opts.fixed ?? [])];
  const excluded = new Set(opts.exclude ?? []);
  const candidates = pool.filter((r) => !excluded.has(r.id) && isPriceable(r, offers));
  const score = (l: ShoppingList) => l.total + UNPRICED_PENALTY * l.missing.length;
  while (plan.length < opts.dinners) {
    const base = score(buildList(plan, opts.people, offers));
    const proteinCount = (p: string) => plan.filter((m) => m.protein === p).length;
    const scored = candidates
      .filter((r) => !plan.some((m) => m.id === r.id || m.name === r.name) && proteinCount(r.protein) < maxPer)
      .map((r) => ({ r, marginal: score(buildList([...plan, r], opts.people, offers)) - base }))
      .sort((a, b) => a.marginal - b.marginal);
    if (!scored.length) break;
    const pick = rand ? scored[Math.floor(rand() * Math.min(3, scored.length))] : scored[0];
    plan.push(pick.r);
  }
  return plan;
}

/** Replace meal `index` with the cheapest alternative not already rejected. */
export function swapMeal(pool: Recipe[], offers: Offer[], plan: Recipe[], index: number, rejected: string[], people: number, seed?: number): Recipe[] {
  const keep = plan.filter((_, i) => i !== index);
  const exclude = [...rejected, plan[index].id];
  const next = choosePlan(pool, offers, { dinners: plan.length, people, fixed: keep, exclude, seed });
  if (next.length < plan.length) return plan; // nothing else fits
  const replacement = next[next.length - 1];
  const out = [...plan];
  out[index] = replacement;
  return out;
}
