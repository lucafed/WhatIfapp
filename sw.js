// FILE: /sw.js
// Service Worker per What?f
// - Gestisce direttamente le notifiche FCM (data-only)
// - Niente cache/fetch per non incasinare il routing

// Attiva subito la nuova versione
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Prende il controllo di tutte le pagine aperte
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 🔔 Gestione PUSH (Firebase data-only)
self.addEventListener("push", (event) => {
  if (!event.data) return;

  const payload = event.data.json() || {};
  // FCM per il web mette i nostri dati in payload.data
  const data = payload.data || payload;

  const title =
    data.title ||
    (data.src === "daily_push" ? "What?f · frase del giorno" : "What?f");

  const body =
    data.body ||
    (data.src === "daily_push"
      ? "La tua frase di oggi è pronta 🔔"
      : "Hai un nuovo messaggio da What?f");

  const url =
    data.url ||
    data.click_action ||
    "https://what-ifapp.vercel.app/fifth.html";

  // URL assoluto
  const targetUrl = new URL(url, self.location.origin).toString();

  const options = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      url: targetUrl,
      src: data.src || "",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 👆 Click sulla notifica → apri /fifth.html?signal=...&phase=...
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetUrl =
    data.url || "https://what-ifapp.vercel.app/fifth.html";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Se esiste già UNA tab con QUELLO stesso URL → focus
        for (const client of clientList) {
          if (client.url === targetUrl && "focus" in client) {
            return client.focus();
          }
        }
        // Altrimenti apri sempre la pagina corretta
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
