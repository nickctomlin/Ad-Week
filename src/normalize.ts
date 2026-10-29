// Maps raw ad/product names to canonical ingredients and parses price/unit/limit text.
// Pure functions only — tested in test/normalize.test.ts.

export type BaseUnit = 'lb' | 'each' | 'pkg';
export type Category = 'protein' | 'produce' | 'dairy' | 'grain' | 'canned' | 'frozen' | 'other';

export type Canonical = {
  key: string;
  category: Category;
  unit: BaseUnit; // unit recipes use for this ingredient
  protein?: string; // protein group for variety rules
  vegetarian: boolean;
  match: RegExp[];
  exclude?: RegExp[];
  defaultPkg?: number; // typical package size in base unit (used only when the ad doesn't say; marked "est.")
  eachLb?: number; // approx weight of one item, to use per-lb prices for 'each' ingredients
  search: string; // search term for product APIs
};

const c = (key: string, category: Category, unit: BaseUnit, match: RegExp[], o: Partial<Canonical> = {}): Canonical => ({
  key,
  category,
  unit,
  match,
  vegetarian: o.protein ? ['eggs', 'beans', 'tofu', 'lentils'].includes(o.protein) : true,
  search: key,
  ...o,
});

const meatNot = [/broth|stock|soup|seasoning|bouillon|flavor|dog food|cat food|baby food|jerky|chips|ramen|noodle cup|burgers?\b|patt(y|ies)/i];

