// Watches: things you want to know about when they go on sale. A watch is either a dinner ingredient
// ("chicken breast", matched at every store) or keywords ("blue bell ice cream"), with an optional
// target price. Shared by the Deals page and tests (test/watch.test.js). Pure functions only.
//
// Shape: { id, label, canonical?: string, query?: string, unit?: 'lb'|'each', maxPrice?: number }

export const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);

/** Does deal `d` satisfy watch `w`? (Price target compares per-lb/each when the units match.) */
export function matchesWatch(d, w) {
  const hit = w.canonical
    ? (d.canonicals || []).includes(w.canonical)
    : tokens(w.query).length > 0 && tokens(w.query).every((t) => tokens(`${d.item} ${d.chainName || ''}`).includes(t));
  if (!hit) return false;
  if (w.maxPrice == null) return true;
  if (w.unit && d.unitPriceUnit === w.unit && d.unitPrice != null) return d.unitPrice <= w.maxPrice;
  return d.salePrice != null && d.salePrice <= w.maxPrice;
}

const FILLER = new Set(['fresh', 'assorted', 'select', 'selected', 'varieties', 'variety', 'family', 'size', 'pack', 'value', 'large', 'small', 'new', 'the', 'and', 'with', 'all', 'natural', 'premium', 'original']);

/**
 * A sensible default watch for an item: its dinner ingredient if it has one, otherwise up to four
 * meaningful words from the first product named in the ad ("Blue Bell Ice Cream Pint, Ben & Jerry's…").
 */
export function suggestWatch(x) {
  const canonical = x.canonicals?.[0] ?? x.canonical ?? null;
  if (canonical) {
    return { label: canonical, canonical, unit: x.unitPriceUnit === 'lb' || x.unitPriceUnit === 'each' ? x.unitPriceUnit : undefined };
  }
  const first = String(x.title || '')
    .split(/,| or | & |;/i)[0]
    .replace(/[®™©]/g, '')
    .replace(/\b\d+(\.\d+)?\s*-?\s*(fl\.? ?oz|oz|lbs?|ct|count|pk|pack|gal)\b\.?/gi, ' ');
  const words = first.split(/\s+/).filter((w) => /[a-z]/i.test(w) && !FILLER.has(w.toLowerCase())).slice(0, 4);
  const query = words.join(' ').toLowerCase();
  return { label: words.join(' ') || x.title, query };
}

/** Watches as a stable id for de-duplication ("canonical:chicken breast" / "q:blue bell ice cream"). */
export const watchKey = (w) => (w.canonical ? `canonical:${w.canonical}` : `q:${tokens(w.query).join(' ')}`);
