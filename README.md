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

Four tabs (Setup, Deals, List, Flyers): a bottom bar on phones, a top bar on desktop. The meal planner (Plan tab) is switched off for now; set `FEATURES.plan = true` in `public/app.js` to bring it back.

- **Setup.** ZIP and radius, then pick stores. Each chain shows Live, Stale or No data, plus when it was updated and how long its ad is valid.
- **Plan.** Two styles, picked on Setup:
  - **Meal prep** (default): one recipe cooked as a single batch of people × dinners servings. For example, 4 people × 3 dinners = 12 servings.
  - **Variety**: a different recipe each night.

  Every recipe is sized to about **¾–1 lb of food per person per meal**. Meat and produce are rounded to the nearest half pound (then nudged so portions stay in range), and countable items to whole units. The tab shows a budget meter, cost per person and per serving, and the ad clipping of each recipe's main ingredient. Swap the recipe, or shuffle.
- **List.** Shopping list grouped by store, with directions links, checkboxes and a copy button. Switch between best prices and a single store.
- **Deals.** Every grocery item in this week's ads at your selected stores (about 640 for 75024), not just dinner ingredients, sorted into store aisles.
  - **Default view** is curated: "Best deals this week" (the biggest real savings, at most 2 per aisle), then the best 4 deals in each aisle with a "See all" link.
  - **Toolbar:** a compact bar pinned under the header, with search plus Stores, Aisle and Sort drop-downs. Picking an aisle or searching shows the full list, 60 cards at a time with "Show more".
  - **Stores** is a checklist, so you can view several stores at once. Your choice is remembered, and it stays applied when you go back from an aisle.
  - **Aisles have a back button.** Opening an aisle adds a history step (`#deals?aisle=meat`), so "← All aisles" or your phone's back gesture returns to the overview where you left it.
  - **Search** filters as you type with no lag: results redraw after a short pause, and only the results redraw.
  - **While ads are loading**, each store's deals appear as soon as that store finishes.
  - **Watches** (`public/watch.js`, tested in `test/watch.test.js`). Tap **☆ Watch** in any item window. You can also add keywords in the **Watching** panel. A dinner ingredient ("chicken breast") matches at every store; anything else matches its keywords ("blue bell ice cream"). Watches can have a target price ("under $2.50/lb"). Matching deals appear first in "★ Your watched items on sale", with a ★ on their cards and a "★ Watched items" aisle. Watches are stored on the server, so every device shares them.
  - **Price history** (`src/history.ts`, tested in `test/history.test.ts`). Every refresh records each item's price for that ad week (weeks start Wednesday) in `price_history`:
    - The same item is matched across weeks by Kroger's product id, or by chain plus a normalized ad name.
    - The item window shows a bar chart of recent weeks, "Usually $X · lowest $Y".
    - Cards get a "↓ Lowest in N wks" tag when this week beats every earlier week *and* the usual price, so steady prices aren't flagged.
    - On first start, history is seeded from earlier ads still in the HTTP cache.
  - **Savings ranking** (`public/scoring.js`, tested in `test/scoring.test.js`): each deal gets an estimated % off *that item*, from the best evidence available:
    1. Its own regular price, from the ad or Kroger's API. This is exact. Once an item has 3 or more past weeks of history, its own *usual* price counts too.
    2. Coupon terms turned into a real percentage:
       - "Buy 1 get 1 free" = 50%, "buy 2 get 1 free" = 33%, "buy 1 get 1 50% off" = 25%.
       - "Save $X" is measured against the item's price and split across the "when you buy N" quantity. With no price to compare, it stays low.
    3. For dinner ingredients priced per lb or per item, the price compared with the everyday price of an ordinary version: the 25th percentile of Kroger's regular shelf prices. These estimates are capped at 40%, so verified markdowns rank first.

    Items are never compared with other, pricier products, so a cheap product isn't mistaken for a sale. "Best deals this week" shows the top 8 (score 20 or more, at most 2 per aisle and 3 per store), ties going to bigger dollar savings. The item window shows each deal's estimate and what it's based on.
  - **Coupon-style deals** with no single price ("Buy 2 get 1 free", "Save $2 with yellow coupon") show their terms instead of a price.
- **Flyers.** Every current grocery weekly ad for your ZIP, page by page, as the actual ad clippings. A single compact toolbar row holds search, a Page drop-down that follows as you scroll, and a "Dinner only" toggle. Items already in your list are tagged.

