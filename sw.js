// FILE: /sw.js
// Service Worker generico per What?f
// - NIENTE push, NIENTE fetch
// - Serve solo per eventuali future features (PWA, ecc.)

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Nessun handler "push" o "fetch" qui.
// Tutte le notifiche sono gestite da firebase-messaging-sw.js.