export const CANONICALS: Canonical[] = [
  // Proteins
  c('chicken breast', 'protein', 'lb', [/chicken breast/i, /breast(s)? of chicken/i], { protein: 'chicken', vegetarian: false, defaultPkg: 2.5, exclude: [...meatNot, /breaded|nugget|tender|fritter|patt(y|ies)|strip|popcorn|crispy|canned|lunch ?meat|deli|sliced|salad|wing/i] }),
  c('chicken thighs', 'protein', 'lb', [/chicken thigh/i], { protein: 'chicken', vegetarian: false, defaultPkg: 3, exclude: meatNot }),
  c('chicken drumsticks', 'protein', 'lb', [/drumstick/i, /chicken leg/i, /leg quarter/i], { protein: 'chicken', vegetarian: false, defaultPkg: 3, exclude: meatNot }),
  c('whole chicken', 'protein', 'lb', [/whole (fryer|chicken)/i, /fryer chicken/i], { protein: 'chicken', vegetarian: false, defaultPkg: 4.5, exclude: [...meatNot, /rotisserie/i] }),
  c('rotisserie chicken', 'protein', 'each', [/rotisserie chicken/i], { protein: 'chicken', vegetarian: false, defaultPkg: 1 }),
  c('ground beef', 'protein', 'lb', [/ground (beef|chuck|round|sirloin)/i, /lean ground/i, /hamburger meat/i], { protein: 'beef', vegetarian: false, defaultPkg: 1, exclude: [...meatNot, /turkey|pork|patt(y|ies)|meatball|burgers?\b/i] }),
  c('beef steak', 'protein', 'lb', [/sirloin steak|ribeye|rib eye|strip steak|chuck steak|flank steak|skirt steak|t-bone|new york strip|top sirloin|round steak/i], { protein: 'beef', vegetarian: false, defaultPkg: 1.5, exclude: [...meatNot, /ground|salmon|tuna|cauliflower/i] }),
  c('beef roast', 'protein', 'lb', [/chuck roast|pot roast|rump roast|brisket|round roast|eye of round/i], { protein: 'beef', vegetarian: false, defaultPkg: 3, exclude: meatNot }),
  c('pork chops', 'protein', 'lb', [/pork (loin )?chops?/i, /\bchops\b/i], { protein: 'pork', vegetarian: false, defaultPkg: 2, exclude: [...meatNot, /lamb/i] }),
  c('pork loin', 'protein', 'lb', [/pork (loin|tenderloin)/i], { protein: 'pork', vegetarian: false, defaultPkg: 3, exclude: [...meatNot, /chop/i] }),
  c('pork shoulder', 'protein', 'lb', [/pork (shoulder|butt|steak)/i, /boston butt/i, /country style ribs/i], { protein: 'pork', vegetarian: false, defaultPkg: 4, exclude: meatNot }),
  c('ground pork', 'protein', 'lb', [/ground pork/i], { protein: 'pork', vegetarian: false, defaultPkg: 1, exclude: meatNot }),
  c('ground turkey', 'protein', 'lb', [/ground turkey/i], { protein: 'turkey', vegetarian: false, defaultPkg: 1, exclude: meatNot }),
  c('bacon', 'protein', 'pkg', [/\bbacon\b/i], { protein: 'pork', vegetarian: false, defaultPkg: 1, exclude: [...meatNot, /bits|turkey bacon|bacon ranch|bacon cheddar|wrapped/i] }),
  c('smoked sausage', 'protein', 'pkg', [/smoked sausage|kielbasa|sausage links?|italian sausage|bratwurst|brats\b|chorizo|andouille|polish sausage/i], { protein: 'pork', vegetarian: false, defaultPkg: 1, exclude: [...meatNot, /breakfast|biscuit|pizza|patt(y|ies)|gravy/i] }),
  c('ham', 'protein', 'lb', [/\bham\b/i], { protein: 'pork', vegetarian: false, defaultPkg: 1, exclude: [...meatNot, /hamburger|sandwich|lunch|deli|sliced|hamm/i] }),
  c('salmon', 'protein', 'lb', [/salmon/i], { protein: 'fish', vegetarian: false, defaultPkg: 1, exclude: [...meatNot, /smoked|canned|pouch|cat|dog|burger|wellington|stuffed|crab cake/i] }),
  c('white fish', 'protein', 'lb', [/tilapia|\bcod\b|swai|pollock|catfish|whiting|haddock|white fish|flounder/i], { protein: 'fish', vegetarian: false, defaultPkg: 1, exclude: [...meatNot, /stick|breaded|battered|sandwich|cape cod|pretzel|nuggets?/i] }),
  c('shrimp', 'protein', 'lb', [/shrimp/i], { protein: 'fish', vegetarian: false, defaultPkg: 1, exclude: [...meatNot, /ring|tempura|breaded|popcorn|cocktail sauce|crunchy|butterfly|scampi/i] }),
  c('canned tuna', 'protein', 'each', [/tuna/i], { protein: 'fish', vegetarian: false, defaultPkg: 1, exclude: [/steak|salad kit|cat|helper/i] }),
  c('eggs', 'protein', 'each', [/\beggs?\b/i], { protein: 'eggs', defaultPkg: 12, exclude: [/easter|noodle|nog|roll|plastic|dye|plant|bites|chocolate|cadbury|creme|candy|ornament|salad/i] }),
  c('tofu', 'protein', 'pkg', [/tofu/i], { protein: 'tofu', defaultPkg: 1 }),
  c('canned beans', 'protein', 'each', [/(black|pinto|kidney|cannellini|navy|great northern|refried|ranch style) beans/i, /chick ?peas|garbanzo/i], { protein: 'beans', defaultPkg: 1, exclude: [/green beans|jelly|coffee|chili with/i] }),
  c('lentils', 'protein', 'lb', [/lentils/i], { protein: 'lentils', defaultPkg: 1, exclude: [/soup|chips/i] }),
  // Produce
  c('potatoes', 'produce', 'lb', [/potato(es)?\b/i], { defaultPkg: 5, exclude: [/chip|sweet|tots|fries|salad|mashed|hash|crisps|skins|soup|pringles|flakes|lay'?s|kettle|ore.?ida|pizza/i] }),
  c('sweet potatoes', 'produce', 'lb', [/sweet potato|\byams?\b/i], { defaultPkg: 1, exclude: [/fries|chips|tots|pie|casserole/i] }),
  c('onions', 'produce', 'lb', [/\bonions?\b/i], { defaultPkg: 3, eachLb: 0.5, exclude: [/rings?|green|dip|soup|powder|fried|crispy|french/i] }),
  c('bell peppers', 'produce', 'each', [/bell peppers?|sweet peppers?|mini peppers/i], { defaultPkg: 1, eachLb: 0.4, exclude: [/stuffed|jar|roasted|flakes/i] }),
  c('tomatoes', 'produce', 'lb', [/tomato(es)?\b/i], { defaultPkg: 1, exclude: [/sauce|paste|canned|diced|crushed|ketchup|soup|salsa|juice|dried|rotel|stewed|whole peeled/i] }),
  c('canned tomatoes', 'canned', 'each', [/(diced|crushed|whole|stewed|petite) tomatoes|tomato (sauce|paste)|rotel|ro\*tel/i], { defaultPkg: 1, exclude: [/soup|ketchup/i] }),
  c('pasta sauce', 'canned', 'pkg', [/pasta sauce|marinara|spaghetti sauce|alfredo sauce|ragu|prego|bertolli|classico/i], { defaultPkg: 1, exclude: [/pizza|lasagna|dinner|meal/i] }),
  c('broccoli', 'produce', 'lb', [/broccoli/i], { defaultPkg: 1, exclude: [/cheese sauce|soup|slaw|rice|tots|bites/i] }),
  c('carrots', 'produce', 'lb', [/carrots?\b/i], { defaultPkg: 1, exclude: [/cake|juice|baby food/i] }),
  c('lettuce', 'produce', 'pkg', [/lettuce|romaine|salad (mix|blend|kit)|spring mix|iceberg|leaf salad|greens blend|chopped salad/i], { defaultPkg: 1, exclude: [/dressing|wrap|potato salad|pasta salad|chicken salad|tuna salad|egg salad/i] }),
  c('spinach', 'produce', 'pkg', [/spinach/i], { defaultPkg: 1, exclude: [/dip|artichoke|pasta|wrap|tortilla/i] }),
  c('zucchini', 'produce', 'lb', [/zucchini|yellow squash|summer squash/i], { defaultPkg: 1, eachLb: 0.5, exclude: [/bread|noodle|chips/i] }),
  c('mushrooms', 'produce', 'pkg', [/mushrooms?\b/i], { defaultPkg: 1, exclude: [/soup|sauce|gravy|jar|canned/i] }),
  c('avocados', 'produce', 'each', [/avocados?\b/i], { defaultPkg: 1, eachLb: 0.4, exclude: [/oil|guacamole|toast|ranch|mayo|dressing/i] }),
  c('cabbage', 'produce', 'lb', [/cabbage|coleslaw mix|cole slaw mix/i], { defaultPkg: 2, exclude: [/roll|kimchi/i] }),
  c('corn', 'produce', 'each', [/corn on the cob|sweet corn|\bcorn\b/i], { defaultPkg: 1, exclude: [/chips?|tortilla|flakes|dog|bread|starch|syrup|muffin|pops|nuts|meal|pop ?corn|candy|chex|corned|cornbread|pops|corona|cornish/i] }),
  c('green beans', 'produce', 'each', [/green beans|french style beans/i], { defaultPkg: 1, exclude: [/casserole/i] }),
  c('cauliflower', 'produce', 'each', [/cauliflower/i], { defaultPkg: 1, exclude: [/pizza|crust|rice bowl|tots|gnocchi|wings|mac/i] }),
  c('cucumbers', 'produce', 'each', [/cucumbers?\b/i], { defaultPkg: 1, eachLb: 0.6, exclude: [/pickle|melon|lotion|water/i] }),
  c('limes', 'produce', 'each', [/\blimes?\b|\blemons?\b/i], { defaultPkg: 1, eachLb: 0.2, exclude: [/juice|ade\b|lemonade|soda|cake|pie|pepper|water|sparkling|tea|bars|cookies|curd|sprite|starry|seltzer|zest|rind|hint|oreo/i] }),
  c('cilantro', 'produce', 'each', [/cilantro/i], { defaultPkg: 1, exclude: [/dressing|lime rice|sauce/i] }),
  c('frozen vegetables', 'frozen', 'pkg', [/frozen (mixed )?vegetables|stir[- ]?fry vegetables|steamfresh|birds eye|mixed vegetables|vegetable blend|frozen (peas|corn|broccoli|green beans)/i], { defaultPkg: 1, exclude: [/meal|bowl|pot pie|lasagna/i] }),
  // Grains
  c('rice', 'grain', 'lb', [/\brice\b/i], { defaultPkg: 2, exclude: [/krispie|cake|vinegar|a-roni|pudding|cereal|chex|milk|bowl|cauliflower|noodle|mix\b|side|spanish rice|wine|paper|crispy|cups?\b|microwave|ready rice|instant|minute/i] }),
  c('pasta', 'grain', 'lb', [/\bpasta\b|spaghetti|penne|macaroni|rotini|linguine|fettuccine|egg noodles|elbows|farfalle|ziti|rigatoni/i], { defaultPkg: 1, exclude: [/sauce|salad|cheese dinner|& cheese|and cheese|mac ?& ?cheese|kraft dinner|velveeta|helper|cup|bowl|meal|spaghettios|lasagna dinner|chef boyardee|entr[eé]es?|single serve|refrigerated|ravioli|tortellini/i] }),
  c('tortillas', 'grain', 'pkg', [/tortillas?\b/i], { defaultPkg: 1, exclude: [/chips|strips|soup|crunch/i] }),
  c('bread', 'grain', 'pkg', [/\bbread\b|hamburger buns|hot dog buns|dinner rolls|\bbuns\b|hoagie|texas toast|sandwich rolls/i], { defaultPkg: 1, exclude: [/crumbs|breadsticks|pudding|corn ?bread mix|banana bread|monkey|shortbread|naan dippers|flatbread pizza|garlic bread|sweet bread|bread maker|cookie/i] }),
  // Dairy
  c('shredded cheese', 'dairy', 'pkg', [/shredded|cheddar|mozzarella|monterey jack|colby|pepper jack|parmesan|mexican blend|cheese blend|sliced cheese|cheese slices|block cheese|chunk cheese|cheese chunk|natural cheese/i], { defaultPkg: 1, exclude: [/cream cheese|crackers|cheez|goldfish|its|pizza|bread|dip|sauce|puffs|curls|popcorn|bagel|biscuit|sticks?\b|snack|macaroni|mac|cheesecake|burger|chips|string|dog|cat/i] }),
  c('milk', 'dairy', 'pkg', [/\bmilk\b/i], { defaultPkg: 1, exclude: [/almond|chocolate|oat|coconut|soy|cashew|breeze|silk|evaporated|condensed|powder|milk bone|milky|shake|buttermilk|lactaid chocolate|bath|lotion|candy|dove|tea/i] }),
  c('butter', 'dairy', 'pkg', [/\bbutter\b/i], { defaultPkg: 1, exclude: [/butter chicken|bowls?\b|tikka|masala|peanut|almond butter|cookies?|popcorn|apple butter|milk|crackers|cake|finger|nut|chips|candy|toffee|rolls|biscuit|beans|squash|lettuce|cream|caramel|lotion|shea|cocoa|crust|ritz|i can.?t believe/i] }),
  c('sour cream', 'dairy', 'pkg', [/sour cream/i], { defaultPkg: 1, exclude: [/chips|onion dip|pringles|lays|ruffles/i] }),
  c('cream cheese', 'dairy', 'pkg', [/cream cheese/i], { defaultPkg: 1, exclude: [/frosting|bagel|danish|cheesecake|icing|wontons|rangoons/i] }),
  // Canned / pantry items that cost real money
  c('chicken broth', 'canned', 'pkg', [/broth|stock\b/i], { defaultPkg: 1, exclude: [/bone broth protein|stockings?|in stock|stock pot|dog|cat/i] }),
  c('salsa', 'canned', 'pkg', [/\bsalsa\b/i], { defaultPkg: 1, exclude: [/chips|dip mix|verde chicken|seasoning/i] }),
];

export const CANONICAL_BY_KEY = new Map(CANONICALS.map((x) => [x.key, x]));

// Assumed on hand; recipes may use these without pricing them.
export const PANTRY = [
  'salt', 'black pepper', 'cooking oil', 'olive oil', 'garlic', 'garlic powder', 'onion powder', 'chili powder',
  'cumin', 'paprika', 'italian seasoning', 'oregano', 'red pepper flakes', 'flour', 'sugar', 'brown sugar',
  'soy sauce', 'vinegar', 'hot sauce', 'mustard', 'ketchup', 'honey', 'cornstarch', 'taco seasoning', 'bbq sauce',
];

// Approximate pounds of food on the plate per base unit, used to size portions
// (target 0.75–1 lb of food per person per meal). Weight items default to 1 lb per lb; dry grains
// count their cooked weight; bone-in cuts count edible meat. Garnishes count 0.
export const PLATE_LB: Record<string, number> = {
  'chicken drumsticks': 0.7, 'whole chicken': 0.65, rice: 3, pasta: 2.25, lentils: 2.5,
  eggs: 0.11, 'canned beans': 0.55, 'canned tomatoes': 0.9, 'bell peppers': 0.4, avocados: 0.35, corn: 0.4,
  'green beans': 0.6, cauliflower: 1.5, cucumbers: 0.6, limes: 0, cilantro: 0, 'rotisserie chicken': 1.5, 'canned tuna': 0.3,
  bacon: 0.6, 'smoked sausage': 0.85, tofu: 0.9, 'pasta sauce': 1.5, lettuce: 0.6, spinach: 0.3, mushrooms: 0.5,
  'frozen vegetables': 0.75, tortillas: 0.8, bread: 1, 'shredded cheese': 0.5, milk: 0.5, butter: 0.25, 'sour cream': 0.5,
  'cream cheese': 0.5, 'chicken broth': 0.25, salsa: 0.5, // liquids mostly cook down into sauce

};
export const plateLb = (key: string) => PLATE_LB[key] ?? (CANONICAL_BY_KEY.get(key)?.unit === 'lb' ? 1 : 0);

/** Split multi-product ad names like "Chicken Breasts or Pork Chops" into parts. */
export function splitAdName(name: string): string[] {
  return name
    .replace(/®|™/g, '')
    .split(/\s+or\s+|,\s+(?=[A-Z])|;\s*|\s+&\s+(?=[A-Z][a-z]+ [A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const NON_FOOD = /wipes|lysol|clean(er|ing)|disinfect|detergent|soap|scent(ed)?\b|candle|shampoo|lotion|dishwash|air freshener|febreze|\btide\b|pet food|\bdog\b|cat food|litter|diaper|vitamin|supplement|gummies/i;

export function matchCanonical(text: string): Canonical | undefined {
  if (NON_FOOD.test(text)) return undefined;
  // Prefer the most specific (longest) matching pattern so "sweet potatoes" beats "potatoes".
  let best: { c: Canonical; len: number } | undefined;
  for (const can of CANONICALS) {
    if (can.exclude?.some((r) => r.test(text))) continue;
    for (const r of can.match) {
      const m = text.match(r);
      if (m && (!best || m[0].length > best.len)) best = { c: can, len: m[0].length };
    }
  }
  return best?.c;
}

/** Returns canonical matches for every part of a (possibly multi-product) ad name. */
export function matchAdName(name: string): { part: string; canonical: Canonical }[] {
  const out: { part: string; canonical: Canonical }[] = [];
  if (NON_FOOD.test(name)) return out; // non-food is a property of the whole item, not a split part
  const seen = new Set<string>();
  for (const part of splitAdName(name)) {
    const can = matchCanonical(part);
    if (can && !seen.has(can.key)) {
      seen.add(can.key);
      out.push({ part, canonical: can });
    }
  }
  // If splitting lost context (e.g. "Fresh Boneless Skinless Chicken Breasts or Thighs"), try the whole name.
  if (!out.length) {
    const can = matchCanonical(name);
    if (can) out.push({ part: name, canonical: can });
  }
  return out;
}

export type ParsedSize = { qty: number; unit: 'lb' | 'oz' | 'ct' | 'gal' | 'fl oz' };

/** Pull a package size out of text like "20 oz.", "18 ct", "3 lb bag", "Half Gallon", "9-9.5 oz". */
export function parseSize(text: string): ParsedSize | undefined {
  const t = text.toLowerCase();
  if (/half gallon|1\/2 gal/.test(t)) return { qty: 0.5, unit: 'gal' };
  const m = t.match(/(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?\s*-?\s*(fl\.? ?oz|lbs?|pounds?|oz|ounces?|ct|count|pk|pack|dozen|doz|gal(?:lon)?|rolls?|ea)\b/);
  if (!m) {
    if (/\bdozen\b/.test(t)) return { qty: 12, unit: 'ct' };
    if (/\bgallon\b/.test(t)) return { qty: 1, unit: 'gal' };
    return undefined;
  }
  const n = Number(m[1]);
  const u = m[2].replace(/\./g, '');
  if (/^(lb|lbs|pound|pounds)$/.test(u)) return { qty: n, unit: 'lb' };
  if (/^fl ?oz$/.test(u)) return { qty: n, unit: 'fl oz' };
  if (/^(oz|ounce|ounces)$/.test(u)) return { qty: n, unit: 'oz' };
  if (/^(dozen|doz)$/.test(u)) return { qty: n * 12, unit: 'ct' };
  if (/^gal/.test(u)) return { qty: n, unit: 'gal' };
  return { qty: n, unit: 'ct' };
}

/** Convert a parsed size into the canonical's base unit; undefined if incompatible. */
export function sizeInBase(size: ParsedSize | undefined, can: Canonical): number | undefined {
  if (!size) return undefined;
  if (can.unit === 'lb') {
    if (size.unit === 'lb') return size.qty;
    if (size.unit === 'oz') return size.qty / 16;
    return undefined;
  }
  if (can.unit === 'each') {
    if (size.unit === 'ct') return size.qty;
    if ((size.unit === 'lb' || size.unit === 'oz') && can.eachLb) {
      const lb = size.unit === 'lb' ? size.qty : size.qty / 16;
      return Math.max(1, Math.round(lb / can.eachLb));
    }
    return undefined;
  }
  return 1; // 'pkg' — the package is the unit
}

export type PriceInfo = {
  price: number; // price per sold unit
  soldBy: 'weight' | 'package';
  multiBuy?: number; // e.g. 2 for "2/$5" (price already divided)
  note?: string;
};

/**
 * Interpret flyer price fields. Examples:
 *   current 2.77, post "lb member price"   -> $2.77/lb (weight)
 *   current 5, pre "2/"                    -> $2.50 each
 *   current 10, pre "10 for"               -> $1.00 each
 */
export function parsePrice(f: { current_price?: number | string | null; pre_price_text?: string | null; price_text?: string | null; sale_story?: string | null }): PriceInfo | undefined {
  const raw = f.current_price == null || f.current_price === '' ? NaN : Number(f.current_price);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  const pre = (f.pre_price_text || '').toLowerCase();
  const post = (f.price_text || '').toLowerCase();
  const story = (f.sale_story || '').toLowerCase();
  const notes: string[] = [];
  let price = raw;
  let multiBuy: number | undefined;
  const mb = pre.match(/(\d+)\s*(?:\/|for\b)/);
  if (mb && Number(mb[1]) > 1) {
    multiBuy = Number(mb[1]);
    price = raw / multiBuy;
    notes.push(`${multiBuy} for $${raw.toFixed(2)}`);
  }
  if (/starting at|as low as|from\b/.test(pre)) notes.push('price is "starting at"');
  if (/member|card|digital|app|rewards|loyalty/.test(post + ' ' + story)) notes.push('member/digital price');
  if (/buy \d+ get|bogo/.test(pre + ' ' + post + ' ' + story)) notes.push('BOGO offer (priced as single item)');
  const weight = /\blb\b|\blbs\b|per pound|\/lb/.test(post) || /\/lb|per lb/.test(pre);
  return { price: round2(price), soldBy: weight ? 'weight' : 'package', multiBuy, note: notes.join('; ') || undefined };
}

export function parseLimit(...texts: (string | null | undefined)[]): number | undefined {
  for (const t of texts) {
    const m = (t || '').match(/limit\s*(?:of\s*)?(\d+)/i);
    if (m) return Number(m[1]);
  }
  return undefined;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
