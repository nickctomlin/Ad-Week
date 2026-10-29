// Sorts every weekly-ad item into a store department for the Deals tab, or rejects it as
// non-grocery (household, health & beauty, decor, apparel...). Checked in order; first match wins.
// Tuned against real DFW flyer item names — see test/departments.test.ts.

export type DeptId = 'meat' | 'produce' | 'dairy' | 'bakery' | 'deli' | 'frozen' | 'pantry' | 'snacks' | 'beverages' | 'alcohol' | 'other';

export const DEPARTMENTS: { id: DeptId; label: string }[] = [
  { id: 'meat', label: 'Meat & seafood' },
  { id: 'produce', label: 'Produce' },
  { id: 'dairy', label: 'Dairy & eggs' },
  { id: 'bakery', label: 'Bakery' },
  { id: 'deli', label: 'Deli & prepared' },
  { id: 'frozen', label: 'Frozen' },
  { id: 'pantry', label: 'Pantry' },
  { id: 'snacks', label: 'Snacks & sweets' },
  { id: 'beverages', label: 'Beverages' },
  { id: 'alcohol', label: 'Beer & wine' },
  { id: 'other', label: 'Other grocery' },
];

const NON_GROCERY = new RegExp([
  // household & paper
  'paper towels?', 'bath tissue', 'facial tissue','napkins', 'paper (plates|bowls)', '\\bplates or bowls', 'dixie', 'angel soft', 'brawny', 'charmin', 'cottonelle',
  'trash bags', 'food storage', 'storage (set|bin|containers?)', 'containers', 'latch box', 'handi-?foil', 'foil pans', 'good ?cook', 'anchor hocking', 'rubbermaid', 'gadgets?', 'bakeware',
  'utensils?', 'cookie sheet', 'roasting pan', 'kitchen (scale|mat)', 'electric knife', 'vacuum food sealer', 'warming plate',
  'detergent', 'fabric (soft|rinse)', '\\bdowny\\b', '\\bgain\\b', '\\btide\\b', '\\bbounce\\b', 'dreft', 'dish(washing| spray)', 'dawn\\b', 'cascade', 'cleaner', 'cleaning', 'wipes', 'disinfect',
  'sanitizer', 'lysol', 'febreze', 'air wick', 'glade', 'windex', 'scrubbing bubbles', 'mr\\.? clean', 'fabuloso', 'swiffer', 'bona\\b', 'mops?\\b', 'brooms?', 'brushes', 'libman',
  'candles?', 'wax melts', 'light bulbs?', 'batter(y|ies)', 'energizer', 'charcoal', 'briquets', 'grilling pellets', 'lighter', 'balloons?',
  // personal care & pharmacy
  'shampoo', 'conditioner', 'hair ?care', 'toothpaste', 'mouthwash', 'listerine', 'crest\\b', 'scope\\b', 'deodorant', 'body (wash|scrub)', '\\bsoap\\b', 'lotion', 'cartridges', 'razor',
  'tampons?', 'tampax', '\\bpads?\\b', 'always or', 'playtex', 'stayfree', 'carefree', 'diapers', 'baby (items|wipes|club)', 'vitamins?', 'supp?lements?', 'protein powder', 'body care', 'health support', 'sleep support', 'aromatherapy', 'aura cacia', 'hair colou?r', 'herbatint', 'tylenol', 'aleve', 'bayer',
  'dayquil', 'nyquil', 'mucinex', 'pepcid', 'imodium', 'alka.?seltzer', 'afrin', 'coricidin', 'halls\\b', 'pedialyte', 'mascara', 'eyeshadow', 'henna', 'flu shot', 'one-a-day',
  // decor, home, apparel, seasonal, flowers, pets
  'sheets', 'comforter', 'coverlet', 'pillows?', 'air bed', 'slippers', 'pajamas', 'clogs', 'pullover', '\\bthrow\\b', 'decorations?\\b', 'tinsel', '\\btree\\b', '\\bled\\b', 'string lights', 'gnome',
  'snowman', 'ceramic', 'pumpkin (carving|pails)', 'treat bowl', 'party goods', 'carriers', 'carving accessories', 'baking accessories', 'holiday home', 'fall (plates|napkins|accessories|novelty|candles)',
  'bouquet', '\\broses\\b', 'orchid', 'marigolds', 'chrysanthemum', '\\bflowers?\\b', '\\bplants?\\b(?!.?based)', '\\bpets?\\b', '\\bdog\\b', '\\bcat\\b', 'purina', 'milk.?bone', 'coffee table', '\\btables?\\b',
  'hefty', 'plates or cups', 'partyware', 'humidifiers?', 'cosmetics', 'favors', 'costume', 'buckets', 'plush', 'cotton balls', 'swabs', 'theraflu',
  "beggin'?", 'sincerely health', 'see all savings',
  'gift cards?', 'gas rewards', 'earn \\d+x', '\\d+x points', 'we deliver', 'digital coupon', 'cake d[eé]cor', 'advent calendar',
].join('|'), 'i');

