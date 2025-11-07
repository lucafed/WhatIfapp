/* What?f — Service Worker (v1.1.0) */
const VERSION = '1.1.0';
const STATIC_CACHE  = `whatif-static-${VERSION}`;
const RUNTIME_CACHE = `whatif-runtime-${VERSION}`;
const IMG_CACHE     = `whatif-images-${VERSION}`;

const PRECACHE_URLS = [
  '/', '/index.html', '/second.html', '/third.html', '/fourth.html', '/fifth.html',
  '/about.html', '/privacy.html', '/terms.html',
  '/manifest.json',

  // public essentials
  '/public/home-hero.png',
  '/public/icon-192.png',
  '/public/icon-512.png',
  '/public/icon-192-maskable.png',
  '/public/icon-512-maskable.png',

  // JS/static not pesanti (se esistono)
  '/public/i18n.js'
];

// --- Install: precache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// --- Activate: pulizia cache vecchie + claim
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => /^whatif-(static|runtime|images)-/.test(k) && ![STATIC_CACHE,RUNTIME_CACHE,IMG_CACHE].includes(k))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Helper: determinare tipo richiesta
const isHTML  = (req) =>
  req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

const isImage = (req) => {
  try {
    const p = new URL(req.url).pathname;
    return req.destination === 'image' || /\.(png|jpe?g|gif|webp|svg)$/i.test(p);
  } catch { return false; }
};

// Network con timeout (per HTML)
async function fromNetworkWithTimeout(request, ms = 6000) {
  const c = new AbortController(); const id = setTimeout(() => c.abort(), ms);
  try {
    const res = await fetch(request, { signal: c.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// Stale-While-Revalidate generico
async function swr(request, cacheName = RUNTIME_CACHE) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetching = fetch(request).then(res => {
    if (res && res.status === 200 && res.type !== 'opaque') {
      cache.put(request, res.clone());
    }
    return res;
  }).catch(() => null);
  return cached || fetching || new Response(null, { status: 504 });
}

// --- Fetch routing
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // ignora non-GET
  if (request.method !== 'GET') return;

  // 1) Navigazioni HTML: network-first con fallback cache → offline
  if (isHTML(request)) {
    event.respondWith((async () => {
      try {
        const res = await fromNetworkWithTimeout(request, 6000);
        (await caches.open(STATIC_CACHE)).put(request, res.clone());
        return res;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        // prova la pagina specifica, poi index.html, poi mini fallback
        return (await cache.match(request)) ||
               (await cache.match('/index.html')) ||
               new Response(
                 '<!doctype html><meta charset="utf-8"><title>Offline</title><style>body{font-family:system-ui;padding:2rem;background:#0B0B0C;color:#fff}</style><h1>Sei offline</h1><p>Riprova quando torni online.</p>',
                 { status: 200, headers: { 'Content-Type': 'text/html' } }
               );
      }
    })());
    return;
  }

  // 2) Immagini: cache-first con ignoreSearch per gestire ?v=...
  if (isImage(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res && res.status === 200) {
          // normalizza chiave senza query per riusare il file con ?v= diversi
          const url = new URL(request.url);
          url.search = '';
          await cache.put(new Request(url.toString(), { method: 'GET' }), res.clone());
        }
        return res;
      } catch {
        return new Response('', { status: 404 });
      }
    })());
    return;
  }

  // 3) Altri GET statici: SWR
  event.respondWith(swr(request, RUNTIME_CACHE));
});

// Facciamo attivare subito la nuova SW (opzionale)
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
