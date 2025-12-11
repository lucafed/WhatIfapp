/* FILE: firebase-messaging-sw.js */
/* Service worker FCM per What?f — gestisce SOLO le notifiche push */

importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js");

// 🔹 METTI QUI LA TUA CONFIG (quella che hai già in progetto)
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
 * Qui costruiamo noi la notifica e passiamo dentro TUTTI i dati utili
 * (soprattutto `data.url`) così il click handler sa dove portarti.
 */
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw] onBackgroundMessage", payload);

  const data = payload.data || {};

  const title = data.title || "What?f · frase del giorno";
  const body = data.body || "La tua frase di oggi è pronta 🔔";

  // ⚠️ QUI è la chiave: mettiamo `data.url` dentro `notification.data`
  const notifData = {
    url: data.url || "/", // es: "/fifth.html?signal=morning&phase=1"
    src: data.src || "signal",
    slot: data.slot || "",
    phase: data.phase || "",
    mood: data.mood || ""
  };

  const options = {
    body,
    icon: "/icons/icon-192.png",   // adatta al tuo path
    badge: "/icons/badge-72.png",  // opzionale
    data: notifData
  };

  self.registration.showNotification(title, options);
});

/**
 * CLICK NOTIFICATION
 * Quando tocchi la notifica:
 * - chiude la notifica
 * - cerca una finestra aperta della webapp
 * - la porta su `data.url` (fifth.html?signal=...)
 *   oppure apre una nuova tab su quell’URL
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetPath = data.url || "/"; // relativo (es. "/fifth.html?signal=morning&phase=1")

  // Costruiamo URL assoluto rispetto all'origine del SW
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
        // Prendo la prima finestra dell’app e la porto SULL’URL desiderato
        const client = allClients[0];
        try {
          await client.focus();
          await client.navigate(absoluteUrl);
        } catch (e) {
          // fallback
          await clients.openWindow(absoluteUrl);
        }
        return;
      }

      // Nessuna finestra aperta → ne apro una nuova direttamente lì
      await clients.openWindow(absoluteUrl);
    })()
  );
});
