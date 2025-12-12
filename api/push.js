// FILE: /api/push.js
import admin from "../firebase-admin-server.js";

const db = admin.firestore();
const APP_ORIGIN = "https://what-ifapp.vercel.app";

/* =======================
   COPY NOTIFICHE (SOLO FRASI)
   - Rotazione deterministica giornaliera (Rome)
   - WHAT IF: mattina (phase=1)
   - WHAT THE F: sera (phase=2)
======================= */
function hashStr(str = "") {
  let h = 2166136261 >>> 0;
  for (const ch of String(str)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function pickDet(list, seedStr) {
  if (!list || !list.length) return "";
  const seed = hashStr(seedStr);
  return list[seed % list.length];
}

function getRomeDateKey() {
  // YYYY-MM-DD in timezone Italia (Rome)
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// WHAT IF (mattina) — intrigante/positiva
const WHATIF_MORNING = [
  "Stamattina c’è una frase che ti sistema la testa meglio del caffè: apri qua.",
  "Ti ho lasciato una frase che fa luce senza fare la predica: apri e prenditela.",
  "Oggi si parte puliti: c’è una frase pronta a darti un filo di direzione. Apri qui.",
  "Una frase breve, ma di quelle che sbloccano un pensiero: te la sei meritata. Apri.",
  "La frase di stamattina è fatta per farti venire voglia di muoverti, non di rimandare: apri qua.",
];

// WHAT THE F (sera) — sbronza/stronza ma positiva, fine giornata
const WTF_EVENING = [
  "We, ancora sveglio stai? Leggiti questa e poi vai a letto, ecchecazz!!!",
  "Hai visto che ore sono? Dai, leggila e poi nanna: domani ti alzi, ecchecazz!!!",
  "Non pensarci troppo: apri qua, fatti due risate e spegni tutto, ecchecazz!!!",
  "Domani manco un elefante col tamburo ti sveglia: leggila adesso, ecchecazz!!!",
  "Ok, ultima cosa prima di dormire: apri qua e chiudiamo la giornata come si deve, ecchecazz!!!",
  "Se oggi ti ha preso a schiaffi, almeno chiudila con stile: apri qua, ecchecazz!!!",
];

// Fallback (se un domani usi afternoon o altre combinazioni)
const GENERIC = [
  "C’è una frase pronta per te: apri qua.",
  "Ti aspetta una frase del giorno: apri qui.",
];

function buildPushCopy({ slot, phase, mood }) {
  const dayKey = getRomeDateKey(); // cambia ogni giorno (Italia)
  const seed = `${dayKey}|${slot}|${phase}|${mood || ""}`;

  // SOLO COPY: non tocchiamo url/phase logica, solo title/body
  if (String(phase) === "2" && String(slot) === "evening") {
    return {
      title: "What?f · sera",
      body: pickDet(WTF_EVENING, seed),
    };
  }

  if (String(phase) === "1" && String(slot) === "morning") {
    return {
      title: "What?f · buongiorno",
      body: pickDet(WHATIF_MORNING, seed),
    };
  }

  return {
    title: "What?f · frase del giorno",
    body: pickDet(GENERIC, seed),
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { slot = "morning", phase = "1", mood = "" } = req.query || {};

    const safeSlot = ["morning", "afternoon", "evening"].includes(String(slot))
      ? String(slot)
      : "morning";
    const safePhase = String(phase) === "2" ? "2" : "1";
    const safeMood = String(mood || "");

    const signalPath =
      `/fifth.html?signal=${safeSlot}&phase=${safePhase}` +
      (safeMood ? `&mood=${encodeURIComponent(safeMood)}` : "");

    const CLICK_LINK = `${APP_ORIGIN}${signalPath}`;

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    // ✅ SOLO FRASI dinamiche (nient’altro)
    const copy = buildPushCopy({ slot: safeSlot, phase: safePhase, mood: safeMood });

    // 🔔 MESSAGGIO SOLO DATA (no `notification`, no `webpush.notification`)
    const message = {
      data: {
        title: copy.title,
        body: copy.body,

        src: "signal",
        slot: safeSlot,
        phase: safePhase,
        mood: safeMood,

        url: signalPath,

        // opzionale, info in più, ma NON decide il click
        click_action: CLICK_LINK,
      },
      tokens,
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
