// FILE: /api/send-test-push.js
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
    ),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  try {
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({ ok: false, error: "no_tokens" });
    }

    const token = snap.docs[0].id;

    await admin.messaging().send({
      token,
      notification: {
        title: "What?f",
        body: "What if: e se domani fosse meno incasinato del previsto?\n\nWhat the F: sì vabbè… intanto dormi.",
      },
      data: {
        click_action: "/index.html",
      },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("push error", e);
    res.status(500).json({ ok: false });
  }
}
