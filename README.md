# Ad Week

A personal proof of concept that builds a cheap weekly dinner plan from **this week's real grocery
sale prices** around Plano / DFW, Texas. Enter a ZIP, pick nearby stores, set a budget, and get a
plan, a shopping list grouped by store, and every deal it's based on.

No prices are hardcoded or invented. Every price comes from a chain's current weekly ad or from the
official Kroger API, and every cost is computed in code from those rows.

## Setup

Requires **Node.js 24+** (developed on Node 26). Node runs the TypeScript directly, and SQLite is built in
(`node:sqlite`), so there's no build step and no native modules.

```bash
npm install
cp .env.example .env     # optional: add Kroger and/or Anthropic keys
npm start                # http://localhost:3000
```

The app works with **no keys at all**: weekly-ad data for all chains comes from Flipp, and recipes
come from a built-in library. Keys add:

| Key | What it adds | How to get it |
|---|---|---|
| `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET` | Kroger store locations from the official API, plus **store-level shelf and promo prices** for 57 ingredients at the 3 nearest Krogers. This fills the staples flyers don't list (rice, onions…). | https://developer.kroger.com → create an app → Production → scope `product.compact` |
| `ANTHROPIC_API_KEY` | Claude (`claude-opus-5-5` by default) writes 16 recipes around what's on sale this week as validated structured JSON. The pool is cached per ZIP-week. | https://console.anthropic.com |

Keys stay on the server and are never sent to the browser.

### Getting Kroger API keys (free)

1. Go to https://developer.kroger.com and choose **Create an Account**.
2. Choose **Register App** (under *My Apps*). Name it anything (e.g. "Ad Week").
3. Choose the **Production** environment and add the public **Products** and **Locations** APIs.
4. If it asks for a redirect URI, enter `http://localhost:3000/callback`. Ad Week never uses it (it uses the client-credentials flow), but the form may require one.
5. Copy the **Client ID** and **Client Secret** into `.env`, then restart with `npm start`.

The Setup tab will then show Kroger stores from the official API, and plans will price staples at real shelf prices.

## Using the app

Five tabs: a bottom bar on phones, a top bar on desktop.

- **Setup.** ZIP and radius, then pick stores. Each chain shows Live, Stale or No data, plus when it was updated and how long its ad is valid. Then set budget, people, dinners and diet.
- **Plan.** Two styles, picked on Setup:
  - **Meal prep** (default): one recipe cooked as a single batch of people × dinners servings. For example, 4 people × 3 dinners = 12 servings.
  - **Variety**: a different recipe each night.

  Every recipe is sized to about **¾–1 lb of food per person per meal**. Meat and produce are rounded to the nearest half pound (then nudged so portions stay in range), and countable items to whole units. The tab shows a budget meter, cost per person and per serving, and the ad clipping of each recipe's main ingredient. Swap the recipe, or shuffle.
- **List.** Shopping list grouped by store, with directions links, checkboxes and a copy button. Switch between best prices and a single store.
- **Deals.** Every grocery item in this week's ads at your selected stores (about 640 for 75024), not just dinner ingredients, sorted into store aisles.
  - **Default view** is curated: "Best deals this week" (the biggest real savings, at most 2 per aisle), then the best 4 deals in each aisle with a "See all" link.
  - **Toolbar:** a compact bar pinned under the header, with search plus Store, Aisle and Sort drop-downs. Picking an aisle or store, or searching, shows the full list.
  - **Savings ranking:** % off when the ad prints a regular price, free and BOGO offers, "Save $X" coupons, and dinner ingredients priced below the typical price at other nearby stores.
  - **Coupon-style deals** with no single price ("Buy 2 get 1 free", "Save $2 with yellow coupon") show their terms instead of a price.
- **Flyers.** Every current grocery weekly ad for your ZIP, page by page, as the actual ad clippings. Search within an ad, show only dinner ingredients, and see "In your plan" tags.

Tap any item to open its **item window**. It shows the real ad clipping (with the printed price), price, unit price, regular price, limit, valid-through date, and store, plus links to **verify the price**:
- **Verify price.** Opens the item on flipp.com, or the product on kroger.com for Kroger API prices.
- **The chain's own weekly ad.** For example kroger.com/weeklyad or tomthumb.com/weeklyad.
- **Show it in the flyer.** Jumps to that ad page in the Flyers tab and highlights the item.

