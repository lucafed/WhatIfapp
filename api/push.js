// FILE: api/push.js
// Notifiche giornaliere senza duplicati
// ➜ Mattina = WHAT IF
// ➜ Sera = WHAT THE F
// ➜ Nessuna notifica FCM automatica (solo data-only)

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// Funzione che crea l’URL corretto
function buildLink(slot) {
  if (slot === "evening") {
    return "https://what-ifapp.vercel.app/fifth.html?signal=evening&style=wtf&slot=evening&src=daily";
  }
  return "https://what-ifapp.vercel.app/fifth.html?signal=morning&style=whatif&slot=morning&src=daily";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const slot = req.query.slot || "morning";
    const link = buildLink(slot);

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    // NOTIFICA DATA-ONLY (niente FCM automatico)
    const message = {
      data: {
        title:
          slot === "evening"
            ? "What the F · frase della sera"
            : "What?f · frase del mattino",

        body:
          slot === "evening"
            ? "La tua frase della sera è pronta 💥"
            : "La tua frase del mattino è qui 🔔",

        src: "daily_push",
        slot,
        style: slot === "evening" ? "wtf" : "whatif",
        url: link,          // il SW usa questo
        click_action: link  // android/web compat
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
