// FILE: api/push.js
// Invia una notifica "frase del giorno" a tutti gli ultimi token salvati
// ⚠️ Data-only: niente campo `notification` → niente doppia notifica
// ✅ Ora apre direttamente fifth.html in modalità FRASE DEL GIORNO (signal-mode)

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// URL base pubblico della tua app
const APP_URL = "https://what-ifapp.vercel.app";

function normSlot(raw = "") {
  const s = String(raw || "").toLowerCase();
  if (s.includes("after")) return "afternoon";
  if (s.includes("even") || s.includes("night") || s.includes("sera")) return "evening";
  return "morning";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    // 🕒 parametri da cron o da URL manuale
    const { slot: rawSlot = "morning", phase: rawPhase = "1" } = req.query || {};
    const slot = normSlot(rawSlot);
    const phaseNum = Number(rawPhase) === 2 ? 2 : 1; // 1 = WHAT IF, 2 = WTF
    const style = phaseNum === 2 ? "wtf" : "whatif";

    // 🎯 TITOLO / TESTO diversi per mattina/sera & stile
    let title = "What?f · frase del giorno";
    let body = "La tua frase di oggi è pronta 🔔";

    if (slot === "morning" && phaseNum === 1) {
      title = "What?f · segnale del mattino";
      body = "La frase del mattino è pronta 🔔";
    } else if (slot === "evening" && phaseNum === 2) {
      title = "What the F · segnale della sera";
      body = "Il commento cazzaro della sera è pronto 🔔";
    }

    // 🔗 URL verso fifth.html in modalità FRASE DEL GIORNO
    const params = new URLSearchParams({
      signal: slot,          // usato in fifth.html → bootstrapSignalFromUrl
      phase: String(phaseNum), // 1 = WHAT IF, 2 = WTF
      style,                 // whatif / wtf (solo informativo)
      slot,                  // ridondante ma chiaro
      src: "daily_push"      // per analytics / debug
    });

    const relativeUrl = `/fifth.html?${params.toString()}`;
    const CLICK_LINK = `${APP_URL}${relativeUrl}`;

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    // 🔔 Messaggio DATA-ONLY
    const message = {
      data: {
        title,
        body,

        // per capire in index/fifth da dove arrivi
        src: "daily_push",

        // URL RELATIVO usato dal tuo sw.js (che lo normalizza con location.origin)
        url: relativeUrl,

        // URL ASSOLUTO per compat con firebase-messaging-sw.js
        click_action: CLICK_LINK,

        // meta utili se vuoi usarle in futuro
        slot,
        phase: String(phaseNum),
        style
      },
      webpush: {
        fcmOptions: {
          // per alcuni browser il link principale è questo
          link: CLICK_LINK
        }
      },
      tokens
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      sent: resp.successCount,
      failed: resp.failureCount,
      slot,
      phase: phaseNum,
      style
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
