/* sw.js — What?f PWA Service Worker
   Strategie:
   - HTML (navigazioni): Network-first con fallback offline inline
   - API (/api/ask): sempre rete (no cache), con timeout + errore grazioso
   - Immagini: Cache-first con “expiring” (max 60)
   - Altri asset same-origin (JS/CSS/manifest/icone): Stale-While-Revalidate
*/

const VERSION = '1.0.0-' + (self.registration?.scope || '') + '-' + Date.now();
const STATIC_CACHE  = `whatif-static-${VERSION}`;
const RUNTIME_CACHE = `whatif-runtime-${VERSION}`;
const IMG_CACHE     = `whatif-images-${VERSION}`;

// Precache essenziali (app shell)
const PRECACHE_URLS = [
  '/',                 // fallback routing su index
  '/index.html',
  '/second.html',
  '/third.html',
  '/fourth.html',
  '/fifth.html',
  '/about.html',
  '/privacy.html',
  '/terms.html',

  // Manifest + hero
  '/manifest.json',
  '/home-hero.png',

  // Icone PWA effettive
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png'
];

// Offline fallback HTML minimale (inline, zero dipendenze)
const OFFLINE_HTML = `
<!doctype html>
<html lang="it"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>What?f — Offline</title>
<style>
  :root{--bg:#0A0F14;--fg:#E6F2F5;--muted:#A0B2BA;--acc:#00E0FF}
  html,body{height:100%;margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
  main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
  .card{max-width:520px;background:#101922;border:1px solid #1b2a33;border-radius:14px;padding:20px}
  h1{margin:0 0 6px;color:var(--acc)}
  p{color:var(--muted);line-height:1.55}
  a{color:var(--acc);text-decoration:none;font-weight:700}
  .row{display:flex;gap:10px;justify-content:center;margin-top:10px;flex-wrap:wrap}
  .btn{appearance:none;border:none;background:linear-gradient(180deg,var(--acc),#00B5CC);color:#001f26;font-weight:800;padding:10px 14px;border-radius:12px;cursor:pointer}
  .ghost{background:#0f1820;border:1px solid #1b2a33;color:#cfe3e7}
</style></head>
<body><main><div class="card">
<h1>Sei offline</h1>
<p>Non riesco a raggiungere la rete. Puoi tornare alla <a href="/index.html">Home</a> o riprovare quando torna la connessione.</p>
<div class="row">
  <button class="btn" onclick="location.reload()">Riprova</button>
  <button class="btn ghost" onclick="location.href='index.html'">Home</button>
</div>
</div></main></body></html>
`;

// Utils
const isSameOrigin = (url) => new URL(url, self.location.origin).origin === self.location.origin;
const isHTMLRequest = (req) =>
  req.mode === 'navigate' ||
  (req.headers.get('accept') || '').includes('text/html');
const isImageRequest = (req) => (req.destination === 'image') ||
  /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(new URL(req.url).pathname);
const isAPIRequest = (req) => new URL(req.url).pathname.startsWith('/api/');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k =>
          (k.startsWith('whatif-static-') ||
           k.startsWith('whatif-runtime-') ||
           k.startsWith('whatif-images-')) &&
          ![STATIC_CACHE, RUNTIME_CACHE, IMG_CACHE].includes(k)
        )
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Helper: network-first con timeout
async function fromNetworkWithTimeout(request, ms = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(request, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Helper: SWR (stale-while-revalidate) per asset generici
async function staleWhileRevalidate(request, cacheName = RUNTIME_CACHE) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((res) => {
    if (res && res.status === 200) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || fetchPromise || new Response(null, { status: 504 });
}

// Limita numero di entry in cache immagini
async function enforceImageCacheLimit(maxEntries = 60) {
  const cache = await caches.open(IMG_CACHE);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const toDelete = keys.slice(0, keys.length - maxEntries);
  await Promise.all(toDelete.map(k => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Bypass: cross-origin → SWR senza rompere
  if (!isSameOrigin(request.url)) {
    if (request.method !== 'GET') return;
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // API: sempre rete, no cache
  if (isAPIRequest(request)) {
    if (request.method !== 'GET') {
      event.respondWith(
        fromNetworkWithTimeout(request, 15000).catch(() =>
          new Response(JSON.stringify({ error: 'offline', detail: 'Nessuna connessione' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      );
      return;
    }
    event.respondWith(
      fromNetworkWithTimeout(request, 8000).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Navigazioni / HTML → network-first con fallback offline
  if (isHTMLRequest(request)) {
    event.respondWith((async () => {
      try {
        const res = await fromNetworkWithTimeout(request, 6000);
        const cache = await caches.open(STATIC_CACHE);
        cache.put(request, res.clone());
        return res;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request) || await cache.match('/index.html');
        if (cached) return cached;
        return new Response(OFFLINE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // Immagini → cache-first con expiring
  if (request.method === 'GET' && isImageRequest(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res && res.status === 200) {
          cache.put(request, res.clone());
          enforceImageCacheLimit(60).catch(()=>{});
        }
        return res;
      } catch {
        return new Response('', { status: 404 });
      }
    })());
    return;
  }

  // Altri asset same-origin (JS/CSS/manifest/icone) → SWR
  if (request.method === 'GET') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});

// Facoltativo: messaggio per forzare skipWaiting da UI
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
