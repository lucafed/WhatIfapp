// FILE: /sw.js
// Service Worker per What?f

// 🔹 Attiva subito la nuova versione
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// 🔹 Prende il controllo di tutte le pagine aperte
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 🔔 PUSH: notifiche data-only da FCM
self.addEventListener("push", (event) => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    data = {};
  }

  const title = data.title || "What?f · frase del giorno";
  const body =
    data.body ||
    "La tua frase di oggi è pronta 🔔";

  // URL da aprire
  let url = data.click_action || data.url || "/fifth.html?src=daily_push";

  try {
    url = new URL(url, self.location.origin).toString();
  } catch (e) {
    url = self.location.origin + "/fifth.html?src=daily_push";
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/public/icon-192.png",
      badge: "/public/icon-192.png",
      data: { url }
    })
  );
});

// 🔔 Click sulla notifica → apri l'URL corretto
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  let targetUrl = event.notification.data?.url || "/fifth.html?src=daily_push";

  try {
    targetUrl = new URL(targetUrl, self.location.origin).toString();
  } catch (e) {
    targetUrl = self.location.origin + "/fifth.html?src=daily_push";
  }

  event.waitUntil(self.clients.openWindow(targetUrl));
});