## Running ingestion

Ingestion runs automatically:
- **On demand.** The first time a ZIP is searched, or when its data is stale (older than `DEAL_TTL_HOURS`, default 24, or a flyer has expired), it runs in the background while the UI shows progress.
- **New weekly ads.** The list of a ZIP's current ads is cached for 6 hours, but the cache is discarded as soon as any ad in it has ended. So the morning a new week's ads start (usually Wednesday), the first open picks them up.
- **On a schedule.** While the server runs, every 6 hours it refreshes stale data for any ZIP used in the last 14 days.

To run it manually, for example from cron or Task Scheduler for a weekly refresh:

```bash
npm run ingest -- 75024 75074 75075 75034           # skips ZIPs that are still fresh
npm run ingest -- 75024 --force                      # re-pull regardless (fresh ad list + Kroger prices)
```

The UI also has a **Refresh deals** link. The first ingest of a new week's ads takes about 2 minutes:
one request per flyer, plus one per grocery item (about 450), at 4 requests a second. After that, item
details are cached for the life of the ad, so other ZIPs sharing those flyers, and re-runs, finish in seconds.

```bash
npm test          # pricing/budget + name-normalization tests (node:test)
npm run typecheck # tsc --noEmit
```

## How it works

```
ZIP ──► zippopotam.us geocode ──► DFW coverage check
     ├─► stores: Kroger API locations (if keyed) + OpenStreetMap/Nominatim for every chain
     └─► ingest ─► Flipp weekly-ad flyers for the ZIP (Kroger, Tom Thumb, ALDI, H-E-B, Walmart)
               └─► Kroger Products API at nearest stores (if keyed)
                     │
                     ▼  normalize.ts: ad name → canonical ingredient, price/unit/size/limit parsing
               SQLite `deals` (one schema for all sources)
                     │
plan request ──► per-store offers ──► recipe pool (Claude or built-in)
                                   ──► planner.ts: greedy marginal-cost optimizer, ≤2 meals per protein
                                   ──► shopping lists: best price per item / cheapest single store
```

- **Normalized schema** (`deals` table, see `src/db.ts`): `store_id` (store-level sources) or `zone` (flyer ZIP), `chain`, `item_name`, `canonical`, `category`, `sale_price`, `regular_price`, `sold_by` (weight/package), `pkg_qty`, `unit_price` + `unit_price_unit`, `limit_qty`, `valid_from`, `valid_to`, `source_url`.
- **Departments** (`src/departments.ts`): every ad item is sorted into a store department, or rejected as non-grocery. Rejected items include household, health & beauty, decor, apparel, flowers, pets, and the ads' banner tiles. Only items that match a dinner ingredient, with a real price, are used for planning; everything else is display-only on the Deals tab.
- **Canonical ingredients** (`src/normalize.ts`): 57 entries with match and exclude patterns. For example, "Signature SELECT® Fresh Boneless Skinless Chicken Breasts or Value Pack Pork Loin Chops, $2.77 lb member price, Limit 2 Each" becomes two deals, `chicken breast` and `pork chops`, each at $2.77/lb with limit 2.
- **The LLM proposes, code prices.** Claude only picks dishes and quantities, constrained by a zod schema with an enum of canonical names. Costs, package rounding, limits and budget math are deterministic (`src/planner.ts`).
- **Purchase limits.** The planner buys up to the limit at the sale offer, then fills the rest from the next-best offer, or at the regular price when that's known.
- **Rounding.** Countable and packaged items round up to whole packages, and weight items are priced per lb. A package is bought once even when several meals share it.
- **Freshness.** Each chain shows "updated … valid through …". Chains whose data is missing, errored, expired or empty are flagged in the store picker and above the results, not silently dropped.

## Adding a new chain

