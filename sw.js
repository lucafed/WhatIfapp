// FILE: /sw.js
// Service Worker base per PWA (no push, no cache)

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ✅ NIENTE push, NIENTE fetch qui.
