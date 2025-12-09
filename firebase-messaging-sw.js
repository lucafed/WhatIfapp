// FILE: firebase-messaging-sw.js
// Service Worker per le notifiche push Firebase Cloud Messaging (FCM)

// ⚠️ Nota:
// Nel service worker usiamo le API "compat" perché Firebase Messaging
// lato SW funziona ancora così, anche se nel resto del sito usi i modular v12.

importScripts("https://www.gstatic.com/firebasejs/12.6.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging-compat.js");

// Stessa config del tuo firebase.init.js
firebase.initializeApp({
  apiKey: "AIzaSyAeWhmo9BtwWUVVeBxwJKUgLODMDQNUZTE",
  authDomain: "whatif-oracolo-bc15d.firebaseapp.com",
  projectId: "whatif-oracolo-bc15d",
  storageBucket: "whatif-oracolo-bc15d.firebasestorage.app",
  messagingSenderId: "857481137283",
  appId: "1:857481137283:web:ff8f766d14392835cf5fb6",
});

// Istanza Messaging nel SW
const messaging = firebase.messaging();

// Gestione messaggi in background (quando la web app è chiusa o in background)
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Messaggio in background ricevuto:", payload);

  const notificationTitle =
    (payload.notification && payload.notification.title) ||
    "What?f";

  const notificationBody =
    (payload.notification && payload.notification.body) ||
    "Hai un nuovo messaggio da What?f";

  const notificationOptions = {
    body: notificationBody,
    icon: "/icon-192.png", // opzionale: puoi cambiarlo con la tua icona
    badge: "/icon-72.png", // opzionale
    data: payload.data || {},
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// (opzionale) click sulla notifica → apri la web app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.click_action || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    }),
  );
});
