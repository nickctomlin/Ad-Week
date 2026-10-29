// Glue between the database and the planner: builds per-store offers, chain freshness, plans.
import { db } from './db.ts';
import { hasKroger, hasAnthropic, config } from './config.ts';
import { latestRuns, getJob } from './ingest.ts';
import { CHAINS, CHAIN_BY_ID, type ChainId, type Deal } from './sources/types.ts';
import type { StoreWithDistance } from './stores.ts';
import { CANONICAL_BY_KEY } from './normalize.ts';
import { DEPARTMENTS, deptLabel } from './departments.ts';
import { buildList, buildOneStoreList, choosePlan, swapMeal, mealCosts, unpriced, portionRecipe, type Offer, type ShoppingList } from './planner.ts';
import { getRecipePool, type AvailableItem, type Diet, type Recipe } from './recipes.ts';
import { UserError } from './geo.ts';
import { HOUR } from './http.ts';

function currentDeals(zip: string, storeIds: string[]): Deal[] {
  const now = new Date().toISOString();
  const placeholders = storeIds.map(() => '?').join(',') || "''";
  return db
    .prepare(`SELECT * FROM deals WHERE (zone = ? OR store_id IN (${placeholders}))
      AND (valid_to IS NULL OR valid_to >= ?) AND (valid_from IS NULL OR valid_from <= ?)`)
    .all(zip, ...storeIds, now, now) as Deal[];
}

function storesByChain(stores: StoreWithDistance[]) {
  const byChain = new Map<string, StoreWithDistance[]>();
  for (const s of stores) byChain.set(s.chain, [...(byChain.get(s.chain) ?? []), s]);
  return byChain;
}

/** Expand deals into per-store offers: flyer deals apply to every selected store of that chain. */
export function buildOffers(zip: string, stores: StoreWithDistance[]): Offer[] {
  // Only dinner-ingredient deals with a real price can be used for planning.
  const deals = currentDeals(zip, stores.map((s) => s.id)).filter((d): d is Deal & { canonical: string; sale_price: number } => d.canonical != null && d.sale_price != null);
  const byChain = storesByChain(stores);
  const offers: Offer[] = [];
  for (const d of deals) {
    const targets = d.store_id ? stores.filter((s) => s.id === d.store_id) : byChain.get(d.chain) ?? [];
    for (const s of targets) {
      offers.push({
        dealId: d.id, canonical: d.canonical, itemName: d.item_name, price: d.sale_price, regularPrice: d.regular_price,
        soldBy: d.sold_by, pkgQty: d.pkg_qty, sizeEstimated: !!d.size_estimated, limit: d.limit_qty, isSale: !!d.is_sale,
        validTo: d.valid_to, store: { id: s.id, chain: s.chain, name: s.name, address: s.address, distance: s.distance },
        imageUrl: d.image_url, sourceUrl: d.source_url, flyerId: d.flyer_id, flyerItemId: d.flyer_item_id, note: d.note,
      });
    }
  }
  return offers;
}

export type ChainStatus = {
  chain: ChainId; name: string; color: string; weeklyAdUrl: string; storesInRadius: number; status: 'ok' | 'stale' | 'loading' | 'missing' | 'error' | 'no-stores';
  dealCount: number; updatedAt: number | null; validThrough: string | null; messages: string[];
};

