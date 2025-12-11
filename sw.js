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

// 🔔 PUSH: notifiche mostrate da questo SW (messaggio *data-only* da FCM)
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

  // URL da aprire quando l’utente tappa la notifica
  // priorità: click_action → url → fallback
  let url = data.click_action || data.url || "/fifth.html?src=daily_push";

  // se è relativo, lo trasformiamo in assoluto rispetto all’origin
  try {
    url = new URL(url, self.location.origin).toString();
  } catch (e) {
    url = self.location.origin + "/fifth.html?src=daily_push";
  }

  const options = {
    body,
    // come vuoi tu: con /public
    icon: "/public/icon-192.png",
    badge: "/public/icon-192.png",
    data: {
      url
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 🔔 Click sulla notifica → apri SEMPRE l'URL della notifica
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = data.url || "/fifth.html?src=daily_push";

  // normalizza l'URL (anche se è relativo)
  try {
    targetUrl = new URL(targetUrl, self.location.origin).toString();
  } catch (e) {
    targetUrl = self.location.origin + "/fifth.html?src=daily_push";
  }

  event.waitUntil(
    self.clients.openWindow(targetUrl)
  );
});
