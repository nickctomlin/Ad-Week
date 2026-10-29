// Recipe candidates. Claude proposes dinners built around what's on sale (structured JSON,
// validated with zod); code does all pricing. If no ANTHROPIC_API_KEY is set or the call fails,
// a small built-in library is used instead and the UI says so.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { config, hasAnthropic } from './config.ts';
import { db } from './db.ts';
import { CANONICALS, CANONICAL_BY_KEY, PANTRY } from './normalize.ts';

export type Recipe = {
  id: string;
  name: string;
  protein: string; // protein group, for the "max 2 of the same protein" rule
  vegetarian: boolean;
  servings: number; // quantities below are for this many servings
  ingredients: { canonical: string; qty: number }[]; // qty in the canonical's base unit
  pantry: string[];
  method: string[];
  minutes: number;
  source: 'claude' | 'builtin';
};

export type Diet = 'anything' | 'vegetarian';
export type AvailableItem = { canonical: string; unitPrice: number; unit: string; onSale: boolean; chains: string[] };

const CANON_KEYS = CANONICALS.map((c) => c.key) as [string, ...string[]];

const RecipeSchema = z.object({
  recipes: z.array(
    z.object({
      name: z.string(),
      minutes: z.number(),
      ingredients: z.array(z.object({ canonical: z.enum(CANON_KEYS), qty: z.number() })),
      pantry: z.array(z.enum(PANTRY as [string, ...string[]])),
      method: z.array(z.string()),
    }),
  ),
});

/** Derive protein group + vegetarian flag from ingredients (don't trust the model for this). */
export function finalizeRecipe(r: Omit<Recipe, 'protein' | 'vegetarian' | 'id'> & { id?: string }): Recipe | undefined {
  const ings = r.ingredients.filter((i) => CANONICAL_BY_KEY.has(i.canonical) && i.qty > 0);
  if (!ings.length || !r.name) return undefined;
  const cans = ings.map((i) => CANONICAL_BY_KEY.get(i.canonical)!);
  const main = cans.filter((c) => c.protein).sort((a, b) => (a.vegetarian === b.vegetarian ? 0 : a.vegetarian ? 1 : -1))[0];
  return {
    ...r,
    id: r.id ?? createHash('sha1').update(r.name + JSON.stringify(ings)).digest('hex').slice(0, 10),
    ingredients: ings,
    protein: main?.protein ?? 'veggie',
    vegetarian: cans.every((c) => c.vegetarian),
  };
}

const isoWeek = () => {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}-w${Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)}`;
};

export async function getRecipePool(available: AvailableItem[], diet: Diet): Promise<{ recipes: Recipe[]; source: string; warning?: string }> {
  const builtin = BUILTIN.map((r) => finalizeRecipe({ ...r, servings: 4, source: 'builtin' })!).filter((r) => diet === 'anything' || r.vegetarian);
  if (!hasAnthropic()) {
    return { recipes: builtin, source: 'Built-in recipe library', warning: 'ANTHROPIC_API_KEY is not set, so recipes come from the built-in library instead of being generated from this week\'s sales.' };
  }
  const key = createHash('sha1')
    .update(JSON.stringify([diet, isoWeek(), config.anthropicModel, available.map((a) => `${a.canonical}:${a.onSale}`).sort()]))
    .digest('hex');
  const cached = db.prepare('SELECT body FROM recipe_pools WHERE key = ?').get(key) as { body: string } | undefined;
  if (cached) return { recipes: JSON.parse(cached.body), source: `Claude (${config.anthropicModel})` };
  try {
    const recipes = await generateWithClaude(available, diet);
    if (recipes.length < 6) throw new Error(`only ${recipes.length} valid recipes returned`);
    db.prepare('INSERT OR REPLACE INTO recipe_pools (key, source, body, created_at) VALUES (?, ?, ?, ?)').run(key, 'claude', JSON.stringify(recipes), Date.now());
    return { recipes, source: `Claude (${config.anthropicModel})` };
  } catch (e: any) {
    console.error('Recipe generation failed:', e.message);
    return { recipes: builtin, source: 'Built-in recipe library', warning: `AI recipe generation failed (${e.message}); using the built-in library.` };
  }
}

async function generateWithClaude(available: AvailableItem[], diet: Diet): Promise<Recipe[]> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const lines = available
    .filter((a) => diet === 'anything' || CANONICAL_BY_KEY.get(a.canonical)?.vegetarian)
    .map((a) => `- ${a.canonical} (${CANONICAL_BY_KEY.get(a.canonical)!.unit}): $${a.unitPrice.toFixed(2)}/${a.unit}${a.onSale ? ' ON SALE' : ''}`)
    .join('\n');
  const prompt = `You plan cheap weeknight family dinners from this week's grocery prices near Plano, Texas.

