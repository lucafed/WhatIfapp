// api/_firebaseAdmin.js
// Inizializza firebase-admin UNA SOLA VOLTA usando
// la variabile d'ambiente GOOGLE_APPLICATION_CREDENTIALS_JSON

import admin from "firebase-admin";

if (!admin.apps.length) {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON mancante");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (e) {
    console.error("Impossibile fare parse del JSON delle credenziali", e);
    throw e;
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default admin;
