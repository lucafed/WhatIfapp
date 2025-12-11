// FILE: /sw.js
// Service Worker per What?f
// NESSUNA gestione push qui (delegata a firebase-messaging-sw.js)
// NESSUN caching/fetch → zero rischi di schermo nero

// Attiva subito la nuova versione
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Prende il controllo delle pagine aperte
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ⛔ NIENTE push.
// ⛔ NIENTE messaging.
// ⛔ NIENTE fetch.
// Tutto è gestito SOLO da firebase-messaging-sw.js.