Ingredients available this week, cheapest price per unit (unit in parentheses is the unit to use for qty):
${lines}

Pantry staples (assume on hand, list them under "pantry" only): ${PANTRY.join(', ')}.

Write 16 different dinner recipes${diet === 'vegetarian' ? ' that are strictly vegetarian (no meat, poultry or fish)' : ''}.
Rules:
- Build each dinner around at least one ON SALE ingredient, and favor the cheapest items.
- Use only the ingredient names listed above in "ingredients" (exact spelling), with qty for 4 servings in that ingredient's unit: lb = pounds, each = count, pkg = number of store packages (e.g. 1 jar sauce, 1 pack tortillas, 1 bag cheese).
- Vary the main protein: no more than 3 recipes per protein across the 16.
- Keep it realistic for a weeknight: 15-60 minutes, 3-6 short method steps.`;

  const res = await client.beta.messages.parse({
    model: config.anthropicModel,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(RecipeSchema) },
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') throw new Error('model declined the request');
  if (res.stop_reason === 'max_tokens') throw new Error('response was cut off');
  const parsed = res.parsed_output;
  if (!parsed) throw new Error('no structured output returned');
  return parsed.recipes
    .map((r) => finalizeRecipe({ ...r, servings: 4, source: 'claude' }))
    .filter((r): r is Recipe => !!r && (diet === 'anything' || r.vegetarian));
}

type B = { name: string; minutes: number; ingredients: { canonical: string; qty: number }[]; pantry: string[]; method: string[] };
const i = (canonical: string, qty: number) => ({ canonical, qty });

// Fallback library (4 servings). Prices still come from real deal data; nothing here is a price.
const BUILTIN: B[] = [
  { name: 'Sheet-pan chicken, potatoes & broccoli', minutes: 40, ingredients: [i('chicken breast', 1.5), i('potatoes', 2), i('broccoli', 1)], pantry: ['olive oil', 'garlic powder', 'paprika', 'salt', 'black pepper'], method: ['Heat oven to 425°F.', 'Cube potatoes and chicken; toss with oil and spices.', 'Roast potatoes 15 min, add chicken and broccoli, roast 20 min more.'] },
  { name: 'Chicken fajitas', minutes: 30, ingredients: [i('chicken breast', 1.5), i('bell peppers', 3), i('onions', 0.75), i('tortillas', 1)], pantry: ['chili powder', 'cumin', 'cooking oil', 'salt'], method: ['Slice chicken, peppers and onion.', 'Sear chicken with spices until cooked; remove.', 'Cook peppers and onions until soft, return chicken.', 'Serve in warm tortillas.'] },
  { name: 'Chicken fried rice', minutes: 30, ingredients: [i('chicken thighs', 1), i('rice', 0.75), i('eggs', 3), i('frozen vegetables', 1)], pantry: ['soy sauce', 'cooking oil', 'garlic'], method: ['Cook rice (day-old is best).', 'Brown diced chicken; push aside and scramble eggs.', 'Add vegetables and rice, season with soy sauce.'] },
  { name: 'Baked drumsticks with sweet potatoes', minutes: 50, ingredients: [i('chicken drumsticks', 2.5), i('sweet potatoes', 2), i('green beans', 2)], pantry: ['paprika', 'garlic powder', 'olive oil', 'salt'], method: ['Heat oven to 425°F.', 'Season drumsticks; roast with cubed sweet potatoes 40-45 min.', 'Heat green beans and serve.'] },
  { name: 'Roast chicken with carrots & potatoes', minutes: 90, ingredients: [i('whole chicken', 4.5), i('carrots', 1), i('potatoes', 2), i('onions', 0.5)], pantry: ['olive oil', 'salt', 'black pepper', 'italian seasoning'], method: ['Heat oven to 425°F.', 'Season chicken; surround with chopped vegetables.', 'Roast about 75 min until 165°F in the thigh. Rest 10 min.'] },
  { name: 'Chicken thigh tray bake with zucchini', minutes: 45, ingredients: [i('chicken thighs', 2), i('zucchini', 1.5), i('potatoes', 1.5)], pantry: ['olive oil', 'oregano', 'garlic', 'salt'], method: ['Heat oven to 425°F.', 'Toss everything with oil, garlic and oregano.', 'Roast 35-40 min.'] },
  { name: 'Ground beef tacos', minutes: 25, ingredients: [i('ground beef', 1), i('tortillas', 1), i('lettuce', 1), i('shredded cheese', 1), i('salsa', 1)], pantry: ['taco seasoning'], method: ['Brown beef; drain and add taco seasoning with a splash of water.', 'Warm tortillas.', 'Fill with beef, lettuce, cheese and salsa.'] },
  { name: 'Spaghetti with meat sauce', minutes: 30, ingredients: [i('ground beef', 1), i('pasta', 1), i('pasta sauce', 1), i('onions', 0.5)], pantry: ['garlic', 'italian seasoning', 'salt'], method: ['Boil pasta.', 'Brown beef with diced onion and garlic.', 'Add sauce, simmer 10 min, toss with pasta.'] },
  { name: 'Beef & broccoli', minutes: 30, ingredients: [i('beef steak', 1.25), i('broccoli', 1.5), i('rice', 0.75)], pantry: ['soy sauce', 'brown sugar', 'cornstarch', 'garlic', 'cooking oil'], method: ['Cook rice.', 'Slice beef thin; toss with cornstarch.', 'Sear beef, add broccoli and a soy-sugar-garlic sauce, cook until glossy.'] },
  { name: 'Slow-cooker pot roast', minutes: 480, ingredients: [i('beef roast', 3), i('potatoes', 2), i('carrots', 1), i('onions', 1), i('chicken broth', 1)], pantry: ['salt', 'black pepper', 'italian seasoning'], method: ['Season and sear the roast.', 'Put vegetables, roast and broth in a slow cooker.', 'Cook on low 8 hours; shred and serve.'] },
  { name: 'Pork chops with potatoes & green beans', minutes: 35, ingredients: [i('pork chops', 1.5), i('potatoes', 2), i('green beans', 2)], pantry: ['garlic powder', 'paprika', 'cooking oil', 'salt'], method: ['Boil or roast potatoes.', 'Season chops; pan-sear 4-5 min per side.', 'Heat green beans and serve.'] },
  { name: 'Pulled pork sandwiches with slaw', minutes: 480, ingredients: [i('pork shoulder', 3), i('bread', 1), i('cabbage', 1)], pantry: ['bbq sauce', 'brown sugar', 'paprika', 'vinegar', 'salt'], method: ['Rub pork with sugar, paprika and salt.', 'Slow-cook on low 8 hours; shred with BBQ sauce.', 'Toss shredded cabbage with vinegar; pile on buns.'] },
  { name: 'Roast pork loin with sweet potatoes', minutes: 60, ingredients: [i('pork loin', 2), i('sweet potatoes', 2), i('broccoli', 1)], pantry: ['olive oil', 'garlic powder', 'salt', 'black pepper'], method: ['Heat oven to 400°F.', 'Season pork; roast with sweet potatoes 45 min to 145°F.', 'Add broccoli for the last 15 min.'] },
  { name: 'Sausage, peppers & rice skillet', minutes: 30, ingredients: [i('smoked sausage', 1), i('bell peppers', 2), i('onions', 0.5), i('rice', 0.75), i('canned tomatoes', 1)], pantry: ['paprika', 'cooking oil'], method: ['Slice sausage; brown in a skillet.', 'Add peppers and onion, then rice, tomatoes and 2 cups water.', 'Cover and simmer 20 min.'] },
  { name: 'Ham & potato soup', minutes: 40, ingredients: [i('ham', 1), i('potatoes', 2), i('milk', 0.5), i('chicken broth', 1), i('onions', 0.5)], pantry: ['flour', 'black pepper', 'salt'], method: ['Cook diced onion; stir in a little flour.', 'Add broth, diced potatoes and ham; simmer 20 min.', 'Stir in milk and heat through.'] },
  { name: 'Turkey & bean chili', minutes: 40, ingredients: [i('ground turkey', 1), i('canned beans', 2), i('canned tomatoes', 2), i('onions', 0.5)], pantry: ['chili powder', 'cumin', 'salt', 'cooking oil'], method: ['Brown turkey with onion.', 'Add beans, tomatoes and spices.', 'Simmer 25 min.'] },
  { name: 'Salmon with rice & broccoli', minutes: 30, ingredients: [i('salmon', 1.5), i('rice', 0.75), i('broccoli', 1), i('limes', 1)], pantry: ['olive oil', 'garlic powder', 'salt'], method: ['Cook rice.', 'Roast salmon at 400°F for 12-15 min.', 'Steam broccoli; finish with lemon or lime.'] },
  { name: 'Fish tacos with slaw', minutes: 25, ingredients: [i('white fish', 1.25), i('tortillas', 1), i('cabbage', 0.5), i('limes', 2), i('sour cream', 1)], pantry: ['chili powder', 'cumin', 'cooking oil', 'salt'], method: ['Season fish and pan-sear 3 min per side.', 'Shred cabbage; toss with lime juice.', 'Serve in tortillas with lime sour cream.'] },
  { name: 'Shrimp stir-fry', minutes: 25, ingredients: [i('shrimp', 1), i('frozen vegetables', 1), i('rice', 0.75)], pantry: ['soy sauce', 'garlic', 'cornstarch', 'cooking oil'], method: ['Cook rice.', 'Stir-fry vegetables, then shrimp until pink.', 'Add soy-garlic sauce thickened with cornstarch.'] },
  { name: 'Garlic shrimp pasta with spinach', minutes: 25, ingredients: [i('shrimp', 1), i('pasta', 1), i('butter', 0.25), i('spinach', 1)], pantry: ['garlic', 'red pepper flakes', 'salt'], method: ['Boil pasta.', 'Sauté garlic in butter; add shrimp until pink.', 'Toss with pasta and spinach until wilted.'] },
  { name: 'Breakfast for dinner', minutes: 30, ingredients: [i('eggs', 8), i('potatoes', 1.5), i('bacon', 1), i('bread', 1)], pantry: ['cooking oil', 'salt', 'black pepper'], method: ['Cook bacon.', 'Dice and pan-fry potatoes until crisp.', 'Scramble eggs; serve with toast.'] },
  { name: 'Rotisserie chicken salad bowls', minutes: 15, ingredients: [i('rotisserie chicken', 1), i('lettuce', 1), i('cucumbers', 1), i('tomatoes', 1)], pantry: ['olive oil', 'vinegar', 'salt'], method: ['Pull the chicken off the bone.', 'Chop vegetables.', 'Assemble bowls with an oil and vinegar dressing.'] },
  // Vegetarian
  { name: 'Black bean tacos with avocado', minutes: 20, ingredients: [i('canned beans', 2), i('tortillas', 1), i('avocados', 2), i('shredded cheese', 1), i('salsa', 1)], pantry: ['cumin', 'chili powder'], method: ['Warm beans with spices; mash lightly.', 'Warm tortillas.', 'Fill with beans, avocado, cheese and salsa.'] },
  { name: 'Veggie fried rice with egg', minutes: 25, ingredients: [i('eggs', 4), i('rice', 0.75), i('frozen vegetables', 1)], pantry: ['soy sauce', 'cooking oil', 'garlic'], method: ['Cook rice.', 'Scramble eggs; set aside.', 'Fry vegetables and rice; add eggs and soy sauce.'] },
  { name: 'Lentil & tomato curry', minutes: 40, ingredients: [i('lentils', 1), i('canned tomatoes', 1), i('onions', 0.5), i('rice', 0.75), i('spinach', 1)], pantry: ['cumin', 'chili powder', 'garlic', 'cooking oil', 'salt'], method: ['Cook onion and garlic with spices.', 'Add lentils, tomatoes and 3 cups water; simmer 25 min.', 'Stir in spinach; serve over rice.'] },
  { name: 'Pasta primavera', minutes: 30, ingredients: [i('pasta', 1), i('zucchini', 1), i('bell peppers', 1), i('tomatoes', 1), i('shredded cheese', 1)], pantry: ['olive oil', 'garlic', 'italian seasoning', 'salt'], method: ['Boil pasta.', 'Sauté vegetables in olive oil with garlic.', 'Toss with pasta and cheese.'] },
  { name: 'Bean & pepper quesadillas', minutes: 20, ingredients: [i('tortillas', 1), i('shredded cheese', 1), i('bell peppers', 2), i('onions', 0.5), i('canned beans', 1)], pantry: ['cumin', 'cooking oil'], method: ['Sauté peppers and onion.', 'Fill tortillas with beans, vegetables and cheese.', 'Griddle until crisp and melted.'] },
  { name: 'Shakshuka', minutes: 30, ingredients: [i('eggs', 8), i('canned tomatoes', 2), i('bell peppers', 1), i('onions', 0.5), i('bread', 1)], pantry: ['cumin', 'paprika', 'olive oil', 'salt'], method: ['Cook onion and pepper in oil with spices.', 'Add tomatoes; simmer 10 min.', 'Crack in eggs, cover until set. Serve with bread.'] },
  { name: 'Tofu & broccoli stir-fry', minutes: 30, ingredients: [i('tofu', 2), i('broccoli', 1), i('rice', 0.75), i('bell peppers', 1)], pantry: ['soy sauce', 'cornstarch', 'garlic', 'cooking oil'], method: ['Cook rice.', 'Press, cube and crisp tofu in a hot pan.', 'Stir-fry vegetables; add tofu and soy-garlic sauce.'] },
  { name: 'Loaded baked potatoes', minutes: 60, ingredients: [i('potatoes', 3), i('broccoli', 1), i('shredded cheese', 1), i('sour cream', 1)], pantry: ['salt', 'olive oil'], method: ['Bake oiled potatoes at 425°F about 50 min.', 'Steam broccoli.', 'Split potatoes; top with broccoli, cheese and sour cream.'] },
];
