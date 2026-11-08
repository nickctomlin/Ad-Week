// Ad Week frontend. Hash-routed tabs: #setup, #plan, #list, #deals, #flyers[/<id>?item=<id>]
import { scoreDeal, dollarsSaved, lowestLabel } from './scoring.js';
import { matchesWatch, suggestWatch, watchKey } from './watch.js';

// ---------- utilities ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : `$${Number(n).toFixed(2)}`);
// Ad dates are stamped in the store's own timezone; use their calendar date as-is.
const adDay = (iso) => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso); };
const fmtDate = (iso) => (iso ? adDay(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '—');
const fmtShort = (iso) => (iso ? adDay(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtQty = (q) => String(Math.round(q * 100) / 100);
const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const mapsUrl = (s) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${s.address}`)}`;

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  setup: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  plan: svg('<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
  deals: svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  flyers: svg('<path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4z"/><path d="M18 8h2v10a2 2 0 0 1-2 2M8 8h6M8 12h6M8 16h3"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  shuffle: svg('<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
  swap: svg('<path d="M4 7h13l-3-3M20 17H7l3 3"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
};

// The meal planner is switched off for now. Set plan: true to bring back the Plan tab and budget form.
const FEATURES = { plan: false };

const TABS = [
  { id: 'setup', label: 'Setup' },
  { id: 'plan', label: 'Plan' },
  { id: 'deals', label: 'Deals' },
  { id: 'list', label: 'List' },
  { id: 'flyers', label: 'Flyers' },
].filter((t) => FEATURES.plan || t.id !== 'plan');

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  } catch {
    throw new Error("Can't reach the Ad Week server. Is it running? (npm start)");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
function setMsg(el, text, isError = false) {
  el.textContent = text || '';
  el.classList.toggle('error', !!text && isError);
}

// ---------- state ----------
const saved = ls.get('adweek:form', {});
const state = {
  zip: '', radius: Number(saved.radius) || 10, diet: saved.diet || 'anything', mode: saved.mode || 'prep',
  place: null, stores: [], chains: [], selected: new Set(), expanded: {}, job: null, pollTimer: null,
  plan: null, rejected: [], listMode: 'best',
  deals: [], dealsKey: '', dealsLoading: false, dealQ: '', dealChains: ls.get('adweek:dealStores', []), dealCat: '', dealSort: 'best', dealLimit: 60,
  flyers: null, flyersZip: '', flyerChain: '', flyer: null, flyerQ: '', groceryOnly: false,
};

// ---------- theme ----------
const savedTheme = ls.get('adweek:theme', null);
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
const paintThemeBtn = () => ($('#theme').innerHTML = isDark() ? ICON.sun : ICON.moon);
paintThemeBtn();
$('#theme').addEventListener('click', () => {
  document.documentElement.dataset.theme = isDark() ? 'light' : 'dark';
  ls.set('adweek:theme', document.documentElement.dataset.theme);
  paintThemeBtn();
});

// ---------- navigation ----------
function parseHash() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const [view, arg] = (path || 'setup').split('/');
  return { view: TABS.some((t) => t.id === view) ? view : 'setup', arg, params: new URLSearchParams(query || '') };
}

const listBadge = () => myList.filter((x) => !x.checked).length;

function renderNav() {
  const { view } = parseHash();
  const badge = { list: Math.max(0, listBadge()) };
  const html = TABS.map((t) => `<a class="navlink" href="#${t.id}" ${t.id === view ? 'aria-current="page"' : ''}>${ICON[t.id]}<span>${t.label}</span>${badge[t.id] ? `<span class="dot">${badge[t.id]}</span>` : ''}</a>`).join('');
  $('.tabbar').innerHTML = html;
  $('.topnav').innerHTML = html;
  const chip = $('#loc-chip');
  if (state.place) {
    chip.classList.remove('hidden');
    chip.innerHTML = `${ICON.pin.replace('<svg', '<svg width="14" height="14"')}<span>${esc(state.place.city)} ${esc(state.zip)} · ${state.radius} mi · ${state.selected.size} stores</span>`;
  }
}
$('#loc-chip').addEventListener('click', () => (location.hash = '#setup'));

function route() {
  const { view, arg, params } = parseHash();
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('hidden', v.dataset.view !== view);
  renderNav();
  if (view === 'plan') renderPlan();
  if (view === 'list') renderList();
  if (view === 'deals') {
    state.dealCat = params.get('aisle') || '';
    renderDeals();
    loadDeals();
    // Coming back from an aisle: return to where you were on the overview.
    if (!state.dealCat && state.dealsScroll != null) {
      const y = state.dealsScroll;
      state.dealsScroll = null;
      requestAnimationFrame(() => window.scrollTo({ top: y }));
      return;
    }
  }
  if (view === 'flyers') renderFlyers(arg, params);
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

function emptyState(icon, title, text, cta = `<a class="btn primary" href="#setup">Go to setup</a>`) {
  return `<div class="empty-state"><div class="icon">${ICON[icon]}</div><h2>${title}</h2><p>${text}</p>${cta}</div>`;
}

// ---------- setup: controls ----------
function paintSeg(el, attr, value) {
  for (const b of el.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset[attr] === String(value)));
}
paintSeg($('#radius'), 'r', state.radius);
paintSeg($('#diet'), 'v', state.diet);
paintSeg($('#mode'), 'v', state.mode);
function paintModeHint() {
  const people = Number($('#people').value) || 1, dinners = Number($('#dinners').value) || 1;
  $('#mode-hint').textContent = state.mode === 'prep'
    ? `One recipe, cooked once: ${people} ${people === 1 ? 'person' : 'people'} × ${dinners} ${dinners === 1 ? 'dinner' : 'dinners'} = ${people * dinners} servings, about ¾–1 lb of food each.`
    : `${dinners} different recipes, each sized for ${people} (about ¾–1 lb of food per person).`;
}
paintModeHint();
$('#mode').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.mode = b.dataset.v;
  paintSeg($('#mode'), 'v', state.mode);
  paintModeHint();
  saveForm();
});
for (const id of ['people', 'dinners']) $('#' + id).addEventListener('input', paintModeHint);
$('#radius').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.radius = Number(b.dataset.r);
  paintSeg($('#radius'), 'r', state.radius);
  saveForm();
  if (state.zip) loadStores();
});
$('#diet').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.diet = b.dataset.v;
  paintSeg($('#diet'), 'v', state.diet);
  saveForm();
});
for (const st of document.querySelectorAll('.stepper')) {
  st.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const input = st.querySelector('input');
    input.value = Math.min(Number(input.max), Math.max(Number(input.min), Number(input.value || 0) + Number(b.dataset.d)));
    saveForm();
    paintModeHint();
  });
}
for (const id of ['zip', 'budget', 'people', 'dinners']) if (saved[id] != null) $('#' + id).value = saved[id];
paintModeHint();
function saveForm() {
  ls.set('adweek:form', { zip: $('#zip').value, radius: state.radius, budget: $('#budget').value, people: $('#people').value, dinners: $('#dinners').value, diet: state.diet, mode: state.mode });
}

// ---------- setup: stores ----------
$('#loc-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loadStores();
});

async function loadStores() {
  const zip = $('#zip').value.trim();
  if (!/^\d{5}$/.test(zip)) return setMsg($('#loc-msg'), 'Enter a 5-digit ZIP code.', true);
  saveForm();
  const btn = $('#find-btn');
  btn.disabled = true;
  setMsg($('#loc-msg'), 'Finding nearby stores…');
  try {
    const r = await api(`/api/stores?zip=${zip}&radius=${state.radius}`);
    const zipChanged = zip !== state.zip;
    state.zip = zip;
    state.place = r.place;
    state.stores = r.stores;
    state.chains = r.chains;
    state.chains = r.chains; // needed by defaultSelection
    state.selected = restoreSelection(ls.get(`adweek:sel:${zip}`, null), r.stores);
    if (zipChanged) { state.plan = null; state.flyers = null; state.flyer = null; }
    setMsg($('#loc-msg'), `${r.place.city}, ${r.place.state} · ${r.stores.length} stores within ${r.radius} miles`);
    $('#stores-panel').classList.remove('hidden');
    $(FEATURES.plan ? '#budget-panel' : '#browse-cta').classList.remove('hidden');
    renderChains();
    handleJob(r.job);
    renderNav();
    // The app may have opened directly on another tab before stores were known; refresh it.
    if (parseHash().view !== 'setup') route();
  } catch (err) {
    setMsg($('#loc-msg'), err.message, true);
  } finally {
    btn.disabled = false;
  }
}

// Saved picks are kept, but if some saved stores no longer exist (e.g. Kroger stores switched from
// OpenStreetMap to the Kroger API, which changes their ids), chains left with nothing selected get
// their default stores back instead of silently dropping out.
function restoreSelection(saved, stores) {
  if (!saved) return new Set(defaultSelection(stores));
  const ids = new Set(stores.map((s) => s.id));
  const kept = stores.filter((s) => saved.includes(s.id)).map((s) => s.id);
  if (saved.every((id) => ids.has(id))) return new Set(kept);
  const covered = new Set(stores.filter((s) => kept.includes(s.id)).map((s) => s.chain));
  return new Set([...kept, ...defaultSelection(stores).filter((id) => !covered.has(stores.find((s) => s.id === id).chain))]);
}

// Default: the 2 nearest stores of each chain that has deal data (or is still loading).
function defaultSelection(stores) {
  const counts = {};
  const usable = new Set(state.chains.filter((c) => ['ok', 'stale', 'loading'].includes(c.status)).map((c) => c.chain));
  return stores.filter((s) => usable.has(s.chain) && (counts[s.chain] = (counts[s.chain] || 0) + 1) <= 2).map((s) => s.id);
}

const STATUS = {
  ok: ['ok', 'Live'],
  stale: ['warn', 'Stale'],
  loading: ['', 'Loading'],
  missing: ['bad', 'No data'],
  error: ['bad', 'Error'],
  'no-stores': ['', 'None nearby'],
};

