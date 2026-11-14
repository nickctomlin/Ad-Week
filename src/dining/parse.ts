import { load, type CheerioAPI } from 'cheerio';
import { createHash } from 'node:crypto';
import { DINING_BRANDS, type DiningSource } from './catalog.ts';

export type DiningOffer = {
  id: string; brand: string; title: string; description: string; terms: string; sourceId: string; sourceUrl: string;
  kind: 'deal' | 'coupon' | 'special' | 'happy-hour'; price: number | null; priceLabel: string; minimumSpend: number | null;
  couponCode: string | null; days: number[] | null; validFrom: string | null; validTo: string | null;
  appRequired: boolean; newCustomer: boolean; purchaseRequired: boolean; delayedReward: boolean; alcohol: boolean; checkedAt: number;
};
type Candidate = { title: string; description: string; terms?: string; appRequired?: boolean };
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const textOf = (html: string) => clean(load(html).text());
export function diningDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
const months = 'january february march april may june july august september october november december'.split(' ');
const pad = (n: number) => String(n).padStart(2, '0');
function dateIn(text: string, year: number): string | null {
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  const named = text.match(new RegExp(`\\b(${months.join('|')})\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?`, 'i'));
  if (numeric && (!named || numeric.index! < named.index!)) {
    const y = numeric[3] ? +numeric[3] < 100 ? 2000 + +numeric[3] : +numeric[3] : year;
    return `${y}-${pad(+numeric[1])}-${pad(+numeric[2])}`;
  }
  return named ? `${named[3] || year}-${pad(months.indexOf(named[1].toLowerCase()) + 1)}-${pad(+named[2])}` : null;
}
export function offerDates(text: string, today: string) {
  const year = +today.slice(0, 4);
  const end = text.match(/(?:through|thru|until|expires?|ends?|valid\s+(?:only\s+)?(?:on|until))\s+(.{0,90})/i);
  const only = text.match(/only.{0,65}?on\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2})/i);
  const start = text.match(/(?:from|between|starts?)\s+(.{0,90})/i);
  return { validFrom: only ? dateIn(only[1], year) : start ? dateIn(start[1], year) : null,
    validTo: only ? dateIn(only[1], year) : end ? dateIn(end[1], year) : null };
}
export function offerDays(text: string): number[] | null {
  if (/\bweekdays?\b|monday\s*(?:-|through|to)\s*friday/i.test(text)) return [1, 2, 3, 4, 5];
  if (/weekends/i.test(text)) return [0, 6];
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday|fryday', 'saturday'];
  const found = days.flatMap((day, index) => new RegExp(`\\b(?:${day})s?\\b`, 'i').test(text) ? [index] : []);
  return found.length ? found : null;
}

