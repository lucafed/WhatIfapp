// FILE: firebase-admin-server.js
// Inizializzazione centralizzata di Firebase Admin (fuori da /api)

import admin from "firebase-admin";

if (!admin.apps.length) {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) {
    throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON env var");
  }

  const creds = JSON.parse(raw);

  admin.initializeApp({
    credential: admin.credential.cert(creds),
  });
}

export default admin;
