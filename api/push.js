// FILE: api/push.js
// Invia una notifica "frase del giorno" a tutti gli ultimi token salvati
// ⚠️ DATA-ONLY: niente campo `notification` → niente doppia notifica automatica FCM

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// Dominio base della tua app
const BASE_URL = "https://what-ifapp.vercel.app";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    // slot=morning|afternoon|evening  ·  phase=1 (WHAT IF) | 2 (WTF)
    const { slot = "morning", phase = "1" } = req.query || {};

    const safeSlot = ["morning", "afternoon", "evening"].includes(
      String(slot).toLowerCase()
    )
      ? String(slot).toLowerCase()
      : "morning";

    const safePhase = String(phase) === "2" ? "2" : "1"; // 1 = whatif, 2 = wtf

    // Path interno verso la UI giornaliera (fifth in modalità signal-mode)
    const clickPath = `/fifth.html?signal=${safeSlot}&phase=${safePhase}&src=daily_push`;
    const CLICK_LINK = `${BASE_URL}${clickPath}`;

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    // Testo leggermente diverso tra mattino (whatif) e sera (wtf)
    const title =
      safePhase === "1"
        ? "What?f · frase del giorno"
        : "What the F · frase del giorno";

    const body =
      safePhase === "1"
        ? "La frase del mattino è pronta 🔔"
        : "La frase della sera è pronta 🔔";

    // 🔔 Messaggio DATA-ONLY (niente notification → nessuna notifica automatica)
    const message = {
      data: {
        title,
        body,

        // per la logica interna della web app
        src: "daily_push",
        slot: safeSlot,
        phase: safePhase,

        // URL relativo che il SW convertirà in assoluto
        url: clickPath,
        // compat + fallback per alcuni ambienti
        click_action: CLICK_LINK
      },
      webpush: {
        fcmOptions: {
          // usato da FCM solo come "link di apertura" di default
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
      slot: safeSlot,
      phase: safePhase,
      link: CLICK_LINK,
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
