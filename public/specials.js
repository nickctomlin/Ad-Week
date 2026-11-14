import { WEEKDAYS, chicagoWeekday, dailySpecialOnDay, happyHourDays, filterSpecials, directionsUrl, safeUrl } from './specials-model.js';
import { getCurrentLocation, formatLocationAccuracy, placeUserLocation } from './specials-location.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons = {
  glass: svg('<path d="M4 3h16l-8 9-8-9Zm8 9v9m-4 0h8M7 6h10"/>'),
  pin: svg('<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>'),
  list: svg('<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  locate: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
};

let leafletPromise;
function loadLeaflet() {
  if (window.L?.markerClusterGroup) return Promise.resolve(window.L);
  if (!leafletPromise) leafletPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/leaflet/leaflet.js';
    script.onload = () => {
      const clusters = document.createElement('script');
      clusters.src = '/vendor/leaflet/leaflet.markercluster.js';
      clusters.onload = () => resolve(window.L);
      clusters.onerror = () => { clusters.remove(); leafletPromise = null; reject(new Error('Map pins could not load. Please retry.')); };
      document.head.append(clusters);
    };
    script.onerror = () => { script.remove(); leafletPromise = null; reject(new Error('The map could not load. Try again or browse the list.')); };
    document.head.append(script);
  });
  return leafletPromise;
}

