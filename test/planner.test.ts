import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costAt, priceNeed, buildList, buildOneStoreList, choosePlan, swapMeal, mealCosts, shopQty, portionRecipe, plateLbPerServing, type Offer } from '../src/planner.ts';
import { finalizeRecipe, type Recipe } from '../src/recipes.ts';

const storeA = { id: 'a', chain: 'aldi', name: 'ALDI', address: '1 Main', distance: 1 };
const storeB = { id: 'b', chain: 'kroger', name: 'Kroger', address: '2 Main', distance: 3 };

let n = 0;
const offer = (o: Partial<Offer> & Pick<Offer, 'canonical' | 'price'>): Offer => ({
  dealId: `d${n++}`, itemName: o.canonical, regularPrice: null, soldBy: 'package', pkgQty: 1, sizeEstimated: false,
  limit: null, isSale: true, validTo: null, store: storeA, ...o,
});

const recipe = (name: string, ingredients: [string, number][]): Recipe =>
  finalizeRecipe({ name, servings: 4, minutes: 30, pantry: [], method: [], source: 'builtin', ingredients: ingredients.map(([canonical, qty]) => ({ canonical, qty })) })!;

test('weight items are priced per lb, packages round up', () => {
  assert.deepEqual(costAt(offer({ canonical: 'chicken breast', price: 1.99, soldBy: 'weight', pkgQty: null }), 1.5), { packages: null, qty: 1.5, cost: 2.99 });
  // need 1.5 lb rice, sold in 2 lb bags -> 1 bag
  assert.equal(costAt(offer({ canonical: 'rice', price: 2.5, pkgQty: 2 }), 1.5)!.packages, 1);
  // need 2.5 lb rice -> 2 bags
  assert.deepEqual(costAt(offer({ canonical: 'rice', price: 2.5, pkgQty: 2 }), 2.5), { packages: 2, qty: 4, cost: 5 });
  // need 3 bell peppers sold each
  assert.equal(costAt(offer({ canonical: 'bell peppers', price: 0.79 }), 3)!.cost, 2.37);
});

test('picks the cheapest store for each item', () => {
  const p = priceNeed('ground beef', 1, [
    offer({ canonical: 'ground beef', price: 4.99, soldBy: 'weight', store: storeA }),
    offer({ canonical: 'ground beef', price: 2.99, soldBy: 'weight', store: storeB }),
  ])!;
  assert.equal(p.cost, 2.99);
  assert.equal(p.lines[0].offer.store.id, 'b');
});

test('respects purchase limits by filling the remainder elsewhere', () => {
  const p = priceNeed('canned beans', 4, [
    offer({ canonical: 'canned beans', price: 0.5, limit: 2, store: storeA }),
    offer({ canonical: 'canned beans', price: 1.0, store: storeB }),
  ])!;
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[0].packages, 2);
  assert.equal(p.lines[1].packages, 2);
  assert.equal(p.cost, 3);
});

test('over-limit with no alternative uses regular price', () => {
  const p = priceNeed('canned beans', 3, [offer({ canonical: 'canned beans', price: 0.5, limit: 1, regularPrice: 1.29 })])!;
  assert.equal(p.cost, 0.5 + 2 * 1.29);
});

test('shared packages are bought once across meals', () => {
  const offers = [offer({ canonical: 'rice', price: 2, pkgQty: 2 }), offer({ canonical: 'eggs', price: 2, pkgQty: 12 }), offer({ canonical: 'frozen vegetables', price: 1 })];
  const m1 = recipe('Fried rice', [['rice', 0.75], ['eggs', 3]]);
  const m2 = recipe('Veg rice', [['rice', 0.75], ['frozen vegetables', 1]]);
  const list = buildList([m1, m2], 4, offers);
  assert.equal(list.purchases.find((p) => p.canonical === 'rice')!.lines[0].packages, 1);
  assert.equal(list.total, 5);
  const costs = mealCosts([m1, m2], 4, list);
  assert.equal(Math.round((costs[0] + costs[1]) * 100) / 100, list.total);
});

test('scales quantities by number of people', () => {
  const offers = [offer({ canonical: 'chicken breast', price: 2, soldBy: 'weight', pkgQty: null })];
  const m = recipe('Chicken', [['chicken breast', 2]]);
  assert.equal(buildList([m], 2, offers).total, 2); // 1 lb for 2 people
  assert.equal(buildList([m], 8, offers).total, 8); // 4 lb for 8 people
});