export function normalizeOffer(candidate: Candidate, source: DiningSource, checkedAt: number): DiningOffer | null {
  const title = clean(candidate.title), description = clean(candidate.description), terms = clean(candidate.terms || '');
  if (!title || title.length > 220 || !/\$\s*\d|\bfree\b|\d+[- ]cent|\bBOGO\b|half[- ]price|happy hour/i.test(`${title} ${description}`)) return null;
  const full = `${title} ${description} ${terms}`;
  const dates = offerDates(full, diningDay(new Date(checkedAt)));
  if (dates.validTo && dates.validTo < diningDay(new Date(checkedAt))) return null;
  const discount = title.match(/\$\s*(\d+(?:\.\d{1,2})?)\s*off/i);
  const free = /\bfree\b/i.test(title) || (!/\$\s*\d/.test(title) && /\bfree\b/i.test(description));
  const cents = title.match(/(\d+)[- ]cent/i);
  const amount = (title.match(/\$\s*(\d+(?:\.\d{1,2})?)/) || description.match(/(?:for|just|only|get a)\s*\$\s*(\d+(?:\.\d{1,2})?)/i))?.[1];
  const minimum = full.match(/(?:\$\s*(\d+(?:\.\d{1,2})?)\s*\+?\s*(?:(?:qualifying|minimum|app|in-app|mobile|online)\s+){0,3}(?:purchase|order)|(?:spend\s*(?:at least\s*)?|purchase of\s*)\$\s*(\d+(?:\.\d{1,2})?))/i);
  const code = full.match(/promo\s+code\s+([A-Z0-9]{3,20})\b/i)?.[1]?.toUpperCase() || null;
  const price = discount || free ? null : cents ? +cents[1] / 100 : amount ? +amount : null;
  const priceLabel = discount ? `$${discount[1]} off` : free ? 'Free with terms' : price != null ? `${/under/i.test(title) ? 'Under ' : /starting|from\s*\$/i.test(title) ? 'From ' : ''}$${price.toFixed(2)}` : /BOGO/i.test(full) ? 'BOGO' : /half[- ]price/i.test(full) ? 'Half price' : 'Special';
  const days = offerDays(full);
  const appRequired = candidate.appRequired || /\bapp\b|must (?:opt|be a registered)|rewards members/i.test(full);
  const kind = /happy hour/i.test(full) ? 'happy-hour' : days || dates.validFrom && dates.validFrom === dates.validTo ? 'special' : code || appRequired || discount || free ? 'coupon' : 'deal';
  return { id: `${source.id}:${createHash('sha256').update(title.toLowerCase()).digest('hex').slice(0, 14)}`, brand: source.brand, title, description: description.slice(0, 1800), terms: terms.slice(0, 7000), sourceId: source.id, sourceUrl: source.url,
    kind, price, priceLabel, minimumSpend: minimum ? +(minimum[1] || minimum[2]) : null, couponCode: code, days, ...dates,
    appRequired: !!appRequired, newCustomer: /new (?:app )?users|first purchase|sign.?up reward/i.test(full),
    purchaseRequired: minimum != null || /qualifying purchase|with (?:a )?purchase|w\/\s*purchase/i.test(full),
    delayedReward: /\bnext\b.{0,45}\b(?:purchase|order)\b/i.test(full),
    alcohol: /\bbeer|\bwine|margarita|tequila|cocktail/i.test(full) || source.brand === 'chilis' && kind === 'happy-hour', checkedAt };
}

// Decode only the JSON data published in server-rendered pages; never execute page scripts.
export function flightData($: CheerioAPI): unknown[] {
  const chunks: string[] = [];
  $('script').each((_, el) => { for (const match of ($(el).html() || '').matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)/g)) {
    try { const value = JSON.parse(match[1]); if (typeof value[1] === 'string') chunks.push(value[1]); } catch {}
  } });
  const joined = chunks.join('');
  const values: unknown[] = joined.split('\n').flatMap((line) => { try { return [JSON.parse(line.slice(line.indexOf(':') + 1))]; } catch { return []; } });
  // React's T records are length-prefixed UTF-8 data, sometimes containing serialized CMS blocks.
  const bytes = Buffer.from(joined), latin = bytes.toString('latin1');
  for (const match of latin.matchAll(/(?:^|\n)[a-f0-9]+:T([a-f0-9]+),/g)) {
    const start = match.index! + match[0].length, length = parseInt(match[1], 16);
    if (length > 2_000_000 || start + length > bytes.length) continue;
    const raw = bytes.subarray(start, start + length).toString('utf8');
    try { values.push(JSON.parse(raw)); } catch { values.push({ publishedText: raw }); }
  }
  // A T record can be followed immediately by another record without a newline.
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes[offset] === 10) { offset++; continue; }
    const colon = latin.indexOf(':', offset);
    if (colon < offset || colon - offset > 12 || !/^[a-f0-9]+$/.test(latin.slice(offset, colon))) {
      const next = latin.indexOf('\n', offset); if (next < 0) break; offset = next + 1; continue;
    }
    if (latin[colon + 1] === 'T') {
      const comma = latin.indexOf(',', colon + 2), length = parseInt(latin.slice(colon + 2, comma), 16);
      if (comma < 0 || !Number.isFinite(length) || length > 2_000_000 || comma + 1 + length > bytes.length) break;
      const raw = bytes.subarray(comma + 1, comma + 1 + length).toString('utf8');
      try { values.push(JSON.parse(raw)); } catch { values.push({ publishedText: raw }); }
      offset = comma + 1 + length;
    } else {
      const newline = latin.indexOf('\n', colon + 1), end = newline < 0 ? bytes.length : newline;
      try { values.push(JSON.parse(bytes.subarray(colon + 1, end).toString('utf8'))); } catch {}
      offset = end + 1;
    }
  }
  return values;
}
function walk(value: unknown, visit: (node: any) => void) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}
function headings($: CheerioAPI): Candidate[] {
  return $('h2,h3,h4,h5,h6').toArray().filter((el) => !$(el).closest('header,footer,nav').length).flatMap((el) => {
    const heading = $(el), title = clean(heading.text());
    if (/best happy hour|explore happy hour|done right|redeem exclusive|about us|contact us|^explore$/i.test(title)) return [];
    let block = heading.parent();
    for (let i = 0; i < 10; i++) {
      const parent = block.parent();
      if (!parent.length || parent.find('h2,h3,h4,h5,h6').length > 1 || parent.text().length > 7000) break;
      block = parent;
    }
    const paragraphs = block.find('p').map((_, p) => clean($(p).text())).get().filter(Boolean);
    return [{ title, description: paragraphs[0] || title, terms: paragraphs.slice(1).join(' ') }];
  });
}

