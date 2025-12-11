// FILE: firebase-messaging-sw.js
// Service Worker per le notifiche push Firebase Cloud Messaging (FCM)

// ⚠️ Nota:
// Nel service worker usiamo le API "compat" perché Firebase Messaging
// lato SW funziona ancora così, anche se nel resto del sito usi i modular v12.

importScripts("https://www.gstatic.com/firebasejs/12.6.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging-compat.js");

// stessa config del tuo firebase.init.js
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

// URL pubblico della tua app
const APP_URL = "https://what-ifapp.vercel.app/";

// Gestione messaggi in background (quando la web app è chiusa o in background)
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Messaggio in background ricevuto:", payload);

  const notificationTitle =
    (payload.notification && payload.notification.title) ||
    "What?f";

  const notificationBody =
    (payload.notification && payload.notification.body) ||
    "Hai un nuovo messaggio da What?f";

  const data = payload.data || {};

  const notificationOptions = {
    body: notificationBody,
    icon: "/public/icon-192.png",   // usa la tua icona
    badge: "/public/icon-192.png",  // opzionale
    data,                           // IMPORTANTISSIMO: qui c'è anche click_action
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// click sulla notifica → apri la web app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetUrl = data.click_action || APP_URL;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // se esiste già una tab di What?f, la porto in primo piano
        for (const client of clientList) {
          if (client.url.startsWith(APP_URL) && "focus" in client) {
            return client.focus();
          }
        }
        // altrimenti ne apro una nuova
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      }),
  );
});