function renderChains() {
  $('#sel-count').textContent = `${state.selected.size} selected`;
  $('#chains').innerHTML = state.chains.map((c) => {
    const stores = state.stores.filter((s) => s.chain === c.chain);
    const [cls, label] = STATUS[c.status];
    const allOn = stores.length > 0 && stores.every((s) => state.selected.has(s.id));
    const someOn = stores.some((s) => state.selected.has(s.id));
    const shown = state.expanded[c.chain] ? stores : stores.slice(0, 3);
    let line = '';
    if (c.status === 'ok' || c.status === 'stale') line = `${c.dealCount} prices · updated ${fmtTime(c.updatedAt)} · valid through ${fmtShort(c.validThrough)}`;
    else if (c.status === 'loading') line = 'Pulling this week\'s ad…';
    const msgs = c.messages.map((m) => `<div class="chain-status ${c.status === 'ok' ? '' : cls}">${esc(m)}</div>`).join('');
    return `<div class="chain" style="--chain:${c.color}">
      <div class="chain-head">
        <label class="chain-name">${stores.length ? `<input type="checkbox" data-chain="${c.chain}" ${allOn ? 'checked' : ''} ${!allOn && someOn ? 'data-partial="1"' : ''} aria-label="Select all ${esc(c.name)} stores"/>` : ''}${esc(c.name)}</label>
        <span class="badge dotted ${cls}">${label}</span>
      </div>
      ${line ? `<div class="chain-status">${line}</div>` : ''}${msgs}
      ${stores.length ? `<ul class="store-list">${shown.map((s) => `<li><label class="store-row">
          <input type="checkbox" data-store="${esc(s.id)}" ${state.selected.has(s.id) ? 'checked' : ''}/>
          <span class="s-main">${esc(s.name)}<span class="s-addr">${esc(s.address || 'Address unavailable')}</span></span>
          <span class="dist">${s.distance} mi</span></label></li>`).join('')}</ul>` : ''}
      ${stores.length > 3 ? `<button class="more-btn" type="button" data-expand="${c.chain}">${state.expanded[c.chain] ? 'Show fewer' : `Show ${stores.length - 3} more`}</button>` : ''}
    </div>`;
  }).join('');
  for (const cb of document.querySelectorAll('[data-partial]')) cb.indeterminate = true;
}

$('#chains').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.store) t.checked ? state.selected.add(t.dataset.store) : state.selected.delete(t.dataset.store);
  if (t.dataset.chain) for (const s of state.stores.filter((s) => s.chain === t.dataset.chain)) t.checked ? state.selected.add(s.id) : state.selected.delete(s.id);
  ls.set(`adweek:sel:${state.zip}`, [...state.selected]);
  renderChains();
  renderNav();
});
$('#chains').addEventListener('click', (e) => {
  const chain = e.target.closest('[data-expand]')?.dataset.expand;
  if (!chain) return;
  state.expanded[chain] = !state.expanded[chain];
  renderChains();
});

function handleJob(job) {
  state.job = job;
  const el = $('#job');
  clearTimeout(state.pollTimer);
  el.classList.remove('err');
  if (job?.running) {
    el.classList.remove('hidden');
    el.innerHTML = `<span class="spinner"></span><div><b>Loading this week's ads…</b><div class="muted small">${esc(job.log.at(-1) || 'Starting')}</div></div>`;
    $('#plan-btn').disabled = true;
    state.pollTimer = setTimeout(pollStatus, 2000);
    return;
  }
  $('#plan-btn').disabled = false;
  if (job?.error) {
    el.classList.remove('hidden');
    el.classList.add('err');
    el.innerHTML = `<div>Couldn't refresh deals: ${esc(job.error)}. Showing the most recent data available.</div>`;
  } else el.classList.add('hidden');
  state.dealsStale = true; // data may have changed: refetch next time Deals loads (without a blank flash)
}

async function pollStatus() {
  try {
    const r = await api(`/api/status?zip=${state.zip}&radius=${state.radius}`);
    // A store finished (or the whole refresh did): pull in its deals right away.
    const sig = r.chains.map((c) => `${c.chain}:${c.status}:${c.updatedAt}`).join('|');
    const changed = sig !== state.chainSig;
    state.chainSig = sig;
    state.chains = r.chains;
    renderChains();
    handleJob(r.job);
    if (parseHash().view === 'deals') {
      if (changed || !r.job?.running) loadDeals(true);
    } else if (!r.job?.running) route();
  } catch (err) {
    $('#job').textContent = err.message;
    state.pollTimer = setTimeout(pollStatus, 5000);
  }
}

$('#refresh').addEventListener('click', async () => {
  try {
    const r = await api(`/api/refresh?zip=${state.zip}`, { method: 'POST' });
    state.flyers = null;
    handleJob(r.job);
  } catch (err) {
    setMsg($('#loc-msg'), err.message, true);
  }
});

// ---------- plan ----------
function planBody(extra = {}) {
  return {
    zip: state.zip, radius: state.radius, stores: [...state.selected],
    budget: Number($('#budget').value), people: Number($('#people').value), dinners: Number($('#dinners').value), diet: state.diet,
    mode: state.mode,
    ...extra,
  };
}

async function requestPlan(extra = {}, msg = 'Building your plan…') {
  if (!state.selected.size) {
    setMsg($('#plan-msg'), 'Select at least one store above.', true);
    location.hash = '#setup';
    return;
  }
  saveForm();
  $('#plan-btn').disabled = true;
  setMsg($('#plan-msg'), msg);
  if (extra.planIds || extra.seed != null) toast(msg);
  try {
    state.plan = await api('/api/plan', { method: 'POST', body: JSON.stringify(planBody(extra)) });
    setMsg($('#plan-msg'), '');
    if (location.hash !== '#plan') location.hash = '#plan';
    else route();
  } catch (err) {
    setMsg($('#plan-msg'), err.message, true);
    if (parseHash().view !== 'setup') toast(err.message);
  } finally {
    $('#plan-btn').disabled = !!state.job?.running;
  }
}

$('#plan-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.rejected = [];
  requestPlan();
});

const unitLabel = (unit, q) => (unit === 'lb' ? 'lb' : unit === 'pkg' ? (q === 1 ? 'pkg' : 'pkgs') : '×');

function freshnessNotice() {
  const selChains = new Set(state.stores.filter((s) => state.selected.has(s.id)).map((s) => s.chain));
  const bad = state.chains.filter((c) => selChains.has(c.chain) && c.status !== 'ok');
  const ok = state.chains.filter((c) => selChains.has(c.chain) && c.status === 'ok');
  const lines = [];
  if (ok.length) lines.push(`Deals updated ${fmtTime(Math.min(...ok.map((c) => c.updatedAt)))}, valid through ${fmtShort(ok.map((c) => c.validThrough).sort()[0])}.`);
  for (const c of bad) lines.push(`${c.name}: ${c.status === 'stale' ? 'data is stale' : 'no current deal data'}${c.messages[0] ? ` — ${c.messages[0]}` : ''}`);
  return lines.length ? `<div class="notice ${bad.length ? '' : 'info'}"><div>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div></div>` : '';
}

