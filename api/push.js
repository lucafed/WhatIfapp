// FILE: api/push.js
// Invia notifica giornaliera con link a fifth.html in modalità frase del giorno

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

function normalizeSlot(raw) {
  const v = String(raw || "").toLowerCase();
  if (v === "afternoon") return "afternoon";
  if (v === "evening") return "evening";
  return "morning";
}

function normalizePhase(raw) {
  return raw === "2" ? 2 : 1;
}

function buildNotificationBody(slot, phase) {
  if (slot === "morning" && phase === 1)
    return "Buongiorno: metti a fuoco una cosa che conta oggi e falla succedere.";
  if (slot === "evening" && phase === 2)
    return "Giornata finita: dimmi com’è andata davvero o chiedi qualcosa.";
  return "La frase del giorno è pronta 🔔";
}

function buildNotificationTitle(phase) {
  return phase === 1
    ? "What if · frase del giorno"
    : "What the F · frase del giorno";
}

export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    const slot = normalizeSlot(req.query.slot);
    const phase = normalizePhase(req.query.phase);

    // URL che deve aprirsi
    const LINK = `https://what-ifapp.vercel.app/fifth.html?signal=${slot}&phase=${phase}&src=daily_push`;

    // Recupera gli ultimi 200 tokens
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    if (snap.empty)
      return res.status(200).json({ ok: false, error: "no_tokens" });

    const tokens = snap.docs.map((d) => d.id);

    const message = {
      notification: {
        title: buildNotificationTitle(phase),
        body: buildNotificationBody(slot, phase),
      },
      data: {
        src: "daily_push",
        signal: slot,
        phase: String(phase),
        url: LINK,
        click_action: LINK
      },
      webpush: {
        fcmOptions: {
          link: LINK
        }
      },
      tokens
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    res.status(200).json({
      ok: true,
      slot,
      phase,
      sent: resp.successCount,
      failed: resp.failureCount,
      click: LINK
    });

  } catch (err) {
    console.error("push error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
}
