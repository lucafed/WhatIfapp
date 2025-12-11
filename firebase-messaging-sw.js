// FILE: /firebase-messaging-sw.js
// Service Worker dedicato a Firebase Messaging (notifiche push)

importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js");

// 🔹 STESSA CONFIG DI firebase.init.js
firebase.initializeApp({
  apiKey: "AIzaSyAeWhmo9BtwWUVVeBxwJKUgLODMDQNUZTE",
  authDomain: "whatif-oracolo-bc15d.firebaseapp.com",
  projectId: "whatif-oracolo-bc15d",
  storageBucket: "whatif-oracolo-bc15d.firebasestorage.app",
  messagingSenderId: "857481137283",
  appId: "1:857481137283:web:ff8f766d14392835cf5fb6"
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
    icon: "/icon-192.png",   // icona già presente nel root
    badge: "/icon-192.png",  // opzionale
    data: notifData
  };

  self.registration.showNotification(title, options);
});

/**
 * 2) CLICK SULLA NOTIFICA
 *    - chiude la notifica
 *    - apre SEMPRE una nuova tab sulla URL giusta
 *      (es: /fifth.html?signal=...&phase=...)
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetPath = data.url || "/";

  const absoluteUrl = targetPath.startsWith("http")
    ? targetPath
    : new URL(targetPath, self.location.origin).href;

  // ✅ SEMPLICE: nuova finestra/tab sempre sulla pagina giusta
  event.waitUntil(
    clients.openWindow(absoluteUrl)
  );
});
