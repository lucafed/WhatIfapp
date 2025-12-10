// FILE: api/push.js
// Endpoint unico per inviare notifiche FCM (test + daily)

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false });
  }

  try {
    const type = req.query.type || "test"; // test | daily
    const slot = req.query.slot || "morning";

    let title = "What?f";
    let body = "Notifica di test ✅";

    if (type === "daily") {
      if (slot === "morning") {
        title = "What?f · mattino";
        body = "È pronta la frase del giorno ☕";
      } else if (slot === "afternoon") {
        title = "What?f · pomeriggio";
        body = "Mini reset mentale di metà giornata 🔁";
      } else if (slot === "evening") {
        title = "What?f · sera";
        body = "Chiudi la giornata con una frase giusta 🌙";
      }
    }

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    const message = {
      notification: { title, body },
      tokens,
      data: { type, slot },
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      sent: resp.successCount,
      failed: resp.failureCount,
      total: tokens.length,
      type,
      slot,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false });
  }
}
