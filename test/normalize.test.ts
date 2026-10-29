import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCanonical, matchAdName, parseSize, parsePrice, parseLimit, sizeInBase, CANONICAL_BY_KEY } from '../src/normalize.ts';

const key = (s: string) => matchCanonical(s)?.key;

test('maps product names to canonical ingredients', () => {
  assert.equal(key('Kroger Boneless Skinless Chicken Breast 2lb pack'), 'chicken breast');
  assert.equal(key('93% Lean Ground Beef'), 'ground beef');
  assert.equal(key('Fresh Diced Boneless Chicken Breast'), 'chicken breast');
  assert.equal(key('Russet Potatoes 5 lb bag'), 'potatoes');
  assert.equal(key('Sweet Potatoes'), 'sweet potatoes');
  assert.equal(key('Lucerne Large Eggs 18 ct.'), 'eggs');
  assert.equal(key('Kraft Shredded Cheddar Cheese 8 oz'), 'shredded cheese');
  assert.equal(key('Barilla Spaghetti 16 oz'), 'pasta');
  assert.equal(key('Bush\'s Black Beans 15 oz'), 'canned beans');
});

test('rejects look-alike products', () => {
  assert.equal(key('Tyson Breaded Chicken Breast Nuggets'), undefined);
  assert.equal(key('Lay\'s Potato Chips'), undefined);
  assert.equal(key('Easter Egg Dye Kit'), undefined);
  assert.equal(key('Swanson Chicken Broth'), 'chicken broth');
  assert.equal(key('Kraft Mac & Cheese'), undefined);
  assert.equal(key('Simply Lemonade'), undefined);
  assert.equal(key('Peanut Butter'), undefined);
});

test('splits multi-product flyer names', () => {
  const m = matchAdName('Signature SELECT® Fresh Boneless Skinless Chicken Breasts or Value Pack Pork Loin Chops');
  assert.deepEqual(m.map((x) => x.canonical.key), ['chicken breast', 'pork chops']);
  const m2 = matchAdName('Simply Lemonade or Punch 52 oz., Blue Diamond Almond Breeze Milk Half Gallon or Lucerne® Large Eggs 18 ct.');
  assert.deepEqual(m2.map((x) => x.canonical.key), ['eggs']);
  assert.equal(parseSize(m2[0].part)?.qty, 18);
});

test('parses package sizes into base units', () => {
  assert.deepEqual(parseSize('Mrs. Baird\'s Bread 20 oz.'), { qty: 20, unit: 'oz' });
  assert.deepEqual(parseSize('Donuts 9-9.5 oz'), { qty: 9, unit: 'oz' });
  assert.deepEqual(parseSize('Large Eggs 1 dozen'), { qty: 12, unit: 'ct' });
  assert.deepEqual(parseSize('Russet Potatoes 5 lb bag'), { qty: 5, unit: 'lb' });
  assert.equal(sizeInBase({ qty: 32, unit: 'oz' }, CANONICAL_BY_KEY.get('rice')!), 2);
  assert.equal(sizeInBase({ qty: 18, unit: 'ct' }, CANONICAL_BY_KEY.get('eggs')!), 18);
  assert.equal(sizeInBase({ qty: 2, unit: 'lb' }, CANONICAL_BY_KEY.get('bell peppers')!), 5);
  assert.equal(sizeInBase({ qty: 12, unit: 'ct' }, CANONICAL_BY_KEY.get('rice')!), undefined);
});

test('interprets flyer price text', () => {
  assert.deepEqual(parsePrice({ current_price: '2.77', price_text: 'lb member price' }), {
    price: 2.77, soldBy: 'weight', multiBuy: undefined, note: 'member/digital price',
  });
  const twoFor = parsePrice({ current_price: 5, pre_price_text: '2/' });
  assert.equal(twoFor?.price, 2.5);
  assert.equal(twoFor?.soldBy, 'package');
  assert.equal(parsePrice({ current_price: 10, pre_price_text: '10 for' })?.price, 1);
  assert.equal(parsePrice({ current_price: null }), undefined);
  assert.equal(parsePrice({ current_price: '' }), undefined);
});

test('parses purchase limits', () => {
  assert.equal(parseLimit('Limit 2 Each'), 2);
  assert.equal(parseLimit(null, 'With card. Limit of 4.'), 4);
  assert.equal(parseLimit('Must buy 2'), undefined);
});

test('rejects non-food and brand look-alikes seen in real flyers', () => {
  assert.equal(key('Cape Cod 7-8 oz.'), undefined);
  assert.equal(key('Lysol Disinfecting Wipes Lemon Scent'), undefined);
  assert.equal(key("Lay's Potato"), undefined);
  assert.equal(key('Minute Rice Microwave Cups'), undefined);
  assert.equal(key('Kroger Crunchy Butterfly Shrimp'), undefined);
  assert.equal(key('Kroger Tilapia'), 'white fish');
  assert.equal(key('H-E-B Wagyu Ground Beef Chuck/Brisket Burgers'), undefined);
  assert.equal(key('Meal Simple® Chicken Tikka Masala or Butter Chicken Bowl'), undefined);
  // Real Walmart flyer item: split parts lose "Lysol", so the whole name must be checked.
  assert.deepEqual(matchAdName('Lysol Disinfecting Wipes Multi Surface Cleaner, 80 Count Each, Pack of 4, Lemon & Mango Scent'), []);
});
