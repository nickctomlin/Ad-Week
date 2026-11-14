export function offerOnDate(offer, date) {
  if (offer.validFrom && date < offer.validFrom) return false;
  if (offer.validTo && date > offer.validTo) return false;
  return !offer.days?.length || offer.days.includes(new Date(`${date}T12:00:00`).getDay());
}
export function nextDiningDays(today) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T12:00:00`);
    date.setDate(date.getDate() + index);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
}
export function nearbyForOffer(offer, restaurants) {
  return restaurants.filter((restaurant) => restaurant.brand === offer.brand).sort((a, b) => a.distance - b.distance);
}
export function filteredDiningOffers(data, filters) {
  const words = diningSearchText(filters.query).trim().split(/\s+/).filter(Boolean);
  const brands = new Map(data.brands.map((brand) => [brand.id, brand.name]));
  return data.offers.filter((offer) => {
    if (filters.brand && offer.brand !== filters.brand) return false;
    if (filters.date && !offerOnDate(offer, filters.date)) return false;
    if (filters.kind && offer.kind !== filters.kind) return false;
    if (filters.tab === 'specials' && !['special', 'happy-hour'].includes(offer.kind)) return false;
    if (filters.near && data.location.status === 'ok' && !nearbyForOffer(offer, data.restaurants).length) return false;
    if (filters.noApp && offer.appRequired) return false;
    if (filters.foodOnly && offer.alcohol) return false;
    if (filters.saved && !filters.savedIds.includes(offer.id)) return false;
    if (filters.underTen && !(offer.price != null && offer.price <= 10 && (!offer.purchaseRequired || offer.minimumSpend != null && offer.price + offer.minimumSpend <= 10) || /free/i.test(offer.priceLabel) && offer.minimumSpend != null && offer.minimumSpend <= 10 && !offer.delayedReward)) return false;
    return words.every((word) => diningSearchText(`${offer.title} ${offer.description} ${brands.get(offer.brand) || ''}`).includes(word));
  }).sort((a, b) => Number(a.stale) - Number(b.stale) || Number(!!b.days?.length) - Number(!!a.days?.length) || (a.price ?? Infinity) - (b.price ?? Infinity) || a.title.localeCompare(b.title));
}
export const diningSearchText = (value) => String(value || '').normalize('NFKD').toLowerCase().replace(/['’‘]/g, '').replace(/\s+/g, ' ');
