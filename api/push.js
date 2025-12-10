// FILE: api/push.js
// Invia una notifica "frase del giorno" a tutti i token registrati

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// URL aperto quando l’utente tocca la notifica ✅
const CLICK_LINK = "https://what-ifapp.vercel.app/?src=daily_push";

export default async function handler(req, res) {
  // Puoi chiamarlo sia in GET che in POST
  if (req.method !== "GET" && req.method !== "POST") {
    return res
      .status(405)
      .json({ ok: false, error: "method_not_allowed" });
  }

  try {
    // Leggo gli ultimi token salvati (max 500 per sicurezza)
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();

    if (snap.empty) {
      return res.status(200).json({
        ok: false,
        error: "no_tokens",
      });
    }

    const tokens = snap.docs.map((d) => d.id);

    // Titolo e testo (puoi sovrascriverli via body JSON in POST)
    const { title, body } =
      (req.method === "POST" && req.body) || {};

    const notifTitle =
      title || "What?f · frase del giorno";
    const notifBody =
      body ||
      "Funziona! Questa è una notifica di test 🔔";

    const message = {
      tokens,
      notification: {
        title: notifTitle,
        body: notifBody,
      },
      // Dati extra per il client (se ti servono in futuro)
      data: {
        src: "daily_push",
      },
      webpush: {
        fcmOptions: {
          // 👉 quando tocchi la notifica apre questo link
          link: CLICK_LINK,
        },
        notification: {
          icon: "/icon-192.png",
          badge: "/icon-192.png",
        },
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
