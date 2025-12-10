// FILE: /sw.js
// Service Worker per What?f
// - Niente cache / fetch → niente rischi di pagina nera
// - Gestione notifiche FCM data-only
// - Click sulla notifica → apre / porta alla PWA con l'URL giusto

// 🔹 Attiva subito la nuova versione
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// 🔹 Prende il controllo di tutte le pagine aperte
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ✅ NIENTE fetch handler → lasciamo gestire tutto a Chrome
// (se mettiamo cache e sbagliamo qualcosa, tornano le schermate nere)


// 🔔 PUSH: mostrata da questo SW (messaggio data-only da FCM)
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

  // URL da aprire quando l’utente tappa la notifica
  // priorità: click_action (pieno) → url (relativo) → fallback
  let url = data.click_action || data.url || "/?src=daily_push";

  // se è relativo, lo trasformiamo in assoluto rispetto all’origin
  try {
    const u = new URL(url, self.location.origin);
    url = u.toString();
  } catch (e) {
    url = self.location.origin + "/?src=daily_push";
  }

  const options = {
    body,
    icon: "/public/icon-192.png",
    badge: "/public/icon-192.png",
    data: {
      url,
      src: data.src || "daily_push"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 🔔 Click sulla notifica
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  let targetUrl = notifData.url || "/";

  // normalizza anche qui
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
        // 1️⃣ Se c'è già una finestra dell'app, la riutilizziamo
        if (clientList && clientList.length > 0) {
          // prova a prendere un client sullo stesso origin
          const sameOriginClient =
            clientList.find((c) => c.url.startsWith(self.location.origin)) ||
            clientList[0];

          // naviga alla URL della notifica (es. https://…/?src=daily_push)
          if (sameOriginClient.navigate) {
            sameOriginClient.navigate(targetUrl);
          }

          return sameOriginClient.focus();
        }

        // 2️⃣ Nessuna finestra aperta → apri una nuova
        return self.clients.openWindow(targetUrl);
      })
  );
});
