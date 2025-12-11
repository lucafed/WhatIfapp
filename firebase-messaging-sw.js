// FILE: /firebase-messaging-sw.js
// Service worker solo per Firebase Cloud Messaging
// - Usa SOLO onBackgroundMessage (niente event "push")
// - Mostra UNA notifica data-only con link alla frase del giorno
// - Click sulla notifica -> apre /fifth.html?signal=...&phase=...&mood=...

importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

// 🔧 METTI QUI LA *STESSA* CONFIG CHE USI IN firebase.init.js
firebase.initializeApp({
  apiKey: "XXX",
  authDomain: "XXX",
  projectId: "XXX",
  storageBucket: "XXX",
  messagingSenderId: "XXX",
  appId: "XXX",
});

// Istanza messaging (solo per background)
const messaging = firebase.messaging();

// 🔹 Data-only push da /api/push
messaging.onBackgroundMessage((payload) => {
  const data = payload?.data || {};

  const title = data.title || "What?f · frase del giorno";
  const body = data.body || "La tua frase di oggi è pronta 🔔";

  // es: "/fifth.html?signal=morning&phase=1&mood=..."
  const urlFromData = data.url || "/";

  const notificationOptions = {
    body,
    // opzionale: icone se le hai
    // icon: "/icons/icon-192.png",
    // badge: "/icons/badge-72.png",
    data: {
      url: urlFromData,
      slot: data.slot || "",
      phase: data.phase || "",
      mood: data.mood || "",
    },
    tag: `daily-signal-${data.slot || "x"}-${data.phase || "1"}`, // stessa tag → niente doppioni
    renotify: false,
  };

  self.registration.showNotification(title, notificationOptions);
});

// 🔹 Click sulla notifica -> apri SEMPRE fifth.html con i parametri
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notifData = event.notification?.data || {};
  const relativeUrl = notifData.url || "/";
  const targetUrl = new URL(relativeUrl, "https://what-ifapp.vercel.app").href;

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Se c'è già una finestra dell'app, la riuso ma NAVIGO alla pagina giusta
      for (const client of allClients) {
        if (client.url.startsWith("https://what-ifapp.vercel.app") && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      // Altrimenti apro una nuova tab
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })()
  );
});

// ✅ Nessun "push" handler generico qui
// ✅ Nessun altro showNotification fuori da onBackgroundMessage