export function parseDiningOffers(html: string, source: DiningSource, checkedAt = Date.now()): DiningOffer[] {
  const $ = load(html);
  $('script[type="application/ld+json"]').remove(); // website/FAQ metadata is not an offer feed
  let candidates: Candidate[] = [];
  if (source.parser === 'wendys') {
    candidates = $('[class*="field-highlightcard-cardheading"]').toArray().map((el) => {
      const card = $(el).closest('.brick');
      return { title: $(el).text(), description: card.find('[class*="highlightcard-copy"]').text() || $(el).text(), terms: 'App and account required. At participating U.S. locations; check the official offer for full terms.', appRequired: true };
    });
    $('.brick--up-promo-sub').each((_, el) => {
      const card = $(el), heading = card.find('[class*="field-uppromo-header"]').clone();
      heading.find('br').replaceWith(' ');
      const title = clean(heading.text()), description = card.find('[class*="field-uppromo-copy"]').text();
      if (title && description) candidates.push({ title, description, terms: card.find('[class*="field-uppromo-legal-line"]').text() });
    });
  } else if (source.parser === 'mcdonalds') {
    candidates = $('.cmp-teaser').toArray().flatMap((el) => {
      const card = $(el), title = clean(card.find('.cmp-teaser__title').text());
      if (/wanna save|check out how|^$/i.test(title)) return [];
      const description = card.find('.cmp-teaser__description').clone();
      const terms = description.find('.legal-pub').map((_, p) => clean($(p).text())).get().join(' ');
      description.find('.legal-pub').remove();
      description.find('p,li,br').after(' ');
      return [{ title, description: description.text(), terms }];
    });
  } else if (source.parser === 'contentful') {
    for (const data of flightData($)) walk(data, (node) => {
      const f = node.fields;
      if (!f?.description || !Array.isArray(f.title) || !f.descriptionCTA?.fields?.message) return;
      candidates.push({ title: f.title.map((t: any) => t.fields?.text || '').join(' '), description: f.description, terms: f.descriptionCTA.fields.message });
    });
  } else {
    candidates = headings($);
    if (source.parser === 'chilis') {
      for (const data of flightData($)) walk(data, (node) => {
        const html = node.publishedText || (node.component?.name === 'Text' ? node.component.options?.text : null);
        if (typeof html !== 'string') return;
        const text = textOf(html);
        if (/3 for me/i.test(text) && /\$\d/.test(text)) candidates.push({ title: '3 for Me®', description: text });
      });
    }
  }
  if (source.id === 'chilis-hours') {
    candidates = candidates.map((candidate) => ({ ...candidate, terms: `${candidate.terms || ''} Happy hour prices, times and participation vary by location. Check the official page and restaurant.` }));
  }
  const unique = new Map<string, DiningOffer>();
  for (const candidate of candidates) {
    const offer = normalizeOffer(candidate, source, checkedAt);
    if (offer) unique.set(offer.id, offer);
  }
  if (source.brand === 'tacobell') {
    // The campaign headings are h3 on some versions and h2 on others; normal extraction handles both.
    const intro = DINING_BRANDS.find((brand) => brand.id === source.brand)!;
    if (!unique.size && html.includes('Taco Bell Offers')) throw new Error(`${intro.name} offers markup changed; review its official page.`);
  }
  return [...unique.values()];
}
