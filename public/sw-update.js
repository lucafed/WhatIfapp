// FILE: /public/sw-update.js
// Registra /sw.js e gestisce gli aggiornamenti
// ✅ NIENTE Notification API → sparisce la notifica "il sito è stato aggiornato in background"

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("[sw-update] Service Worker registrato:", registration.scope);

        // Quando il browser trova una nuova versione di /sw.js
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed") {
              // 🟢 Qui PRIMA probabilmente mostravi una notifica tipo:
              //    registration.showNotification("Il sito è stato aggiornato in background", ...)
              // Adesso facciamo SOLO un log silenzioso:
              if (navigator.serviceWorker.controller) {
                console.log("[sw-update] Nuova versione di What?f installata in background.");
                // Se vuoi, qui potresti mostrare un banner IN-PAGINA,
                // ma NON una Notification vera.
              } else {
                console.log("[sw-update] Service Worker installato per la prima volta.");
              }
            }
          });
        });
      })
      .catch((err) => {
        console.error("[sw-update] Errore nella registrazione del SW:", err);
      });
  });
}
