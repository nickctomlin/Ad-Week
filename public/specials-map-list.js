// Keep map movement independent of card rendering. Only settled bounds are read;
// the DOM receives one bounded page, and unchanged membership does not redraw it.
export function createMapListController({ getBounds, render, pending = () => {}, pageSize = 20, delay = 250, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let venues = [], area = [], areaKey = null, renderedKey = null, revision = '', page = 0, revealId = '';
  let timer = null, active = true, moving = false, busy = false;
  function setPending(value) { if (busy !== value) { busy = value; pending(value); } }
  function cancel() { if (timer !== null) clearTimer(timer); timer = null; }
  function paint(resetScroll = false, focusId = '') {
    const pages = Math.max(1, Math.ceil(area.length / pageSize));
    page = Math.max(0, Math.min(page, pages - 1));
    const key = JSON.stringify([areaKey, page, revision]);
    if (key === renderedKey && !focusId) return;
    renderedKey = key;
    render({ venues: area.slice(page * pageSize, (page + 1) * pageSize), total: area.length,
      page, pages, start: area.length ? page * pageSize + 1 : 0, end: Math.min((page + 1) * pageSize, area.length), resetScroll, focusId });
  }
  function update() {
    timer = null;
    if (!active || moving) return;
    const bounds = getBounds();
    area = venues.filter(({ location }) => location && Number.isFinite(location.lat) && Number.isFinite(location.lng) && bounds.contains([location.lat, location.lng]));
    const key = JSON.stringify(area.map((venue) => venue.id));
    const changed = key !== areaKey;
    if (changed) page = 0;
    areaKey = key;
    const focusId = revealId;
    if (focusId) {
      const index = area.findIndex((venue) => venue.id === focusId);
      if (index >= 0) page = Math.floor(index / pageSize);
      revealId = '';
    }
    paint(changed, focusId);
    setPending(false);
  }
  function schedule() {
    cancel();
    if (!active) return;
    setPending(true);
    if (!moving) timer = setTimer(update, delay);
  }
  return {
    setVenues(next, nextRevision = '') { venues = next; revision = nextRevision; schedule(); },
    moving() { moving = true; cancel(); if (active) setPending(true); },
    settled() { moving = false; schedule(); },
    schedule,
    suspend() { active = false; cancel(); setPending(false); },
    resume() { if (!active) { active = true; moving = false; schedule(); } },
    reveal(id) { revealId = id; schedule(); },
    setPage(next) { if (active) { page = next; paint(true); } },
  };
}
