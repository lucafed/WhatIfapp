// FILE: api/push.js
// Invia una notifica "frase del giorno" a tutti gli ultimi token salvati
// ⚠️ Data-only: niente campo `notification` → niente doppia notifica

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

    // 🔔 Messaggio DATA-ONLY
    const message = {
      data: {
        // Questi li usiamo nel service worker / app se vogliamo
        title: "What?f · frase del giorno",
        body: "La tua frase di oggi è pronta 🔔",

        // per capire in index.html da dove arrivi
        src: "daily_push",

        // URL “logico” interno (lo usi se ti serve nel client)
        url: "/?src=daily_push",

        // per compatibilità con alcuni browser / SW
        click_action: CLICK_LINK
      },
      webpush: {
        fcmOptions: {
          // per sicurezza: link usato da FCM lato browser
          link: CLICK_LINK
        }
      },
      tokens
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      sent: resp.successCount,
      failed: resp.failureCount
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
