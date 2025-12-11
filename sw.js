// FILE: /sw.js
// Service Worker per What?f
// - Nessun caching → niente schermate nere
// - Gestione notifiche PUSH (data-only da FCM)
// - Click sulla notifica → apre SEMPRE l'URL passato da /api/push

// 🔹 Attiva subito la nuova versione
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// 🔹 Prende il controllo di tutte le pagine aperte
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 🔔 PUSH: arrivano messaggi "data-only" da FCM
self.addEventListener("push", (event) => {
  let data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    data = {};
  }

  const title =
    data.title ||
    "What?f · frase del giorno";

  const body =
    data.body ||
    "La tua frase di oggi è pronta 🔔";

  // URL che /api/push mette nel payload
  // (CLICK_LINK = https://what-ifapp.vercel.app/fifth.html?... )
  let url = data.click_action || data.url || "/fifth.html?src=daily_push";

  // normalizza rispetto all'origin, così è sempre assoluto
  try {
    url = new URL(url, self.location.origin).toString();
  } catch (e) {
    url = self.location.origin + "/fifth.html?src=daily_push";
  }

  const options = {
    body,
    // ⚠️ IMPORTANTE: i file in /public diventano /icon-192.png a root,
    // NON /public/icon-192.png
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      url,
      src: data.src || "daily_push"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 🔔 Click sulla notifica → apri SEMPRE la pagina della frase
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  let targetUrl = notifData.url || "/fifth.html?src=daily_push";

  try {
    targetUrl = new URL(targetUrl, self.location.origin).toString();
  } catch (e) {
    targetUrl = self.location.origin + "/fifth.html?src=daily_push";
  }

  event.waitUntil(
    self.clients.openWindow(targetUrl)
  );
});
