// Shared helpers: turn a raw price + name into normalized Deal rows.
import type { Canonical } from '../normalize.ts';
import { parseSize, sizeInBase, round2 } from '../normalize.ts';
import { deptForCanonical } from '../departments.ts';
import type { Deal } from './types.ts';

type Computed = 'canonical' | 'category' | 'dept' | 'pkg_qty' | 'size_estimated' | 'unit_price' | 'unit_price_unit';
export type DealBase = Omit<Deal, Computed>;

/** A deal that prices a dinner ingredient (usable by the planner). Requires a numeric price. */
export function buildDeal(base: DealBase & { sale_price: number }, can: Canonical, sizeText: string): Deal | undefined {
  let pkg: number | null = null;
  let estimated = 0;
  let unitPrice: number;
  let unitLabel: string;

  if (base.sold_by === 'weight') {
    // Priced per lb.
    if (can.unit === 'lb') {
      unitPrice = base.sale_price;
      unitLabel = 'lb';
    } else if (can.unit === 'each' && can.eachLb) {
      unitPrice = base.sale_price * can.eachLb;
      unitLabel = 'each (est. from $/lb)';
      estimated = 1;
    } else {
      // Per-lb price for something recipes count in packages — can't price reliably.
      return undefined;
    }
  } else {
    const parsed = sizeInBase(parseSize(sizeText), can);
    if (parsed) pkg = parsed;
    else {
      // Size not stated. Be conservative so unknown sizes never look cheaper than they are:
      // weight items are priced as 1 lb, countable items as 1 each (eggs as a dozen).
      pkg = can.unit === 'pkg' ? 1 : can.key === 'eggs' ? 12 : 1;
      estimated = can.unit === 'pkg' ? 0 : 1;
    }
    unitPrice = base.sale_price / pkg;
    unitLabel = can.unit === 'pkg' ? 'pkg' : can.unit;
  }

  return {
    ...base,
    canonical: can.key,
    category: can.category,
    dept: deptForCanonical(can.key, can.category),
    pkg_qty: pkg,
    size_estimated: estimated,
    unit_price: round2(unitPrice),
    unit_price_unit: unitLabel,
  };
}

/** A display-only deal (fruit, snacks, frozen...): shown on the Deals tab, never used for pricing plans. */
export function buildGenericDeal(base: DealBase, dept: string, sizeText: string): Deal {
  let unitPrice: number | null = null;
  let unitLabel: string | null = null;
  let pkg: number | null = null;
  if (base.sale_price != null) {
    if (base.sold_by === 'weight') {
      unitPrice = base.sale_price;
      unitLabel = 'lb';
    } else {
      const size = parseSize(sizeText);
      if (size && (size.unit === 'lb' || size.unit === 'oz') && size.qty > 0) {
        pkg = size.unit === 'lb' ? size.qty : size.qty / 16;
        unitPrice = base.sale_price / pkg;
        unitLabel = 'lb';
      } else if (size && size.unit === 'ct' && size.qty > 1) {
        pkg = size.qty;
        unitPrice = base.sale_price / size.qty;
        unitLabel = 'ct';
      }
    }
  }
  return {
    ...base,
    canonical: null,
    category: 'other',
    dept,
    pkg_qty: pkg,
    size_estimated: 0,
    unit_price: unitPrice != null ? round2(unitPrice) : null,
    unit_price_unit: unitLabel,
  };
}
