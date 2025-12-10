// FILE: api/send-test-push.js
// Invia una notifica di test a tutti gli ultimi token salvati

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    if (snap.empty) {
      return res
        .status(200)
        .json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    const message = {
      notification: {
        title: "What?f · frase del giorno",
        body: "Funziona! Questa è una notifica di test 🔔",
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
    console.error("send-test-push error", err);
    return res
      .status(500)
      .json({ ok: false, error: "server_error" });
  }
}
