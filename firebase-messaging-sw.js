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

// URL pubblico della tua app (con / finale)
const APP_URL = "https://what-ifapp.vercel.app/";

// Helper: costruisce URL assoluto verso la app
function resolveTargetUrl(data = {}) {
  // 1) data.url: es. "/fifth.html?signal=morning&phase=1&src=daily_push"
  if (data.url) {
    try {
      return new URL(data.url, APP_URL).href;
    } catch (e) {}
  }

  // 2) click_action assoluto dal payload
  if (data.click_action) {
    try {
      return new URL(data.click_action).href;
    } catch (e) {}
  }

  // 3) fallback: home
  return APP_URL;
}

// Gestione messaggi in background (quando la web app è chiusa o in background)
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Messaggio in background ricevuto:", payload);

  const data = payload.data || {};

  const notificationTitle =
    data.title ||
    (payload.notification && payload.notification.title) ||
    "What?f";

  const notificationBody =
    data.body ||
    (payload.notification && payload.notification.body) ||
    "Hai un nuovo messaggio da What?f";

  const notificationOptions = {
    body: notificationBody,
    // usa la tua icona reale nel public root (senza /public davanti)
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // IMPORTANTISSIMO: qui salviamo tutti i campi data (url, slot, phase, click_action…)
    data,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// click sulla notifica → apri SEMPRE la pagina target (fifth.html con signal/phase)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetUrl = resolveTargetUrl(data); // es. https://what-ifapp.vercel.app/fifth.html?signal=...

  event.waitUntil(
    (async () => {
      const clientList = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // 1) se esiste già una tab della tua app → navigala verso targetUrl
      for (const client of clientList) {
        if (client.url.startsWith(APP_URL)) {
          // se il browser supporta navigate, usiamo quello
          if ("navigate" in client) {
            return client.navigate(targetUrl);
          }
          // fallback: focus + openWindow (alcuni browser vecchi)
          await client.focus();
          if (clients.openWindow) {
            return clients.openWindow(targetUrl);
          }
          return;
        }
      }

      // 2) se non c'è nessuna tab aperta → apri una nuova finestra su targetUrl
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })()
  );
});
