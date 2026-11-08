// Ad Week service worker: lets the installed app open and show your last-loaded deals, list and watches
// with no signal. Strategy for same-site GET requests: network first (so you always get fresh data and new
// versions when online), saving a copy; fall back to the saved copy when offline or when the network takes
// longer than a few seconds (weak in-store signal). Writes (PUT/POST) and other sites go straight through.
const VERSION = 'adweek-v1';
const SHELL = [
  '/', '/index.html', '/app.js', '/scoring.js', '/watch.js', '/styles.css', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
];
const SLOW_MS = 5000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Your list and watches are never answered from a saved copy: the app keeps its own up-to-date copy and
// syncs it, and an old saved response could otherwise overwrite newer edits.
const NEVER_CACHE = new Set(['/api/list', '/api/watches']);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || NEVER_CACHE.has(url.pathname)) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  const saved = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  network.catch(() => {}); // a late failure after we've answered from the saved copy is fine

  if (!saved) {
    try {
      return await network;
    } catch {
      if (req.mode === 'navigate') {
        const shell = await cache.match('/index.html');
        if (shell) return shell;
      }
      return offline(req);
    }
  }
  // We have a saved copy: use the network if it answers soon, otherwise the saved copy.
  try {
    const res = await Promise.race([network, new Promise((r) => setTimeout(() => r(null), SLOW_MS))]);
    return res ?? saved;
  } catch {
    return saved;
  }
}

function offline(req) {
  if (new URL(req.url).pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: "You're offline, and this hasn't been loaded on this device before." }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return Response.error();
}
