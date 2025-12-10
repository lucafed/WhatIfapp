// FILE: api/push.js
import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// 👉 quando clicchi la notifica, si apre questo URL
const CLICK_LINK = "https://what-ifapp.vercel.app/?src=daily_push";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    const { title, body } = (req.method === "POST" && req.body) || {};
    const notifTitle = title || "What?f · frase del giorno";
    const notifBody  = body  || "Funziona! Questa è una notifica di test 🔔";

    const message = {
      tokens,
      notification: { title: notifTitle, body: notifBody },
      data: { src: "daily_push" },
      webpush: {
        fcmOptions: {
          link: CLICK_LINK, // 👈 importante
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
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
