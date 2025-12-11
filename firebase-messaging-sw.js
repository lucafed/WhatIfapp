// FILE: firebase-messaging-sw.js
// Service Worker per le notifiche Firebase — versione corretta e pulita

importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js");

// CONFIG identica al progetto
firebase.initializeApp({
  apiKey: "AIzaSyAeWhmo9BtwWUVVeBxwJKUgLODMDQNUZTE",
  authDomain: "whatif-oracolo-bc15d.firebaseapp.com",
  projectId: "whatif-oracolo-bc15d",
  storageBucket: "whatif-oracolo-bc15d.firebasestorage.app",
  messagingSenderId: "857481137283",
  appId: "1:857481137283:web:ff8f766d14392835cf5fb6",
});

const messaging = firebase.messaging();
const ORIGIN = self.location.origin;

// 🔔 Notifica in background
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};

  // icon e badge devono essere assoluti o root
  const options = {
    body: data.body || "La tua frase di oggi è pronta 🔔",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      url: data.url || "/fifth.html?signal=morning&phase=1",
    },
  };

  self.registration.showNotification(
    data.title || "What?f · frase del giorno",
    options
  );
});

// 🔔 Click sulla notifica → apri fifth.html nella PWA
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data.url;
  const absolute = new URL(url, ORIGIN).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((cl) => {
      // Se l'app è già aperta → naviga lì
      for (const client of cl) {
        if (client.url.startsWith(ORIGIN)) {
          client.focus();
          client.navigate(absolute);
          return;
        }
      }
      // Altrimenti apri una nuova finestra
      return clients.openWindow(absolute);
    })
  );
});
