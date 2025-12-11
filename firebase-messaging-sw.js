// FILE: firebase-messaging-sw.js
// Service Worker per le notifiche push Firebase Cloud Messaging (FCM)
// Gestisce SOLO le notifiche (nessuna cache qui)

importScripts("https://www.gstatic.com/firebasejs/12.6.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAeWhmo9BtwWUVVeBxwJKUgLODMDQNUZTE",
  authDomain: "whatif-oracolo-bc15d.firebaseapp.com",
  projectId: "whatif-oracolo-bc15d",
  storageBucket: "whatif-oracolo-bc15d.firebasestorage.app",
  messagingSenderId: "857481137283",
  appId: "1:857481137283:web:ff8f766d14392835cf5fb6",
});

const messaging = firebase.messaging();
const APP_URL = "https://what-ifapp.vercel.app/";

// Messaggi in background (data-only)
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] background:", payload);

  const data = payload.data || {};
  const notificationTitle =
    data.title ||
    (data.phase === "2"
      ? "What the F · frase del giorno"
      : "What?f · frase del giorno");

  const notificationBody =
    data.body ||
    (data.phase === "2"
      ? "La tua frase di stasera è pronta 🔔"
      : "La tua frase di oggi è pronta 🔔");

  let targetUrl = data.click_action || data.url || "/?src=daily_push";

  try {
    const u = new URL(targetUrl, self.location.origin);
    targetUrl = u.toString();
  } catch (e) {
    targetUrl = APP_URL;
  }

  const notificationOptions = {
    body: notificationBody,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      ...data,
      url: targetUrl,
      click_action: targetUrl,
      src: data.src || "daily_push",
    },
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Click sulla notifica → naviga sempre alla fifth in signal-mode
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = data.click_action || data.url || APP_URL;

  try {
    const u = new URL(targetUrl, self.location.origin);
    targetUrl = u.toString();
  } catch (e) {
    targetUrl = APP_URL;
  }

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        if (clientList && clientList.length > 0) {
          const sameOriginClient =
            clientList.find((c) => c.url.startsWith(self.location.origin)) ||
            clientList[0];

          if (sameOriginClient && "navigate" in sameOriginClient) {
            sameOriginClient.navigate(targetUrl);
          }

          return sameOriginClient.focus();
        }

        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
