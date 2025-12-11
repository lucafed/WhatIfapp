// FILE: /sw.js
// Service Worker per What?f
// - Nessuna cache → niente rischi di pagina nera
// - Gestione notifiche FCM data-only
// - Click della notifica → apre SEMPRE l’URL della notifica

// Installazione immediata
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Prende il controllo di tutte le pagine
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ⛔ Nessun fetch handler → Chrome gestisce tutto, zero problemi

// 🔔 PUSH: notifiche gestite dal SW
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = data.title || "What?f · frase del giorno";
  const body = data.body || "La tua frase di oggi è pronta 🔔";

  // URL da aprire
  let url = data.click_action || data.url || "/?src=daily_push";

  try {
    url = new URL(url, self.location.origin).toString();
  } catch (e) {
    url = self.location.origin + "/?src=daily_push";
  }

  const options = {
    body,
    icon: "/public/icon-192.png",
    badge: "/public/icon-192.png",
    data: {
      url,
      src: data.src || "daily_push"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 🔔 Click sulla notifica
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  let targetUrl = event.notification.data?.url || "/?src=daily_push";

  try {
    targetUrl = new URL(targetUrl, self.location.origin).toString();
  } catch (e) {
    targetUrl = self.location.origin + "/?src=daily_push";
  }

  // Apri SEMPRE una nuova finestra
  event.waitUntil(
    self.clients.openWindow(targetUrl)
  );
});
