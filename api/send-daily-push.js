// FILE: api/send-daily-push.js
// Invia una notifica "frase del giorno" a tutti i token FCM salvati

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

export default async function handler(req, res) {
  // Puoi limitare ai soli cron / GET
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ ok: false, error: "method_not_allowed" });
  }

  try {
    // slot opzionale: ?slot=morning|afternoon|evening
    const slot = (req.query.slot || "morning").toString();

    let title = "What?f · frase del giorno";
    let body = "Hai una nuova frase del giorno in What?f ✨";

    if (slot === "morning") {
      title = "What?f · sveglia la giornata";
      body = "È pronta la frase del mattino. Fatti un check con What?f ☕";
    } else if (slot === "afternoon") {
      title = "What?f · giro di boa";
      body = "Frase del pomeriggio: 30 secondi per rimettere a fuoco la giornata 🔁";
    } else if (slot === "evening") {
      title = "What?f · chiusura di giornata";
      body = "Frase della sera pronta. Chiudi la giornata con un pensiero sensato (o quasi) 🌙";
    }

    // Prendiamo gli ultimi 500 token salvati (basta per ora)
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();

    if (snap.empty) {
      return res
        .status(200)
        .json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    const message = {
      notification: {
        title,
        body,
      },
      tokens,
      data: {
        src: "daily-signal",
        slot,
      },
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      slot,
      sent: resp.successCount,
      failed: resp.failureCount,
      totalTokens: tokens.length,
    });
  } catch (err) {
    console.error("send-daily-push error", err);
    return res
      .status(500)
      .json({ ok: false, error: "server_error" });
  }
}
