// FILE: api/push.js
// Notifica giornaliera DATA-ONLY (NO notification)
// → gestita SOLO dal Service Worker

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

function normalizeSlot(raw) {
  const v = String(raw || "").toLowerCase();
  if (v === "afternoon") return "afternoon";
  if (v === "evening") return "evening";
  return "morning";
}

function normalizePhase(raw) {
  return String(raw) === "2" ? 2 : 1; // 1 = What if | 2 = What the F
}

function buildTitle(phase) {
  return phase === 1
    ? "What if · frase del giorno"
    : "What the F · frase del giorno";
}

function buildBody(slot, phase) {
  if (slot === "morning" && phase === 1)
    return "Buongiorno. Una cosa conta oggi: guardala in faccia. Vuoi chiedere o rispondere?";
  if (slot === "evening" && phase === 2)
    return "Giornata finita. O quasi. Raccontala prima che ti resti addosso.";

  return phase === 1
    ? "Un segnale per oggi. Vuoi chiedere o rispondere?"
    : "Commento non richiesto. Ma necessario.";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false });
  }

  try {
    const slot = normalizeSlot(req.query?.slot);
    const phase = normalizePhase(req.query?.phase);

    const CLICK_URL =
      `https://what-ifapp.vercel.app/fifth.html` +
      `?signal=${slot}&phase=${phase}&src=daily_push`;

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map(d => d.id);

    // ✅ DATA ONLY
    const message = {
      data: {
        title: buildTitle(phase),
        body: buildBody(slot, phase),
        url: CLICK_URL,
        signal: slot,
        phase: String(phase),
        src: "daily_push"
      },
      tokens
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      sent: resp.successCount,
      failed: resp.failureCount,
      url: CLICK_URL
    });
  } catch (e) {
    console.error("push error:", e);
    return res.status(500).json({ ok: false });
  }
}
