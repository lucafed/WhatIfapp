/* FILE: firebase-messaging-sw.js
 * Service worker per notifiche "frase del giorno" (FCM data-only)
 * - NIENTE doppia notifica
 * - click → apre fifth.html con i parametri ricevuti
 */

/* Se usi ancora la versione compat di Firebase (classica): */
importScripts("https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js");

/* ✅ COPIA QUI LO STESSO CONFIG CHE USI IN firebase.init.js */
firebase.initializeApp({
  apiKey: "COPIA_DA_firebase.init.js",
  authDomain: "COPIA_DA_firebase.init.js",
  projectId: "COPIA_DA_firebase.init.js",
  messagingSenderId: "COPIA_DA_firebase.init.js",
  appId: "COPIA_DA_firebase.init.js"
  // se hai measurementId ecc puoi aggiungerli, ma non è obbligatorio per FCM
});

const messaging = firebase.messaging();

/**
 * 1️⃣ Ricezione messaggi in background (DATA ONLY)
 * Qui NON arriva il campo `notification`, solo `data`.
 * Mostriamo NOI una sola notifica.
 */
messaging.onBackgroundMessage((payload) => {
  // payload.data contiene quello che hai mandato da /api/push.js
  const data = payload.data || {};

  const title =
    data.title || "What?f · frase del giorno";

  const options = {
    body: data.body || "La tua frase di oggi è pronta.",
    // Icone opzionali (metti le tue se vuoi)
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",

    // Importantissimo: ci serve per il click
    data: {
      // URL completa (se la mandiamo da server) oppure costruiamo una fallback
      url: data.url || data.click_action || "/",
      slot: data.slot || "morning",
      style: data.style || "whatif",
      src: data.src || "daily_push"
    }
  };

  self.registration.showNotification(title, options);
});

/**
 * 2️⃣ Click sulla notifica
 * - Chiudiamo la notifica
 * - Cerchiamo una tab già aperta con il nostro sito
 * - Se c’è, la mettiamo in focus e la navighiamo all’URL della frase
 * - Se non c’è, apriamo una nuova tab
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetUrl = data.url || "/";

  event.waitUntil(
    (async () => {
      // Prendiamo tutte le finestre/tab aperte del nostro origin
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });

      // Proviamo a riusare una tab esistente
      let matchingClient = null;
      for (const client of allClients) {
        // Se il client è già su questo origin, lo riusiamo
        // (non controllo il path preciso per evitare edge case)
        if (client.url && "focus" in client) {
          matchingClient = client;
          break;
        }
      }

      if (matchingClient) {
        // Se la tab esiste:
        await matchingClient.focus();
        try {
          // proviamo a navigare all’URL della frase del giorno
          matchingClient.navigate(targetUrl);
        } catch (e) {
          // se fallisce, apriamo una nuova finestra
          await clients.openWindow(targetUrl);
        }
      } else {
        // Nessuna tab → apriamo una nuova finestra
        await clients.openWindow(targetUrl);
      }
    })()
  );
});

/**
 * 3️⃣ (Opzionale) Gestione evento "push" puro
 * Nel caso qualche browser passi il messaggio via PushEvent invece che via
 * messaging.onBackgroundMessage, mettiamo un fallback.
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  // Se è già il formato FCM classico con "data", lo usiamo
  const data = payload.data || payload;

  const title =
    data.title || "What?f · frase del giorno";

  const options = {
    body: data.body || "La tua frase di oggi è pronta.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: {
      url: data.url || data.click_action || "/",
      slot: data.slot || "morning",
      style: data.style || "whatif",
      src: data.src || "daily_push"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
