// FILE: /sw.js
// Service Worker per What?f
// - Niente cache custom
// - Notifiche FCM data-only
// - Click → apre l'URL passato da /api/push (fifth.html?signal=...)

// Attiva subito la nuova versione
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Prende il controllo di tutte le pagine
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// PUSH: mostriamo noi la notifica
self.addEventListener("push", (event) => {
  let data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    data = {};
  }

  const title = data.title || "What?f · frase del giorno";
  const body =
    data.body ||
    "La tua frase di oggi è pronta 🔔";

  // URL da aprire al tap: prendiamo quello che manda /api/push
  let url = data.click_action || data.url || "/fifth.html?src=daily_push";

  try {
    url = new URL(url, self.location.origin).toString();
  } catch (e) {
    url = self.location.origin + "/fifth.html?src=daily_push";
  }

  const options = {
    body,
    icon: "/public/icon-192.png",
    badge: "/public/icon-192.png",
    data: {
      url
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// CLICK: apriamo SEMPRE l'URL che abbiamo messo in data.url
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  let targetUrl = notifData.url || (self.location.origin + "/fifth.html?src=daily_push");

  try {
    targetUrl = new URL(targetUrl, self.location.origin).toString();
  } catch (e) {
    targetUrl = self.location.origin + "/fifth.html?src=daily_push";
  }

  event.waitUntil(self.clients.openWindow(targetUrl));
});
