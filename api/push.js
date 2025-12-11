// FILE: /api/push.js
import admin from "../firebase-admin-server.js";

const db = admin.firestore();
const APP_ORIGIN = "https://what-ifapp.vercel.app";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { slot = "morning", phase = "1", mood = "" } = req.query || {};

    const safeSlot = ["morning", "afternoon", "evening"].includes(String(slot))
      ? String(slot)
      : "morning";
    const safePhase = String(phase) === "2" ? "2" : "1";
    const safeMood = String(mood || "");

    const signalPath =
      `/fifth.html?signal=${safeSlot}&phase=${safePhase}` +
      (safeMood ? `&mood=${encodeURIComponent(safeMood)}` : "");

    const CLICK_LINK = `${APP_ORIGIN}${signalPath}`;

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    // 🔔 MESSAGGIO SOLO DATA (no `notification`, no `webpush.notification`)
    const message = {
      data: {
        title: "What?f · frase del giorno",
        body: "La tua frase di oggi è pronta 🔔",

        src: "signal",
        slot: safeSlot,
        phase: safePhase,
        mood: safeMood,

        url: signalPath,

        // opzionale, info in più, ma NON decide il click
        click_action: CLICK_LINK
      },
      tokens
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      sent: resp.successCount,
      failed: resp.failureCount
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
