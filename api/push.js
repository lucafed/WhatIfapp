// FILE: api/push.js
// Invia una notifica "frase del giorno" a tutti gli ultimi token salvati
// Usa i parametri di query ?slot=morning|afternoon|evening & phase=1|2
// E apre fifth.html con ?signal=...&phase=...&src=daily_push

import admin from "../firebase-admin-server.js";

const db = admin.firestore();

// Normalizza slot e phase
function normalizeSlot(raw) {
  const val = String(raw || "").toLowerCase();
  if (val === "afternoon") return "afternoon";
  if (val === "evening") return "evening";
  return "morning"; // default
}

function normalizePhase(raw) {
  // 1 = What if, 2 = What the F
  return String(raw) === "2" ? 2 : 1;
}

// Testi diversi per mattino / pomeriggio / sera e per voce
function buildNotificationBody(slot, phase) {
  // slot: morning | afternoon | evening
  // phase: 1 (What if) | 2 (WTF)

  if (slot === "morning" && phase === 1) {
    // What if mattino
    return "Buongiorno: metti a fuoco una cosa che conta oggi e falla succedere. Vuoi chiedere o rispondere?";
  }

  if (slot === "evening" && phase === 2) {
    // What the F sera
    return "Giornata finita (più o meno): dimmi com’è andata davvero o chiedi qualcosa, così non te la porti a letto.";
  }

  if (slot === "afternoon" && phase === 1) {
    return "Pomeriggio a metà: com’è l’umore ora? Se vuoi, chiedi o racconta cosa sta andando storto o sorprendentemente bene.";
  }

  if (slot === "afternoon" && phase === 2) {
    return "Metà giornata, metà pazienza: sfogati o chiedi qualcosa, prima che ti ritrovi a urlare al muro.";
  }

  // fallback generico
  if (phase === 1) {
    return "Frase del giorno di What if: un passo concreto oggi, non domani. Vuoi chiedere o rispondere adesso?";
  }

  return "Commento cazzaro di What the F sulla tua giornata. Vuoi dirgli la tua o fargli una domanda?";
}

// Titolo diverso per le due voci
function buildNotificationTitle(phase) {
  return phase === 1
    ? "What if · frase del giorno"
    : "What the F · frase del giorno";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    // 🧩 Leggiamo slot e phase dalla query
    const { slot: rawSlot, phase: rawPhase } = req.query || {};
    const slot = normalizeSlot(rawSlot);
    const phase = normalizePhase(rawPhase);

    // 🔗 Link completo che deve APRIRSI al tap
    const CLICK_LINK = `https://what-ifapp.vercel.app/fifth.html?signal=${slot}&phase=${phase}&src=daily_push`;

    // Prendiamo gli ultimi token registrati
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200) // margine per tanti utenti
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    // I token sono gli ID dei documenti nella collection fcm_tokens
    const tokens = snap.docs.map((d) => d.id);

    const title = buildNotificationTitle(phase);
    const body = buildNotificationBody(slot, phase);

    // ✅ MESSAGGIO DATA-ONLY → sarà il service worker a mostrare la notifica
    const message = {
      data: {
        title,
        body,
        src: "daily_push",
        signal: slot,             // morning | afternoon | evening
        phase: String(phase),     // "1" o "2"
        url: CLICK_LINK,
        click_action: CLICK_LINK, // usato dal SW
      },
      tokens,
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      slot,
      phase,
      sent: resp.successCount,
      failed: resp.failureCount,
      click: CLICK_LINK,
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
