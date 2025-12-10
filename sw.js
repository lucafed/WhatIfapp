// FILE: /sw.js
// Service Worker ufficiale What?f
// Gestisce SOLO notifiche data-only

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch {}

  const title = data.title || "What?f";
  const body = data.body || "Hai un nuovo messaggio";
  let url = data.url || "/";

  try {
    url = new URL(url, self.location.origin).toString();
  } catch {
    url = self.location.origin;
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url }
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(list => {
        for (const c of list) {
          if (c.url.startsWith(self.location.origin)) {
            c.navigate(target);
            return c.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
