// FILE: api/push.js
// Invia notifiche FCM ai token salvati in Firestore.
// Uso base per test:
//   https://what-ifapp.vercel.app/api/push?type=test

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// URL della tua web app (RELEASE)
const APP_URL = "https://what-ifapp.vercel.app/";

// messaggi predefiniti in base al tipo
const PRESETS = {
  test: {
    title: "What?f · frase del giorno",
    body: "Funziona! Questa è una notifica di test 🔔",
  },
  // qui in futuro possiamo aggiungere:
//  morning: { ... },
//  afternoon: { ... },
//  evening: { ... },
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ ok: false, error: "method_not_allowed" });
  }

  try {
    // tipo di notifica: ?type=test (default)
    const type = (req.query.type || "test").toString();
    const slot = (req.query.slot || "").toString();

    const preset = PRESETS[type] || PRESETS.test;
    const title = preset.title;
    const body = preset.body;

    // prendo gli ultimi 100 token salvati
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    if (snap.empty) {
      return res
        .status(200)
        .json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    const message = {
      notification: { title, body },
      tokens,
      data: {
        type,
        slot,
        // URL dove aprire l'app quando l'utente tocca la notifica
        // se vuoi mandare direttamente alla pagina risultato:
        // click_action: APP_URL + "fifth.html",
        click_action: APP_URL,
      },
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      sent: resp.successCount,
      failed: resp.failureCount,
    });
  } catch (err) {
    console.error("push error", err);
    return res
      .status(500)
      .json({ ok: false, error: "server_error" });
  }
}
