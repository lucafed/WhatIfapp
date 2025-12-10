// FILE: /sw.js  (e anche /firebase-messaging-sw.js)
// Service Worker per What?f
// - niente cache/fetch (evita schermate nere)
// - gestisce notifiche FCM data-only
// - click apre sempre la PWA sull'URL giusto

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 🔔 PUSH: le notifiche le mostra questo SW
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

  // URL da aprire quando tocchi la notifica
  let url = data.click_action || data.url || "/fifth.html?src=daily_push";

  try {
    url = new URL(url, self.location.origin).toString();
  } catch (e) {
    url = self.location.origin + "/fifth.html?src=daily_push";
  }

  const options = {
    body,
    icon: "/icon-192.png",   // icona PWA (non /public/)
    badge: "/icon-192.png",
    data: {
      url,
      src: data.src || "daily_push"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 🔔 Click sulla notifica → apri SEMPRE l'URL della notifica
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = data.url || data.click_action || "/fifth.html?src=daily_push";

  try {
    targetUrl = new URL(targetUrl, self.location.origin).toString();
  } catch (e) {
    targetUrl = self.location.origin + "/fifth.html?src=daily_push";
  }

  event.waitUntil(self.clients.openWindow(targetUrl));
});