const RULES: [DeptId, RegExp][] = [
  ['alcohol', /\b(beer|wine|wines|cider|hard seltzer|white claw|cayman jack|twisted tea|truly|bud|bud light|budweiser|miller|coors|michelob|modelo|corona|pacifico|dos equis|victoria|yuengling|shiner|lone star|busch|keystone|natural light|eight elite|buzzballz|fireball|mxd|josh|la ?marca|kim crawford|coppola|apothic|m[eé]nage|barefoot|woodbridge|yellow tail|bota box|black box|korbel|oyster bay|freixenet|mionetto|erath|freakshow|unshackled|ghost pines|headsnapper|archer roose|zinfandel|19 crimes|cabernet|chardonnay|merlot|pinot|prosecco|champagne|tequila|vodka|whiskey|bourbon|angry orchard)\b/i],
  ['deli', /\bdeli\b|made in store|tamales|meal simple|tikka masala|butter chicken|\bbowls?\b|sushi|party tray|\btrays?\b|rotisserie|fried chicken|\d+ ?pc\.? (fried|roasted)|wings or tenders|lunch meat|salami|italian meat|guacamole|queso|hummus|\bdips?\b|fruit bowls?|fruit tray|veggie tray|seafood poppers|handcrafted drink|breakfast sandwich|ready to eat|cheese assortment|cheese trio|cheese spread/i],
  ['frozen', /frozen|ice cream|gelato|sherbet|nuggets|pizzetta|popsicle|fruit pops|kulfi|pizza rolls|totino|digiorno|red baron|stouffer|marie callender|healthy choice|lean cuisine|hot pockets|eggo|waffles|toaster sticks|steamable|steamfresh|simply steam|birds eye|skillet meals|taquitos|mini tacos|corn dogs|appetizers?|farm rich|ore.?ida|\btots\b|\bfries\b|entr[eé]es?|blue bell|ben & jerry|blue bunny|mini swirls|bibigo|pagoda|mightycrust|\bpizzas?\b|creme pies|cheesecakes/i],
  ['beverages', /\bsoda\b|soft drinks|latte|capri sun|party barrels|cola\b|coca-cola|\bcoke\b|pepsi|dr pepper|sprite|7up|mountain dew|jarritos|poppi|olipop|juice|lemonade|\bpunch\b|\bwater\b|topo chico|pellegrino|mineral|sparkling|bubly|spindrift|liquid death|bubblr|dasani|gatorade|powerade|bodyarmor|kool.?aid|sunny d|\btea\b|pure leaf|gold peak|coffee|k-cups?|\bpods\b|nescaf|starbucks|mccafe|peet'?s|energy (drink|shots)|celsius|red bull|monster|\bbum\b|5-hour|kombucha|almond ?milk|almond breeze|oat ?milk|hot chocolate|abuelita|\bshots?\b/i],
  ['snacks', /chips|crisps|toffee|brittle|snickers|twix|milky way|snackers|multipacks|pretzels?|popcorn|crackers?|cookies?|oreo|grahams|wafers|candy|chocolate|fun size|share size|sharing size|m&m|skittles|starburst|nerds|dum-dums|hershey|\bmars\b|kinder|ferrero|lindt|ghirardelli|morsels|\bgum\b|trident|\bnuts\b|peanuts|almonds|pistachio|cashews|trail mix|granola|\bbars?\b|clif\b|luna\b|kind bar|nature valley|snacks?\b|cheetos|doritos|fritos|lay'?s|ruffles|takis|pringles|tostitos|goldfish|cheez-it|ritz|slim jim|jerky|pork rinds|cracklins|seaweed|pocky|applesauce|squeez|caramel|gummi|chewy|dipped|biscuits|pudding|chichurritos|gamesa|pastries|bimbo|nabisco|gulab jamun|rossogulla|rasmalai|\bsweets\b/i],
  ['bakery', /bakery|fresh baked|fresh made|\bbread\b|breadsticks|\bbuns?\b|(dinner|crescent|hawaiian|sandwich|sweet|cinnamon) rolls|bagels?|muffins?(?! mix)|donuts?|doughnuts?|croissants?|conchas|turnovers|tres leches|cakes?\b|cupcakes?|brownie bites|madeleines|palmiers|\broti\b|naan|flatbread|tortillas?\b|king'?s hawaiian|\bpies?\b/i],
  ['dairy', /(?<!condensed |coconut |evaporated )\bmilk\b|\beggs?\b|cheese|provolone|cheddar|gouda|edam|mozzarella|parmesan|velveeta|sargento|yogurt|yoplait|oikos|dannon|chobani|fage|\bbutter\b|\bghee\b|sour cream|creamer|half & half|cottage|reddi.?wip|whipped|paneer|\bcream\b/i],
  ['pantry', /soups?\b|broth|bouillon|gravy|ramen|ramyun|noodles|mac(aroni)? (&|and) cheese|knorr|sides\b|cereal|kellogg|general mills|froot loops|chex|oatmeal|\bsauce\b|sauces|sriracha|soy sauce|dressing|mayo|mayonnaise|miracle whip|ketchup|mustard|peanut butter|jelly|fruit spread|\bspreads?\b|\bhoney\b(?! ?crisp)|syrup|flour|sugar|\boil\b|olive oil|cooking spray|\bspices?\b|seasoning|curry|chutney|pickles|olives|mango pulp|\bpumpkin\b|condensed milk|coconut milk|baking|(cake|muffin|brownie|cornbread|pancake) mix|mashed potatoes|\brice\b|pasta|beans|canned|salsa|stuffed peppers|kodiak|lentils/i],
  ['meat', /chicken|beef|steak|smokies|bone-in|mahi|halibut|trout|swordfish|sea ?bass|just bare|roast|brisket|ground|pork|ribs|chops|bacon|sausage|franks|hot dogs?|\bbrats?\b|\bham\b|turkey|lamb|\bduck\b|\bgoat\b|veal|meatballs?|wings|tenders|\bbites\b|salmon|\bfish\b|tilapia|\bcod\b|catfish|shrimp|\bcrab\b|lobster|scallops|oysters|seafood|stew meat|birria|chorizo|kielbasa|tenderloin|patties|cutlets|\brolls?\b/i],
  ['produce', /apples?\b|bananas?|oranges?\b|mandarins|clementines|cuties|grapes|berr(y|ies)|strawberr|blueberr|raspberr|blackberr|avocados?|tomato|potato|\byams?\b|onions?|peppers?\b|lettuce|salads?\b|spinach|kale|broccoli|cauliflower|carrots?|celery|cucumbers?|squash|zucchini|\bcorn\b|mushrooms?|garlic|ginger|limes?\b|lemons?\b|mangos?\b|mangoes|pineapples?|melon|watermelon|cantaloupe|peach(es)?|pears?\b|plums?|cherr(y|ies)|kiwi|pomegranates?|citrus|herbs|cilantro|asparagus|green beans|bok choy|dates\b|\bfruits?\b|vegetables?\b|veggies|fixings|stir fry mix|produce/i],
];

export function deptLabel(id: string): string {
  return DEPARTMENTS.find((d) => d.id === id)?.label ?? 'Other grocery';
}

/** Department for a dinner-ingredient canonical (used when the matcher already identified the item). */
export function deptForCanonical(key: string, category: string): DeptId {
  if (key === 'eggs') return 'dairy';
  if (key === 'canned beans' || key === 'lentils' || key === 'canned tuna') return 'pantry';
  if (key === 'tofu') return 'produce';
  if (key === 'rotisserie chicken') return 'deli';
  if (key === 'tortillas' || key === 'bread') return 'bakery';
  return ({ protein: 'meat', produce: 'produce', dairy: 'dairy', grain: 'pantry', canned: 'pantry', frozen: 'frozen' } as Record<string, DeptId>)[category] ?? 'other';
}

// Section headers and promo tiles that flyers include as clickable "items".
const BANNER = /^(kroger( dallas \d+)?|top deals|our brands|meal planning|signmeup|assorted products|p&g products|groceries & fresh foods|fresh (meat|seafood|fruit & vegetables)|bakery|deli & bakery|wine|13 scary days|some favorites.*|save up to .*|exclusive digital.*|super bogo sale.*|holiday meals.*|cozy family meal.*|.* - header)$/i;

/** Department for any ad item name, or null if it isn't a grocery item. */
export function classifyDept(name: string): DeptId | null {
  if (NON_GROCERY.test(name) || BANNER.test(name.trim())) return null;
  for (const [id, re] of RULES) if (re.test(name)) return id;
  return 'other';
}
