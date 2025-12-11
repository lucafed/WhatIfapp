// FILE: /sw.js
// Service Worker unico per What?f
// - Gestisce Firebase Messaging (notifiche push)
// - Nessun caching/fetch → niente rischi di pagina nera

// 🔹 Attiva subito la nuova versione
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// 🔹 Prende il controllo di tutte le pagine aperte
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// =======================
//  FIREBASE MESSAGING
// =======================
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js");

// 👉 METTI QUI LA TUA CONFIG (QUELLA GIÀ USATA NELL'APP)
firebase.initializeApp({
  apiKey: "XXX",
  authDomain: "XXX",
  projectId: "XXX",
  storageBucket: "XXX",
  messagingSenderId: "XXX",
  appId: "XXX"
});

const messaging = firebase.messaging();

/**
 * BACKGROUND MESSAGE
 * Costruiamo noi la notifica usando SOLO i campi `data`
 * inviati da /api/push (title, body, url, ecc).
 */
messaging.onBackgroundMessage((payload) => {
  console.log("[sw] onBackgroundMessage", payload);
  const data = payload.data || {};

  const title = data.title || "What?f · frase del giorno";
  const body = data.body || "La tua frase di oggi è pronta 🔔";

  const notifData = {
    // esempio: "/fifth.html?signal=morning&phase=1&mood=..."
    url: data.url || "/",
    src: data.src || "signal",
    slot: data.slot || "",
    phase: data.phase || "",
    mood: data.mood || ""
  };

  const options = {
    body,
    icon: "/icons/icon-192.png",   // adatta ai tuoi path reali
    badge: "/icons/badge-72.png",  // opzionale
    data: notifData
  };

  self.registration.showNotification(title, options);
});

/**
 * CLICK NOTIFICATION
 * - chiude la notifica
 * - se c'è una finestra dell'app → focus + navigate verso data.url
 * - se non c'è → apre una nuova tab su data.url
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetPath = data.url || "/";

  const absoluteUrl = targetPath.startsWith("http")
    ? targetPath
    : new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });

      if (allClients.length > 0) {
        const client = allClients[0];
        try {
          await client.focus();
          await client.navigate(absoluteUrl);
        } catch (e) {
          await clients.openWindow(absoluteUrl);
        }
        return;
      }

      await clients.openWindow(absoluteUrl);
    })()
  );
});

// ✅ Nessun event "push" o "fetch" scritto da noi qui: ci pensa Firebase internamente.
