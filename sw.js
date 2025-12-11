// FILE: /sw.js
// Service Worker per What?f
// - Nessuna gestione push qui (delegata a firebase-messaging-sw.js)
// - Nessun cache/fetch → niente rischi di pagina nera

// 🔹 Attiva subito la nuova versione
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// 🔹 Prende il controllo di tutte le pagine aperte
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ✅ NIENTE push, NIENTE fetch handler qui.
// Tutta la parte notifiche è in firebase-messaging-sw.js
