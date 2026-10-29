import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDept } from '../src/departments.ts';

// All names below are real items from DFW weekly ads (Oct 28 – Nov 3, 2026).
const cases: [string, string | null][] = [
  ['Blackberries or Raspberries', 'produce'],
  ['Honeycrisp or Bartlett Pears', 'produce'],
  ['Organic Honey Crisp Apples', 'produce'],
  ['Kroger Adorbs Seedless Mandarins', 'produce'],
  ['Bok Choy', 'produce'],
  ['Bard Valley Medjool Dates', 'produce'],
  ['Pork Baby Back Ribs or St. Louis Style Pork Spareribs', 'meat'],
  ['Wild-Caught Snow Crab Clusters', 'meat'],
  ['Butterball Turkey', 'meat'],
  ['Thin Cut Pork Rolls', 'meat'],
  ['Sargento Cheese', 'dairy'],
  ['Yoplait Yogurt', 'dairy'],
  ['Pillsbury Crescent Rolls', 'bakery'],
  ['Fresh Made Halloween Cakes', 'bakery'],
  ['Stonefire Naan Rounds', 'bakery'],
  ['H-E-B Sushiya® Party Trays', 'deli'],
  ['Fresh Made Fruit Bowls Cantaloupe, Pineapple, Watermelon or Melon Medley', 'deli'],
  ['Oscar Mayer Deli Fresh Lunch Meat', 'deli'],
  ['Meal Simple® Chicken Tikka Masala or Butter Chicken Bowl', 'deli'],
  ['Marie Callender\'s Bowls Pot Pies or Healthy Choice Café Steamers', 'deli'],
  ['Kroger Ice Cream', 'frozen'],
  ['Totino\'s Ultimate Frozen Pizza Singles', 'frozen'],
  ['Kellogg\'s® Eggo® Waffles, Pancakes or Toaster Sticks', 'frozen'],
  ['Campbell\'s Chicken Noodle or Tomato Soup', 'pantry'],
  ['Hellmann\'s Mayonnaise', 'pantry'],
  ['Eagle Brand Sweetened Condensed Milk 14 oz.', 'pantry'],
  ['Lay\'s Potato or Kettle Cooked Potato Chips', 'snacks'],
  ['Affy Tapple Caramel Apples', 'snacks'],
  ['Nabisco Oreo or Chips Ahoy Family Size Cookies', 'snacks'],
  ['Pepsi or Dr Pepper', 'beverages'],
  ['Simple Truth Almondmilk', 'beverages'],
  ['Topo Chico Sabores', 'beverages'],
  ['Miller Lite, Coors or Bud Light', 'alcohol'],
  ['Barefoot, Woodbridge or Yellow Tail', 'alcohol'],
  // Market Street
  ['19 Crimes', 'alcohol'],
  ['Capri Sun', 'beverages'],
  ['Kemps Sherbet', 'frozen'],
  ['Tyson Spooky Nuggets', 'frozen'],
  ['Eckrich Li\'L Smokies', 'meat'],
  ['Provolone', 'dairy'],
  ['Snickers, Twix or Milky Way Jumbo Size', 'snacks'],
  ['Hefty Plates or Cups', null],
  ['Crane Humidifiers', null],
  ['Beggin\' Strips', null],
  ['Maybelline or L\'oreal Cosmetics', null],
  // Sprouts
  ['Milton\'s Frozen Cauliflower Crust Pizza or Butcher\'s Board Gluten-Free Frozen Pizza', 'frozen'],
  ['Hippeas Chickpea Puffs, Skinny Pop Popcorn or Khloud Protein Popcorn', 'snacks'],
  ['Wild-Caught Mahi Mahi Fillets', 'meat'],
  ['Brittle Brittle Roasted Toffee or Brittle', 'snacks'],
  ['Primal Kitchen Collagen Keto Latte, Peptides or Fuel', 'beverages'],
  ['Kroger Mixed Vegetable Blend', 'produce'],
  ['Cymbiotika Suplements', null],
  ['Aura Cacia Aromatherapy', null],
  ['Herbatint Hair Color or Touch Up', null],
  ['SUPER BOGO SALE - HEADER', null],
  // non-grocery
  ['Tide Laundry Detergent', null],
  ['Bounty Paper Towels', null],
  ['Merry Moments LED Snowman', null],
  ['Purina Dog or Cat Treat Items', null],
  ['Milk Bone Biscuits', null],
  ['Pumpkin Carving Kits', null],
  ['Bloom Haus Dozen Roses', null],
  ['Nature Made Supplements 24-300 ct', null],
  ['Ambiano Digital Kitchen Scale', null],
  ['earn 4x points', null],
];

test('sorts real flyer items into store departments', () => {
  for (const [name, dept] of cases) assert.equal(classifyDept(name), dept, name);
});

test('rejects flyer banner tiles and keeps odd-but-real foods', () => {
  for (const banner of ['Kroger Dallas 035', 'Top Deals', 'Fresh Meat', 'Assorted Products', 'SAVE up to $20 on groceries', 'WINE']) {
    assert.equal(classifyDept(banner), null, banner);
  }
  assert.equal(classifyDept('Cacique Chorizo'), 'meat');
  assert.equal(classifyDept('O Organics® Lentils'), 'pantry');
  assert.equal(classifyDept('Specially Selected Italian Breadsticks'), 'bakery');
  assert.equal(classifyDept('Aiko Garden Fruit Bucket'), 'produce');
  assert.equal(classifyDept('NABISCO Multi Packs'), 'snacks');
});
