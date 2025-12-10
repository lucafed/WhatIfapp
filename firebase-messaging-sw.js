// FILE: firebase-messaging-sw.js
// Service Worker unico per What?f
// - niente cache
// - gestisce le push FCM (data-only)
// - click notifica → apre la PWA / pagina giusta

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// PUSH da FCM (data-only)
self.addEventListener("push", (event) => {
  let data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    data = {};
  }

  const title = data.title || "What?f · frase del giorno";
  const body =
    data.body ||
    "La tua frase di oggi è pronta 🔔";

  // URL da aprire al tap
  let url = data.click_action || data.url || "/?src=daily_push";

  try {
    const u = new URL(url, self.location.origin);
    url = u.toString();
  } catch (e) {
    url = self.location.origin + "/?src=daily_push";
  }

  const options = {
    body,
    // metti qui il path giusto della tua icona (se è in /public, l’URL è /icon-192.png)
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      url,
      src: data.src || "daily_push"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click sulla notifica
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  let targetUrl = notifData.url || "/";

  try {
    const u = new URL(targetUrl, self.location.origin);
    targetUrl = u.toString();
  } catch (e) {
    targetUrl = self.location.origin + "/";
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        if (clientList && clientList.length > 0) {
          const sameOriginClient =
            clientList.find((c) => (c.url || "").startsWith(self.location.origin)) ||
            clientList[0];

          if (sameOriginClient.navigate) {
            sameOriginClient.navigate(targetUrl);
          }

          return sameOriginClient.focus();
        }

        return self.clients.openWindow(targetUrl);
      })
  );
});
