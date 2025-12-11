// FILE: /firebase-messaging-sw.js

importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js");

// 🔹 STESSA CONFIG DI firebase.init.js
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
 * 1) MESSAGGIO IN BACKGROUND
 *    - Arriva la push data-only da /api/push
 *    - Costruiamo noi la notifica
 */
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw] onBackgroundMessage", payload);
  const data = payload?.data || {};

  const title = data.title || "What?f · frase del giorno";
  const body = data.body || "La tua frase di oggi è pronta 🔔";

  const notifData = {
    // es: "/fifth.html?signal=morning&phase=1&mood=..."
    url: data.url || "/",
    src: data.src || "signal",
    slot: data.slot || "",
    phase: data.phase || "",
    mood: data.mood || ""
  };

  const options = {
    body,
    icon: "/icon-192.png",            // adatta se hai altri path
    badge: "/icon-192.png",           // opzionale
    data: notifData
  };

  self.registration.showNotification(title, options);
});

/**
 * 2) CLICK SULLA NOTIFICA
 *    - chiude la notifica
 *    - se c'è già una finestra dell'app → focus + navigate(url)
 *    - se non c'è → apre una nuova finestra su url
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

      // Se c'è già una tab dell'app, usiamo quella
      for (const client of allClients) {
        if (client.url.startsWith(self.location.origin)) {
          try {
            await client.focus();
            await client.navigate(absoluteUrl);
          } catch (e) {
            await clients.openWindow(absoluteUrl);
          }
          return;
        }
      }

      // Nessuna tab aperta → nuova finestra
      await clients.openWindow(absoluteUrl);
    })()
  );
});
