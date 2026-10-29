# Ad Week: data-source feasibility report (2026-10-29)

Checked live on 2026-10-29 against robots.txt, the API endpoints and public pages.

| Chain | Method | Legality / ToS | Reliability | Effort | Verdict |
|---|---|---|---|---|---|
| **Kroger** | Official Developer API: `/v1/locations` (ZIP + radius search) and `/v1/products?filter.term=&filter.locationId=` returning `price.regular` / `price.promo` per store. OAuth2 client credentials, scope `product.compact`. | Sanctioned. Needs a free developer account. Products has a daily call quota (about 10k/day per community docs, to be confirmed in the portal). | High. Store-level prices. Endpoints answer `401` without a token, as expected. | Low | **Go** |
| **Tom Thumb** (Albertsons) | No official public API. robots.txt allows `/weeklyad`. That page embeds a **Flipp** flyer: its JS calls `api.flipp.com/flyerkit/v4.0/publications/`. | Flipp's FlyerKit is a partner/retailer API, not a public one. Using it means reusing a retailer-embedded key. That is a ToS gray area, and I stopped investigating there. | Medium if allowed | Medium | **Needs your decision** (see below) |
| **Aldi** | aldi.us `robots.txt`: `User-Agent: * / Disallow: /` (only Googlebot etc. allowed). No public API. | Automated access is explicitly disallowed. | n/a | n/a | **No automated access.** Manual flyer upload, then vision LLM, is possible. |
| **H-E-B** (Plano #790, 6001 Preston Rd) | No public API. heb.com sits behind Incapsula bot protection (robots.txt returns a JS challenge). | Getting through would mean bypassing bot detection. Not doing that. | n/a | n/a | **No automated access.** Manual flyer upload possible. |
| **Walmart** | No printed weekly ad (everyday pricing). Walmart.io Affiliate API requires an approved affiliate account. It is item-ID based, with no "what's on sale near me" feed and no reliable store-level pricing. | Allowed with approval. robots.txt disallows `/api/`. | Low fit for sale planning | High | **Skip for PoC**, documented as a limitation |

## Proposed architecture
- **Node 26 + TypeScript** (no Python on this machine). Node 26 ships `node:sqlite`, so there is no native build step on Windows. One language across ingestion, API and frontend.
- **Kroger ingestion:** for each nearby Kroger store, query about 60 canonical-ingredient search terms. Keep items where `promo < regular` as deals, and also keep regular prices so recipes can price non-sale staples. Cache in SQLite for 24h. Rate-limited.
- **Pluggable "source" interface.** Each chain implements `findStores(lat, lng, radius)` and `fetchDeals(store)`. Chains without access show as **"unavailable — no legitimate data source"** in the UI rather than being silently dropped.
- **Optional manual-flyer source:** you drop a flyer PDF/image you saved yourself into `flyers/<chain>/`. Claude vision turns it into JSON in the normalized schema. This is the legitimate path for Aldi and H-E-B.
- **Geocoding:** US Census geocoder / zippopotam.us (free, no key), with Haversine distance filtering.
- **Planning:** Claude proposes recipes as JSON (validated with zod). Code prices them from deal rows and runs a greedy plus swap budget optimizer.

## Blockers
1. **No credentials on this machine.** `KROGER_CLIENT_ID/SECRET` and `ANTHROPIC_API_KEY` are not set. I can build everything, but I can't show real output until they're in `.env`. Kroger app: https://developer.kroger.com, then create app, Production environment, scope `product.compact`.
2. **Tom Thumb via Flipp:** your call.

## Decision (2026-10-29)
You chose the Flipp route. Building it turned up a better path than the embedded-key approach: Flipp's **public,
unauthenticated** consumer endpoints (`backflipp.wishabi.com/flipp/...`, the ones flipp.com itself uses)
return current flyers by ZIP for **Kroger, Tom Thumb, ALDI, H-E-B and Walmart**, including unit text
("lb member price"), regular price when stated, and purchase limits ("Limit 2 Each"). No retailer key
is reused, and aldi.us and heb.com are never fetched. Store locations come from OpenStreetMap (Nominatim),
or from the Kroger Locations API when keys are set. Kroger's official Products API is layered on top when
keyed. See README → "Data sources and terms".