1. Add it to `CHAINS` in `src/sources/types.ts`: an id, the merchant name **exactly as Flipp shows it**, and a Nominatim search name with a name regex.
2. If the chain publishes its weekly ad on Flipp (check `https://backflipp.wishabi.com/flipp/flyers?locale=en-us&postal_code=75024`), that's all: `flipp.ts` picks it up automatically.
3. If it has its own API, add `src/sources/<chain>.ts` that returns `Deal[]` (use `buildDeal()` from `sources/deal.ts` so units and sizes are normalized the same way). Then call it from `ingestZip()` in `src/ingest.ts`, recording an `ingest_runs` row so its freshness shows in the UI.
4. If its items don't map well, add patterns or excludes in `CANONICALS`, with a test in `test/normalize.test.ts`.

## Data sources and terms

| Chain | Source | Notes |
|---|---|---|
| Kroger | **Official Kroger Developer API** (when keyed) + Kroger weekly ad via Flipp | Sanctioned API. The public Products API doesn't expose promo end dates or purchase limits, so those come from the flyer. |
| Tom Thumb | Weekly ad via Flipp | tomthumb.com's own weekly-ad page embeds this same Flipp flyer. |
| Market Street | Weekly ad via Flipp | Albertsons' upscale DFW banner. shopmarketstreet.com/weeklyad embeds the same Flipp flyer. Stores come from OpenStreetMap. |
| ALDI | Weekly ad via Flipp | aldi.us disallows crawlers in robots.txt, so aldi.us is never fetched. Only Flipp's distribution of the ad is used. |
| H-E-B | Weekly ad via Flipp | heb.com is behind bot protection, so heb.com is never fetched. |
| Sprouts | Weekly ad via Flipp | sprouts.com/weekly-ad shows the same flyer. Many weeks are mostly "Buy one, get one 50% off" offers with no per-item price; those appear on Deals but can't price a meal plan. |
| Walmart | **Removed** | No local grocery weekly ad. Its only Flipp flyer is the national rollback ad (electronics, home goods), and Flipp has no Walmart grocery prices. Walmart's affiliate API would need an approved account. |
| Whole Foods | **Not included** | Not on Flipp. Its sales are only on wholefoodsmarket.com, so adding it would mean reading that site directly. Not done. |

Flipp's endpoints (`backflipp.wishabi.com`) are the **public, unauthenticated** ones behind flipp.com.
They are not a documented API. They're used here for a personal, non-commercial PoC with an
identifying User-Agent, ≤4 requests/second, and aggressive caching. No logins, keys, paywalls or
bot protection are bypassed. Store locations are © OpenStreetMap contributors (ODbL), fetched within
Nominatim's 1 request/second policy. See `FEASIBILITY.md` for the research behind these choices.

## Known limitations

- **Flyers only list sale items.** Without Kroger keys, staples that aren't on sale (onions, rice, broccoli…) often have no price. A recipe may use up to 2 such side ingredients (never the main protein). They're listed under "No current price" and **excluded from the total**, which the UI and warnings say explicitly. Add Kroger keys to price them at real shelf prices.
- **Flyer prices are per ad zone, not per store.** A flyer deal is shown at the nearest selected store of that chain, with "+N more stores in this ad". Individual stores can differ.
- **Unofficial flyer source.** Flipp can change or block its endpoints at any time. If that happens, each chain is flagged "Error" and Kroger API data, if configured, keeps working.
- **Ad text is messy.** Some prices are member, digital-coupon or "starting at" prices, or multi-buys ("2 for $3" is stored as $1.50 each). These are noted on each deal. Regular price and % off appear only when the ad states them. Package sizes the ad doesn't state are priced conservatively (1 lb or 1 each) and marked "size est.".
- **Name matching is a curated dictionary.** It's good for common dinner ingredients, but it will miss things and occasionally mis-file one. Fixes are one regex plus one test.
- **Store locations come from OpenStreetMap** (when not using the Kroger API), so a newly opened or closed store may be wrong, and some addresses lack a house number.
- **Portion sizes are estimates.** "Pounds of food" uses a per-ingredient table (`PLATE_LB` in `src/normalize.ts`): cooked weight for rice and pasta, edible meat for bone-in cuts, typical can and package weights.
- **The optimizer is greedy** (marginal cost with a protein-variety cap). It's fast and usually near-cheapest, but not guaranteed optimal. Swap or shuffle to explore.
- DFW only (ZIPs within 60 miles of Dallas).
