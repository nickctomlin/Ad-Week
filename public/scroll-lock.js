// A fixed body also prevents background swipes in mobile Safari. Restore its
// inline styles and exact scroll position when the modal closes.
export function lockPageScroll(win = window, doc = document) {
  const body = doc.body, html = doc.documentElement;
  const position = { left: win.scrollX, top: win.scrollY };
  const properties = ['position', 'top', 'left', 'right', 'width', 'overflow', 'paddingRight'];
  const saved = Object.fromEntries(properties.map((key) => [key, body.style[key]]));
  const overflow = html.style.overflow;
  const scrollbar = Math.max(0, win.innerWidth - html.clientWidth);
  const padding = parseFloat(win.getComputedStyle(body).paddingRight) || 0;
  html.style.overflow = 'hidden';
  Object.assign(body.style, { position: 'fixed', top: `${-position.top}px`, left: `${-position.left}px`, right: '0', width: '100%', overflow: 'hidden' });
  if (scrollbar) body.style.paddingRight = `${padding + scrollbar}px`;
  let released = false;
  return (restorePosition = true) => {
    if (released) return;
    released = true;
    Object.assign(body.style, saved);
    html.style.overflow = overflow;
    if (restorePosition) win.scrollTo({ ...position, behavior: 'instant' });
  };
}
