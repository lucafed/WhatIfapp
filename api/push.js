// FILE: api/push.js
// Invia una notifica "frase del giorno" agli ultimi token salvati
// ⚠️ Data-only: niente campo `notification` → niente doppia notifica browser+SW

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    // 👉 slot & phase arrivano dalla query (es. /api/push?slot=morning&phase=1)
    const { slot = "morning", phase = "1" } = req.query || {};

    // signal = morning | afternoon | evening → quello che si aspetta fifth.html
    const signal = String(slot).toLowerCase();
    const phaseStr = String(phase);

    // 👉 URL interno logico per la pagina "frase del giorno"
    //    fifth.html userà signal + phase per capire stile (whatif / wtf) e fascia oraria
    const PATH = `/fifth.html?signal=${encodeURIComponent(
      signal
    )}&phase=${encodeURIComponent(phaseStr)}&src=daily_push`;

    // URL assoluto (usato da alcuni browser e come fallback)
    const CLICK_LINK = `https://what-ifapp.vercel.app${PATH}`;

    // 🔍 Prendiamo gli ultimi N token registrati
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    const isEvening = phaseStr === "2";

    // Titolo / corpo diversi tra mattina (WHAT IF) e sera (WHAT THE F)
    const title = isEvening
      ? "What the F · frase di stasera"
      : "What?f · frase del giorno";

    const body = isEvening
      ? "Chiudiamo la giornata con il lato cazzaro 🍷"
      : "La tua frase di oggi è pronta 🔔";

    // 🔔 Messaggio DATA-ONLY per FCM Web
    const message = {
      data: {
        // Campi letti dal service worker
        title,
        body,
        src: "daily_push",
        slot: signal,
        phase: phaseStr,

        // URL interno che il SW userà per aprire la pagina giusta
        url: PATH,

        // Per compatibilità con alcuni browser / SW
        click_action: CLICK_LINK,
      },
      webpush: {
        fcmOptions: {
          // Alcuni client usano direttamente questo link
          link: CLICK_LINK,
        },
      },
      tokens,
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      sent: resp.successCount,
      failed: resp.failureCount,
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
