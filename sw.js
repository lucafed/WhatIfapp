// FILE: /sw.js
// Service Worker per What?f
// - Nessuna gestione push qui (delegata a firebase-messaging-sw.js)
// - Nessun cache/fetch → niente rischi di pagina nera

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ❌ NIENTE push
// ❌ NIENTE fetch
