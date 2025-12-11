// FILE: /firebase-messaging-sw.js
// Service Worker SOLO per le notifiche FCM (Web Push)

// 👉 NIENTE logica di cache qui, niente fetch handler.
// Tutto il resto (install/activate generici) puoi tenerlo in sw.js.

importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

// ⚠️ METTI QUI LA TUA CONFIG DI FIREBASE (la stessa che usi in firebase.init.js)
firebase.initializeApp({
  apiKey: "XXX",
  authDomain: "XXX",
  projectId: "XXX",
  messagingSenderId: "XXX",
  appId: "XXX",
});

const messaging = firebase.messaging();

// 🔔 BACKGROUND MESSAGE → MOSTRA UNA SOLA NOTIFICA, DATA-ONLY
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};

  const title =
    data.title || "What?f · frase del giorno";
  const body =
    data.body || "La tua frase di oggi è pronta 🔔";

  // URL che vogliamo aprire (fifth in modalità signal)
  // es: /fifth.html?signal=morning&phase=1
  const urlFromData = data.url || "/";

  const options = {
    body,
    icon: "/icons/icon-192.png",    // se li hai, altrimenti commenta
    badge: "/icons/badge-72.png",   // se li hai, altrimenti commenta
    data: {
      // ci salviamo l’URL per il click
      url: urlFromData,
      ...data,
    },
  };

  self.registration.showNotification(title, options);
});

// 🔗 CLICK NOTIFICA → APRI O FOCALIZZA FIFTH.HTML?signal=...
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetUrl = data.url || "/";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Se esiste già una tab della nostra origin, la riuso
      for (const client of allClients) {
        if (!client.url.startsWith(self.location.origin)) continue;

        // Se è già sulla stessa pagina, focus e basta
        if (client.url.includes(targetUrl)) {
          await client.focus();
          return;
        }

        // Altrimenti la navigo alla fifth
        try {
          await client.navigate(targetUrl);
        } catch (e) {
          // alcuni browser non supportano navigate: ripieghiamo su openWindow
          return clients.openWindow(targetUrl);
        }
        await client.focus();
        return;
      }

      // Nessuna finestra aperta → ne apro una nuova
      return clients.openWindow(targetUrl);
    })()
  );
});
