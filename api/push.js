// FILE: /api/push.js
// Invia una notifica "frase del giorno" a tutti gli ultimi token salvati
// ⚠️ Data-only: niente campo `notification` → niente doppia notifica

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// Origin dell'app (fisso per evitare problemi con env)
const APP_ORIGIN = "https://what-ifapp.vercel.app";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    // slot = morning / afternoon / evening
    // phase = 1 (WHAT IF) / 2 (WTF) o quello che ti serve
    const { slot = "morning", phase = "1", mood = "" } = req.query || {};

    const safeSlot = ["morning", "afternoon", "evening"].includes(String(slot))
      ? String(slot)
      : "morning";
    const safePhase = String(phase) === "2" ? "2" : "1";
    const safeMood = String(mood || "");

    // URL interno che deve aprirsi nella webapp
    // Esempio: /fifth.html?signal=morning&phase=1&mood=calm
    const signalPath =
      `/fifth.html?signal=${safeSlot}&phase=${safePhase}` +
      (safeMood ? `&mood=${encodeURIComponent(safeMood)}` : "");

    const CLICK_LINK = `${APP_ORIGIN}${signalPath}`;

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200) // margine per tanti utenti
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    // 🔔 Messaggio DATA-ONLY
    const message = {
      data: {
        title: "What?f · frase del giorno",
        body: "La tua frase di oggi è pronta 🔔",

        // per capire in index/fifth da dove arrivi
        src: "signal",
        slot: safeSlot,
        phase: safePhase,
        mood: safeMood,

        // URL interno logico (lo userà firebase-messaging-sw.js)
        url: signalPath,

        // per compatibilità con alcuni browser / SW
        click_action: CLICK_LINK,
      },
      webpush: {
        fcmOptions: {
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
