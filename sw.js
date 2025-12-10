// FILE: /sw.js
// Service Worker minimale per What?f

// Attiva subito la nuova versione
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Prende il controllo di tutte le pagine aperte
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// NIENTE fetch handler → lasciamo gestire a Chrome tutte le richieste.
// Così eliminiamo il rischio di "pagina nera" per colpa della cache.

// Gestione click sulle notifiche (se qualche notifica usa questo SW)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url =
    (event.notification.data && event.notification.data.url) ||
    "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin)) {
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
