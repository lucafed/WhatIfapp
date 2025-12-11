// FILE: /sw.js
// Service Worker vuoto per What?f
// Nessuna gestione push → la fa firebase-messaging-sw.js

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// STOP — niente importScripts, niente messaging, niente notifiche.
