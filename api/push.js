// FILE: api/push.js
// Invia una notifica "frase del giorno" a tutti gli ultimi token salvati
// ⚠️ Data-only: niente campo `notification` → nessuna doppia notifica

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// Base URL della webapp (puoi cambiarlo se usi un dominio diverso)
const APP_BASE_URL =
  process.env.APP_BASE_URL || "https://what-ifapp.vercel.app";

/**
 * Costruisce l'URL che deve aprirsi quando l'utente tappa la notifica.
 * Esempi:
 *  - /fifth.html?signal=morning&phase=1
 *  - /fifth.html?signal=evening&phase=2&mood=giu
 */
function buildClickUrl(slot, phase, mood) {
  const params = new URLSearchParams();
  params.set("signal", slot);
  params.set("phase", String(phase));
  if (mood) params.set("mood", String(mood));
  return `${APP_BASE_URL}/fifth.html?${params.toString()}`;
}

/**
 * Piccolo helper per titolo e testo della notifica
 */
function buildText(slot, phase) {
  slot = slot || "morning";

  // default IT per ora (tanto il contenuto vero lo genera fifth)
  let title = "What?f · frase del giorno";
  let body =
    phase === 2
      ? "What the F ha qualcosa da ridire su oggi…"
      : "What if ha una frase per iniziare o rimettere a fuoco la giornata.";

  if (slot === "afternoon") {
    title = "What?f · check-in del pomeriggio";
    body =
      phase === 2
        ? "What the F commenta il tuo pomeriggio."
        : "Come sta andando? Tocca per il check-in con What if.";
  } else if (slot === "evening") {
    title = "What?f · chiusura giornata";
    body =
      phase === 2
        ? "What the F chiude il giro e dice la sua sulla tua giornata."
        : "Tocca per chiudere la giornata con What if e rimettere ordine.";
  }

  return { title, body };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    // 🔹 Leggiamo dallo querystring:
    //   /api/push?slot=morning&phase=1
    const slotRaw = (req.query.slot || "morning").toString().toLowerCase();
    const phase = Number(req.query.phase || "1");
    const mood = req.query.mood ? String(req.query.mood) : undefined;

    // Normalizza slot
    const ALLOWED_SLOTS = ["morning", "afternoon", "evening"];
    const slot = ALLOWED_SLOTS.includes(slotRaw) ? slotRaw : "morning";
    const safePhase = phase === 2 ? 2 : 1; // solo 1 o 2

    const clickLink = buildClickUrl(slot, safePhase, mood);
    const { title, body } = buildText(slot, safePhase);

    // Recuperiamo gli ultimi token
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
        // Questi li usiamo nel client / service worker se serve
        title,
        body,

        // ci teniamo traccia del tipo di segnale
        src: "signal",
        slot, // morning | afternoon | evening
        phase: String(safePhase), // "1" | "2"
        mood: mood || "",

        // per compatibilità con alcuni browser / SW
        click_action: clickLink
      },
      webpush: {
        fcmOptions: {
          // per sicurezza: link usato da FCM lato browser
          link: clickLink
        }
      },
      tokens
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      slot,
      phase: safePhase,
      mood: mood || null,
      sent: resp.successCount,
      failed: resp.failureCount
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
