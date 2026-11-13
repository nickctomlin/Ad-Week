// Keep shared links within the installed PWA's scope, with no dependency on saved setup preferences.
export function dealShareData(item, baseUrl, zip) {
  const params = new URLSearchParams();
  const id = item.dealId || item.listId;
  if (id && !id.startsWith('flyer:')) {
    params.set('deal', id);
    if (item.store?.id) params.set('store', item.store.id);
  } else if (item.flyerId && item.flyerItemId && /^\d{5}$/.test(item.shareZip || zip)) {
    params.set('flyer', item.flyerId);
    params.set('item', item.flyerItemId);
    params.set('zip', item.shareZip || zip);
  } else {
    return null;
  }
  const url = new URL('/', baseUrl);
  url.hash = `deals?${params}`;
  const price = item.price != null ? `$${Number(item.price).toFixed(2)}${item.priceUnit ? ` / ${item.priceUnit}` : ''}` : item.promo;
  const text = [item.title, price, item.chainName ? `at ${item.chainName}` : ''].filter(Boolean).join(' · ');
  return { title: `${item.title} — Ad Week`, text, url: url.href };
}

export async function shareDeal(data, nav = navigator) {
  if (typeof nav.share === 'function') {
    try {
      // This must happen in the tap handler, before any fetch or clipboard work consumes activation.
      await nav.share(data);
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await nav.clipboard.writeText(data.url);
    return 'copied';
  } catch {
    return 'manual';
  }
}
