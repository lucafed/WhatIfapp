// FILE: /sw.js
// Service Worker per What?f
// - Nessuna cache custom (evitiamo schermate nere)
// - Gestione notifiche push data-only FCM
// - Click sulla notifica → apre fifth.html con i parametri giusti

// Attiva subito la nuova versione del SW
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Prende il controllo di tutte le pagine aperte
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 🔔 Gestione dell'evento PUSH
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
  const body = data.body || "La tua frase di oggi è pronta 🔔";

  // URL da aprire al tap sulla notifica
  let url = data.click_action || data.url || "/fifth.html?src=daily_push";

  // Normalizza l'URL (se relativo → assoluto)
  try {
    url = new URL(url, self.location.origin).toString();
  } catch (e) {
    url = self.location.origin + "/fifth.html?src=daily_push";
  }

  const options = {
    body,
    // tu hai le icone sotto /public, quindi usiamo quel path
    icon: "/public/icon-192.png",
    badge: "/public/icon-192.png",
    data: {
      url
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 🔔 Click sulla notifica → apri SEMPRE l'URL salvato in data.url
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
