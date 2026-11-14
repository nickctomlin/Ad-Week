import { filteredDiningOffers, nearbyForOffer, nextDiningDays, offerOnDate, diningSearchText } from './dining-model.js';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dayName = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
const dateName = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const checked = (time) => time ? new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not checked yet';
const kindName = { deal: 'Meal deal', coupon: 'Coupon / reward', special: 'Daily special', 'happy-hour': 'Happy hour' };
const ext = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>';
const safeLink = (url) => { try { const value = new URL(url); return ['https:', 'http:'].includes(value.protocol) ? value.href : '#'; } catch { return '#'; } };

export function createDining(root, getLocation) {
  const $ = (selector) => root.querySelector(selector);
  let data = null, mounted = false, loading = false, timer, request = 0, currentKey = '', lastError = '', dayInitialized = false;
  let locationOverride = false, limit = 24, query = '', tab = 'offers', brand = '', date = '', kind = '', placeKind = '', near = true, noApp = false, foodOnly = true, savedOnly = false, underTen = false;
  let savedIds;
  try { savedIds = JSON.parse(localStorage.getItem('adweek:dining:saved')) || []; } catch { savedIds = []; }
  if (!Array.isArray(savedIds)) savedIds = [];
  let local = getLocation();
  let locationExpanded = !/^\d{5}$/.test(local.zip || ''), filtersExpanded = false, closeLocationOnLoad = false;
  function mount() {
    root.innerHTML = `<div class="food-hero"><div><p class="food-eyebrow"><i></i> FAST FOOD & CASUAL</p><h1 id="h-food"><span class="food-desktop-only">Your next bite.<br><em>A better price.</em></span><span class="food-mobile-only">Fast food</span></h1><p class="food-lede"><span class="food-desktop-only">Public offers, daily specials, and the good spots around you.</span><span class="food-mobile-only">Find a good deal nearby.</span></p></div><div id="food-pick" class="food-pick"><span>ON THE MENU</span><b>Big appetite.<br>Small bill.</b><i aria-hidden="true">↗</i><small>Let’s find something good.</small></div></div>
      <button type="button" class="food-mobile-location" id="food-location-toggle" aria-expanded="false" aria-controls="food-location"><span id="food-location-label">Choose a location</span><span><span id="food-location-action">Change</span> <span aria-hidden="true">⌄</span></span></button>
      <form id="food-location" class="food-location"><div class="food-location-copy"><b>Where are we eating?</b><span>Use a ZIP to find nearby spots.</span></div><label><span>ZIP code</span><input id="food-zip" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" value="${esc(local.zip || '')}" placeholder="75024" required aria-label="Restaurant ZIP code"/></label><label><span>Within</span><select id="food-radius" aria-label="Restaurant search radius">${[5, 10, 15, 25].map((r) => `<option value="${r}" ${r === local.radius ? 'selected' : ''}>${r} miles</option>`).join('')}</select></label><button class="btn primary" type="submit">Find my next bite ${ext}</button></form>
      <div id="food-status" class="food-status" role="status" aria-live="polite"></div><div id="food-stats" class="food-stats"></div>
      <div class="food-browser"><div class="food-tabs" aria-label="Restaurant views"><button type="button" data-food-tab="offers" aria-pressed="true"><span class="food-desktop-only">Deals & coupons</span><span class="food-mobile-only">Offers</span><span id="food-offer-count"></span></button><button type="button" data-food-tab="specials" aria-pressed="false">Daily specials</button><button type="button" data-food-tab="places" aria-pressed="false"><span class="food-desktop-only">Nearby spots</span><span class="food-mobile-only">Nearby</span><span id="food-place-count"></span></button></div>
      <div class="food-toolbar"><label class="food-search"><span aria-hidden="true">⌕</span><input type="search" id="food-search" placeholder="Search restaurants or food" aria-label="Search restaurant deals and places"/></label><div class="food-mobile-controls"><label id="food-mobile-day-label"><select id="food-mobile-day" aria-label="Choose a day"><option value="">Any day</option></select></label><button type="button" id="food-filter-toggle" aria-expanded="false" aria-controls="food-filter-panel">Filters <span id="food-filter-count"></span><span aria-hidden="true">⌄</span></button></div>
      <div id="food-filter-panel" class="food-filter-panel"><label class="food-filter-field"><span>Restaurant</span><select id="food-brand" aria-label="Filter restaurant brand"><option value="">All restaurants</option></select></label><label class="food-filter-field"><span id="food-kind-label">Offer type</span><select id="food-kind" aria-label="Filter offer type"><option value="">All offer types</option>${Object.entries(kindName).map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></label>
      <div id="food-days" class="food-days" aria-label="Choose a day"></div>
      <div class="food-toggles"><button type="button" class="food-toggle" data-food-filter="near" aria-pressed="true">Near me</button><button type="button" class="food-toggle" data-food-filter="underTen" aria-pressed="false">$10 & under</button><button type="button" class="food-toggle" data-food-filter="noApp" aria-pressed="false">No app needed</button><button type="button" class="food-toggle" data-food-filter="foodOnly" aria-pressed="true">Food & soft drinks</button><button type="button" class="food-toggle" data-food-filter="savedOnly" aria-pressed="false">☆ Saved</button><button type="button" class="food-reset" data-food-reset>Reset filters</button></div><div class="food-filter-footer"><button type="button" class="btn primary" data-food-apply>Show results</button></div></div></div>
      <div class="food-results-head"><p id="food-summary" role="status" aria-live="polite"></p><button type="button" class="food-reset" data-food-refresh><span class="food-desktop-only">↻ Check for updates</span><span class="food-mobile-only">Refresh</span></button></div><div id="food-results"></div><div id="food-more"></div></div>
      <details class="food-coverage"><summary><span>What’s connected?</span><span id="food-coverage-count"></span></summary><p>We import public national offers and find nearby branches separately. Participation, menu prices, account eligibility, and hours can vary. Independent restaurants appear in Nearby spots even when their specials aren’t connected yet.</p><div id="food-sources"></div></details>
      <p class="food-credit">Locations © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>. Distances are straight-line estimates from the ZIP center. Offers link to each restaurant’s official site; redeem there or in its app.</p>`;
    mounted = true;
    paintMobileControls();
  }

  function paintMobileControls() {
    root.classList.toggle('food-location-open', locationExpanded);
    root.classList.toggle('food-filters-open', filtersExpanded);
    $('#food-location-toggle').setAttribute('aria-expanded', String(locationExpanded));
    $('#food-location-action').textContent = locationExpanded ? 'Close' : 'Change';
    $('#food-location-label').textContent = /^\d{5}$/.test(local.zip || '') ? `${data?.place.city ? `${data.place.city} ` : ''}${local.zip} · ${local.radius} mi` : 'Choose a location';
    $('#food-filter-toggle').setAttribute('aria-expanded', String(filtersExpanded));
    const extra = tab === 'places' ? [brand, placeKind, savedOnly] : [brand, kind, !near, underTen, noApp, !foodOnly, savedOnly];
    const count = extra.filter(Boolean).length;
    $('#food-filter-count').textContent = count || '';
    $('#food-filter-toggle').setAttribute('aria-label', count ? `Filters, ${count} applied` : 'Filters');
    $('#food-mobile-day-label').hidden = tab === 'places';
    $('.food-mobile-controls').classList.toggle('is-places', tab === 'places');
  }

  async function load(force = false) {
    if (!/^\d{5}$/.test(local.zip || '')) { lastError = ''; draw(); return; }
    const key = `${local.zip}:${local.radius}`;
    if (loading && key === currentKey) return;
    currentKey = key;
    const token = ++request;
    loading = true; lastError = ''; clearTimeout(timer); status();
    try {
      const response = await fetch(`/api/dining${force ? '/refresh' : ''}?zip=${local.zip}&radius=${local.radius}`, { method: force ? 'POST' : 'GET' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load restaurant offers.');
      if (token !== request) return;
      if (!dayInitialized) { date = result.today; dayInitialized = true; }
      data = result;
      if (closeLocationOnLoad) { locationExpanded = false; closeLocationOnLoad = false; }
      try { localStorage.setItem(`adweek:dining:${key}`, JSON.stringify(data)); } catch {}
      updateBrands(); draw();
      if (result.job?.running && !root.closest('.view').classList.contains('hidden')) timer = setTimeout(() => load(), 2200);
    } catch (error) {
      if (token !== request) return;
      lastError = error.message;
      if (!data) { try { data = JSON.parse(localStorage.getItem(`adweek:dining:${key}`)); updateBrands(); } catch {} }
    } finally {
      if (token === request) { loading = false; status(); if (lastError) draw(); }
    }
  }
  function updateBrands() {
    if (!data) return;
    const nearby = new Set(data.restaurants.map((r) => r.brand).filter(Boolean));
    const imported = new Set(data.offers.map((o) => o.brand));
    $('#food-brand').innerHTML = '<option value="">All restaurants</option>' + data.brands.filter((b) => nearby.has(b.id) || imported.has(b.id)).map((b) => `<option value="${b.id}" ${b.id === brand ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  }
  function status() {
    if (!mounted) return;
    const el = $('#food-status');
    if (lastError) el.innerHTML = `<span>${esc(lastError)}${data ? ' Showing the last saved results; recheck offers before ordering.' : ''}</span><button type="button" data-food-refresh>Try again</button>`;
    else if (loading || data?.job?.running) el.innerHTML = '<span class="food-dot-pulse"></span><span class="food-desktop-only">Checking official offers and nearby restaurants… Results appear as each source finishes.</span><span class="food-mobile-only">Checking for offers…</span>';
    else if (data?.location.status === 'error') el.innerHTML = '<span>Nearby lookup is unavailable right now. National offers are shown; use the restaurant’s locator to confirm a branch.</span>';
    else if (data?.location.status === 'stale') el.innerHTML = '<span>Nearby locations are from a saved search. The latest lookup was unavailable.</span>';
    else el.innerHTML = '';
  }
  const filters = () => ({ query, tab, brand, date, kind, near, noApp, foodOnly, saved: savedOnly, savedIds, underTen });
  const brandFor = (id) => data?.brands.find((b) => b.id === id);
  function saveButton(id, label) {
    return `<button type="button" class="food-save${savedIds.includes(id) ? ' on' : ''}" data-food-save="${esc(id)}" aria-label="${savedIds.includes(id) ? 'Unsave' : 'Save'} ${esc(label)}" aria-pressed="${savedIds.includes(id)}">${savedIds.includes(id) ? '★' : '☆'}</button>`;
  }
  function offerCard(offer) {
    const restaurant = brandFor(offer.brand), branches = nearbyForOffer(offer, data.restaurants), closest = branches[0];
    const schedule = offer.days?.length ? offer.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(' · ') : null;
    const priceInTitle = offer.priceLabel && offer.title.toLowerCase().includes(offer.priceLabel.toLowerCase());
    return `<article class="food-card${priceInTitle ? ' food-price-in-title' : ''}" style="--food-brand:${esc(restaurant?.color || '#738a6c')}"><div class="food-card-top"><div class="food-brand"><span>${esc(restaurant?.initials || '•')}</span><div><b>${esc(restaurant?.name || offer.brand)}</b><small>${esc(kindName[offer.kind])}</small></div></div>${saveButton(offer.id, offer.title)}</div>
      <div class="food-price">${esc(offer.priceLabel)}</div><h2>${esc(offer.title)}</h2>${offer.description !== offer.title ? `<p class="food-card-description">${esc(offer.description)}</p>` : ''}
      <div class="food-tags">${offer.appRequired ? '<span>App / rewards required</span>' : '<span class="food-tag-green food-tag-public">Public offer</span>'}${offer.minimumSpend != null ? `<span>$${offer.minimumSpend.toFixed(2)} minimum purchase</span>` : offer.purchaseRequired ? '<span>Qualifying purchase required</span>' : ''}${offer.delayedReward ? '<span>Reward for a later order</span>' : ''}${offer.newCustomer ? '<span>New members</span>' : ''}${offer.alcohol ? '<span>Alcohol</span>' : ''}${offer.stale || lastError ? '<span class="food-tag-warn">Needs recheck</span>' : ''}</div>
      ${schedule || offer.validTo || offer.validFrom ? `<p class="food-schedule">${[schedule, offer.validFrom && offer.validFrom > data.today ? `Starts ${dateName(offer.validFrom)}` : '', offer.validTo ? `Through ${dateName(offer.validTo)}` : '', offer.kind === 'happy-hour' ? 'Check local hours' : ''].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
      ${offer.couponCode ? `<button type="button" class="food-coupon" data-food-code="${esc(offer.couponCode)}">${esc(offer.couponCode)} <small>Copy code</small></button>` : ''}
      <div class="food-card-bottom">${closest ? `<div class="food-nearest"><b>${closest.distance} mi · ${esc(closest.name)}</b><small>${esc(closest.address || 'See map for location')}${branches.length > 1 ? ` · +${branches.length - 1} more nearby` : ''}</small><span>National offer · confirm local participation</span></div>` : '<p class="food-no-branch">National offer · no nearby branch confirmed</p>'}
      <div class="food-card-links"><a href="${esc(safeLink(offer.sourceUrl))}" target="_blank" rel="noopener noreferrer">View official offer ${ext}</a>${closest ? `<a class="food-map-link" href="${esc(closest.mapsUrl)}" target="_blank" rel="noopener noreferrer">Directions</a>` : ''}</div>
      <details class="food-terms"><summary><span class="food-desktop-only">Terms & source</span><span class="food-mobile-only">Details & terms</span></summary><div class="food-mobile-context">${offer.description !== offer.title ? `<p>${esc(offer.description)}</p>` : ''}${closest ? `<p>${esc(closest.address || 'See map for location')}${branches.length > 1 ? ` · +${branches.length - 1} more nearby` : ''}<br>National offer · confirm local participation.</p>` : ''}</div><p>${esc(offer.terms || 'No expiration or complete terms were published in the imported section. Check the official offer before ordering.')}</p><small>Read from ${esc(restaurant?.name)} · ${checked(offer.checkedAt)}. Prices and participation may vary.</small></details></div></article>`;
  }
  function restaurantCard(restaurant) {
    const b = brandFor(restaurant.brand), offers = data.offers.filter((o) => o.brand === restaurant.brand && (!date || offerOnDate(o, date)));
    return `<article class="food-place" style="--food-brand:${esc(b?.color || '#74877a')}"><div class="food-card-top"><div class="food-brand"><span>${esc(b?.initials || restaurant.name.slice(0, 1))}</span><div><h2>${esc(restaurant.name)}</h2><small>${restaurant.distance} mi · ${esc(restaurant.category === 'fast-food' ? 'Fast food' : restaurant.category === 'cafe' ? 'Café / treats' : 'Restaurant')}</small></div></div>${saveButton(restaurant.id, restaurant.name)}</div><p>${esc(restaurant.address || 'Address not listed; see map for exact location.')}</p>${restaurant.cuisine ? `<span class="food-cuisine">${esc(restaurant.cuisine)}</span>` : ''}<div class="food-place-offers">${offers.length ? `<button type="button" data-food-brand="${restaurant.brand}">${offers.length} public ${offers.length === 1 ? 'offer' : 'offers'} ${ext}</button><small>Confirm this location participates</small>` : '<span>No public offers imported yet</span>'}</div><div class="food-card-links"><a href="${esc(restaurant.mapsUrl)}" target="_blank" rel="noopener noreferrer">Get directions ${ext}</a>${restaurant.website ? `<a class="food-map-link" href="${esc(safeLink(restaurant.website))}" target="_blank" rel="noopener noreferrer">Official website</a>` : ''}</div>${restaurant.hours || restaurant.phone ? `<details class="food-terms"><summary>Location details</summary>${restaurant.hours ? `<p>Listed hours: ${esc(restaurant.hours)}</p>` : ''}${restaurant.phone ? `<p>Phone: ${esc(restaurant.phone)}</p>` : ''}<small>Location details are from OpenStreetMap and can change.</small></details>` : ''}</article>`;
  }
  function draw() {
    if (!mounted) mount();
    status();
    paintMobileControls();
    if (!data) {
      for (const id of ['food-stats', 'food-offer-count', 'food-place-count', 'food-summary', 'food-days', 'food-more', 'food-sources', 'food-coverage-count']) $(`#${id}`).textContent = '';
      $('#food-results').innerHTML = loading ? '<div class="food-grid">' + '<div class="skel" style="height:300px"></div>'.repeat(3) + '</div>' : '<div class="food-empty"><span>↗</span><h2>Let’s see what’s cooking nearby.</h2><p>Enter your ZIP above to load public offers and nearby restaurants.</p></div>';
      return;
    }
    const allOffers = filteredDiningOffers(data, filters());
    const words = diningSearchText(query).trim().split(/\s+/).filter(Boolean);
    const places = data.restaurants.filter((r) => (!brand || r.brand === brand) && (!placeKind || r.category === placeKind) && (!savedOnly || savedIds.includes(r.id)) && words.every((word) => diningSearchText(`${r.name} ${r.cuisine} ${r.address}`).includes(word)));
    const results = tab === 'places' ? places : allOffers, shown = results.slice(0, limit);
    const connected = new Set(data.sources.filter((s) => s.status === 'ok').map((s) => s.brand)).size;
    $('#food-stats').innerHTML = `<div><b>${data.offers.length}</b><span>public offers imported</span></div><div><b>${data.restaurants.length}</b><span>nearby spots discovered</span></div><div><b>${connected}</b><span>chains with live offers</span></div><p>${esc(data.place.city)} ${esc(data.place.zip)} · ${data.radius} mile radius</p>`;
    $('#food-offer-count').textContent = data.offers.length;
    $('#food-place-count').textContent = data.restaurants.length;
    $('#food-days').innerHTML = `<button type="button" data-food-day="" aria-pressed="${!date}"><b>Any day</b><small>All offers</small></button>` + nextDiningDays(data.today).map((day, i) => `<button type="button" data-food-day="${day}" aria-pressed="${date === day}"><b>${i === 0 ? 'Today' : dayName(day)}</b><small>${dateName(day)}</small></button>`).join('');
    $('#food-days').hidden = tab === 'places';
    $('#food-mobile-day').innerHTML = '<option value="">Any day</option>' + nextDiningDays(data.today).map((value, i) => `<option value="${value}">${i === 0 ? 'Today' : `${dayName(value)}, ${dateName(value)}`}</option>`).join('');
    $('#food-mobile-day').value = date;
    $('#food-kind').innerHTML = tab === 'places' ? '<option value="">All place types</option><option value="fast-food">Fast food</option><option value="restaurant">Restaurants</option><option value="cafe">Cafés & treats</option>' : '<option value="">All offer types</option>' + Object.entries(kindName).map(([key, name]) => `<option value="${key}">${name}</option>`).join('');
    $('#food-kind').value = tab === 'places' ? placeKind : kind;
    $('#food-kind').setAttribute('aria-label', tab === 'places' ? 'Filter restaurant category' : 'Filter offer type');
    $('#food-kind-label').textContent = tab === 'places' ? 'Place type' : 'Offer type';
    for (const button of root.querySelectorAll('[data-food-filter]')) button.hidden = tab === 'places' && !['savedOnly'].includes(button.dataset.foodFilter);
    $('#food-summary').textContent = `${results.length} ${tab === 'places' ? 'nearby restaurants' : tab === 'specials' ? 'advertised specials' : 'matching offers'}${date && tab !== 'places' ? ` for ${dayName(date)}, ${dateName(date)}` : ''}`;
    paintMobileControls();
    $('#food-results').innerHTML = shown.length ? `<div class="food-grid">${shown.map(tab === 'places' ? restaurantCard : offerCard).join('')}</div>` : `<div class="food-empty"><span>⌕</span><h2>${savedOnly ? 'Your saved picks will land here.' : 'Nothing matches this combination yet.'}</h2><p>${tab === 'places' && data.location.status !== 'ok' ? 'Restaurant discovery is still loading or unavailable. You can explore national offers while it finishes.' : 'Try another day, broaden your filters, or look at nearby spots.'}</p><button type="button" class="btn secondary" data-food-reset>Clear filters</button></div>`;
    $('#food-more').innerHTML = results.length > shown.length ? `<button type="button" class="btn secondary full" data-food-more>Show ${Math.min(24, results.length - shown.length)} more · ${results.length - shown.length} remaining</button>` : '';
    const featured = data.offers.find((o) => !o.stale && o.days?.length && offerOnDate(o, data.today) && (!foodOnly || !o.alcohol) && (!near || data.location.status !== 'ok' || nearbyForOffer(o, data.restaurants).length));
    $('#food-pick').innerHTML = featured ? `<span>${dayName(data.today).toUpperCase()} FIND</span><strong>${esc(featured.priceLabel)}</strong><b>${esc(brandFor(featured.brand)?.name)}</b><small>${esc(featured.title)}</small>` : '<span>ON THE MENU</span><b>Big appetite.<br>Small bill.</b><i aria-hidden="true">↗</i><small>A little local discovery.</small>';
    $('#food-coverage-count').textContent = `${data.sources.filter((s) => s.status === 'ok').length} of ${data.sources.length} sources importing`;
    $('#food-sources').innerHTML = data.sources.map((s) => `<div class="food-source"><span class="food-source-light ${s.status}"></span><div><b>${esc(s.label)}</b><small>${s.status === 'ok' ? `${s.offerCount} offers · Checked ${checked(s.successAt)}` : s.status === 'empty' ? 'No current public offers found. Additional deals may be in the app.' : s.status === 'blocked' ? 'Automatic import unavailable; check the official site.' : s.status === 'pending' ? 'Waiting for the first import…' : 'Could not recheck this source; saved offers are marked.'}</small></div><a href="${esc(safeLink(s.url))}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(s.label)}">${ext}</a></div>`).join('');
  }
  function redraw() { limit = 24; draw(); }
  root.addEventListener('submit', (event) => {
    if (event.target.id !== 'food-location') return;
    event.preventDefault(); locationOverride = true;
    closeLocationOnLoad = true;
    const next = { zip: $('#food-zip').value.trim(), radius: Number($('#food-radius').value) };
    if (next.zip !== local.zip || next.radius !== local.radius) { data = null; brand = ''; date = ''; dayInitialized = false; limit = 24; }
    local = next; load(); draw();
  });
  root.addEventListener('input', (event) => { if (event.target.id === 'food-search') { query = event.target.value; redraw(); } });
  root.addEventListener('change', (event) => {
    if (event.target.id === 'food-mobile-day') { date = event.target.value; redraw(); }
    if (event.target.id === 'food-brand') { brand = event.target.value; redraw(); }
    if (event.target.id === 'food-kind') { if (tab === 'places') placeKind = event.target.value; else kind = event.target.value; redraw(); }
  });
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.id === 'food-location-toggle') { locationExpanded = !locationExpanded; paintMobileControls(); if (locationExpanded) $('#food-zip').focus(); }
    else if (button.id === 'food-filter-toggle') { filtersExpanded = !filtersExpanded; paintMobileControls(); }
    else if (button.hasAttribute('data-food-apply')) { filtersExpanded = false; paintMobileControls(); $('#food-filter-toggle').focus(); }
    else if (button.dataset.foodTab) { tab = button.dataset.foodTab; for (const el of root.querySelectorAll('[data-food-tab]')) el.setAttribute('aria-pressed', String(el === button)); redraw(); }
    else if (button.hasAttribute('data-food-day')) { date = button.dataset.foodDay; redraw(); }
    else if (button.dataset.foodFilter) {
      const value = button.dataset.foodFilter;
      if (value === 'near') near = !near; if (value === 'underTen') underTen = !underTen; if (value === 'noApp') noApp = !noApp; if (value === 'foodOnly') foodOnly = !foodOnly; if (value === 'savedOnly') savedOnly = !savedOnly;
      button.setAttribute('aria-pressed', String(({ near, underTen, noApp, foodOnly, savedOnly })[value])); redraw();
    } else if (button.dataset.foodSave) {
      const id = button.dataset.foodSave; savedIds = savedIds.includes(id) ? savedIds.filter((v) => v !== id) : [...savedIds, id];
      try { localStorage.setItem('adweek:dining:saved', JSON.stringify(savedIds)); } catch {} draw();
    } else if (button.dataset.foodBrand) { brand = button.dataset.foodBrand; tab = 'offers'; $('#food-brand').value = brand; for (const el of root.querySelectorAll('[data-food-tab]')) el.setAttribute('aria-pressed', String(el.dataset.foodTab === 'offers')); redraw(); }
    else if (button.hasAttribute('data-food-reset')) {
      query = ''; brand = ''; date = data?.today || ''; kind = ''; placeKind = ''; noApp = false; underTen = false; savedOnly = false; near = true; foodOnly = true;
      $('#food-search').value = ''; $('#food-brand').value = ''; $('#food-kind').value = '';
      for (const el of root.querySelectorAll('[data-food-filter]')) el.setAttribute('aria-pressed', String(['near', 'foodOnly'].includes(el.dataset.foodFilter))); redraw();
    } else if (button.hasAttribute('data-food-refresh')) load(true);
    else if (button.hasAttribute('data-food-more')) { limit += 24; draw(); }
    else if (button.dataset.foodCode) {
      try { await navigator.clipboard.writeText(button.dataset.foodCode); button.querySelector('small').textContent = 'Copied'; }
      catch { button.querySelector('small').textContent = 'Select and copy code'; }
    }
  });
  return { show() {
    if (!locationOverride) { const next = getLocation(); if (next.zip !== local.zip || next.radius !== local.radius) { local = next; data = null; date = ''; dayInitialized = false; } }
    if (!mounted) mount();
    $('#food-zip').value = local.zip || ''; $('#food-radius').value = local.radius || 10;
    draw(); load();
  }, hide() { clearTimeout(timer); } };
}