export function createSpecials(root) {
  let data, loading = false, mounted = false, visible = false, map, markers, L, selectedId = '', mapRequest = 0;
  let userMarker, userAccuracy;
  let query = '', day = '', kind = '', savedOnly = false, view = 'map', saved = [];
  try { const value = JSON.parse(localStorage.getItem('adweek:specials:saved')); if (Array.isArray(value)) saved = value.filter((id) => typeof id === 'string'); } catch {}
  const $ = (selector) => root.querySelector(selector);
  const results = () => filterSpecials(data?.venues || [], { query, day, kind, savedOnly, saved });
  const byId = (id) => data?.venues.find((venue) => venue.id === id);
  const isSaved = (id) => saved.includes(id);
  const saveButton = (venue) => `<button class="special-save" type="button" data-special-save="${esc(venue.id)}" aria-pressed="${isSaved(venue.id)}" aria-label="${isSaved(venue.id) ? 'Unsave' : 'Save'} ${esc(venue.name)}">${isSaved(venue.id) ? '★' : '☆'}</button>`;
  const link = (url, text, cls = '') => `<a class="${cls}" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${text}</a>`;

  function mount() {
    root.innerHTML = `<div class="special-hero"><div><p class="special-eyebrow">${icons.glass} A LITTLE LOCAL KNOW-HOW</p><h1 id="h-specials">Good times.<br><em>Great specials.</em></h1><p class="special-lede">Happy hours, food specials, and your next favorite spot around Plano and beyond.</p></div><div class="special-hero-aside" aria-hidden="true"><div class="special-glass">${icons.glass}</div><span>THE PLANO EDIT</span><b>Make a little<br>time for happy.</b><small>Find your spot. Bring your people.</small></div></div>
      <div class="special-intro"><span>${icons.pin} Plano & nearby <span class="special-intro-dot">·</span> <b id="special-total">Your local guide</b></span><span id="special-date"></span></div>
      <div class="special-browser"><div class="special-toolbar"><label class="special-search">${icons.search}<input id="special-query" type="search" placeholder="Search spots, tacos, margaritas…" aria-label="Search specials"/></label><select id="special-kind" aria-label="Type of special"><option value="">All specials</option><option value="happy-hour">Happy hours</option><option value="daily">Daily specials</option></select><div class="special-view-toggle" aria-label="Specials view"><button type="button" data-special-view="list" aria-pressed="false">${icons.list}<span>List</span></button><button type="button" data-special-view="map" aria-pressed="true">${icons.pin}<span>Map</span></button></div></div>
      <div class="special-filter-row"><div class="special-days" aria-label="Filter specials by day"><button type="button" data-special-day="" aria-pressed="true">Any day</button><button type="button" data-special-day="${chicagoWeekday()}" data-special-today aria-pressed="false">Today</button>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" data-special-day="${d}" aria-pressed="false">${WEEKDAYS[d].slice(0, 3)}</button>`).join('')}</div><button type="button" class="special-saved-filter" data-special-saved aria-pressed="false">☆ Saved</button></div>
      <div class="special-results-heading"><p id="special-summary" role="status" aria-live="polite">Loading your local guide…</p><button type="button" class="special-reset" data-special-reset>Reset filters</button></div>
      <div id="special-error" role="status"></div><div class="special-map-layout hidden" id="special-map-layout"><div class="special-map-frame"><div class="special-map-top"><span>${icons.pin} <b>Your next spot is around here.</b></span><div class="special-map-actions"><button type="button" id="special-locate" data-special-locate aria-label="Go to my location" disabled>${icons.locate}<span>My location</span></button><button type="button" data-special-fit>Show all results</button></div></div><div id="special-map" class="special-map" role="region" aria-label="Map of restaurant specials" tabindex="0"></div><div class="special-map-note"><span class="special-pin-key"></span> Select a pin to explore <span>Drag to move · + / − to zoom</span></div><p id="special-map-status" role="status"></p><p id="special-location-status" role="status" aria-live="polite"></p></div><div id="special-map-list" class="special-map-list" aria-label="Restaurants on map"></div></div>
      <div id="special-list" class="special-grid"></div></div>
      <p class="special-disclaimer" id="special-disclaimer">A guide for planning your visit. Hours, prices, and participation can change; check the linked source before heading out.</p>
      <dialog class="special-dialog" id="special-dialog" aria-labelledby="special-dialog-title"><div id="special-dialog-body"></div></dialog>`;
    $('#special-query').addEventListener('input', (event) => { query = event.target.value; draw(); });
    $('#special-kind').addEventListener('change', (event) => { kind = event.target.value; draw(); });
    root.addEventListener('click', onClick);
    $('#special-dialog').addEventListener('click', (event) => { if (event.target === $('#special-dialog')) $('#special-dialog').close(); });
    mounted = true;
  }

  function preview(venue) {
    const hh = venue.happy_hour && (kind !== 'daily') && (day === '' || happyHourDays(venue).includes(Number(day)));
    const daily = venue.daily_specials.filter((special) => dailySpecialOnDay(special, day));
    if (hh) return { label: 'Happy hour', schedule: `${venue.happy_hour.days} · ${venue.happy_hour.time}`, deals: [...new Set(venue.happy_hour.deals)].slice(0, 3) };
    return { label: 'Daily specials', schedule: daily.slice(0, 2).map((special) => special.day).join(' · '), deals: daily.slice(0, 3).map((special) => `${special.day}: ${special.special}`) };
  }

  function card(venue, compact = false) {
    const offer = preview(venue);
    return `<article class="special-card${selectedId === venue.id ? ' special-selected' : ''}" data-special-card="${esc(venue.id)}"><div class="special-card-top"><span class="special-category">${esc(venue.category)}</span>${saveButton(venue)}</div><h2><button type="button" data-special-detail="${esc(venue.id)}">${esc(venue.name)}</button></h2><p class="special-address">${esc(venue.address.replace(/, TX(?:\s+\d{5})?$/, ''))}</p><div class="special-offer-type">${icons.clock}<span>${offer.label}</span></div><p class="special-schedule">${esc(offer.schedule || 'Check source for schedule')}</p>${compact ? `<p class="special-compact-deal">${esc(offer.deals[0] || 'See the full specials and schedule.')}</p>` : `<ul class="special-deals">${offer.deals.map((deal) => `<li>${esc(deal)}</li>`).join('')}</ul>`}<div class="special-card-bottom"><button type="button" class="special-details-btn" data-special-detail="${esc(venue.id)}">View specials <span aria-hidden="true">↗</span></button>${venue.location ? `<button class="special-on-map" type="button" data-special-pin="${esc(venue.id)}" aria-label="See ${esc(venue.name)} on map">${icons.pin}<span>On map</span></button>` : link(directionsUrl(venue), 'Directions', 'special-on-map')}</div></article>`;
  }

  function draw() {
    if (!data) return;
    const venues = results();
    $('#special-total').textContent = `${data.venues.length} local spots`;
    $('#special-date').textContent = `Compiled ${new Date(`${data.generated_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    $('#special-summary').innerHTML = `<b>${venues.length}</b> ${venues.length === 1 ? 'spot' : 'spots'}${day === '' ? ' to explore' : ` with specials listed for ${WEEKDAYS[Number(day)]}`}${savedOnly ? ' · saved by you' : ''}`;
    for (const button of root.querySelectorAll('[data-special-day]')) button.setAttribute('aria-pressed', String(button.dataset.specialDay === day));
    for (const button of root.querySelectorAll('[data-special-view]')) button.setAttribute('aria-pressed', String(button.dataset.specialView === view));
    $('[data-special-saved]').setAttribute('aria-pressed', String(savedOnly));
    $('[data-special-saved]').textContent = `${savedOnly ? '★' : '☆'} Saved${saved.length ? ` (${saved.length})` : ''}`;
    $('#special-map-layout').classList.toggle('hidden', view !== 'map');
    $('#special-list').classList.toggle('hidden', view === 'map');
    const empty = '<div class="special-empty"><span aria-hidden="true">⌕</span><h2>No spots found</h2><p>Try another day, a different search, or your full local guide.</p><button type="button" class="btn primary" data-special-reset>Show all spots</button></div>';
    if (!venues.some((venue) => venue.id === selectedId)) selectedId = '';
    if (view === 'list') $('#special-list').innerHTML = venues.length ? venues.map((venue) => card(venue)).join('') : empty;
    else { $('#special-map-list').innerHTML = venues.length ? venues.map((venue) => card(venue, true)).join('') : empty; drawMap(venues); }
  }

  async function drawMap(venues) {
    const token = ++mapRequest;
    try {
      L = await loadLeaflet();
      if (token !== mapRequest || view !== 'map' || !visible) return;
      if (!map) {
        map = L.map($('#special-map'), { scrollWheelZoom: false, zoomControl: true }).setView([33.047, -96.769], 12);
        // Standard OSM raster tiles; only the tile pane is tinted by our theme.
        // No third-party tiles are prefetched by the service worker.
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>' }).addTo(map);
        tiles.on('tileerror', () => { $('#special-map-status').textContent = 'Map background unavailable. Pins, restaurant details, and directions are still available.'; });
        tiles.on('tileload', () => { $('#special-map-status').textContent = ''; });
        markers = L.markerClusterGroup({ maxClusterRadius: 38, showCoverageOnHover: false, animate: false,
          iconCreateFunction: (cluster) => L.divIcon({ className: 'special-map-cluster', html: `<span aria-label="${cluster.getChildCount()} restaurants; select to zoom in">${cluster.getChildCount()}</span>`, iconSize: [42, 42] }),
        }).addTo(map);
        $('#special-locate').disabled = false;
      }
      map.invalidateSize();
      markers.clearLayers();
      let selectedMarker;
      for (const venue of venues.filter((venue) => venue.location)) {
        const selected = venue.id === selectedId;
        const marker = L.marker([venue.location.lat, venue.location.lng], {
          title: venue.name, alt: venue.name,
          icon: L.divIcon({ className: `special-map-marker${selected ? ' active' : ''}`, html: `<span>${icons.glass}</span>`, iconSize: [36, 42], iconAnchor: [18, 42], popupAnchor: [0, -40] }),
        }).addTo(markers);
        marker.bindPopup(`<div class="special-popup"><small>${esc(venue.category)}</small><b>${esc(venue.name)}</b><p>${esc(venue.address)}</p><p>${esc(preview(venue).schedule)}</p><button type="button" data-special-detail="${esc(venue.id)}">View specials ↗</button>${link(directionsUrl(venue), 'Directions ↗')}</div>`, { maxWidth: 290 });
        marker.on('click', () => { selectedId = venue.id; highlight(); const card = root.querySelector(`[data-special-card="${venue.id}"]`); if (card) $('#special-map-list').scrollTop = card.offsetTop - $('#special-map-list').offsetTop; });
        if (selected) selectedMarker = marker;
      }
      if (selectedMarker) markers.zoomToShowLayer(selectedMarker, () => { selectedMarker.openPopup(); highlight(); });
      else fitMap(venues);
      const missing = venues.filter((venue) => !venue.location).length;
      if (missing) $('#special-map-status').textContent = `${missing} ${missing === 1 ? 'spot needs' : 'spots need'} an address check; use Directions in the list.`;
    } catch (error) { $('#special-map-status').innerHTML = `${esc(error.message)} <button type="button" data-special-map-retry>Retry map</button>`; }
  }

  function fitMap(venues = results()) {
    const points = venues.filter((v) => v.location).map((v) => [v.location.lat, v.location.lng]);
    if (map && points.length) map.fitBounds(points, { padding: [38, 38], maxZoom: 15, animate: false });
  }
  async function locateMe() {
    const button = $('#special-locate');
    if (!map || button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `${icons.locate}<span>Locating…</span>`;
    $('#special-location-status').textContent = 'Finding your location…';
    try {
      const position = await getCurrentLocation();
      selectedId = '';
      highlight();
      map.closePopup();
      const layers = placeUserLocation(L, map, position, { marker: userMarker, accuracy: userAccuracy, center: visible && view === 'map' });
      userMarker = layers.marker;
      userAccuracy = layers.accuracy;
      $('#special-location-status').textContent = `The blue dot is your location. Accuracy about ${formatLocationAccuracy(position.accuracy)}.`;
    } catch (error) {
      $('#special-location-status').textContent = `${error.message}${userMarker ? ' Your previous location is still shown.' : ''}`;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = `${icons.locate}<span>My location</span>`;
    }
  }
  function highlight() {
    for (const card of root.querySelectorAll('[data-special-card]')) card.classList.toggle('special-selected', card.dataset.specialCard === selectedId);
    if (markers) for (const marker of markers.getLayers()) marker.getElement()?.classList.toggle('active', marker.getPopup().getContent().includes(`data-special-detail="${selectedId}"`));
  }

  function detail(venue) {
    const hh = venue.happy_hour;
    $('#special-dialog-body').innerHTML = `<div class="special-dialog-top"><span class="special-eyebrow">THE PLANO EDIT</span><div class="special-dialog-controls">${saveButton(venue)}<button type="button" class="icon-btn" data-special-close aria-label="Close restaurant details">✕</button></div></div><p class="special-category">${esc(venue.category)}</p><h2 id="special-dialog-title">${esc(venue.name)}</h2><p class="special-address">${esc(venue.address)}</p><div class="special-dialog-actions">${link(directionsUrl(venue), `${icons.pin} Get directions`, 'btn primary')}${venue.phone ? `<a class="btn" href="tel:${esc(venue.phone.replace(/[^+\d]/g, ''))}">Call restaurant</a>` : ''}</div>${hh ? `<section class="special-detail-section"><h3>${icons.glass} Happy hour</h3><p class="special-detail-days">${esc(hh.days)}</p><p class="special-detail-time">${esc(hh.time)}</p><ul>${[...new Set(hh.deals)].map((deal) => `<li>${esc(deal)}</li>`).join('')}</ul></section>` : ''}${venue.daily_specials.length ? `<section class="special-detail-section"><h3>Daily specials</h3><div class="special-daily-list">${venue.daily_specials.map((special) => `<div><b>${esc(special.day)}</b><p>${esc(special.special)}</p></div>`).join('')}</div></section>` : ''}<div class="special-detail-source"><p>Hours and prices may change. Confirm with the restaurant before visiting.</p>${link(venue.source_url, 'Check the source ↗')}${venue.website && venue.website !== venue.source_url ? link(venue.website, 'Restaurant website ↗') : ''}${venue.notes ? `<details><summary>Source notes</summary><p>${esc(venue.notes)}</p></details>` : ''}${venue.location ? `<small>Map pin: ${esc(venue.location.precision)} · ${esc(venue.location.source)}. See directions for the entrance.</small>` : ''}</div>`;
    $('#special-dialog').showModal();
  }

  function onClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if ('specialClose' in button.dataset) { $('#special-dialog').close(); return; }
    if ('specialDetail' in button.dataset) { const venue = byId(button.dataset.specialDetail); if (venue) detail(venue); return; }
    if ('specialSave' in button.dataset) {
      const id = button.dataset.specialSave;
      saved = isSaved(id) ? saved.filter((value) => value !== id) : [...saved, id];
      try { localStorage.setItem('adweek:specials:saved', JSON.stringify(saved)); } catch {}
      const venue = byId(id);
      button.setAttribute('aria-pressed', String(isSaved(id)));
      button.setAttribute('aria-label', `${isSaved(id) ? 'Unsave' : 'Save'} ${venue.name}`);
      button.textContent = isSaved(id) ? '★' : '☆';
      draw(); return;
    }
    if ('specialPin' in button.dataset) {
      selectedId = button.dataset.specialPin; view = 'map'; draw();
      $('#special-map-layout').scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    }
    if ('specialFit' in button.dataset) { selectedId = ''; highlight(); map?.closePopup(); fitMap(); return; }
    if ('specialLocate' in button.dataset) { locateMe(); return; }
    if ('specialMapRetry' in button.dataset) { drawMap(results()); return; }
    if ('specialView' in button.dataset) view = button.dataset.specialView;
    else if ('specialDay' in button.dataset) { day = button.dataset.specialDay; selectedId = ''; }
    else if ('specialSaved' in button.dataset) { savedOnly = !savedOnly; selectedId = ''; }
    else if ('specialReset' in button.dataset) { query = ''; day = ''; kind = ''; savedOnly = false; selectedId = ''; $('#special-query').value = ''; $('#special-kind').value = ''; }
    else if ('specialRetry' in button.dataset) { load(); return; }
    else return;
    draw();
    if (button.dataset.specialView === 'map' && matchMedia('(max-width: 800px)').matches) $('#special-map-layout').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function load() {
    if (loading) return;
    loading = true;
    $('#special-error').textContent = '';
    try {
      const response = await fetch('/specials-data/plano-happy-hours.json');
      if (!response.ok) throw new Error('Your specials guide could not be loaded.');
      data = await response.json();
      draw();
    } catch (error) { $('#special-summary').textContent = 'The guide is unavailable.'; $('#special-error').innerHTML = `<div class="special-empty"><p>${esc(error.message)}</p><button class="btn primary" type="button" data-special-retry>Try again</button></div>`; }
    finally { loading = false; }
  }
  return {
    show() { visible = true; if (!mounted) mount(); if (!data) load(); else draw(); },
    hide() { visible = false; mapRequest++; if (mounted && $('#special-dialog').open) $('#special-dialog').close(); },
  };
}
