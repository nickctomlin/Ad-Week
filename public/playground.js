import { basketItem, listBasket, seedBasket, scenarioTotals, breakdown, recordedHistory, roundMoney, bounded } from './playground-model.js';
import { imageUrl } from './images.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (value) => Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const shortDate = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const COLORS = ['#5ebc91', '#f6a557', '#a69af3', '#67bdd4', '#e582a1', '#d1be67', '#8caaa1'];
const KEY = 'adweek:playground:v1';
const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg>';

export function createPlayground(root, { getDeals, getList }) {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(KEY)); } catch {}
  let items = Array.isArray(stored?.items) ? stored.items.filter((x) => x && typeof x.id === 'string' && typeof x.title === 'string' && Number.isFinite(x.price) && Number.isFinite(x.original)).slice(0, 60) : [];
  let controls = { multiplier: bounded(stored?.multiplier ?? 1, 1, 6, 1), shift: bounded(stored?.shift ?? 0, -30, 30, 0), budget: bounded(stored?.budget ?? 75, 1, 10000, 75) };
  let selected = items[0]?.id, groupBy = 'dept', filter = '', range = 12, source = stored?.source || 'A basket of this week’s real deals';
  let context = {}, mounted = false, initialized = stored?.initialized === true || !!stored?.items?.length, query = '', selectedWeek = null, statusTimer;
  const $ = (selector) => root.querySelector(selector);
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ items, ...controls, source, initialized })); } catch {} };
  const say = (text) => { const el = $('#pg-status'); el.textContent = text; clearTimeout(statusTimer); statusTimer = setTimeout(() => { el.textContent = ''; }, 5000); };

  function hydrate() {
    const deals = getDeals();
    const byId = new Map(deals.map((d) => [d.dealId, d]));
    for (const item of items) {
      const current = byId.get(item.id);
      if (current?.history?.weeks) item.history = current.history.weeks;
    }
    if (!initialized && !items.length) {
      const list = listBasket(getList(), deals);
      items = list.length ? list : seedBasket(deals);
      source = list.length ? 'A copy of your shopping list' : 'A basket of this week’s real deals';
      selected = items[0]?.id;
      if (items.length) initialized = true;
    }
  }

  function mount() {
    root.innerHTML = `
      <div class="pg-head"><div><div class="pg-eyebrow"><span></span> THE PRICE PLAYGROUND</div><h1 id="h-playground">A little <em>what if.</em><br>A lot of possibility.</h1><p>Turn the knobs. Follow the prices. Find your happy total.</p></div><div class="pg-sticker" aria-hidden="true">GOOD FOOD.<br>SMARTER<br><b>SPENDING.</b><span>↗</span></div></div>
      <div class="pg-source"><span id="pg-source"></span><div><button type="button" class="btn ghost sm" data-pg="import">Use my list</button><button type="button" class="btn secondary sm" data-pg="shuffle">↻ Surprise me</button></div></div>
      <p class="pg-help">Real ad prices to start. Your edits are just for this playground.</p>
      <div class="pg-metrics" id="pg-metrics" aria-live="polite" aria-atomic="true"></div>
      <section class="pg-card pg-controls" aria-labelledby="pg-controls-title"><div class="pg-section-title"><div><span class="pg-kicker">01 / WHAT IF</span><h2 id="pg-controls-title">Pull a few strings.</h2></div><button type="button" class="pg-text-button" data-pg="reset">Reset changes ↺</button></div>
        <div class="pg-knobs"><label class="pg-knob"><span>Basket multiplier <output id="pg-multiplier-value"></output></span><input id="pg-multiplier" type="range" min="1" max="6" step="1" value="${controls.multiplier}"/><small>One basket or feeding a crowd?</small></label>
        <label class="pg-knob"><span>Price shift <output id="pg-shift-value"></output></span><input id="pg-shift" type="range" min="-30" max="30" step="1" value="${controls.shift}"/><small>A sale day. A pricier week. Try it.</small></label>
        <label class="pg-budget"><span>Your spending target</span><div><b>$</b><input id="pg-budget" type="number" min="1" max="10000" step="1" value="${controls.budget}" aria-label="Spending target"/></div><small id="pg-budget-hint"></small></label></div>
      </section>
      <div class="pg-chart-grid"><section class="pg-card" aria-labelledby="pg-breakdown-title"><div class="pg-section-title"><div><span class="pg-kicker">02 / THE BIG PICTURE</span><h2 id="pg-breakdown-title">Where does it all go?</h2></div><div class="pg-switch" aria-label="Group costs"><button type="button" data-group="dept" aria-pressed="true">Aisle</button><button type="button" data-group="chain" aria-pressed="false">Store</button></div></div><div id="pg-breakdown"></div><p class="pg-chart-hint">Tap a segment or category to explore its items.</p></section>
      <section class="pg-card pg-history-card" aria-labelledby="pg-history-title"><div class="pg-section-title"><div><span class="pg-kicker">03 / THE TIME MACHINE</span><h2 id="pg-history-title">Every price has a past.</h2></div><span class="pg-history-mark" aria-hidden="true">↝</span></div><label class="pg-history-select"><span class="sr-only">Item price history</span><select id="pg-history-item" aria-label="Item price history"></select></label><div class="pg-history-tools"><span><i></i> Recorded price <i class="scenario"></i> Your price</span><div class="pg-switch" aria-label="History range"><button type="button" data-range="4">4 wk</button><button type="button" data-range="8">8 wk</button><button type="button" data-range="12" aria-pressed="true">12 wk</button></div></div><div id="pg-history"></div><div id="pg-history-info"></div></section></div>
      <section class="pg-card pg-basket" aria-labelledby="pg-basket-title"><div class="pg-section-title"><div><span class="pg-kicker">04 / MAKE IT YOURS</span><h2 id="pg-basket-title">Your basket. Your rules.</h2></div><span id="pg-item-count" class="pg-count"></span></div><div id="pg-filter"></div><div id="pg-items"></div><div class="pg-add"><label><span class="pg-search-icon" aria-hidden="true">⌕</span><input id="pg-search" type="search" placeholder="Find a deal to add…" autocomplete="off" aria-label="Search deals to add"/></label><span id="pg-catalog-count"></span></div><div id="pg-catalog"></div><p class="pg-fineprint">Quantities use each ad’s selling unit: pounds for per-lb deals, packages for packaged items. Tax, coupon eligibility and purchase limits can affect checkout totals.</p></section>
      <div class="pg-bottom"><span>Curiosity looks good on your grocery bill.</span><a href="#deals">Back to the deals ${arrow}</a></div><div id="pg-status" class="pg-status" role="status" aria-live="polite"></div>`;
    mounted = true;
  }

  function metrics(totals) {
    const delta = roundMoney(totals.total - totals.original);
    const progress = Math.min(100, totals.budget > 0 ? totals.total / totals.budget * 100 : 0);
    $('#pg-metrics').innerHTML = `<div class="pg-metric pg-metric-main"><span>Your what-if total</span><strong>${money(totals.total)}</strong><small>${totals.count} items · ${controls.multiplier}× basket${controls.shift ? ` · ${controls.shift > 0 ? '+' : ''}${controls.shift}% prices` : ''}</small></div>
      <div class="pg-metric"><span>${totals.remaining >= 0 ? 'Room to play' : 'Over your target'}</span><strong class="${totals.remaining < 0 ? 'pg-orange' : ''}">${money(Math.abs(totals.remaining))}</strong><div class="pg-meter"><i style="width:${progress}%" class="${totals.remaining < 0 ? 'over' : ''}"></i></div><small>of your ${money(totals.budget)} target</small></div>
      <div class="pg-metric"><span>${totals.saving >= 0 ? 'Below regular prices' : 'Above regular prices'}</span><strong>${totals.comparable ? money(Math.abs(totals.saving)) : '—'}</strong><small>${totals.comparable ? `${totals.comparable} of ${totals.count} items have a known regular price` : 'No regular prices available to compare'}</small></div>
      <div class="pg-metric pg-metric-note"><span>The ripple effect</span><strong>${delta > 0 ? '+' : delta < 0 ? '−' : ''}${money(Math.abs(delta))}</strong><small>${delta < 0 ? 'A little change, a little more left over.' : delta > 0 ? 'What your tweaks add to the original basket.' : 'Move a slider. See what happens.'}</small></div>`;
    $('#pg-multiplier-value').textContent = `${controls.multiplier}×`;
    $('#pg-shift-value').textContent = `${controls.shift > 0 ? '+' : ''}${controls.shift}%`;
    $('#pg-budget-hint').textContent = totals.remaining >= 0 ? 'Looking good. There’s room left.' : 'Try a smaller basket or a lower price.';
  }

  function drawBreakdown(totals) {
    const groups = breakdown(totals.rows, groupBy), radius = 74, circumference = 2 * Math.PI * radius;
    let offset = 0;
    const rings = groups.map((group, index) => {
      const length = totals.total > 0 ? group.value / totals.total * circumference : 0;
      const result = `<circle class="pg-ring${filter && filter !== group.name ? ' dim' : ''}" cx="110" cy="110" r="${radius}" fill="none" stroke="${COLORS[index % COLORS.length]}" stroke-width="25" stroke-dasharray="${Math.max(0, length - (groups.length > 1 ? 3 : 0))} ${circumference}" stroke-dashoffset="${-offset}" transform="rotate(-90 110 110)" data-slice="${esc(group.name)}"><title>${esc(group.name)}: ${money(group.value)}</title></circle>`;
      offset += length;
      return result;
    }).join('');
    $('#pg-breakdown').innerHTML = groups.length ? `<div class="pg-donut-layout"><div class="pg-donut"><svg viewBox="0 0 220 220" role="img" aria-label="Cost breakdown by ${groupBy === 'dept' ? 'aisle' : 'store'}"><circle cx="110" cy="110" r="74" fill="none" stroke="var(--surface-3)" stroke-width="25"/>${rings}</svg><div><small>THE WHOLE BASKET</small><b>${money(totals.total)}</b><span>${groups.length} ${groupBy === 'dept' ? 'aisle' : 'store'}${groups.length === 1 ? '' : 's'}</span></div></div><div class="pg-legend">${groups.map((g, i) => `<button type="button" data-slice="${esc(g.name)}" aria-pressed="${filter === g.name}" style="--slice:${COLORS[i % COLORS.length]}"><i></i><span>${esc(g.name)}<small>${g.count} ${g.count === 1 ? 'item' : 'items'} · ${totals.total ? Math.round(g.value / totals.total * 100) : 0}%</small></span><b>${money(g.value)}</b></button>`).join('')}</div></div>` : '<div class="pg-chart-empty">Your next grocery experiment starts below.<br>Add an item to bring this chart to life.</div>';
  }

  function drawHistory() {
    if (!items.some((item) => item.id === selected)) selected = items[0]?.id;
    $('#pg-history-item').innerHTML = items.map((item) => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.title)} · ${esc(item.chain)}</option>`).join('') || '<option>Add an item to explore</option>';
    const item = items.find((row) => row.id === selected), history = recordedHistory(item, range);
    if (!item) { $('#pg-history').innerHTML = '<div class="pg-chart-empty">Choose a deal. Start its story.</div>'; $('#pg-history-info').innerHTML = ''; return; }
    const scenario = roundMoney(item.price * (1 + controls.shift / 100));
    if (!history.length) {
      $('#pg-history').innerHTML = '<div class="pg-chart-empty"><span>↝</span>No recorded history for this item yet.<br>Try another item in your basket.</div>';
      $('#pg-history-info').innerHTML = `<p class="pg-chart-hint">Your scenario: ${money(scenario)} / ${esc(item.unit)}. History appears as prices are recorded each week.</p>`;
      return;
    }
    const width = 500, height = 195, left = 48, right = 22, top = 22, bottom = 34;
    const prices = [...history.map(([, p]) => p), scenario], min = Math.max(0, Math.min(...prices) * 0.75), max = Math.max(1, ...prices) * 1.15;
    const firstDay = Date.parse(history[0][0]), lastDay = Date.parse(history[history.length - 1][0]);
    const px = (i) => history.length === 1 ? (width + left - right) / 2 : left + (Date.parse(history[i][0]) - firstDay) / (lastDay - firstDay) * (width - left - right);
    const py = (price) => top + (1 - (price - min) / (max - min)) * (height - top - bottom);
    const points = history.map(([, price], i) => `${px(i)},${py(price)}`), floor = height - bottom;
    const grid = Array.from({ length: 4 }, (_, i) => { const value = min + (max - min) * i / 3, y = py(value); return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="pg-gridline"/><text x="${left - 9}" y="${y + 4}" text-anchor="end" class="pg-axis">${money(value)}</text>`; }).join('');
    $('#pg-history').innerHTML = `<svg class="pg-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(item.title)} recorded prices: ${history.map(([w, p]) => `${shortDate(w)} ${money(p)}`).join(', ')}. Your scenario ${money(scenario)}.">
      <defs><linearGradient id="pg-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5ebc91" stop-opacity=".28"/><stop offset="100%" stop-color="#5ebc91" stop-opacity="0"/></linearGradient></defs>${grid}
      ${history.length > 1 ? `<path d="M${px(0)},${floor} L${points.join(' L')} L${px(history.length - 1)},${floor} Z" fill="url(#pg-area)"/><polyline points="${points.join(' ')}" fill="none" stroke="#5ebc91" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      <line x1="${left}" y1="${py(scenario)}" x2="${width - right}" y2="${py(scenario)}" stroke="#f6a557" stroke-width="2" stroke-dasharray="5 5"/>
      ${history.map(([week, price], i) => `<circle cx="${px(i)}" cy="${py(price)}" r="${selectedWeek === week ? 7 : 5}" fill="var(--surface)" stroke="#5ebc91" stroke-width="3"><title>${shortDate(week)}: ${money(price)} / ${esc(item.unit)}</title></circle>${i === 0 || i === history.length - 1 || history.length < 5 ? `<text x="${px(i)}" y="${height - 9}" text-anchor="middle" class="pg-axis">${shortDate(week)}</text>` : ''}`).join('')}</svg>`;
    const low = Math.min(...history.map(([, p]) => p));
    $('#pg-history-info').innerHTML = `<div class="pg-history-stats"><span>Lowest recorded <b>${money(low)}</b></span><span>Your price <b class="pg-orange">${money(scenario)}</b></span><span>Recorded weeks <b>${history.length}</b></span></div><div class="pg-week-picks" aria-label="Try a recorded price">${history.map(([week, price]) => `<button type="button" data-week="${week}" aria-pressed="${selectedWeek === week}" title="Use the ${shortDate(week)} recorded price"><span>${shortDate(week)}</span><b>${money(price)}</b></button>`).join('')}</div><p class="pg-chart-hint">Tap a week to try its price in your basket. Prices are per ${esc(item.unit)}; the dashed line follows your edits.${history.length < 4 ? ' More history builds with each weekly refresh.' : ''}</p>`;
  }

  function drawItems() {
    const shown = items.filter((item) => !filter || item[groupBy] === filter);
    $('#pg-item-count').textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
    $('#pg-filter').innerHTML = filter ? `<button type="button" class="pg-filter" data-pg="clear-filter">${esc(filter)} <span>Show all ×</span></button>` : '';
    $('#pg-items').innerHTML = shown.length ? `<div class="pg-table-labels"><span>IN YOUR EXPERIMENT</span><span>QTY</span><span>PRICE / UNIT</span><span>TOTAL</span><span></span></div>${shown.map((item) => `<div class="pg-item${item.included === false ? ' excluded' : ''}${item.id === selected ? ' selected' : ''}" data-row="${esc(item.id)}"><div class="pg-item-name"><input type="checkbox" data-include="${esc(item.id)}" ${item.included !== false ? 'checked' : ''} aria-label="Include ${esc(item.title)}"/>${item.image ? `<img src="${esc(imageUrl(item.image))}" alt="" loading="lazy"/>` : '<span class="pg-no-image" aria-hidden="true">↗</span>'}<button type="button" data-select="${esc(item.id)}"><b>${esc(item.title)}</b><small><i style="background:${esc(item.color || COLORS[0])}"></i>${esc(item.chain)} · ${esc(item.unit)}</small></button></div><label class="pg-qty"><span class="sr-only">Quantity for ${esc(item.title)}</span><input type="number" min="${item.unit === 'lb' ? '.5' : '1'}" max="99" step="${item.unit === 'lb' ? '.5' : '1'}" value="${item.qty}" data-quantity="${esc(item.id)}"/></label><label class="pg-price"><span>$</span><span class="sr-only">Price for ${esc(item.title)}</span><input type="number" min="0" max="9999" step="0.01" value="${item.price.toFixed(2)}" data-price="${esc(item.id)}"/></label><b class="pg-row-total" data-total="${esc(item.id)}"></b><button class="pg-remove" type="button" data-remove="${esc(item.id)}" aria-label="Remove ${esc(item.title)}">×</button></div>`).join('')}` : `<div class="pg-basket-empty"><span>＋</span><h3>${filter ? 'No items in this category.' : 'A clean slate. So many possibilities.'}</h3><p>${context.loading ? 'Loading your local deals…' : 'Find a real deal below, or import your shopping list.'}</p>${!context.zip ? '<a class="btn secondary" href="#setup">Choose your stores</a>' : ''}</div>`;
    rowTotals();
  }

  function rowTotals() {
    const totals = scenarioTotals(items, controls), rows = new Map(totals.rows.map((row) => [row.id, row]));
    for (const el of root.querySelectorAll('[data-total]')) el.textContent = money(rows.get(el.dataset.total)?.total || 0);
  }

  function catalog() {
    const deals = getDeals().filter((d) => d.salePrice != null && Number.isFinite(d.salePrice));
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = deals.filter((d) => !items.some((x) => x.id === d.dealId) && words.every((word) => `${d.item} ${d.chainName} ${d.deptLabel}`.toLowerCase().includes(word)));
    $('#pg-catalog-count').textContent = `${matches.length} available deals`;
    $('#pg-catalog').innerHTML = matches.slice(0, 4).map((deal) => `<button class="pg-catalog-item" type="button" data-add="${esc(deal.dealId)}" aria-label="Add ${esc(deal.item)} from ${esc(deal.chainName)}"><span><b>${esc(deal.item)}</b><small>${esc(deal.chainName)} · ${esc(deal.priceUnit || 'each')}</small></span><strong>${money(deal.salePrice)}</strong><i aria-hidden="true">+</i></button>`).join('') || `<p class="pg-chart-hint">${query ? 'No matches. Try another item or store.' : context.loading ? 'Bringing in your local deals…' : 'Choose your stores on Setup to load deals.'}</p>`;
  }

  function render(rebuildItems = true) {
    if (!mounted) mount();
    $('#pg-source').innerHTML = `<i></i>${esc(source)}`;
    metrics(scenarioTotals(items, controls));
    drawBreakdown(scenarioTotals(items, controls));
    drawHistory();
    if (rebuildItems) drawItems(); else rowTotals();
    catalog();
    persist();
  }

  root.addEventListener('input', (event) => {
    const input = event.target;
    if (input.id === 'pg-search') { query = input.value; catalog(); return; }
    if (input.id === 'pg-multiplier') controls.multiplier = Number(input.value);
    else if (input.id === 'pg-shift') controls.shift = Number(input.value);
    else if (input.id === 'pg-budget') { if (!input.value || !input.validity.valid) return; controls.budget = Number(input.value); }
    else if (input.dataset.quantity || input.dataset.price) {
      if (!input.value || !input.validity.valid) return;
      const item = items.find((x) => x.id === (input.dataset.quantity || input.dataset.price));
      if (!item) return;
      if (input.dataset.quantity) item.qty = Number(input.value); else { item.price = Number(input.value); selectedWeek = null; }
    } else return;
    render(false);
  });
  root.addEventListener('change', (event) => {
    const input = event.target;
    if (input.id === 'pg-history-item') { selected = input.value; selectedWeek = null; render(); }
    if (input.dataset.include) { const item = items.find((x) => x.id === input.dataset.include); if (item) { item.included = input.checked; render(); } }
    if ((input.dataset.quantity || input.dataset.price) && (!input.value || !input.validity.valid)) { render(); say('Use a quantity from 1 to 99 (half pounds are OK), or a price from $0 to $9,999.'); }
  });
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button, [data-slice]');
    if (!button) return;
    if (button.dataset.group) { groupBy = button.dataset.group; filter = ''; for (const el of root.querySelectorAll('[data-group]')) el.setAttribute('aria-pressed', String(el === button)); render(); }
    else if (button.dataset.range) { range = Number(button.dataset.range); selectedWeek = null; for (const el of root.querySelectorAll('[data-range]')) el.setAttribute('aria-pressed', String(el === button)); drawHistory(); }
    else if (button.dataset.slice) { filter = filter === button.dataset.slice ? '' : button.dataset.slice; render(); }
    else if (button.dataset.select) { selected = button.dataset.select; selectedWeek = null; render(); $('#pg-history-title').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); }
    else if (button.dataset.remove) { items = items.filter((x) => x.id !== button.dataset.remove); render(); }
    else if (button.dataset.add) {
      if (items.length >= 60) return say('This playground holds up to 60 items. Remove one to make room.');
      const deal = getDeals().find((d) => d.dealId === button.dataset.add);
      if (deal && !items.some((x) => x.id === deal.dealId)) { items.push(basketItem(deal)); selected = deal.dealId; selectedWeek = null; render(); say(`Added ${deal.item} to your experiment.`); }
    } else if (button.dataset.week) {
      const item = items.find((x) => x.id === selected), point = recordedHistory(item, range).find(([week]) => week === button.dataset.week);
      if (point) { item.price = point[1]; selectedWeek = point[0]; render(); say(`Trying the ${shortDate(point[0])} price. Your price shift still applies.`); }
    } else if (button.dataset.pg === 'clear-filter') { filter = ''; render(); }
    else if (button.dataset.pg === 'import') {
      const imported = listBasket(getList(), getDeals()).slice(0, 60);
      if (!imported.length) return say('Add a priced item to your shopping list first. Your current experiment is still here.');
      items = imported; selected = items[0]?.id; filter = ''; source = 'A copy of your shopping list'; selectedWeek = null; render(); say('List copied. Experiment away—your shopping list stays as it is.');
    } else if (button.dataset.pg === 'shuffle') {
      const fresh = seedBasket(getDeals(), true);
      if (!fresh.length) return say('Choose stores on Setup first, then come back to mix a basket.');
      items = fresh; selected = items[0]?.id; filter = ''; selectedWeek = null; source = 'A fresh mix of this week’s real deals'; render(); say('A new basket, a new possibility.');
    } else if (button.dataset.pg === 'reset') {
      controls = { multiplier: 1, shift: 0, budget: 75 };
      items = items.map((item) => ({ ...item, price: item.original, qty: item.originalQty || 1, included: true }));
      filter = ''; selectedWeek = null;
      $('#pg-multiplier').value = 1; $('#pg-shift').value = 0; $('#pg-budget').value = 75;
      render(); say('Back to the starting prices. Ready for another what-if.');
    }
  });

  return { show(nextContext) { context = nextContext; hydrate(); render(); },
    update(nextContext) { context = nextContext; hydrate(); if (mounted && !root.closest('.view').classList.contains('hidden')) render(); } };
}
