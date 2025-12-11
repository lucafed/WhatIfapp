// FILE: /public/sw-update.js
// Controlla eventuali aggiornamenti del Service Worker
// ma NON mostra nessuna notifica di sistema.

// Se vuoi, qui puoi solo loggare in console.

(function () {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker
    .getRegistration()
    .then((reg) => {
      if (!reg) return;
      // Se arriva una nuova versione, ci limitiamo a loggare.
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed") {
            // Prima qui c'era la notifica
            console.log("[sw-update] Nuova versione di What?f installata in background.");
          }
        });
      });
    })
    .catch((err) => {
      console.warn("[sw-update] errore nel controllo aggiornamenti:", err);
    });
})();
