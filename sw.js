// FILE: /sw.js
// Service Worker per What?f

// Attiva subito la nuova versione
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Prende il controllo delle pagine aperte
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// NIENTE fetch handler → niente cache strane

// 🔔 Gestione PUSH (messaggi data-only da FCM)
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
    data.body || "La tua frase di oggi è pronta 🔔";

  // URL da aprire al tap
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
      url,
      src: data.src || "daily_push"
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 🔔 Click sulla notifica
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = data.url || "/fifth.html?src=daily_push";

  try {
    targetUrl = new URL(targetUrl, self.location.origin).toString();
  } catch (e) {
    targetUrl = self.location.origin + "/fifth.html?src=daily_push";
  }

  event.waitUntil(
    self.clients.openWindow(targetUrl)
  );
});
