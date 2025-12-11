// FILE: /sw.js
// Service Worker per What?f
// - NIENTE cache/fetch (evitiamo schermate nere)
// - Gestione notifiche push (FCM)
// - Click sulla notifica → apre l’URL esatto passato da FCM

// 🔧 Install: attiva subito la nuova versione
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// 🔧 Activate: prende il controllo di tutte le pagine aperte
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ❗ NON gestiamo fetch → lasciamo tutto al browser

// 🔔 PUSH: arriva il messaggio da FCM
self.addEventListener("push", (event) => {
  let data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    data = {};
  }

  // Titolo e testo della notifica
  const title =
    data.title || "What?f · frase del giorno";
  const body =
    data.body || "La tua frase di oggi è pronta 🔔";

  // URL da aprire al tap (quello che mandiamo da /api/push)
  const clickUrl =
    data.click_action ||
    data.url ||
    data.link ||
    "/";

  const options = {
    body,
    // 👇 usa l’icona dell’app (nel deploy è servita alla root)
    // se preferisci assolutamente "public", metti "/public/icon-192.png"
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      url: clickUrl
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 🔔 CLICK: apre SEMPRE l’URL salvato in data.url
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    (event.notification.data && event.notification.data.url) ||
    "/";

  event.waitUntil(
    // Proviamo prima a riutilizzare una scheda aperta
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      // Altrimenti apriamo una nuova scheda / finestra
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
