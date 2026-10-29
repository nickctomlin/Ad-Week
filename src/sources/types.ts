export type ChainId = 'kroger' | 'tomthumb' | 'marketstreet' | 'aldi' | 'heb' | 'sprouts';

export type ChainInfo = {
  id: ChainId;
  name: string;
  flippMerchant: string; // merchant name as it appears in Flipp
  osmName: string; // Nominatim search query
  osmMatch: RegExp; // accept store names matching this
  osmExclude?: RegExp;
  weeklyAdUrl: string; // the chain's own weekly-ad page, linked (never fetched) so users can verify
  color: string; // accent for the UI
};

// Order = order shown in the UI.
export const CHAINS: ChainInfo[] = [
  { id: 'kroger', name: 'Kroger', flippMerchant: 'Kroger', osmName: 'Kroger', osmMatch: /^kroger\b/i, osmExclude: /fuel|pharmacy|gas|marketplace fuel/i, weeklyAdUrl: 'https://www.kroger.com/weeklyad', color: '#2b62b8' },
  { id: 'tomthumb', name: 'Tom Thumb', flippMerchant: 'Tom Thumb', osmName: 'Tom Thumb', osmMatch: /^tom thumb\b/i, osmExclude: /express|pharmacy|fuel|gas/i, weeklyAdUrl: 'https://www.tomthumb.com/weeklyad', color: '#c8312b' },
  { id: 'marketstreet', name: 'Market Street', flippMerchant: 'Market Street', osmName: 'Market Street', osmMatch: /^market street\b/i, osmExclude: /pharmacy|fuel|gas/i, weeklyAdUrl: 'https://www.shopmarketstreet.com/weeklyad', color: '#2f6b3a' },
  { id: 'aldi', name: 'ALDI', flippMerchant: 'ALDI', osmName: 'Aldi', osmMatch: /^aldi\b/i, weeklyAdUrl: 'https://www.aldi.us/weekly-specials/our-weekly-ads', color: '#1b3a8a' },
  { id: 'heb', name: 'H-E-B', flippMerchant: 'H-E-B', osmName: 'H-E-B', osmMatch: /^h-?e-?b\b/i, osmExclude: /fuel|gas|car wash|pharmacy|central market/i, weeklyAdUrl: 'https://www.heb.com/weekly-ad', color: '#d12d27' },
  { id: 'sprouts', name: 'Sprouts', flippMerchant: 'Sprouts Farmers Market', osmName: 'Sprouts Farmers Market', osmMatch: /^sprouts farmers market\b/i, osmExclude: /pharmacy|fuel/i, weeklyAdUrl: 'https://www.sprouts.com/weekly-ad/', color: '#4f8a1d' },
  // Walmart was dropped: it has no local grocery weekly ad (its only Flipp flyer is the national rollback ad).
];

export const CHAIN_BY_ID = new Map(CHAINS.map((c) => [c.id, c]));

export type Store = {
  id: string;
  chain: ChainId;
  name: string;
  address: string;
  lat: number;
  lng: number;
  source: string;
};

// Normalized deal/price row (see deals table in db.ts).
export type Deal = {
  id: string;
  source: 'kroger-api' | 'flipp';
  chain: ChainId;
  store_id: string | null;
  zone: string | null;
  item_name: string;
  canonical: string | null; // null = display-only deal (not a dinner ingredient)
  category: string;
  dept: string; // store department (departments.ts)
  sale_price: number | null; // null = promo-only deal ("Buy 2 Get 1 Free")
  promo_text: string | null;
  regular_price: number | null;
  sold_by: 'weight' | 'package';
  pkg_qty: number | null;
  size_estimated: number;
  unit_price: number | null;
  unit_price_unit: string | null;
  limit_qty: number | null;
  is_sale: number;
  note: string | null;
  valid_from: string | null;
  valid_to: string | null;
  source_url: string | null;
  image_url: string | null; // ad clipping (flyers) or product photo (Kroger API)
  flyer_id: number | null;
  flyer_item_id: number | null;
  fetched_at: number;
};
