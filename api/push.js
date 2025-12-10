// FILE: api/push.js
// Invia una notifica (giornaliera / di test) a tutti gli ultimi token salvati

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// URL da aprire quando l’utente tocca la notifica
const CLICK_LINK = "https://what-ifapp.vercel.app/";

export default async function handler(req, res) {
  // Se il cron di Vercel usa GET, lasciamo GET
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ ok: false, error: "method_not_allowed" });
  }

  try {
    // Prendiamo gli ultimi token registrati
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(500) // puoi abbassare se vuoi
      .get();

    if (snap.empty) {
      return res
        .status(200)
        .json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    // 👇 Testo della notifica (poi lo cambieremo con quelle “vere”)
    const title = "What?f · frase del giorno";
    const body  = "Hey, c’è una nuova frase del giorno che ti aspetta 🔔";

    const message = {
      notification: {
        title,
        body,
      },

      // 👇 Importante per il click su WEB
      webpush: {
        fcmOptions: {
          // URL che il browser deve aprire quando tocchi la notifica
          link: CLICK_LINK,
        },
        notification: {
          icon: "/icon-192.png",
          badge: "/icon-192.png",
        },
      },

      // 👇 Dati extra, usati anche dal service worker (notificationclick)
      data: {
        click_action: CLICK_LINK,
        type: "daily_phrase",
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
    console.error("push.js error", err);
    return res
      .status(500)
      .json({ ok: false, error: "server_error" });
  }
}