export function chainStatuses(zip: string, stores: StoreWithDistance[], lookupErrors: Partial<Record<ChainId, string>> = {}): ChainStatus[] {
  const runs = latestRuns(zip);
  const running = getJob(zip)?.running;
  const now = Date.now();
  return CHAINS.map((c) => {
    const mine = runs.filter((r) => r.chain === c.id);
    const flyer = mine.find((r) => r.source === 'flipp');
    const api = mine.filter((r) => r.source === 'kroger-api');
    const messages: string[] = [];
    if (lookupErrors[c.id]) messages.push(lookupErrors[c.id]!);
    const inRadius = stores.filter((s) => s.chain === c.id).length;
    const dealCount = mine.reduce((s, r) => s + (r.status === 'ok' ? r.deal_count : 0), 0);
    let status: ChainStatus['status'];
    if (!inRadius) status = 'no-stores';
    else if (!flyer && running) status = 'loading';
    else if (!flyer) status = 'missing';
    else if (flyer.status === 'error') status = 'error';
    else if (flyer.status !== 'ok' && !api.some((r) => r.status === 'ok')) status = 'missing';
    else if ((flyer.valid_to && Date.parse(flyer.valid_to) < now) || now - flyer.finished_at > 7 * 24 * HOUR) status = 'stale';
    else status = 'ok';
    if (flyer?.message && flyer.status !== 'ok') messages.push(flyer.message);
    if (c.id === 'kroger') {
      if (!hasKroger()) messages.push('Kroger API not configured — using the Kroger weekly-ad flyer only (no store-level shelf prices).');
      for (const r of api) if (r.status !== 'ok' && r.status !== 'skipped') messages.push(`Kroger API: ${r.message}`);
    }
    if (status === 'stale') messages.push('This ad has expired or is over a week old; refreshing will pull the new one.');
    const finished = mine.map((r) => r.finished_at).filter(Boolean);
    return {
      chain: c.id, name: c.name, color: c.color, weeklyAdUrl: c.weeklyAdUrl, storesInRadius: inRadius, status, dealCount,
      updatedAt: finished.length ? Math.min(...finished) : null,
      validThrough: flyer?.valid_to ?? null,
      messages,
    };
  });
}

/** Links and images that let the user check a price at its source. */
export function verifyFields(chainId: string, o: { imageUrl?: string | null; sourceUrl?: string | null; flyerId?: number | null; flyerItemId?: number | null; note?: string | null }) {
  const chain = CHAIN_BY_ID.get(chainId as ChainId);
  return {
    imageUrl: o.imageUrl ?? null,
    sourceUrl: o.sourceUrl ?? null,
    sourceLabel: o.flyerId ? 'View on Flipp' : 'View on kroger.com',
    weeklyAdUrl: chain?.weeklyAdUrl || null,
    flyerId: o.flyerId ?? null,
    flyerItemId: o.flyerItemId ?? null,
    note: o.note ?? null,
    chainColor: chain?.color ?? null,
  };
}

const DEPT_ORDER = DEPARTMENTS.map((d) => d.id as string);

/**
 * Deals tab: every advertised grocery item at the selected stores (not just dinner ingredients),
 * one entry per ad item, shown at the nearest selected store of its chain.
 */
