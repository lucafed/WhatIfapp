// FILE: api/push.js
import admin from "../firebase-admin-server.js";

const db = admin.firestore();

function normalizeSlot(raw) {
  const v = String(raw || "").toLowerCase();
  if (v === "evening") return "evening";
  if (v === "afternoon") return "afternoon";
  return "morning";
}

function normalizePhase(raw) {
  return String(raw) === "2" ? 2 : 1;
}

function titleFor(phase) {
  return phase === 1
    ? "What if · frase del giorno"
    : "What the F · frase del giorno";
}

function bodyFor(slot, phase) {
  if (slot === "morning" && phase === 1)
    return "Buongiorno. Un passo vero oggi cambia la giornata. Vuoi parlarne?";
  if (slot === "evening" && phase === 2)
    return "Fine giornata. Raccontami com’è andata davvero.";
  return "Frase del giorno. Vuoi chiedere o rispondere?";
}

export default async function handler(req, res) {
  try {
    const slot = normalizeSlot(req.query.slot);
    const phase = normalizePhase(req.query.phase);

    const CLICK_URL =
      `https://what-ifapp.vercel.app/fifth.html` +
      `?signal=${slot}&phase=${phase}&src=daily_push`;

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();

    if (snap.empty) {
      return res.json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map(d => d.id);

    const message = {
      // ✅ SOLO DATA — Chrome NON deve intervenire
      data: {
        title: titleFor(phase),
        body: bodyFor(slot, phase),
        url: CLICK_URL,
        src: "daily_push"
      },
      tokens
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    res.json({
      ok: true,
      sent: resp.successCount,
      failed: resp.failureCount,
      url: CLICK_URL
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
}