Tap any item to open its **item window**. It shows the real ad clipping (with the printed price), price, unit price, regular price, limit, valid-through date, and store, plus links to **verify the price**:
- **Share.** Opens the native iOS or Android share sheet on HTTPS. Share a deal by text or another app; its link opens that exact item's window, including on a device without setup or with different store selections. Unsupported browsers copy the link, or show a selectable link if clipboard access is unavailable. Expired or removed deals show an explanation. Links use the address you're visiting, so recipients need access to that server (including Tailscale access for a private server). Android installations can open supported links in the installed PWA; iOS may open the same deal in Safari because a home-screen PWA cannot require native Universal Link handling.
- **Verify price.** Opens the item on flipp.com, or the product on kroger.com for Kroger API prices.
- **The chain's own weekly ad.** For example kroger.com/weeklyad or tomthumb.com/weeklyad.
- **Show it in the flyer.** Jumps to that ad page in the Flyers tab and highlights the item.

## Run it on a server (Docker) and install it on your phone

```bash
git clone https://github.com/<you>/Ad-Week.git && cd Ad-Week
cp .env.example .env            # add your Kroger keys
docker compose up -d --build    # http://<server>:3000
```

**Different port?** If 3000 is taken, add `ADWEEK_PORT=3001` (or any free port) to `.env` on the server and rerun `docker compose up -d`. Keep the setting in `.env` rather than editing `docker-compose.yml`, so `git pull` never conflicts with your local changes.

**To update later:** run `git pull`, then `docker compose up -d --build`. Use a rebuild, not just a restart, because the code is baked into the image. Your deals, list, watches and price history live in the `adweek-data` volume and are kept. Compose only manages Ad Week's container, so other containers (e.g. Jellyfin) are untouched.

**Install as an app.** Ad Week is a Progressive Web App:
- `public/manifest.webmanifest` provides the home-screen icon.
- `public/sw.js` lets it open and show your last-loaded deals, list and watches with no signal.
- Kroger product photos load through Ad Week's own `/api/product-image` endpoint, so a phone does not have to connect directly to Kroger for each image. Valid photos are cached in the existing database (up to 32 MB), temporary failures retry once, and a cached photo remains available during an upstream outage. This also applies to older saved list images without refreshing the deals. Only fixed public Kroger image paths are accepted; arbitrary URLs and redirects are rejected.

Phones only allow installing on **HTTPS**. With Tailscale, run this once on the server:

```bash
tailscale serve --bg 3000       # use your ADWEEK_PORT if you changed it; serves https://<server-name>.<tailnet>.ts.net
```

If something else (e.g. Jellyfin) already uses that HTTPS address, give Ad Week its own: `tailscale serve --bg --https=8443 3000`, then use `https://<server-name>.<tailnet>.ts.net:8443`.

Then open that https:// address on your phone:
- **Android (Chrome):** tap **Install** on the Setup tab, or use the ⋮ menu → *Install app*.
- **iPhone (Safari):** tap **Share** → *Add to Home Screen*.

HTTPS also enables the List tab's **Copy** button, since browsers only allow clipboard access on secure pages.

**Offline behavior:**
- The app always tries the network first, so it shows fresh deals and new versions whenever you're online.
- If you're offline, or the network takes more than 5 seconds, it shows the last copy saved on the device.
- List and watch changes made offline are kept on the phone and synced as soon as you're back online. Unsynced edits win over the server's older copy.

The icons are generated by `node scripts/make-icons.mjs`.

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

The UI also has a **Refresh deals** link.

**Speed.** Ingestion runs in parallel:
- All chains' flyers and the Kroger API (a different host) load at the same time.
- Every chain and every Kroger store loads in parallel.
- Each chain fetches several item details at once, and each Kroger store prices 6 ingredients at once.

A per-host limiter in `src/http.ts` keeps it polite: Flipp at most 4 concurrent and 8 requests a second; Kroger 6 concurrent.

A forced refresh of a ZIP (fresh ad list plus Kroger prices for 3 stores) takes about 20 seconds. Before the parallel version it took about 4½ minutes. A brand-new week's ads add about a minute the first time, for about 500 item details. Those are then cached for the life of the ad, so other ZIPs sharing those flyers finish in seconds. Each chain's deals are saved, and show up in the app, as soon as that chain finishes.

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
identifying User-Agent, at most 4 concurrent requests and 8 per second, and aggressive caching. No logins, keys, paywalls or
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
