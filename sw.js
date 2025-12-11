// FILE: /sw.js
// Service Worker minimale per What?f
// - Nessuna gestione push (solo in firebase-messaging-sw.js)
// - Nessun cache/fetch → niente rischi di schermate nere

// 🔹 Installa subito la nuova versione del SW
self.addEventListener("install", (event) => {
  // salta lo stato "waiting" e diventa attivo subito
  self.skipWaiting();
});

// 🔹 Prende il controllo di tutte le pagine aperte dell'app
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ✅ STOP.
// Nessun listener "push"
// Nessun listener "notificationclick"
// Nessun listener "fetch"
//
// Tutto ciò che riguarda le notifiche push
// viene gestito ESCLUSIVAMENTE in firebase-messaging-sw.js.
