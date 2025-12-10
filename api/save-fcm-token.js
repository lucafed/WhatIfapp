// FILE: api/save-fcm-token.js
// Salva il token FCM in Firestore

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { token, uid } = req.body || {};

    if (!token) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_token" });
    }

    await db.collection("fcm_tokens").doc(token).set({
      token,
      uid: uid || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      platform: "android-web",
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("save-fcm-token error", err);
    return res
      .status(500)
      .json({ ok: false, error: "server_error" });
  }
}
