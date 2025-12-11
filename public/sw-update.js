<script>
(function () {
  if (!("serviceWorker" in navigator)) return;

  function showUpdateBar(onUpdate) {
    let bar = document.getElementById("updateBar");
    if (bar) return;

    bar = document.createElement("div");
    bar.id = "updateBar";
    bar.style.cssText = `
      position:fixed; left:12px; right:12px; bottom:12px; z-index:99999;
      background:rgba(20,24,28,.92); color:#E6EEF2; border:1px solid rgba(255,255,255,.12);
      border-radius:14px; padding:12px; display:flex; gap:10px; align-items:center;
      box-shadow:0 12px 28px rgba(0,0,0,.35); backdrop-filter:blur(8px);
      font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    `;
    bar.innerHTML = `
      <div style="flex:1; font-weight:700">Nuova versione disponibile</div>
      <button id="updNow" style="
        appearance:none; border:0; border-radius:12px; padding:10px 14px; font-weight:800;
        background:linear-gradient(180deg,#1C57A0,#FFEC01); color:#0A0E12; cursor:pointer;">
        Aggiorna
      </button>
    `;
    document.body.appendChild(bar);

    const btn = document.getElementById("updNow");
    if (btn) {
      btn.addEventListener("click", onUpdate);
    }
  }

  function askSkipWaiting(sw) {
    if (!sw) return;
    sw.postMessage({ type: "SKIP_WAITING" });
  }

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });

  async function register() {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");

      // Se c'è già un worker in stato "waiting" → mostra subito la barra
      if (reg.waiting) {
        showUpdateBar(() => askSkipWaiting(reg.waiting));
      }

      // Quando arriva un nuovo SW
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;

        sw.addEventListener("statechange", () => {
          // Nuovo SW installato e c'è già un controller → versione nuova pronta
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBar(() => askSkipWaiting(reg.waiting || sw));
          }
        });
      });

      // Controlla aggiornamenti ogni 30 minuti
      setInterval(() => {
        reg.update().catch(() => {});
      }, 30 * 60 * 1000);
    } catch (e) {
      // silenzioso, niente alert
      console.warn("SW register error:", e);
    }
  }

  register();
})();
</script>
