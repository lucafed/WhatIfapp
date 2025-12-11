// FILE: /sw.js
// Service Worker principale per What?f
// - Nessuna gestione push qui (ci pensa firebase-messaging-sw.js)
// - Nessun caching/fetch → niente rischi di pagina nera

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ✅ STOP: niente "push", niente "fetch" qui.
// Firebase Messaging usa il suo service worker dedicato: /firebase-messaging-sw.js