export function dealsForDisplay(zip: string, stores: StoreWithDistance[]) {
  const rows = currentDeals(zip, stores.map((s) => s.id)).filter((d) => d.is_sale);
  const byChain = storesByChain(stores);
  const groups = new Map<string, Deal[]>();
  const storeById = new Map(stores.map((s) => [s.id, s]));
  for (const d of rows) {
    // One card per ad item; Kroger API prices for the same product at several stores collapse to one card.
    const key = d.flyer_item_id ? `${d.chain}:${d.flyer_item_id}` : d.source === 'kroger-api' ? d.id.replace(/^kroger:[^:]+:/, 'kroger:') : d.id;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const out = [];
  for (const ds of groups.values()) {
    // Store-level groups: show the cheapest price, nearest store on ties.
    const storeLevel = ds.every((d) => d.store_id);
    const rep = storeLevel
      ? [...ds].sort((a, b) => (a.sale_price ?? Infinity) - (b.sale_price ?? Infinity) || (storeById.get(a.store_id!)?.distance ?? 99) - (storeById.get(b.store_id!)?.distance ?? 99))[0]
      : ds.find((d) => d.canonical && d.sale_price != null) ?? ds[0];
    const targets = (storeLevel
      ? ds.map((d) => storeById.get(d.store_id!)).filter((s): s is StoreWithDistance => !!s)
      : byChain.get(rep.chain) ?? []).sort((a, b) => a.distance - b.distance);
    if (!targets.length) continue;
    const s = storeLevel ? storeById.get(rep.store_id!) ?? targets[0] : targets[0];
    const can = rep.canonical ? CANONICAL_BY_KEY.get(rep.canonical) : undefined;
    const price = rep.sale_price;
    let priceUnit = 'each';
    if (rep.sold_by === 'weight') priceUnit = 'lb';
    else if (can) priceUnit = can.unit === 'pkg' ? 'pkg' : rep.pkg_qty && rep.pkg_qty !== 1 ? `pkg (${+rep.pkg_qty.toFixed(2)} ${can.unit})` : can.unit === 'lb' ? 'pkg' : 'each';
    out.push({
      dealId: rep.id, item: rep.item_name,
      canonical: rep.canonical, canonicals: [...new Set(ds.map((d) => d.canonical).filter(Boolean))],
      dept: rep.dept, deptLabel: deptLabel(rep.dept),
      chain: rep.chain, chainName: CHAIN_BY_ID.get(rep.chain)?.name ?? rep.chain,
      store: { id: s.id, chain: s.chain, name: s.name, address: s.address, distance: s.distance }, otherStores: targets.length - 1,
      salePrice: price, promoText: rep.promo_text, priceUnit, regularPrice: rep.regular_price,
      percentOff: price != null && rep.regular_price ? Math.round((1 - price / rep.regular_price) * 100) : null,
      unitPrice: rep.unit_price, unitPriceUnit: rep.unit_price_unit,
      sizeEstimated: !!rep.size_estimated, limit: rep.limit_qty, validTo: rep.valid_to,
      ...verifyFields(rep.chain, { imageUrl: rep.image_url, sourceUrl: rep.source_url, flyerId: rep.flyer_id, flyerItemId: rep.flyer_item_id, note: rep.note }),
    });
  }
  return out.sort((a, b) => DEPT_ORDER.indexOf(a.dept) - DEPT_ORDER.indexOf(b.dept) || a.item.localeCompare(b.item));
}

function availableItems(offers: Offer[]): AvailableItem[] {
  const best = new Map<string, AvailableItem>();
  for (const o of offers) {
    const can = CANONICAL_BY_KEY.get(o.canonical)!;
    const unitPrice = o.soldBy === 'weight' ? (can.unit === 'lb' ? o.price : o.price * (can.eachLb ?? 1)) : o.price / (o.pkgQty || 1);
    const cur = best.get(o.canonical);
    if (!cur || unitPrice < cur.unitPrice) {
      best.set(o.canonical, { canonical: o.canonical, unitPrice, unit: can.unit, onSale: o.isSale || !!cur?.onSale, chains: [...new Set([...(cur?.chains ?? []), o.store.chain])] });
    } else {
      cur.onSale ||= o.isSale;
      if (!cur.chains.includes(o.store.chain)) cur.chains.push(o.store.chain);
    }
  }
  return [...best.values()];
}

export type PlanRequest = {
  budget: number; people: number; dinners: number; diet: Diet; mode?: 'prep' | 'variety';
  seed?: number; planIds?: string[]; swapIndex?: number; rejected?: string[];
};

const listView = (l: ShoppingList | undefined) =>
  l && {
    mode: l.mode, total: l.total, missing: l.missing, warnings: l.warnings, store: l.store,
    purchases: l.purchases.map((p) => ({
      canonical: p.canonical, needed: Math.round(p.needed * 100) / 100, unit: p.unit, cost: p.cost,
      lines: p.lines.map((ln) => ({
        store: ln.offer.store, itemName: ln.offer.itemName, packages: ln.packages, qty: Math.round(ln.qty * 100) / 100,
        soldBy: ln.offer.soldBy, price: ln.offer.price, regularPrice: ln.offer.regularPrice, cost: ln.cost, limit: ln.offer.limit,
        isSale: ln.offer.isSale, sizeEstimated: ln.offer.sizeEstimated, pkgQty: ln.offer.pkgQty, validTo: ln.offer.validTo,
        ...verifyFields(ln.offer.store.chain, ln.offer), lineNote: ln.note ?? null, dealNote: ln.offer.note ?? null,
      })),
    })),
  };

/** Ad clipping of the meal's main purchased ingredient (protein first), for the meal card. */
function mealImage(r: Recipe, list: ShoppingList): string | null {
  const ranked = [...r.ingredients].sort((a, b) => Number(!!CANONICAL_BY_KEY.get(b.canonical)?.protein) - Number(!!CANONICAL_BY_KEY.get(a.canonical)?.protein));
  for (const ing of ranked) {
    const img = list.purchases.find((p) => p.canonical === ing.canonical)?.lines.find((l) => l.offer.imageUrl)?.offer.imageUrl;
    if (img) return img;
  }
  return null;
}

export async function makePlan(offers: Offer[], req: PlanRequest) {
  const { people, dinners, budget, diet } = req;
  if (!(people >= 1 && people <= 12)) throw new UserError('People must be between 1 and 12.');
  if (!(dinners >= 1 && dinners <= 7)) throw new UserError('Dinners must be between 1 and 7.');
  if (!(budget > 0)) throw new UserError('Enter a weekly budget greater than $0.');
  if (!offers.length) throw new UserError('No current prices for the selected stores. Pick more stores, widen the radius, or refresh the deals.', 404);

  // Meal prep: one recipe cooked as a single batch covering every dinner (people × dinners servings).
  // Variety: a different recipe each night, each sized for `people`.
  const mode = req.mode === 'variety' ? 'variety' : 'prep';
  const batchServings = mode === 'prep' ? people * dinners : people;
  const mealsWanted = mode === 'prep' ? 1 : dinners;

  const { recipes: pool, source, warning } = await getRecipePool(availableItems(offers), diet);
  // Every recipe is re-portioned to 0.75–1 lb of food per serving and rounded to shoppable amounts.
  const usable = pool.filter((r) => diet === 'anything' || r.vegetarian).map((r) => portionRecipe(r, batchServings));
  let plan: Recipe[];
  if (req.planIds && req.swapIndex != null) {
    const current = req.planIds.map((id) => usable.find((r) => r.id === id)).filter((r): r is (typeof usable)[number] => !!r);
    if (current.length !== req.planIds.length || current.length !== mealsWanted) throw new UserError('This plan is out of date. Build a new plan.', 409);
    plan = swapMeal(usable, offers, current, req.swapIndex, req.rejected ?? [], batchServings, req.seed);
  } else {
    plan = choosePlan(usable, offers, { dinners: mealsWanted, people: batchServings, seed: req.seed });
  }

  const warnings: string[] = [];
  if (warning) warnings.push(warning);
  if (plan.length < mealsWanted) {
    warnings.push(`Only ${plan.length} of ${mealsWanted} dinners could be priced from the selected stores' current deals. Select more stores or widen the radius.`);
  }
  const best = buildList(plan, batchServings, offers);
  const oneStore = buildOneStoreList(plan, batchServings, offers);
  if (best.missing.length) {
    warnings.push(`No current price at your selected stores for: ${best.missing.join(', ')}. These are on the shopping list without a price and are NOT included in the total.`);
  }
  const costs = mealCosts(plan, batchServings, best);
  const saleSet = new Set(offers.filter((o) => o.isSale).map((o) => o.canonical));
  const total = best.total;
  const totalServings = people * dinners;
  return {
    recipeSource: source,
    model: hasAnthropic() ? config.anthropicModel : null,
    mode,
    people,
    dinners,
    batchServings,
    meals: plan.map((r, i) => ({
      ...r,
      ingredients: r.ingredients.map((x) => ({ ...x, unit: CANONICAL_BY_KEY.get(x.canonical)?.unit ?? 'each' })),
      cost: costs[i],
      perServing: Math.round((costs[i] / batchServings) * 100) / 100,
      plateLb: (r as Recipe & { plateLb?: number }).plateLb ?? null,
      onSale: r.ingredients.filter((x) => saleSet.has(x.canonical)).map((x) => x.canonical),
      unpriced: unpriced(r, offers),
      image: mealImage(r, best),
    })),
    unpricedCount: best.missing.length,
    total,
    budget,
    perPerson: Math.round((total / people) * 100) / 100,
    perServing: plan.length ? Math.round((total / totalServings) * 100) / 100 : 0,
    underBudget: total <= budget,
    difference: Math.round((budget - total) * 100) / 100,
    best: listView(best),
    oneStore: listView(oneStore),
    warnings: [...warnings, ...best.warnings],
  };
}
