// FILE: firebase-messaging-sw.js
// Service Worker per le notifiche push Firebase Cloud Messaging (FCM)
// Versione: usa SOLO i campi `data` → niente doppie notifiche.

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

const messaging = firebase.messaging();
const APP_ORIGIN = self.location.origin;

/**
 * 1) MESSAGGIO IN BACKGROUND
 *    Arriva un push "data-only" da /api/push, costruiamo noi la notifica.
 */
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw] onBackgroundMessage", payload);

  const data = payload && payload.data ? payload.data : {};

  const title = data.title || "What?f · frase del giorno";
  const body  = data.body  || "La tua frase di oggi è pronta 🔔";

  // URL interno: se non arriva da data.url, apriamo la quinta pagina con signal/phase
  let url = data.url;
  if (!url) {
    const slot  = (data.slot || data.signal || "morning").toLowerCase();
    const phase = data.phase || "1";
    const mood  = data.mood ? `&mood=${encodeURIComponent(data.mood)}` : "";
    url = `/fifth.html?signal=${encodeURIComponent(slot)}&phase=${encodeURIComponent(phase)}${mood}`;
  }

  // Normalizza a URL assoluto
  let absoluteUrl;
  try {
    absoluteUrl = new URL(url, APP_ORIGIN).toString();
  } catch (e) {
    console.warn("[firebase-messaging-sw] URL non valida, fallback:", e);
    absoluteUrl = `${APP_ORIGIN}/fifth.html?signal=morning&phase=1`;
  }

  const options = {
    body,
    icon: "/icon-192.png",   // file che hai già in root
    badge: "/icon-192.png",
    data: {
      url: absoluteUrl,
      src: data.src || "signal",
      slot: data.slot || data.signal || "",
      phase: data.phase || "1",
      mood: data.mood || "",
    },
  };

  self.registration.showNotification(title, options);
});

/**
 * 2) CLICK NOTIFICATION
 *    - chiude la notifica
 *    - se c'è una finestra PWA aperta → focus + navigate verso data.url
 *    - se non c'è → apre una nuova finestra su data.url
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = data.url || `${APP_ORIGIN}/fifth.html?signal=morning&phase=1`;

  try {
    targetUrl = new URL(targetUrl, APP_ORIGIN).toString();
  } catch (e) {
    targetUrl = `${APP_ORIGIN}/fifth.html?signal=morning&phase=1`;
  }

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // se esiste già una tab della webapp, usa quella
      for (const client of allClients) {
        if (client.url.startsWith(APP_ORIGIN)) {
          try {
            await client.focus();
            await client.navigate(targetUrl);
          } catch (e) {
            await clients.openWindow(targetUrl);
          }
          return;
        }
      }

      // altrimenti apri una nuova tab
      await clients.openWindow(targetUrl);
    })()
  );
});
