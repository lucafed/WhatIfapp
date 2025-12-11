// FILE: api/push.js

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// Normalizza slot e phase
function normalizeSlot(raw) {
  const val = String(raw || "").toLowerCase();
  if (val === "afternoon") return "afternoon";
  if (val === "evening") return "evening";
  return "morning";
}

function normalizePhase(raw) {
  return String(raw) === "2" ? 2 : 1;
}

// Testo per la notifica
function buildNotificationBody(slot, phase) {
  if (slot === "morning" && phase === 1) {
    return "Buongiorno: metti a fuoco una cosa che conta oggi e falla succedere. Vuoi chiedere o rispondere?";
  }
  if (slot === "evening" && phase === 2) {
    return "Giornata finita: com’è andata davvero? Puoi chiedere o rispondere qui.";
  }
  return "La tua frase di oggi è pronta 🔔";
}

function buildNotificationTitle(phase) {
  return phase === 1
    ? "What if · frase del giorno"
    : "What the F · frase del giorno";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { slot: rawSlot, phase: rawPhase } = req.query || {};
    const slot = normalizeSlot(rawSlot);
    const phase = normalizePhase(rawPhase);

    const CLICK_LINK = `https://what-ifapp.vercel.app/fifth.html?signal=${slot}&phase=${phase}&src=daily_push`;

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    const title = buildNotificationTitle(phase);
    const body = buildNotificationBody(slot, phase);

    const message = {
      notification: { title, body },
      data: {
        src: "daily_push",
        signal: slot,
        phase: String(phase),
        url: CLICK_LINK,
        click_action: CLICK_LINK
      },
      webpush: {
        fcmOptions: { link: CLICK_LINK }
      },
      tokens
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      slot,
      phase,
      sent: resp.successCount,
      failed: resp.failureCount,
      click: CLICK_LINK
    });

  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error", details: err.message });
  }
}
