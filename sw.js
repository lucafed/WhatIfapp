// FILE: /sw.js
// Service Worker minimale per What?f
// Niente cache, niente push: lasciamo le notifiche a FCM.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Nessun handler "push" e "notificationclick":
// FCM usa notification + webpush.fcmOptions.link per aprire la pagina.
