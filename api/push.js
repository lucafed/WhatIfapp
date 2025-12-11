// FILE: /api/push.js
// Invia una notifica "frase del giorno" a tutti gli ultimi token salvati
// ⚠️ Data-only: niente campo `notification` → la UI la gestisce firebase-messaging-sw.js

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// Dominio base della tua app
const APP_ORIGIN = "https://what-ifapp.vercel.app";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    // 🔹 Leggo slot / phase / mood dai query param (usati anche dai CRON)
    const url = new URL(req.url, "http://localhost");
    const rawSlot = (url.searchParams.get("slot") || "morning").toLowerCase();
    const rawPhase = url.searchParams.get("phase") || "1";
    const mood = url.searchParams.get("mood") || "";

    const slot =
      rawSlot.includes("even") || rawSlot.includes("sera")
        ? "evening"
        : rawSlot.includes("after") || rawSlot.includes("pomer")
        ? "afternoon"
        : "morning";

    const phase = rawPhase === "2" ? "2" : "1"; // 1 = WHAT IF, 2 = WTF

    // 🔹 Costruisco il link giusto per la FIFTH in modalità "signal"
    // Es: /fifth.html?signal=morning&phase=1
    const signalPath = `/fifth.html?signal=${slot}&phase=${phase}${
      mood ? `&mood=${encodeURIComponent(mood)}` : ""
    }`;
    const CLICK_LINK = `${APP_ORIGIN}${signalPath}`;

    // 🔹 Testo diverso per morning / evening + phase
    let title;
    let body;
    if (phase === "2") {
      // WHAT THE F (sera)
      title = "What the F · frase di stasera";
      body = "La tua frase cazzara di fine giornata è pronta 🔔";
    } else {
      // WHAT IF (mattina)
      title = "What?f · frase del giorno";
      body = "La tua frase del mattino è pronta 🔔";
    }

    // 🔎 Prendo gli ultimi token salvati
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    // Piccola dedup per sicurezza
    const tokenList = snap.docs.map((d) => d.id);
    const tokens = Array.from(new Set(tokenList));

    // 🔔 Messaggio DATA-ONLY
    const message = {
      data: {
        // titolo / corpo usati dal service worker
        title,
        body,

        // per il fifth.html → bootstrapSignalFromUrl
        src: "signal",       // importantissimo: indica che è una frase giornaliera
        slot,                // morning | afternoon | evening
        phase,               // "1" (WHAT IF) o "2" (WTF)
        mood,                // opzionale, oggi vuoto nei CRON

        // URL interno logico (relativo)
        url: signalPath,

        // compat: alcuni SW / browser guardano click_action
        click_action: CLICK_LINK
      },

      // Webpush: link “di default” se il browser lo usa
      webpush: {
        fcmOptions: {
          link: CLICK_LINK
        }
      },

      tokens
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      slot,
      phase,
      sent: resp.successCount,
      failed: resp.failureCount
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
