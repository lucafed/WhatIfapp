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

// Origin della tua app (puoi anche tenere fisso l'URL se preferisci)
const APP_ORIGIN = self.location.origin;

// 🔔 Messaggi in background (quando la web app è chiusa o in background)
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Messaggio in background ricevuto:", payload);

  const notificationTitle =
    (payload.notification && payload.notification.title) ||
    "What?f · frase del giorno";

  const notificationBody =
    (payload.notification && payload.notification.body) ||
    "La tua frase di oggi è pronta 🔔";

  const data = payload.data || {};

  // 🎯 COSTRUZIONE URL PER LA FRASE DEL GIORNO
  // priorità: click_action → url
  let url = data.click_action || data.url;

  if (!url) {
    // Cerchiamo info sullo slot dal payload:
    // puoi mandare dal backend: signal=morning/afternoon/evening, phase=1/2, mood=...
    const slot =
      data.signal ||
      data.slot ||
      data.timeOfDay ||
      "morning"; // default: mattino
    const phase = data.phase || "1"; // 1 = WHAT IF, 2 = WTF
    const mood = data.mood ? `&mood=${encodeURIComponent(data.mood)}` : "";

    url = `/fifth.html?signal=${encodeURIComponent(
      String(slot).toLowerCase()
    )}&phase=${encodeURIComponent(String(phase))}${mood}`;
  }

  // Normalizza a URL assoluto
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
      signal: data.signal || data.slot || data.timeOfDay || null,
      phase: data.phase || "1",
      mood: data.mood || null
    },
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// 🔔 click sulla notifica → apri / naviga alla frase del giorno
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = data.url || (APP_ORIGIN + "/");

  // normalizza anche qui
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
        // se esiste già una tab dell'app, la riutilizziamo
        if (clientList && clientList.length > 0) {
          const sameOriginClient =
            clientList.find((c) => c.url.startsWith(APP_ORIGIN)) ||
            clientList[0];

          if (sameOriginClient.navigate) {
            sameOriginClient.navigate(targetUrl);
          }

          return sameOriginClient.focus();
        }

        // altrimenti ne apriamo una nuova
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
