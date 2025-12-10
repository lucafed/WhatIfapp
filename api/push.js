// FILE: api/push.js
// Invia una notifica di "frase del giorno" a tutti gli ultimi token salvati

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// URL che deve aprirsi quando l'utente tappa la notifica
const CLICK_LINK = "https://what-ifapp.vercel.app/?src=daily_push";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200) // margine per tanti utenti
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    const message = {
      notification: {
        title: "What?f · frase del giorno",
        body: "Funziona! Questa è una notifica di test 🔔",
      },
      // 👇 qui salviamo il link dentro i dati della notifica
      data: {
        click_action: CLICK_LINK,
        src: "daily_push",
      },
      webpush: {
        fcmOptions: {
          // 👇 per sicurezza, anche qui
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
