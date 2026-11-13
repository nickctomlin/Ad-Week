// All playground edits are scenarios. Source prices and recorded history remain unchanged.
export const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export const bounded = (value, min, max, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function basketItem(deal, quantity = 1) {
  return {
    id: deal.dealId, title: deal.item, price: deal.salePrice, original: deal.salePrice,
    regular: deal.regularPrice, qty: quantity, originalQty: quantity, unit: deal.priceUnit || 'each',
    chain: deal.chainName, color: deal.chainColor, dept: deal.deptLabel || 'Other groceries',
    image: deal.imageUrl, history: deal.history?.weeks || [], included: true,
  };
}

export function listBasket(items, deals) {
  const byId = new Map(deals.map((deal) => [deal.dealId, deal]));
  return items.filter((item) => item.price != null && Number.isFinite(Number(item.price))).map((item) => {
    const deal = byId.get(item.dealId || item.id);
    return {
      ...(deal ? basketItem(deal) : {}), id: item.dealId || item.id, title: item.title,
      price: Number(item.price), original: Number(item.price), regular: item.regular,
      qty: bounded(item.qty, 0.5, 99, 1), originalQty: bounded(item.qty, 0.5, 99, 1), unit: item.priceUnit || 'each',
      chain: item.chainName || 'Other stores', color: item.color, dept: item.dept || deal?.deptLabel || 'Other groceries',
      image: item.image, history: deal?.history?.weeks || [], included: true,
    };
  });
}

export function seedBasket(deals, random = false) {
  const candidates = deals.filter((d) => d.salePrice > 0 && d.salePrice <= 25);
  const sorted = random ? candidates.map((deal) => ({ deal, order: Math.random() })).sort((a, b) => a.order - b.order).map((x) => x.deal)
    : [...candidates].sort((a, b) => Number(!!b.history?.priorWeeks) - Number(!!a.history?.priorWeeks) || (b.score || 0) - (a.score || 0));
  const picked = [], departments = new Map(), chains = new Map();
  for (const deal of sorted) {
    if ((departments.get(deal.dept) || 0) >= 2) continue;
    if ((chains.get(deal.chainName) || 0) >= 2) continue;
    if (picked.some((d) => d.item === deal.item)) continue;
    picked.push(deal);
    departments.set(deal.dept, (departments.get(deal.dept) || 0) + 1);
    chains.set(deal.chainName, (chains.get(deal.chainName) || 0) + 1);
    if (picked.length === 6) break;
  }
  // A user selecting one chain can still explore a full basket.
  for (const deal of sorted) {
    if (picked.length >= 6) break;
    if (picked.some((d) => d.item === deal.item) || (departments.get(deal.dept) || 0) >= 2) continue;
    picked.push(deal);
    departments.set(deal.dept, (departments.get(deal.dept) || 0) + 1);
  }
  return picked.map((d) => basketItem(d));
}

export function scenarioTotals(items, { multiplier = 1, shift = 0, budget = 75 } = {}) {
  multiplier = bounded(multiplier, 1, 6, 1);
  shift = bounded(shift, -30, 30, 0);
  budget = bounded(budget, 0, 100000, 75);
  const rows = items.filter((x) => x.included !== false).map((item) => {
    const quantity = bounded(item.qty, 0, 99, 1) * multiplier;
    const price = roundMoney(bounded(item.price, 0, 9999) * (1 + shift / 100));
    const total = roundMoney(price * quantity);
    const hasRegular = item.regular != null && Number.isFinite(Number(item.regular));
    return { ...item, quantity, effectivePrice: price, total, regularTotal: hasRegular ? roundMoney(Number(item.regular) * quantity) : null };
  });
  const total = roundMoney(rows.reduce((sum, row) => sum + row.total, 0));
  const comparable = rows.filter((row) => row.regularTotal != null);
  const regular = roundMoney(comparable.reduce((sum, row) => sum + row.regularTotal, 0));
  const saving = roundMoney(regular - comparable.reduce((sum, row) => sum + row.total, 0));
  const original = roundMoney(items.reduce((sum, row) => sum + roundMoney(Number(row.original) * bounded(row.originalQty ?? row.qty, 0, 99, 1)), 0));
  return { rows, total, original, saving, regular, comparable: comparable.length, count: rows.length,
    units: rows.reduce((sum, row) => sum + row.quantity, 0), remaining: roundMoney(budget - total), budget };
}

export function breakdown(rows, groupBy = 'dept') {
  const groups = new Map();
  for (const row of rows) {
    const name = row[groupBy] || 'Other';
    if (!groups.has(name)) groups.set(name, { name, value: 0, count: 0 });
    const group = groups.get(name);
    group.value = roundMoney(group.value + row.total);
    group.count++;
  }
  return [...groups.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

export function recordedHistory(item, weeks = 12, asOf = new Date()) {
  // Never fill gaps with invented prices or compare differently sized products.
  const unique = new Map((item?.history || []).filter(([week, price]) => /^\d{4}-\d{2}-\d{2}$/.test(week) && Number.isFinite(price) && price >= 0));
  const end = new Date(asOf);
  end.setDate(end.getDate() - (end.getDay() - 3 + 7) % 7);
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks - 1) * 7);
  const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return [...unique].filter(([week]) => week >= day(start) && week <= day(end)).sort(([a], [b]) => a.localeCompare(b));
}
