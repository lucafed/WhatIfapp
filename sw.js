/* What?f — Service Worker */
const VERSION = '1.0.0-' + Date.now();
const STATIC_CACHE  = `whatif-static-${VERSION}`;
const RUNTIME_CACHE = `whatif-runtime-${VERSION}`;
const IMG_CACHE     = `whatif-images-${VERSION}`;

const PRECACHE_URLS = [
  '/', '/index.html', '/second.html','/third.html','/fourth.html','/fifth.html',
  '/about.html','/privacy.html','/terms.html',

  // public assets
  '/public/manifest.json',
  '/public/home-hero.png',
  '/public/icon-192.png',
  '/public/icon-512.png',
  '/public/icon-192-maskable.png',
  '/public/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => /whatif-(static|runtime|images)-/.test(k) && k !== STATIC_CACHE && k !== RUNTIME_CACHE && k !== IMG_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isHTML = (req) => req.mode === 'navigate' || (req.headers.get('accept')||'').includes('text/html');
const isImage = (req) => req.destination === 'image' || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(new URL(req.url).pathname);

async function fromNetworkWithTimeout(request, ms=6000){
  const c = new AbortController(); const id=setTimeout(()=>c.abort(), ms);
  try{ const res=await fetch(request,{signal:c.signal}); clearTimeout(id); return res; } catch(e){ clearTimeout(id); throw e; }
}
async function swr(request, cacheName=RUNTIME_CACHE){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetcher = fetch(request).then(res => { if(res && res.status===200) cache.put(request, res.clone()); return res; }).catch(()=>null);
  return cached || fetcher || new Response(null,{status:504});
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (isHTML(request)) {
    event.respondWith((async () => {
      try {
        const res = await fromNetworkWithTimeout(request, 6000);
        const cache = await caches.open(STATIC_CACHE);
        cache.put(request, res.clone());
        return res;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match(request)) || (await cache.match('/index.html')) || new Response('<h1>Offline</h1>', { status: 200, headers: {'Content-Type':'text/html'}});
      }
    })());
    return;
  }

  if (request.method === 'GET' && isImage(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res && res.status === 200) cache.put(request, res.clone());
        return res;
      } catch { return new Response('', { status: 404 }); }
    })());
    return;
  }

  if (request.method === 'GET') {
    event.respondWith(swr(request, RUNTIME_CACHE));
  }
});