test('one-store mode chooses the cheapest complete single stop', () => {
  const offers = [
    offer({ canonical: 'pasta', price: 1, store: storeA }),
    offer({ canonical: 'pasta sauce', price: 3, store: storeA }),
    offer({ canonical: 'pasta', price: 0.8, store: storeB }),
    // store B has no sauce -> incomplete
  ];
  const m = recipe('Spaghetti', [['pasta', 1], ['pasta sauce', 1]]);
  const best = buildList([m], 4, offers);
  assert.equal(best.total, 3.8);
  const one = buildOneStoreList([m], 4, offers)!;
  assert.equal(one.store!.id, 'a');
  assert.equal(one.total, 4);
  assert.deepEqual(one.missing, []);
});

test('greedy plan limits repeats of the same protein and skips unpriceable recipes', () => {
  const offers = [
    offer({ canonical: 'chicken breast', price: 1, soldBy: 'weight', pkgQty: null }),
    offer({ canonical: 'ground beef', price: 3, soldBy: 'weight', pkgQty: null }),
    offer({ canonical: 'pasta', price: 1 }),
  ];
  const pool = [
    recipe('Chicken A', [['chicken breast', 1]]),
    recipe('Chicken B', [['chicken breast', 1.1]]),
    recipe('Chicken C', [['chicken breast', 1.2]]),
    recipe('Beef pasta', [['ground beef', 1], ['pasta', 1]]),
    recipe('Salmon', [['salmon', 1]]), // no salmon offer -> never picked
  ];
  const plan = choosePlan(pool, offers, { dinners: 3, people: 4 });
  assert.equal(plan.length, 3);
  assert.equal(plan.filter((r) => r.protein === 'chicken').length, 2);
  assert.ok(plan.some((r) => r.name === 'Beef pasta'));
  assert.ok(!plan.some((r) => r.name === 'Salmon'));
});

test('swap replaces one meal and keeps the rest', () => {
  const offers = [offer({ canonical: 'eggs', price: 2, pkgQty: 12 }), offer({ canonical: 'pasta', price: 1 }), offer({ canonical: 'canned beans', price: 1 })];
  const pool = [recipe('Eggs', [['eggs', 6]]), recipe('Pasta', [['pasta', 1]]), recipe('Beans', [['canned beans', 2]])];
  const plan = choosePlan(pool, offers, { dinners: 2, people: 4 });
  const swapped = swapMeal(pool, offers, plan, 0, [], 4);
  assert.equal(swapped.length, 2);
  assert.equal(swapped[1].id, plan[1].id);
  assert.notEqual(swapped[0].id, plan[0].id);
});

test('meat and produce round to the nearest half pound, counts to whole items', () => {
  assert.equal(shopQty('ground beef', 1.1), 1);
  assert.equal(shopQty('ground beef', 1.3), 1.5);
  assert.equal(shopQty('ground beef', 2), 2);
  assert.equal(shopQty('potatoes', 0.2), 0.5); // never below half a pound
  assert.equal(shopQty('bell peppers', 2.2), 2);
  assert.equal(shopQty('tortillas', 1.4), 2); // packages always round up
});

test('portions every serving to 0.75–1 lb of food and sizes the batch for people × dinners', () => {
  // Light recipe: 1 lb chicken + 1 lb broccoli for 4 = 0.5 lb/serving -> scaled up to 0.75 lb.
  const light = recipe('Light', [['chicken breast', 1], ['broccoli', 1]]);
  const batch = portionRecipe(light, 12); // 4 people × 3 dinners
  assert.equal(batch.servings, 12);
  // 0.75 lb × 12 = 9 lb of food, split evenly -> 4.5 lb each, already on a half pound
  assert.deepEqual(batch.ingredients, [{ canonical: 'chicken breast', qty: 4.5 }, { canonical: 'broccoli', qty: 4.5 }]);
  assert.ok(batch.plateLb >= 0.75 && batch.plateLb <= 1);

  // Heavy recipe: 3 lb roast + 2 lb potatoes for 4 = 1.25 lb/serving -> scaled down to 1 lb.
  const heavy = portionRecipe(recipe('Heavy', [['beef roast', 3], ['potatoes', 2]]), 2);
  for (const ing of heavy.ingredients) assert.equal((ing.qty * 2) % 1, 0, 'half-pound multiples');
  assert.ok(heavy.plateLb <= 1 && heavy.plateLb >= 0.75);

  // Small batches: rounding three items to half pounds must not push servings over 1 lb.
  const small = portionRecipe(recipe('Drumsticks', [['chicken drumsticks', 2.5], ['sweet potatoes', 2], ['green beans', 2]]), 2);
  assert.ok(small.plateLb <= 1 && small.plateLb >= 0.75, `got ${small.plateLb}`);
  assert.ok(small.ingredients.find((i) => i.canonical === 'chicken drumsticks')!.qty >= 1, 'trims sides before protein');

  // A recipe already in range keeps its proportions.
  assert.equal(plateLbPerServing(recipe('Ok', [['ground beef', 2], ['rice', 0.5]])), (2 + 0.5 * 3) / 4);
});