function renderPlan() {
  const p = state.plan;
  const el = $('#plan-view');
  if (!p) {
    el.innerHTML = emptyState('plan', 'No plan yet', 'Pick your stores and budget on the Setup tab, and Ad Week will build the cheapest dinners from this week\'s sales.');
    return;
  }
  const prep = p.mode === 'prep';
  const over = !p.underBudget;
  const pct = Math.min(100, Math.round((p.total / p.budget) * 100));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const peopleWord = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
  const meals = p.meals.map((m, idx) => `
    <article class="meal ${prep ? 'prep' : ''}">
      <div class="meal-top">
        ${m.image ? `<button class="meal-img" data-meal-img="${idx}" aria-label="See the ad for ${esc(m.name)}"><img src="${esc(m.image)}" alt="" loading="lazy"/></button>` : `<div class="meal-img noimg">🍽</div>`}
        <div class="meal-info">
          <span class="meal-kicker">${prep ? `Meal prep · cook once · ${m.minutes} min` : `Dinner ${idx + 1} · ${m.minutes} min`}</span>
          <h3>${esc(m.name)}</h3>
          <span class="meal-meta">${prep
            ? `${m.servings} servings = ${peopleWord(p.people)} × ${plural(p.dinners, 'dinner')}`
            : `Serves ${m.servings}`}${m.plateLb ? ` · ≈${fmtQty(m.plateLb)} lb food per serving` : ''}</span>
          <div class="meal-price"><b>${money(m.cost)}</b><span>${money(m.perServing)} / serving</span></div>
        </div>
      </div>
      <div class="chips">${m.onSale.map((c) => `<span class="badge sale">${esc(c)}</span>`).join('')}${m.unpriced.map((c) => `<span class="badge warn">${esc(c)}: no price</span>`).join('')}</div>
      <details ${prep ? 'open' : ''}>
        <summary>${prep ? `Batch ingredients for ${m.servings} servings` : 'Ingredients'} &amp; method</summary>
        <div class="meal-body">
          <ul class="ing">${m.ingredients.map((i) => `<li><span class="q">${fmtQty(i.qty)} ${unitLabel(i.unit, i.qty)}</span><span>${esc(i.canonical)}</span></li>`).join('')}</ul>
          ${m.pantry.length ? `<p class="muted small">Pantry: ${m.pantry.map(esc).join(', ')}</p>` : ''}
          <ol class="method">${m.method.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          ${prep ? `<p class="muted small">Divide into ${p.batchServings} containers (${plural(p.people, 'portion')} per dinner). Refrigerate up to 4 days; freeze any dinners beyond that.</p>` : ''}
        </div>
      </details>
      <div class="meal-actions"><button class="btn secondary sm" data-swap="${idx}">${ICON.swap} ${prep ? 'Swap recipe' : 'Swap meal'}</button></div>
    </article>`).join('');

  el.innerHTML = `
    <div class="view-head row">
      <div><h1 id="h-plan">${prep ? 'This week\'s meal prep' : 'This week\'s dinners'}</h1><p class="lede">${prep
        ? `One batch, ${p.batchServings} servings, covering ${plural(p.dinners, 'dinner')} for ${peopleWord(p.people)}`
        : `${plural(p.meals.length, 'dinner')} for ${peopleWord(p.people)}`} · recipes: ${esc(p.recipeSource)} · costs computed from real deal prices</p></div>
    </div>
    <div class="hero ${over ? 'over' : ''}">
      <div class="hero-top">
        <div><div class="hero-total">${money(p.total)}</div><div class="hero-sub">total of ${money(p.budget)} budget${p.unpricedCount ? ` · excludes ${p.unpricedCount} unpriced item${p.unpricedCount > 1 ? 's' : ''}` : ''}</div></div>
        <span class="hero-pill">${over ? `${money(-p.difference)} over` : `${money(p.difference)} under`}</span>
      </div>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Share of budget used"><i style="width:${pct}%"></i></div>
      <div class="hero-stats">
        <div><b>${money(p.perPerson)}</b><span>per person</span></div>
        <div><b>${money(p.perServing)}</b><span>per serving</span></div>
        <div><b>${p.best.purchases.length}</b><span>items to buy</span></div>
      </div>
    </div>
    ${freshnessNotice()}
    ${p.warnings.length ? `<div class="notice"><div>${p.warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</div></div>` : ''}
    <div class="toolbar">
      <button class="btn secondary" id="shuffle">${ICON.shuffle} Shuffle plan</button>
      <a class="btn primary" href="#list">${ICON.list} Shopping list</a>
    </div>
    <div class="meals">${meals || emptyState('plan', 'No dinners fit', 'None of the recipes could be priced from the selected stores. Select more stores or widen the radius.')}</div>`;
}

$('#plan-view').addEventListener('click', (e) => {
  const swap = e.target.closest('[data-swap]');
  if (swap) {
    const idx = Number(swap.dataset.swap);
    state.rejected.push(state.plan.meals[idx].id);
    return requestPlan({ planIds: state.plan.meals.map((m) => m.id), swapIndex: idx, rejected: state.rejected }, 'Swapping meal…');
  }
  if (e.target.closest('#shuffle')) {
    state.rejected = [];
    return requestPlan({ seed: Math.floor(Math.random() * 1e9) }, 'Shuffling plan…');
  }
  const img = e.target.closest('[data-meal-img]');
  if (img) {
    const m = state.plan.meals[Number(img.dataset.mealImg)];
    const ln = state.plan.best.purchases.flatMap((p) => p.lines.map((l) => ({ p, l }))).find(({ l }) => l.imageUrl === m.image);
    if (ln) openSheet(fromLine(ln.p, ln.l));
  }
});

// ---------- my list ----------
// Deals you add from the Deals tab, the Flyers tab, or an item window. Each entry is a snapshot of the
// deal (price, store, ad image, links) plus your quantity. The server stores the list so every device
// (computer, phone over Tailscale) sees the same one; this browser keeps a copy for offline use.
const LIST_KEY = 'adweek:list';
let myList = ls.get(LIST_KEY, []);
let listSaveTimer;

// Changes made while offline are flagged "dirty" (remembered across app restarts). While dirty, this
// device's copy wins: it's pushed when the connection is back instead of being replaced by the server's.
const isDirty = (key) => ls.get(`${key}:dirty`, false);
const setDirty = (key, v) => ls.set(`${key}:dirty`, v);

async function pushList() {
  try {
    await api('/api/list', { method: 'PUT', body: JSON.stringify({ items: myList }) });
    setDirty(LIST_KEY, false);
  } catch {
    if (!isDirty(LIST_KEY)) toast("You're offline — your list will sync when you're back online");
    setDirty(LIST_KEY, true);
  }
}

/** Load the server's list. If the server has none yet, upload this device's list (first run). */
async function pullList() {
  if (isDirty(LIST_KEY)) return pushList(); // unsynced edits from offline win
  try {
    const r = await api('/api/list');
    if (r.updatedAt == null && myList.length) return pushList();
    if (r.updatedAt == null) return;
    myList = r.items;
    ls.set(LIST_KEY, myList);
    renderNav();
    if (parseHash().view === 'list') renderList();
  } catch {
    // Offline or server down: keep using this device's copy.
  }
}
// Pick up changes made on another device when you come back to this tab.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { pullList(); pullWatches(); } });

// Used by the (currently hidden) meal planner's item windows.
function lineQty(ln, unit) {
  if (ln.soldBy === 'weight') return `${fmtQty(ln.qty)} lb`;
  if (unit === 'pkg') return `${ln.packages} pkg`;
  if (ln.pkgQty && ln.pkgQty !== 1) return `${ln.packages} × ${fmtQty(ln.pkgQty)} ${unit === 'lb' ? 'lb' : 'ct'}`;
  return `${ln.packages}${unit === 'lb' ? ' × 1 lb' : ''}`;
}

const inList = (id) => myList.some((x) => x.id === id);
const byWeight = (x) => x.priceUnit === 'lb';
const qtyStep = (x) => (byWeight(x) ? 0.5 : 1);
const lineCost = (x) => (x.price != null ? Math.round(x.price * x.qty * 100) / 100 : null);
const qtyLabel = (x) => (byWeight(x) ? `${fmtQty(x.qty)} lb` : `${x.qty}`);
const adEnded = (x) => x.validTo && adDay(x.validTo).getTime() + 86400000 <= Date.now();

function saveList() {
  ls.set(LIST_KEY, myList);
  renderNav();
  if (parseHash().view === 'list') renderList();
  clearTimeout(listSaveTimer);
  listSaveTimer = setTimeout(pushList, 400); // batch quick taps (e.g. quantity +++) into one save
}

/** Add or remove an item-window item (see fromDeal / fromFlyerItem) from the list. */
function toggleInList(x) {
  if (inList(x.listId)) {
    myList = myList.filter((i) => i.id !== x.listId);
    toast('Removed from your list');
  } else {
    myList.push({
      id: x.listId, title: x.title, image: x.image ?? null, chainName: x.chainName, color: x.color, store: x.store ?? null,
      price: x.price ?? null, priceUnit: x.priceUnit ?? null, promo: x.promo ?? null, regular: x.regular ?? null,
      limit: x.limit ?? null, unitPrice: x.unitPrice ?? null, unitPriceUnit: x.unitPriceUnit ?? null, validTo: x.validTo ?? null,
      note: x.note ?? null, dept: x.dept ?? null, sourceUrl: x.sourceUrl ?? null, sourceLabel: x.sourceLabel ?? null,
      weeklyAdUrl: x.weeklyAdUrl ?? null, flyerId: x.flyerId ?? null, flyerItemId: x.flyerItemId ?? null,
      qty: 1, checked: false, addedAt: Date.now(),
    });
    toast('Added to your list');
  }
  saveList();
}

function listGroups() {
  const groups = new Map();
  for (const x of myList) {
    const key = x.store?.id ?? x.chainName;
    if (!groups.has(key)) groups.set(key, { store: x.store, chainName: x.chainName, color: x.color, items: [] });
    groups.get(key).items.push(x);
  }
  return [...groups.values()].sort((a, b) => (a.store?.distance ?? 99) - (b.store?.distance ?? 99));
}

const listTotal = (items) => Math.round(items.reduce((s, x) => s + (lineCost(x) ?? 0), 0) * 100) / 100;

function renderList() {
  const el = $('#list-view');
  if (!myList.length) {
    el.innerHTML = emptyState('list', 'Your list is empty', 'Tap + on any deal, or "Add to list" in an item\'s window, to start your shopping list. It\'s grouped by store, with each item\'s ad one tap away.', '<a class="btn primary" href="#deals">Browse deals</a>');
    return;
  }
  const groups = listGroups();
  const done = myList.filter((x) => x.checked).length;
  const unpriced = myList.filter((x) => x.price == null).length;

  const row = (x) => {
    const priceLine = x.price != null ? `${money(x.price)}/${esc(x.priceUnit || 'each')}` : esc(x.promo || 'See ad for price');
    const flags = [
      adEnded(x) ? '<span class="badge bad">Ad ended</span>' : '',
      // Limits count packages; for per-lb items we can't compare pounds to them, so just show the limit.
      x.limit && !byWeight(x) && x.qty > x.limit ? `<span class="badge warn">Over limit of ${x.limit}</span>` : '',
      x.limit && byWeight(x) ? `<span class="badge">Limit ${x.limit} pkgs</span>` : '',
    ].join('');
    const cost = lineCost(x);
    return `<div class="item list-item ${x.checked ? 'done' : ''}">
      <input type="checkbox" data-check="${esc(x.id)}" ${x.checked ? 'checked' : ''} aria-label="Got ${esc(x.title)}"/>
      ${x.image ? `<button class="thumb" data-open="${esc(x.id)}" aria-label="See the ad"><img src="${esc(x.image)}" alt="" loading="lazy"/></button>` : ''}
      <div class="i-main" data-open="${esc(x.id)}">
        <div class="i-title">${esc(x.title)}</div>
        <span class="i-sub">${priceLine}${x.validTo ? ` · ends ${fmtShort(x.validTo)}` : ' · shelf price'}</span>
        ${flags ? `<span class="i-flags">${flags}</span>` : ''}
      </div>
      <div class="i-side">
        <div class="qty" role="group" aria-label="Quantity">
          <button data-qty="-1" data-id="${esc(x.id)}" aria-label="Less">−</button><span>${qtyLabel(x)}</span><button data-qty="1" data-id="${esc(x.id)}" aria-label="More">+</button>
        </div>
        <div class="i-price">${cost != null ? money(cost) : '—'}</div>
      </div>
      <button class="remove" data-remove="${esc(x.id)}" aria-label="Remove ${esc(x.title)}">✕</button>
    </div>`;
  };

  const groupHtml = groups.map((g) => `
    <section class="group" style="--chain:${g.color || 'var(--accent)'}">
      <header class="group-head">
        <span class="chain-dot"></span>
        <div class="g-main"><b>${esc(g.store?.name ?? g.chainName)}</b>${g.store ? `<span class="g-addr">${esc(g.store.address)} · ${g.store.distance} mi · <a class="map" href="${mapsUrl(g.store)}" target="_blank" rel="noopener">Directions</a></span>` : ''}</div>
        <span class="g-total">${g.items.some((x) => x.price != null) ? money(listTotal(g.items)) : '—'}</span>
      </header>
      ${g.items.map(row).join('')}
    </section>`).join('');

  el.innerHTML = `
    <div class="view-head row">
      <div><h1 id="h-list">My list</h1><p class="lede">${myList.length} ${myList.length === 1 ? 'item' : 'items'} from ${groups.length} ${groups.length === 1 ? 'store' : 'stores'}. Tap an item to see its ad.</p></div>
      <div class="head-actions">
        <button class="btn secondary sm" id="copy">${ICON.copy} Copy</button>
        ${done ? '<button class="btn ghost sm" id="clear-checked">Clear checked</button>' : ''}
        <button class="btn ghost sm" id="clear-all">Clear all</button>
      </div>
    </div>
    <div class="progress"><span>${done} of ${myList.length} in cart</span><span class="bar"><i style="width:${(done / myList.length) * 100}%"></i></span></div>
    <div class="groups">${groupHtml}</div>
    <div class="total-bar"><span>Estimated total${unpriced ? ` <span class="muted small">(+${unpriced} without a single price)</span>` : ''}</span><b>${money(listTotal(myList))}</b></div>
    <p class="muted small" style="margin-top:10px">Estimates use the ad price × your quantity. Member prices may need the store's card or app.</p>`;
}

function listAsText() {
  return listGroups().map((g) =>
    `${g.store?.name ?? g.chainName}${g.store ? ` (${g.store.address})` : ''}\n` +
    g.items.map((x) => `[${x.checked ? 'x' : ' '}] ${byWeight(x) ? `${fmtQty(x.qty)} lb` : `${x.qty} ×`} ${x.title} — ${x.price != null ? `${money(x.price)}/${x.priceUnit || 'each'} = ${money(lineCost(x))}` : x.promo || 'see ad'}`).join('\n') +
    `\nSubtotal: ${money(listTotal(g.items))}`).join('\n\n') + `\n\nEstimated total: ${money(listTotal(myList))}`;
}

$('#list-view').addEventListener('click', async (e) => {
  const qty = e.target.closest('[data-qty]');
  if (qty) {
    const x = myList.find((i) => i.id === qty.dataset.id);
    if (x) { x.qty = Math.max(qtyStep(x), Math.round((x.qty + Number(qty.dataset.qty) * qtyStep(x)) * 100) / 100); saveList(); }
    return;
  }
  const rm = e.target.closest('[data-remove]');
  if (rm) { myList = myList.filter((i) => i.id !== rm.dataset.remove); saveList(); return; }
  const open = e.target.closest('[data-open]');
  if (open) { const x = myList.find((i) => i.id === open.dataset.open); if (x) openSheet({ ...x, listId: x.id }); return; }
  if (e.target.closest('#clear-checked')) { myList = myList.filter((i) => !i.checked); saveList(); return; }
  if (e.target.closest('#clear-all')) { if (confirm('Remove everything from your list?')) { myList = []; saveList(); } return; }
  if (e.target.closest('#copy')) {
    try {
      await navigator.clipboard.writeText(listAsText());
      toast('List copied');
    } catch {
      toast("Couldn't access the clipboard");
    }
  }
});
$('#list-view').addEventListener('change', (e) => {
  const id = e.target.dataset.check;
  const x = id && myList.find((i) => i.id === id);
  if (!x) return;
  x.checked = e.target.checked;
  saveList();
});

// ---------- watches ----------
// Things you want to know about when they're on sale (see watch.js). Stored on the server like the
// list, so every device shares them; this browser keeps a copy.
const WATCH_KEY = 'adweek:watches';
let myWatches = ls.get(WATCH_KEY, []);
let watchSaveTimer;

async function pushWatches() {
  try {
    await api('/api/watches', { method: 'PUT', body: JSON.stringify({ items: myWatches }) });
    setDirty(WATCH_KEY, false);
  } catch {
    if (!isDirty(WATCH_KEY)) toast("You're offline — your watches will sync when you're back online");
    setDirty(WATCH_KEY, true);
  }
}

async function pullWatches() {
  if (isDirty(WATCH_KEY)) return pushWatches(); // unsynced edits from offline win
  try {
    const r = await api('/api/watches');
    if (r.updatedAt == null) { if (myWatches.length) pushWatches(); return; }
    myWatches = r.items;
    ls.set(WATCH_KEY, myWatches);
    if (parseHash().view === 'deals' && state.dealsKey) renderDeals();
  } catch {
    // Offline: keep this device's copy.
  }
}

function saveWatches() {
  ls.set(WATCH_KEY, myWatches);
  clearTimeout(watchSaveTimer);
  watchSaveTimer = setTimeout(pushWatches, 400);
}

const findWatch = (w) => myWatches.find((x) => watchKey(x) === watchKey(w));
const isWatched = (d) => myWatches.some((w) => matchesWatch(d, w));

/** Start or stop watching the item shown in an item window (its ingredient, or keywords from its name). */
function toggleWatch(x) {
  const suggestion = suggestWatch(x);
  const existing = findWatch(suggestion);
  if (existing) {
    myWatches = myWatches.filter((w) => w !== existing);
    toast(`Stopped watching ${existing.label}`);
  } else {
    myWatches.push({ id: `w${Date.now().toString(36)}`, ...suggestion, maxPrice: null, createdAt: Date.now() });
    toast(`Watching ${suggestion.label}`);
  }
  saveWatches();
}

/** The Watching panel: see what's on sale for each watch, set price targets, add keywords, remove. */
function openWatchesSheet() {
  state.sheetItem = null;
  const unitLabel = (w) => (w.unit === 'lb' ? '/lb' : w.unit === 'each' ? ' each' : '');
  const rows = myWatches.map((w) => {
    const onSale = state.deals.filter((d) => matchesWatch(d, w)).length;
    return `<div class="watch-row">
      <div class="w-main"><b>${esc(w.label)}</b><small>${onSale ? `<span class="on">${onSale} on sale now</span>` : 'Not on sale this week'} · ${w.canonical ? 'any store' : 'keywords'}</small></div>
      <label class="w-target" title="Only show it when the price is at or below this">Under $<input type="number" min="0" step="0.01" inputmode="decimal" placeholder="any" value="${w.maxPrice ?? ''}" data-watch-target="${esc(w.id)}"/>${unitLabel(w)}</label>
      <button class="remove" type="button" data-watch-remove="${esc(w.id)}" aria-label="Stop watching ${esc(w.label)}">✕</button>
    </div>`;
  }).join('');
  $('#sheet-body').innerHTML = `
    <button class="sheet-close" type="button" aria-label="Close" data-close>✕</button>
    <div class="sheet-grab"></div>
    <div class="sheet-content">
      <div><h2 id="sheet-title">★ Watching</h2><p class="muted small" style="margin:4px 0 0">These show at the top of Deals whenever they're on sale. Add a target price to only see them at or below it.</p></div>
      <form class="watch-add" data-watch-add><input name="q" type="text" placeholder="Add keywords, e.g. ribeye or blue bell" aria-label="Keywords to watch" autocomplete="off"/><button class="btn primary sm" type="submit">Watch</button></form>
      <div class="watch-list">${rows || '<p class="muted">Nothing watched yet. Open any deal and tap ☆ Watch, or add keywords above.</p>'}</div>
    </div>`;
  const dlg = $('#sheet');
  if (!dlg.open) dlg.showModal();
}

$('#sheet-body').addEventListener('submit', (e) => {
  if (!e.target.matches('[data-watch-add]')) return;
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (!q) return;
  const w = { label: q, query: q.toLowerCase() };
  if (!findWatch(w)) myWatches.push({ id: `w${Date.now().toString(36)}`, ...w, maxPrice: null, createdAt: Date.now() });
  saveWatches();
  openWatchesSheet();
  if (parseHash().view === 'deals' && state.dealsKey) renderDeals();
});
$('#sheet-body').addEventListener('change', (e) => {
  const id = e.target.dataset.watchTarget;
  const w = id && myWatches.find((x) => x.id === id);
  if (!w) return;
  const v = parseFloat(e.target.value);
  w.maxPrice = Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  saveWatches();
  openWatchesSheet();
  if (parseHash().view === 'deals' && state.dealsKey) renderDeals();
});

// ---------- deals ----------
/**
 * Fetch deals for the selected stores. Runs while this week's ads are still loading too, so each store's
 * deals show up as soon as it finishes; `force` re-fetches after more stores have finished.
 */
async function loadDeals(force = false) {
  if (!state.zip || !state.selected.size) return;
  const key = `${state.zip}|${state.radius}|${[...state.selected].sort().join(',')}`;
  if ((!force && !state.dealsStale && key === state.dealsKey) || state.dealsLoading) return;
  state.dealsLoading = true;
  state.dealsStale = false;
  try {
    const r = await api(`/api/deals?zip=${state.zip}&radius=${state.radius}&stores=${[...state.selected].join(',')}`);
    // Precompute each deal's lowercase search text once, so filtering while typing is cheap.
    for (const d of r.deals) d._s = `${d.item} ${d.deptLabel} ${d.canonicals.join(' ')} ${d.chainName}`.toLowerCase();
    state.deals = r.deals;
    state.departments = r.departments;
    state.baselines = r.baselines || {};
    scoreDeals(r.deals);
    state.dealsKey = key;
  } catch (err) {
    toast(err.message);
  } finally {
    state.dealsLoading = false;
    if (parseHash().view === 'deals') {
      // Re-render without losing your place: keep the search box focused and the scroll position.
      const typing = document.activeElement?.id === 'deal-q' ? document.activeElement.selectionStart : null;
      const y = window.scrollY;
      renderDeals();
      window.scrollTo({ top: y });
      if (typing != null) { const q = $('#deal-q'); q?.focus(); q?.setSelectionRange(typing, typing); }
    }
  }
}

// Short label for a coupon-style deal on a card; the full terms are in the item window.
function shortPromo(text) {
  const t = String(text || '').toLowerCase();
  if (/get.{0,40}free/.test(t)) return /buy (two|2)/.test(t) ? 'Buy 2, get 1 free' : 'Buy 1, get 1 free';
  if (/get (one|1).{0,10}50% off/.test(t)) return 'Buy 1, get 1 50% off';
  const pct = t.match(/(\d{1,2})% off/);
  if (pct) return `${pct[1]}% off`;
  const save = t.match(/save (?:up to )?\$(\d+(?:\.\d+)?)/);
  if (save) return `Save $${save[1]}`;
  return 'See deal';
}

function dealPrice(d) {
  if (d.salePrice == null) return `<div class="d-price"><span class="promo">${esc(shortPromo(d.promoText))}</span></div>`;
  // Show the pack size only when it's simple ("/lb", "/each", "/pkg"); details live in the item window.
  const unit = d.priceUnit && d.priceUnit.length <= 5 ? `<span class="d-unit">/${esc(d.priceUnit)}</span>` : '';
  return `<div class="d-price"><b>${money(d.salePrice)}</b>${unit}${d.regularPrice ? `<s>${money(d.regularPrice)}</s>` : ''}</div>`;
}

const addBtn = (id) => {
  const on = inList(id);
  return `<button class="add-btn ${on ? 'on' : ''}" data-add="${esc(id)}" aria-label="${on ? 'Remove from list' : 'Add to list'}" title="${on ? 'In your list — tap to remove' : 'Add to list'}">${on ? '✓' : '+'}</button>`;
};

// Cards show only what you need to decide: picture, name, store, price. Everything else
// (unit price, limit, end date, full coupon terms) is one tap away in the item window.
function dealCard(d) {
  return `<div class="deal" data-deal="${esc(d.dealId)}" role="button" tabindex="0" aria-label="${esc(d.item)}">
    <div class="d-img">${d.imageUrl ? `<img src="${esc(d.imageUrl)}" alt="" loading="lazy"/>` : ''}</div>
    <div class="d-main">
      <span class="d-name">${esc(d.item)}</span>
      <span class="d-store"><span class="chain-dot" style="--chain:${d.chainColor}"></span>${esc(d.chainName)} · ${d.store.distance} mi${myWatches.length && isWatched(d) ? ' <span class="star" title="On your watch list">★</span>' : ''}${(() => { const low = lowestLabel(d); return low ? ` · <span class="low-tag">↓ ${esc(low.replace('weeks', 'wks'))}</span>` : ''; })()}</span>
      <div class="d-foot">${dealPrice(d)}${addBtn(d.dealId)}</div>
    </div>
  </div>`;
}

/** Flip a card's + / ✓ button in place (no re-render, so the page doesn't jump). */
function paintAddBtn(btn, id) {
  const on = inList(id);
  btn.classList.toggle('on', on);
  btn.textContent = on ? '✓' : '+';
  btn.setAttribute('aria-label', on ? 'Remove from list' : 'Add to list');
}

// Each deal's score is an estimated % off that item (see scoring.js for how it's measured).
function scoreDeals(deals) {
  for (const d of deals) {
    Object.assign(d, scoreDeal(d, state.baselines));
    d.saved = dollarsSaved(d);
  }
}

const SORTS = { best: 'Best deals', price: 'Lowest price', az: 'A–Z' };
const sortDeals = (rows, how) => [...rows].sort(
  how === 'price' ? (a, b) => (a.salePrice ?? Infinity) - (b.salePrice ?? Infinity)
  : how === 'az' ? (a, b) => a.item.localeCompare(b.item)
  : (a, b) => b.score - a.score || b.saved - a.saved || (a.salePrice ?? Infinity) - (b.salePrice ?? Infinity));

// ---------- deals navigation ----------
// The open aisle lives in the URL (#deals?aisle=meat) so the on-screen back button and the phone's back
// gesture both return to the overview. The store filter is a saved preference instead, so choosing a store
// inside an aisle still applies after going back.
const dealsHash = (aisle) => `#deals${aisle ? `?aisle=${encodeURIComponent(aisle)}` : ''}`;
const PAGE_SIZE = 60; // cards rendered at once in a full list; "Show more" adds another page

function openAisle(aisle) {
  state.dealsScroll = window.scrollY; // where to return to on the overview
  state.aisleFromOverview = true;
  location.hash = dealsHash(aisle);
}

function backToAisles() {
  if (state.aisleFromOverview) {
    state.aisleFromOverview = false;
    history.back();
  } else {
    // Opened directly on an aisle (bookmark/reload): there's no overview behind us in history.
    location.replace(dealsHash(''));
  }
}

function saveStoreFilter() {
  ls.set('adweek:dealStores', state.dealChains);
}

const storeFilterLabel = () =>
  !state.dealChains.length ? 'All stores' : state.dealChains.length === 1 ? state.dealChains[0] : `${state.dealChains[0]} +${state.dealChains.length - 1}`;

function storeMenu(chains) {
  const all = !state.dealChains.length;
  return `<details class="multi" id="store-menu" ${state.storeMenuOpen ? 'open' : ''}>
    <summary class="pick-like"><span>Stores</span><b>${esc(storeFilterLabel())}</b></summary>
    <div class="menu" role="group" aria-label="Filter by store">
      <label class="opt"><input type="checkbox" data-store-opt="" ${all ? 'checked' : ''}/> <span class="opt-name">All stores</span><span class="count">${state.deals.length}</span></label>
      ${chains.map(([name, color]) => `<label class="opt"><input type="checkbox" data-store-opt="${esc(name)}" ${state.dealChains.includes(name) ? 'checked' : ''}/>
        <span class="chain-dot" style="--chain:${color}"></span><span class="opt-name">${esc(name)}</span><span class="count">${state.deals.filter((d) => d.chainName === name).length}</span></label>`).join('')}
      <button class="btn primary sm menu-done" type="button" data-store-done>Done</button>
    </div>
  </details>`;
}

/** Everything the Deals view shows, derived from the current filters. */
function dealsModel() {
  const chains = [...new Map(state.deals.map((d) => [d.chainName, d.chainColor])).entries()];
  // Drop saved stores that aren't among this ZIP's selected stores.
  state.dealChains = state.dealChains.filter((c) => chains.some(([n]) => n === c));
  const q = state.dealQ.trim().toLowerCase();
  const inChain = state.dealChains.length ? state.deals.filter((d) => state.dealChains.includes(d.chainName)) : state.deals;
  const matchesQ = (d) => !q || d._s.includes(q);
  const inAisle = (d) => !state.dealCat
    || (state.dealCat === 'dinner' ? d.canonicals.length > 0 : state.dealCat === 'watched' ? isWatched(d) : d.dept === state.dealCat);
  const rows = inChain.filter((d) => inAisle(d) && matchesQ(d));
  const depts = (state.departments || []).filter((dep) => inChain.some((d) => d.dept === dep.id));
  const aisleLabel = state.dealCat === 'dinner' ? 'Dinner ingredients' : state.dealCat === 'watched' ? '★ Watched items'
    : (state.departments || []).find((d) => d.id === state.dealCat)?.label;
  return { chains, q, inChain, matchesQ, rows, depts, aisleLabel, browsing: !q && !state.dealCat };
}

function aisleOptions(m) {
  const n = (pred) => m.inChain.filter((d) => pred(d) && m.matchesQ(d)).length;
  return `<option value="">All aisles (${n(() => true)})</option>
    ${myWatches.length ? `<option value="watched" ${state.dealCat === 'watched' ? 'selected' : ''}>★ Watched items (${n(isWatched)})</option>` : ''}
    <option value="dinner" ${state.dealCat === 'dinner' ? 'selected' : ''}>Dinner ingredients (${n((d) => d.canonicals.length > 0)})</option>
    ${m.depts.map((dep) => `<option value="${dep.id}" ${state.dealCat === dep.id ? 'selected' : ''}>${esc(dep.label)} (${n((d) => d.dept === dep.id)})</option>`).join('')}`;
}

/** Full render: header + toolbar + results. Used when the view, aisle, stores or data change. */
function renderDeals() {
  const el = $('#deals-view');
  if (!state.zip) {
    el.innerHTML = emptyState('deals', 'No stores yet', 'Enter your ZIP on the Setup tab to see this week\'s sale prices near you.');
    return;
  }
  if (!state.dealsKey) {
    el.innerHTML = `<div class="view-head"><h1 id="h-deals">Deals</h1></div>${loadingNote()}<div class="cards">${'<div class="skel" style="height:110px"></div>'.repeat(6)}</div>`;
    return;
  }
  const m = dealsModel();
  el.innerHTML = `
    ${state.dealCat ? '' : `<div class="view-head"><h1 id="h-deals">This week's deals</h1><p class="lede">${state.deals.length} grocery deals at your ${state.selected.size} stores. Tap any deal to see the original ad.</p></div>`}
    ${loadingNote()}
    <div class="deal-toolbar">
      <label class="search">${ICON.search}<input id="deal-q" type="search" placeholder="Search berries, chips, chicken…" value="${esc(state.dealQ)}" aria-label="Search deals" autocomplete="off"/></label>
      <div class="selects">
        ${storeMenu(m.chains)}
        <label class="pick"><span>Aisle</span><select id="deal-aisle">${aisleOptions(m)}</select></label>
        <label class="pick"><span>Sort</span><select id="deal-sort">
          ${Object.entries(SORTS).map(([v, l]) => `<option value="${v}" ${state.dealSort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </div>
      <div id="deal-crumb"></div>
    </div>
    <div id="deals-body"></div>`;

  // Typing only redraws the results (after a short pause), never the search box itself.
  let typing;
  $('#deal-q').addEventListener('input', (e) => {
    state.dealQ = e.target.value;
    clearTimeout(typing);
    typing = setTimeout(() => { state.dealLimit = PAGE_SIZE; renderDealsBody(); }, 160);
  });
  $('#deal-aisle').addEventListener('change', (e) => (e.target.value ? openAisle(e.target.value) : backToAisles()));
  $('#deal-sort').addEventListener('change', (e) => { state.dealSort = e.target.value; renderDealsBody(); });
  $('#store-menu').addEventListener('toggle', (e) => { state.storeMenuOpen = e.target.open; });
  renderDealsBody(m);
}

/** Results only: the back/summary row, the cards, and the aisle counts. Cheap enough to run while typing. */
function renderDealsBody(m = dealsModel()) {
  const body = $('#deals-body');
  if (!body) return;
  const storesNote = state.dealChains.length ? ` at ${state.dealChains.join(', ')}` : '';
  const { rows, q } = m;

  let html;
  if (!rows.length) {
    html = `<div class="empty-state slim"><h2>No deals match</h2><p>Try a different word or another store.</p><button class="btn secondary" data-clear>Show all deals</button></div>`;
  } else if (!m.browsing) {
    const sorted = sortDeals(rows, state.dealSort);
    const shown = sorted.slice(0, state.dealLimit);
    html = `<div class="cards">${shown.map(dealCard).join('')}</div>${sorted.length > shown.length
      ? `<button class="btn secondary full show-more" data-more type="button">Show ${Math.min(PAGE_SIZE, sorted.length - shown.length)} more of ${sorted.length - shown.length}</button>` : ''}`;
  } else {
    // Curated overview: the week's standouts (max 2 per aisle), then the best few per aisle.
    // At most 2 per aisle and 3 per store, so one chain with richer price data can't fill the list.
    const best = [];
    const perDept = {};
    const perChain = {};
    for (const d of sortDeals(rows, 'best')) {
      if (best.length >= 8 || d.score < 20) break;
      if ((perDept[d.dept] ?? 0) >= 2 || (perChain[d.chain] ?? 0) >= 3) continue;
      perDept[d.dept] = (perDept[d.dept] ?? 0) + 1;
      perChain[d.chain] = (perChain[d.chain] ?? 0) + 1;
      best.push(d);
    }
    const sections = m.depts.map((dep) => {
      const all = rows.filter((d) => d.dept === dep.id);
      if (!all.length) return '';
      const top = sortDeals(all.filter((d) => !best.includes(d)), state.dealSort).slice(0, 4);
      return `<section class="dept-sec">
        <div class="dept-head"><h2 class="dept-title">${esc(dep.label)}</h2>
          <button class="btn ghost sm" data-aisle="${dep.id}">See all ${all.length} →</button></div>
        <div class="cards">${top.map(dealCard).join('')}</div></section>`;
    }).join('');
    // Your watched items come first: everything on your watch list that's on sale this week.
    const watched = myWatches.length ? sortDeals(rows.filter(isWatched), 'best') : [];
    const watchedHtml = !myWatches.length
      ? `<div class="watch-hint">☆ Open any deal and tap <b>Watch</b> to see it here first whenever it's on sale. <button class="link-clear" data-watching type="button">Add keywords</button></div>`
      : watched.length
        ? `<section class="dept-sec watch-sec"><div class="dept-head"><h2 class="dept-title">★ Your watched items on sale <span class="muted small">${watched.length}</span></h2>
            <span class="head-actions"><button class="btn ghost sm" data-watching type="button">Manage</button>${watched.length > 4 ? `<button class="btn ghost sm" data-aisle="watched" type="button">See all →</button>` : ''}</span></div>
            <div class="cards">${watched.slice(0, 4).map(dealCard).join('')}</div></section>`
        : `<div class="watch-hint">None of your ${myWatches.length} watched item${myWatches.length === 1 ? ' is' : 's are'} on sale this week. <button class="link-clear" data-watching type="button">Manage</button></div>`;
    html = `${watchedHtml}${best.length ? `<section class="dept-sec highlight-sec"><div class="dept-head"><h2 class="dept-title">⭐ Best deals this week</h2></div><div class="cards">${best.map(dealCard).join('')}</div></section>` : ''}${sections}`;
  }
  body.innerHTML = html;

  $('#deal-crumb').innerHTML = state.dealCat
    ? `<div class="crumb"><button class="back-link" data-back type="button">${ICON.back}<span>All aisles</span></button><span class="crumb-title">${esc(m.aisleLabel || '')} <span class="muted">· ${rows.length}${esc(storesNote)}</span></span></div>`
    : q
      ? `<div class="crumb"><button class="back-link" data-back type="button">${ICON.back}<span>All deals</span></button><span class="crumb-title">“${esc(state.dealQ.trim())}” <span class="muted">· ${rows.length}${esc(storesNote)}</span></span></div>`
      : state.dealChains.length ? `<div class="crumb"><span class="crumb-title muted">${rows.length} deals${esc(storesNote)}</span><button class="link-clear" data-clear-stores>All stores</button></div>` : '';
  const aisle = $('#deal-aisle');
  if (aisle) aisle.innerHTML = aisleOptions(m);
}

/** Shown while this week's ads are still loading: deals appear store by store as each finishes. */
function loadingNote() {
  if (!state.job?.running) return '';
  const ready = state.chains.filter((c) => c.status === 'ok').map((c) => c.name);
  return `<div class="job" role="status"><span class="spinner"></span><div><b>Loading this week's ads…</b><div class="muted small">${ready.length ? `Showing ${esc(ready.join(', '))} so far. More stores appear as they finish.` : 'Deals will appear here store by store as each one finishes.'}</div></div></div>`;
}

$('#deals-view').addEventListener('change', (e) => {
  const opt = e.target.closest('[data-store-opt]');
  if (!opt) return;
  const name = opt.dataset.storeOpt;
  if (!name) state.dealChains = []; // "All stores"
  else state.dealChains = opt.checked ? [...state.dealChains, name] : state.dealChains.filter((c) => c !== name);
  saveStoreFilter();
  state.storeMenuOpen = true; // keep the checklist open while ticking stores
  state.dealLimit = PAGE_SIZE;
  renderDeals();
});

$('#deals-view').addEventListener('click', (e) => {
  if (e.target.closest('[data-store-done]')) { state.storeMenuOpen = false; $('#store-menu').open = false; return; }
  if (e.target.closest('[data-watching]')) return openWatchesSheet();
  const aisle = e.target.closest('[data-aisle]');
  if (aisle) return openAisle(aisle.dataset.aisle);
  if (e.target.closest('[data-more]')) { state.dealLimit += PAGE_SIZE; return renderDealsBody(); }
  if (e.target.closest('[data-back]')) {
    if (state.dealCat) return backToAisles();
    state.dealQ = '';
    $('#deal-q').value = '';
    return renderDealsBody();
  }
  if (e.target.closest('[data-clear-stores]')) { state.dealChains = []; saveStoreFilter(); return renderDeals(); }
  if (e.target.closest('[data-clear]')) {
    state.dealChains = []; state.dealQ = ''; saveStoreFilter();
    return state.dealCat ? backToAisles() : renderDeals();
  }
  const add = e.target.closest('[data-add]');
  if (add) {
    const d = state.deals.find((x) => x.dealId === add.dataset.add);
    if (d) { toggleInList(fromDeal(d)); paintAddBtn(add, d.dealId); }
    return;
  }
  const card = e.target.closest('[data-deal]');
  if (card) {
    const d = state.deals.find((x) => x.dealId === card.dataset.deal);
    if (d) openSheet(fromDeal(d));
  }
});
$('#deals-view').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.deal[data-deal]')) { e.preventDefault(); e.target.click(); }
});
// Close the store checklist when tapping anywhere else.
document.addEventListener('click', (e) => {
  const menu = $('#store-menu');
  if (menu?.open && !menu.contains(e.target)) { menu.open = false; state.storeMenuOpen = false; }
});

// ---------- flyers ----------
async function loadFlyers() {
  if (state.flyers && state.flyersZip === state.zip) return;
  try {
    const r = await api(`/api/flyers?zip=${state.zip}`);
    state.flyers = r.flyers;
    state.flyersZip = state.zip;
  } catch (err) {
    $('#flyers-view').innerHTML = emptyState('flyers', "Couldn't load flyers", esc(err.message), `<button class="btn primary" onclick="location.reload()">Try again</button>`);
    throw err;
  }
}

async function renderFlyers(arg, params) {
  const el = $('#flyers-view');
  if (!state.zip) {
    el.innerHTML = emptyState('flyers', 'No location yet', 'Enter your ZIP on the Setup tab to browse every store\'s weekly ad.');
    return;
  }
  if (arg) return renderFlyerViewer(Number(arg), Number(params.get('item')) || null);
  if (!state.flyers || state.flyersZip !== state.zip) {
    el.innerHTML = `<div class="view-head"><h1 id="h-flyers">Weekly ads</h1></div><div class="flyer-cards">${'<div class="skel" style="height:260px"></div>'.repeat(4)}</div>`;
    try { await loadFlyers(); } catch { return; }
    if (parseHash().view !== 'flyers' || parseHash().arg) return;
  }
  const chains = [...new Map(state.flyers.map((f) => [f.chainName, f.color])).entries()];
  const rows = state.flyers.filter((f) => !state.flyerChain || f.chainName === state.flyerChain);
  el.innerHTML = `
    <div class="view-head"><h1 id="h-flyers">Weekly ads</h1><p class="lede">Every current grocery ad for ZIP ${esc(state.zip)}. Open one to flip through it page by page.</p></div>
    <div class="chips" style="margin-bottom:14px">
      <button class="chip" data-fchain="" aria-pressed="${!state.flyerChain}">All</button>
      ${chains.map(([n, color]) => `<button class="chip" data-fchain="${esc(n)}" aria-pressed="${state.flyerChain === n}"><span class="chain-dot" style="--chain:${color}"></span>${esc(n)}</button>`).join('')}
    </div>
    <div class="flyer-cards">${rows.map((f) => `
      <a class="flyer-card" href="#flyers/${f.id}" style="--chain:${f.color};text-decoration:none">
        <div class="flyer-cover">${f.thumbnail ? `<img src="${esc(f.thumbnail)}" alt="" loading="lazy"/>` : ''}</div>
        <div class="f-body">
          <span class="f-chain">${esc(f.chainName)}</span>
          <h3>${esc(f.name)}</h3>          <span class="f-meta">${fmtShort(f.valid_from)} – ${fmtShort(f.valid_to)} · ${f.itemCount} items${f.groceryCount ? ` · ${f.groceryCount} dinner ingredients` : ''}</span>
        </div>
      </a>`).join('') || '<p class="muted">No current flyers found.</p>'}</div>`;
}

$('#flyers-view').addEventListener('click', (e) => {
  const fc = e.target.closest('[data-fchain]');
  if (fc) { state.flyerChain = fc.dataset.fchain; return renderFlyers(); }
  const toggle = e.target.closest('#grocery-only');
  if (toggle) { state.groceryOnly = !state.groceryOnly; return drawClips(); }
  const clip = e.target.closest('[data-clip]');
  if (clip) {
    const it = state.flyer.items.find((x) => String(x.id) === clip.dataset.clip);
    if (it) openSheet(fromFlyerItem(it, state.flyer.flyer));
  }
});

async function renderFlyerViewer(id, highlightId) {
  const el = $('#flyers-view');
  if (state.flyer?.flyer.id !== id) {
    el.innerHTML = `<div class="view-head"><h1 id="h-flyers">Loading ad…</h1></div><div class="clips">${'<div class="skel" style="height:220px;margin-bottom:10px"></div>'.repeat(8)}</div>`;
    try {
      state.flyer = await api(`/api/flyer?zip=${state.zip}&id=${id}`);
    } catch (err) {
      el.innerHTML = emptyState('flyers', "Couldn't open this ad", esc(err.message), `<a class="btn primary" href="#flyers">Back to all ads</a>`);
      return;
    }
    state.flyerQ = '';
  }
  if (parseHash().arg !== String(id)) return;
  const { flyer, pages } = state.flyer;
  el.innerHTML = `
    <div class="viewer-head" style="--chain:${flyer.color}">
      <a class="btn secondary sm" href="#flyers">${ICON.back} All ads</a>
      <div class="v-title"><h1 id="h-flyers" style="font-size:1.3rem">${esc(flyer.chainName)} · ${esc(flyer.name)}</h1><small>Valid ${fmtDate(flyer.valid_from)} – ${fmtDate(flyer.valid_to)} · ${state.flyer.items.length} items · ${pages} pages</small></div>
      <a class="btn secondary sm" href="${esc(flyer.flippUrl)}" target="_blank" rel="noopener">Open on Flipp ${ICON.ext}</a>
      ${flyer.weeklyAdUrl ? `<a class="btn secondary sm" href="${esc(flyer.weeklyAdUrl)}" target="_blank" rel="noopener">${esc(flyer.chainName)}.com ad ${ICON.ext}</a>` : ''}
    </div>
    <div class="viewer-tools">
      <label class="search">${ICON.search}<input id="flyer-q" type="search" placeholder="Search this ad" value="${esc(state.flyerQ)}" aria-label="Search this ad"/></label>
      ${pages > 1 ? `<label class="pick page-pick"><span>Page</span><select id="flyer-page" aria-label="Jump to page">
        ${Array.from({ length: pages }, (_, i) => `<option value="${i + 1}">${i + 1} of ${pages}</option>`).join('')}
      </select></label>` : ''}
      <button class="chip toggle-chip" id="grocery-only" aria-pressed="${state.groceryOnly}" title="Show only dinner ingredients">Dinner only</button>
    </div>
    <div id="clips"></div>`;
  $('#flyer-q').addEventListener('input', (e) => { state.flyerQ = e.target.value; drawClips(); });
  $('#flyer-page')?.addEventListener('change', (e) => document.getElementById(`page-${e.target.value}`)?.scrollIntoView({ behavior: 'smooth' }));
  drawClips(highlightId);
}

function drawClips(highlightId) {
  const box = $('#clips');
  if (!box) return;
  const { items, pages } = state.flyer;
  $('#grocery-only')?.setAttribute('aria-pressed', String(state.groceryOnly));
  const q = state.flyerQ.toLowerCase();
  const listed = new Set(myList.map((x) => x.flyerItemId).filter(Boolean));
  let html = '';
  for (let pg = 1; pg <= pages; pg++) {
    const onPage = items.filter((it) => it.page === pg && (!state.groceryOnly || it.canonical) && (!q || it.name.toLowerCase().includes(q)));
    if (!onPage.length) continue;
    html += `<section class="page-sec" id="page-${pg}"><h3>Page ${pg}</h3><div class="clips">${onPage.map((it) => `
      <button class="clip ${it.id === highlightId ? 'highlight' : ''}" data-clip="${it.id}" id="clip-${it.id}" aria-label="${esc(it.name)}">
        ${listed.has(it.id) ? '<span class="badge ok clip-tag">✓ In your list</span>' :it.canonical ? `<span class="badge sale clip-tag">${esc(it.canonical)}</span>` : ''}
        <img src="${esc(it.image)}" alt="${esc(it.name)}" loading="lazy"/>
        <span class="clip-cap">${esc(it.name)}${it.price ? ` · $${esc(it.price)}` : ''}</span>
      </button>`).join('')}</div></section>`;
  }
  box.innerHTML = html || '<p class="muted">Nothing on this ad matches.</p>';
  if (highlightId) {
    const target = document.getElementById(`clip-${highlightId}`);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  }
  // Keep the "Page" drop-down showing the page you're scrolled to: the last page whose top has
  // passed under the sticky toolbar.
  if (state.pageTracker) window.removeEventListener('scroll', state.pageTracker);
  const pick = $('#flyer-page');
  if (pick) {
    const secs = [...box.querySelectorAll('.page-sec')];
    state.pageTracker = () => {
      if (!pick.isConnected) return;
      let current = secs[0];
      for (const sec of secs) {
        if (sec.getBoundingClientRect().top <= 150) current = sec;
        else break;
      }
      if (current) pick.value = current.id.replace('page-', '');
    };
    window.addEventListener('scroll', state.pageTracker, { passive: true });
  }
}

// ---------- item window (sheet) ----------
// Normalized shape for the sheet, built from a deal, a list line, or a flyer item.
function fromDeal(d) {
  return {
    image: d.imageUrl, title: d.item, canonical: d.canonical, chainName: d.chainName, color: d.chainColor, store: d.store, otherStores: d.otherStores,
    price: d.salePrice, priceUnit: d.priceUnit, regular: d.regularPrice, percentOff: d.percentOff, unitPrice: d.unitPrice, unitPriceUnit: d.unitPriceUnit,
    limit: d.limit, validTo: d.validTo, sizeEstimated: d.sizeEstimated, note: d.note, sourceUrl: d.sourceUrl, sourceLabel: d.sourceLabel,
    weeklyAdUrl: d.weeklyAdUrl, flyerId: d.flyerId, flyerItemId: d.flyerItemId, isSale: true,
    promo: d.promoText, dept: d.deptLabel, canonicals: d.canonicals, listId: d.dealId, score: d.score, basis: d.basis, history: d.history,
  };
}
function fromLine(p, ln) {
  const deal = state.deals.find((d) => d.flyerItemId && d.flyerItemId === ln.flyerItemId && d.canonical === p.canonical);
  return {
    ...(deal ? fromDeal(deal) : {}),
    image: ln.imageUrl, title: ln.itemName, canonical: p.canonical, store: ln.store, color: ln.chainColor,
    chainName: deal?.chainName ?? ln.store.name, price: ln.price, priceUnit: ln.soldBy === 'weight' ? 'lb' : 'each', regular: ln.regularPrice,
    limit: ln.limit, validTo: ln.validTo, sizeEstimated: ln.sizeEstimated, note: ln.dealNote, sourceUrl: ln.sourceUrl, sourceLabel: ln.sourceLabel,
    weeklyAdUrl: ln.weeklyAdUrl, flyerId: ln.flyerId, flyerItemId: ln.flyerItemId, isSale: ln.isSale,
    buying: `${lineQty(ln, p.unit)} for ${money(ln.cost)}`,
  };
}
function fromFlyerItem(it, flyer) {
  const deal = state.deals.find((d) => d.flyerItemId === it.id);
  if (deal) return { ...fromDeal(deal), image: it.image };
  // Not a parsed deal (e.g. a store you haven't selected): list it at the nearest store of that chain.
  const store = state.stores.filter((s) => s.chain === flyer.chain).sort((a, b) => Number(state.selected.has(b.id)) - Number(state.selected.has(a.id)) || a.distance - b.distance)[0];
  return {
    image: it.image, title: it.name, canonical: it.canonical, chainName: flyer.chainName, color: flyer.color, store,
    price: it.price ? Number(it.price) : null, priceUnit: it.price ? 'each' : null, validTo: flyer.valid_to, sourceUrl: it.flippUrl, sourceLabel: 'View on Flipp',
    weeklyAdUrl: flyer.weeklyAdUrl, flyerId: flyer.id, flyerItemId: it.id, isSale: true, fromFlyer: true, listId: `flyer:${it.id}`,
    promo: it.price ? null : 'See the ad for this price',
  };
}

/** ☆ Watch / ★ Watching button for the item window (watches the ingredient, or keywords from the name). */
function watchButton(x) {
  if (!x.title) return '';
  const s = suggestWatch(x);
  return findWatch(s)
    ? `<button class="btn secondary watch-toggle on" type="button" data-watch-toggle><span>★ Watching ${esc(s.label)}</span><span class="muted small">Stop</span></button>`
    : `<button class="btn secondary watch-toggle" type="button" data-watch-toggle><span>☆ Watch ${esc(s.label)}</span><span class="muted small">See it first when on sale</span></button>`;
}

/** Small bar chart of this item's price over past ad weeks, with a one-line summary. */
function historyBlock(x) {
  if (x.price == null) return '';
  const h = x.history;
  if (!h || h.weeks.length < 2) {
    return `<div class="hist"><b>Price history</b><p class="muted small">First week we've seen this item here. Its price history builds each week.</p></div>`;
  }
  const pts = h.weeks.slice(-10);
  const max = Math.max(...pts.map(([, p]) => p));
  const low = lowestLabel({ salePrice: x.price, history: h });
  const summary = low ? `<span class="good">↓ ${esc(low)}</span>`
    : h.priorWeeks ? `Usually ${money(h.usual)} · lowest ${money(h.low)} over ${h.priorWeeks} past week${h.priorWeeks === 1 ? '' : 's'}` : '';
  return `<div class="hist">
    <div class="hist-head"><b>Price history</b><span class="small">${summary}</span></div>
    <div class="bars">${pts.map(([w, p], i) => `<div class="bar-col" title="Week of ${fmtShort(w)}: ${money(p)}">
      <span class="bar-val">${money(p)}</span>
      <div class="bar ${i === pts.length - 1 ? 'now' : ''}" style="height:${Math.max(10, Math.round((p / max) * 100))}%"></div>
      <span class="bar-wk">${i === pts.length - 1 ? 'This wk' : fmtShort(w)}</span></div>`).join('')}</div>
  </div>`;
}

function openSheet(x) {
  const pctOff = x.percentOff ?? (x.regular && x.price ? Math.round((1 - x.price / x.regular) * 100) : null);
  const facts = [
    x.buying ? ['You\'re buying', x.buying] : null,
    x.unitPrice != null ? ['Unit price', `${money(x.unitPrice)}/${x.unitPriceUnit}${x.sizeEstimated ? ' (size est.)' : ''}`] : null,
    ['Regular price', x.regular ? money(x.regular) : 'Not listed in ad'],
    ['Purchase limit', x.limit ? `${x.limit} per order` : x.fromFlyer ? 'See ad' : 'None stated'],
    ['Valid through', x.validTo ? fmtDate(x.validTo) : 'No end date (shelf price)'],
    x.dept ? ['Department', x.dept] : null,
    x.canonicals?.length ? ['Dinner ingredient', x.canonicals.join(', ')] : x.canonical ? ['Dinner ingredient', x.canonical] : null,
  ].filter(Boolean);
  $('#sheet-body').innerHTML = `
    <button class="sheet-close" type="button" aria-label="Close" data-close>✕</button>
    ${x.image ? `<div class="sheet-hero"><img src="${esc(x.image)}" alt="Ad for ${esc(x.title)}"/><span class="cap">${x.flyerItemId ? `From the ${esc(x.chainName || '')} weekly ad` : `Product photo from ${esc(x.chainName || 'the store')}`}</span></div>` : '<div class="sheet-grab"></div>'}
    <div class="sheet-content">
      <div>
        <span class="badge ${x.isSale ? 'sale' : ''}">${x.isSale ? 'On sale' : 'Regular price'}</span>
        <h2 id="sheet-title" style="margin-top:8px">${esc(x.title)}</h2>
      </div>
      ${x.price != null ? `<div class="price-row">
        <span class="big">${money(x.price)}</span>${x.priceUnit ? `<span class="per">/ ${esc(x.priceUnit)}</span>` : ''}
        ${x.regular ? `<s>${money(x.regular)}</s>` : ''}${pctOff ? `<span class="badge sale">${pctOff}% off</span>` : ''}
      </div>` : `<div class="promo-big">${esc(x.promo || 'See the ad above for this deal\'s price')}</div>`}
      ${x.score > 0 ? `<div class="deal-value"><b>≈${x.score}% off</b><span>${esc(x.basis)}</span></div>` : ''}
      ${x.store ? `<div class="store-card" style="--chain:${x.color}"><span class="chain-dot"></span><div class="s-main"><b>${esc(x.store.name)}</b><small>${esc(x.store.address)} · ${x.store.distance} mi${x.otherStores ? ` · +${x.otherStores} more ${esc(x.chainName)} in this ad` : ''}</small></div><a class="btn ghost sm" href="${mapsUrl(x.store)}" target="_blank" rel="noopener">Directions</a></div>` : ''}
      ${historyBlock(x)}
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${x.note && x.note !== x.promo ? `<div class="note">${esc(x.note)}</div>` : ''}
      <div class="links">
        ${x.listId ? (inList(x.listId)
          ? '<button class="btn secondary list-toggle on" type="button" data-list-toggle><span>✓ In your list</span><span class="muted small">Remove</span></button>'
          : '<button class="btn primary list-toggle" type="button" data-list-toggle><span>+ Add to list</span></button>') : ''}
        ${x.sourceUrl ? `<a class="btn secondary" href="${esc(x.sourceUrl)}" target="_blank" rel="noopener"><span>Verify price — ${esc(x.sourceLabel || 'View source')}</span>${ICON.ext}</a>` : ''}
        ${x.weeklyAdUrl ? `<a class="btn secondary" href="${esc(x.weeklyAdUrl)}" target="_blank" rel="noopener"><span>${esc(x.chainName)}'s own weekly ad</span>${ICON.ext}</a>` : ''}
        ${watchButton(x)}
        ${x.flyerId && x.flyerItemId ? `<a class="btn secondary" href="#flyers/${x.flyerId}?item=${x.flyerItemId}" data-close><span>Show it in the flyer</span>${ICON.eye}</a>` : ''}
      </div>
      <p class="verify-hint">The image above is the actual clipping from the store's ad. Prices can vary by store within an ad zone, and member prices need the store's loyalty card or app.</p>
    </div>`;
  state.sheetItem = x;
  const dlg = $('#sheet');
  if (!dlg.open) { dlg.showModal(); $('#sheet-body').scrollTop = 0; }
}
$('#sheet').addEventListener('click', (e) => {
  if (e.target.closest('[data-list-toggle]') && state.sheetItem) {
    const x = state.sheetItem;
    toggleInList(x);
    openSheet(x); // repaint the button
    // Keep the + / ✓ on the matching deal card in sync.
    const card = document.querySelector(`.add-btn[data-add="${CSS.escape(x.listId)}"]`);
    if (card) paintAddBtn(card, x.listId);
    if (parseHash().view === 'flyers') drawClips();
    return;
  }
  if (e.target.closest('[data-watch-toggle]') && state.sheetItem) {
    toggleWatch(state.sheetItem);
    openSheet(state.sheetItem);
    if (parseHash().view === 'deals' && state.dealsKey) renderDealsBody();
    return;
  }
  const rm = e.target.closest('[data-watch-remove]');
  if (rm) {
    myWatches = myWatches.filter((w) => w.id !== rm.dataset.watchRemove);
    saveWatches();
    openWatchesSheet();
    if (parseHash().view === 'deals' && state.dealsKey) renderDeals();
    return;
  }
  if (e.target.closest('[data-watching]')) return openWatchesSheet();
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) $('#sheet').close();
});

// ---------- installable app ----------
// The service worker (sw.js) lets the installed app open offline. Browsers only allow it (and installing)
// on HTTPS or localhost; over plain http://server:3000 the app still works, just not installable/offline.
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null; // Android/desktop Chrome hands us this when the app can be installed

function paintInstall() {
  const el = $('#install-panel');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let html = '';
  if (isStandalone()) html = '';
  else if (!window.isSecureContext) {
    html = `<div class="install-row">${ICON.ext}<div><b>Install Ad Week as an app</b><p class="muted small">Your phone can only install it over HTTPS. On the server, run <code>tailscale serve --bg 3000</code> and open the https:// address it shows.</p></div></div>`;
  } else if (installPrompt) {
    html = `<div class="install-row"><img src="icons/icon-192.png" alt="" width="44" height="44"/><div><b>Install Ad Week</b><p class="muted small">Opens full-screen from your home screen and works without signal in the store.</p></div><button class="btn primary" type="button" data-install>Install</button></div>`;
  } else if (ios) {
    html = `<div class="install-row"><img src="icons/icon-192.png" alt="" width="44" height="44"/><div><b>Add Ad Week to your Home Screen</b><p class="muted small">In Safari, tap <b>Share</b> (the square with an arrow), then <b>Add to Home Screen</b>.</p></div></div>`;
  }
  el.innerHTML = html;
  el.classList.toggle('hidden', !html);
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; paintInstall(); });
window.addEventListener('appinstalled', () => { installPrompt = null; paintInstall(); toast('Ad Week installed'); });
$('#install-panel').addEventListener('click', async (e) => {
  if (!e.target.closest('[data-install]') || !installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  paintInstall();
});

// Offline note, and sync offline edits the moment the connection comes back.
const paintOnline = () => $('#offline-note').classList.toggle('hidden', navigator.onLine);
window.addEventListener('online', () => {
  paintOnline();
  if (isDirty(LIST_KEY)) pushList();
  if (isDirty(WATCH_KEY)) pushWatches();
});
window.addEventListener('offline', paintOnline);

// ---------- boot ----------
paintOnline();
paintInstall();
route();
pullList();
pullWatches();
if (saved.zip && /^\d{5}$/.test(saved.zip)) loadStores();
