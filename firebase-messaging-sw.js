// FILE: firebase-messaging-sw.js
// Service Worker per le notifiche push Firebase Cloud Messaging (FCM)

importScripts("https://www.gstatic.com/firebasejs/12.6.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging-compat.js");

// Stessa config del tuo firebase.init.js
firebase.initializeApp({
  apiKey: "AIzaSyAeWhmo9BtwWUVVeBxwJKUgLODMDQNUZTE",
  authDomain: "whatif-oracolo-bc15d.firebaseapp.com",
  projectId: "whatif-oracolo-bc15d",
  storageBucket: "whatif-oracolo-bc15d.firebasestorage.app",
  messagingSenderId: "857481137283",
  appId: "1:857481137283:web:ff8f766d14392835cf5fb6",
});

const messaging = firebase.messaging();

// Messaggi in background → mostriamo una notifica “normale”
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Messaggio in background:", payload);

  const notificationTitle =
    (payload.notification && payload.notification.title) ||
    "What?f";

  const notificationBody =
    (payload.notification && payload.notification.body) ||
    "Hai un nuovo messaggio da What?f";

  // click_action passato dal server (api/push.js)
  const clickAction =
    (payload.data && payload.data.click_action) ||
    "https://what-ifapp.vercel.app/?src=daily_push";

  const notificationOptions = {
    body: notificationBody,
    icon: "/icon-192.png",
    badge: "/icon-72.png",
    data: {
      click_action: clickAction,
      ...payload.data,
    },
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Click sulla notifica
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    (event.notification.data && event.notification.data.click_action) ||
    "https://what-ifapp.vercel.app/?src=daily_push";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Se esiste già una finestra di What?f → la NAVIGO verso targetUrl e poi la metto in focus
      if (clientList.length > 0) {
        const client = clientList[0];
        // usa navigate per cambiare pagina nella stessa scheda
        if ("navigate" in client) {
          return client.navigate(targetUrl).then(() => client.focus());
        } else {
          // fallback: focus + nuova finestra
          client.focus();
          return clients.openWindow(targetUrl);
        }
      }

      // Nessuna finestra aperta → apro una nuova scheda/finestra su targetUrl
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
