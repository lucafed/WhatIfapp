// FILE: api/push.js
// Invia una notifica "frase del giorno" a tutti i token salvati
// Usa query: ?slot=morning|afternoon|evening & phase=1|2

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

function normalizeSlot(raw) {
  const v = String(raw || "").toLowerCase();
  if (v === "afternoon") return "afternoon";
  if (v === "evening") return "evening";
  return "morning";
}

function normalizePhase(raw) {
  return String(raw) === "2" ? 2 : 1; // 1 = What if, 2 = What the F
}

function buildNotificationBody(slot, phase) {
  if (slot === "morning" && phase === 1) {
    return "Buongiorno: metti a fuoco una cosa che conta oggi e falla succedere. Vuoi chiedere o rispondere?";
  }
  if (slot === "evening" && phase === 2) {
    return "Giornata finita: dimmi com’è andata davvero o chiedi qualcosa, così non te la porti a letto.";
  }
  if (slot === "afternoon" && phase === 1) {
    return "Pomeriggio a metà: com’è l’umore ora? Se vuoi, chiedi o racconta cosa sta andando storto o sorprendentemente bene.";
  }
  if (slot === "afternoon" && phase === 2) {
    return "Metà giornata, metà pazienza: sfogati o chiedi qualcosa, prima che ti ritrovi a urlare al muro.";
  }

  if (phase === 1) {
    return "Frase del giorno di What if: un passo concreto oggi, non domani. Vuoi chiedere o rispondere adesso?";
  }
  return "Commento cazzaro di What the F sulla tua giornata. Vuoi dirgli la tua o fargli una domanda?";
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
    const rawSlot = (req.query && req.query.slot) || "morning";
    const rawPhase = (req.query && req.query.phase) || "1";

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

    // ⚠️ DATA-ONLY: niente `notification` → la notifica la mostra SOLO il SW (1 volta)
    const message = {
      data: {
        title,
        body,
        src: "daily_push",
        signal: slot,
        phase: String(phase),
        url: CLICK_LINK,
        click_action: CLICK_LINK
      },
      webpush: {
        fcmOptions: {
          link: CLICK_LINK
        }
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
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
