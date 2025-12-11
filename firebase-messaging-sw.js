// FILE: /firebase-messaging-sw.js
// Service Worker DI FIREBASE per le notifiche di What?f
// - Usa SOLO onBackgroundMessage (data-only da /api/push)
// - Mostra UNA sola notifica
// - Click → apre SEMPRE fifth.html con i parametri giusti

importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js");

// ⚠️ USA LA STESSA CONFIG DELL'APP (quella in firebase.init.js)
firebase.initializeApp({
  apiKey: "XXX",
  authDomain: "XXX",
  projectId: "XXX",
  storageBucket: "XXX",
  messagingSenderId: "XXX",
  appId: "XXX"
});

const messaging = firebase.messaging();

// 🔹 Notifiche background: data-only da /api/push
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw] onBackgroundMessage", payload);
  const data = payload?.data || {};

  const title = data.title || "What?f · frase del giorno";
  const body = data.body || "La tua frase di oggi è pronta 🔔";

  // es: "/fifth.html?signal=morning&phase=1&mood=..."
  const urlFromData = data.url || "/";

  const options = {
    body,
    // opzionali: metti le tue icone se le hai
    // icon: "/icons/icon-192.png",
    // badge: "/icons/badge-72.png",
    data: {
      url: urlFromData,
      src: data.src || "signal",
      slot: data.slot || "",
      phase: data.phase || "",
      mood: data.mood || "",
    },
    tag: `daily-signal-${data.slot || "x"}-${data.phase || "1"}`,
    renotify: false,
  };

  self.registration.showNotification(title, options);
});

// 🔹 Click → porta SEMPRE alla fifth giusta
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification?.data || {};
  const relativeUrl = data.url || "/";
  const targetUrl = new URL(relativeUrl, "https://what-ifapp.vercel.app").href;

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // se c'è già una tab dell'app, la uso ma NAVIGO alla URL giusta
      for (const client of allClients) {
        if (client.url.startsWith("https://what-ifapp.vercel.app") && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      // altrimenti apro una tab nuova
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })()
  );
});

// ✅ Nessun event "push" extra qui.
// Firebase internamente aggancia il push a onBackgroundMessage.
