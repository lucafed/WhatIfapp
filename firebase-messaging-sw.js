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
const APP_ORIGIN = self.location.origin;

messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Messaggio in background ricevuto:", payload);

  const data = payload.data || {};

  const notificationTitle =
    data.title ||
    (payload.notification && payload.notification.title) ||
    "What?f · frase del giorno";

  const notificationBody =
    data.body ||
    (payload.notification && payload.notification.body) ||
    "La tua frase di oggi è pronta 🔔";

  // 🎯 Usa SEMPRE signal/phase → fifth.html
  const slot =
    data.signal ||
    data.slot ||
    data.timeOfDay ||
    "morning";
  const phase = data.phase || "1";
  const mood = data.mood ? `&mood=${encodeURIComponent(data.mood)}` : "";

  let url = `/fifth.html?signal=${encodeURIComponent(
    String(slot).toLowerCase()
  )}&phase=${encodeURIComponent(String(phase))}${mood}`;

  try {
    const u = new URL(url, APP_ORIGIN);
    url = u.toString();
  } catch (e) {
    url = APP_ORIGIN + "/fifth.html?signal=morning&phase=1";
  }

  const notificationOptions = {
    body: notificationBody,
    icon: "/public/icon-192.png",
    badge: "/public/icon-192.png",
    data: {
      url,
      src: data.src || "daily_push",
      signal: slot,
      phase,
      mood: data.mood || null
    },
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = data.url || (APP_ORIGIN + "/fifth.html?signal=morning&phase=1");

  try {
    const u = new URL(targetUrl, APP_ORIGIN);
    targetUrl = u.toString();
  } catch (e) {
    targetUrl = APP_ORIGIN + "/fifth.html?signal=morning&phase=1";
  }

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        if (clientList && clientList.length > 0) {
          const sameOriginClient =
            clientList.find((c) => c.url.startsWith(APP_ORIGIN)) ||
            clientList[0];

          if (sameOriginClient.navigate) {
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
