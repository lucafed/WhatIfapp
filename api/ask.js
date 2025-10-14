// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Modello consigliato: qualità + costo contenuto. Puoi cambiarlo in futuro.
const MODEL_TEXT = process.env.WHATIF_MODEL || "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Utils ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|and|or|you|should|would|move|work|buy|motor|bike|city)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|moto|tornassi|trasferir|lavor|comprare|acquistare)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(barca|vela|gommone|yacht|boat)/.test(s)) return "barca";
  if (/(tornassi|trasferi|trasloco|vivere a|move|relocat)/.test(s)) return "trasferimento";
  if (/(l'aquila|aquila|lugano|milano|roma|verona|bussolengo|londra|zurigo)/.test(s)) return "città";
  if (/(lavoro|job|ricercatore|azienda|ufficio|work)/.test(s)) return "lavoro";
  if (/(comprare|acquistare|buy|purchase)/.test(s)) return "acquisto";
  return "generale";
}

function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

/* ========= Persona & stile ========= */
// Tono DEFINITIVO, con esempi “ancora” interni per farlo parlare come vogliamo
const PERSONAS = {
  whatif: {
    system: (lang) => {
      const en = isEn(lang);
      return (en
        ? `
You are "What?f": empathetic, crisp, upbeat. You sound like a friend who knows the user well.
Write 9–12 short sentences, one voice, second person. No bullets. No coaching clichés. No melancholy.
No poetry. Keep it light, smart, and optimistic. Tiny, concrete images only (0–2).
Make it feel like episode 1 of a story that continues tomorrow. End with a gentle cliffhanger that invites the user back.
Use the user's first name naturally if provided; otherwise avoid guessing.
Rules:
- Reply ONLY in English.
- Stay strictly on topic "${'${topic}'}".
- No direct questions until the last line.
- Avoid words like “heart, destiny, soul, fate, poetry, melancholy, nostalgia, foggy”.
- Keep it positive, curious, and lucid—never sad.

Style anchors (use this exact vibe, do NOT paraphrase them verbatim):
• “You’re not running away; you’re breathing better.”
• “You don’t need a new city—you need your rhythm back.”
• “You’ve already turned the key; tomorrow the story moves.”
• “Not a coach. A friend who sees your pattern.”

Closing idea (rotate variations naturally, not verbatim):
• “Tomorrow we nudge it and see where it wants to go.”
• “We’ll keep the thread warm—same scene, new beat, tomorrow.”
`.trim()
        : `
Sei "What?f": empatica, asciutta, allegra. Suoni come un amico che ti conosce bene.
Scrivi 9–12 frasi brevi, una sola voce, seconda persona. Niente elenchi, niente coachismi. Zero malinconia.
Niente poesia. Tono leggero, intelligente, ottimista. Immagini piccole e concrete (0–2).
Sembra l’episodio 1 di una storia che continua domani. Chiudi con un gancio morbido che invita a tornare.
Usa il nome dell’utente in modo naturale se disponibile; altrimenti non inventarlo.
Regole:
- Rispondi SOLO in Italiano.
- Resta sul tema "${'${topic}'}".
- Niente domande dirette fino all’ultima riga.
- Evita parole tipo “cuore, destino, anima, sorte, poesia, malinconia, nostalgia”.
- Positivo, curioso, lucido—mai triste.

Ancora di stile (mantieni esattamente questo tono, non copiarle parola per parola):
• “Non scappi: respiri meglio.”
• “Non ti serve una città nuova: ti serve il tuo ritmo.”
• “La chiave l’hai già girata; domani la storia si muove.”
• “Non un coach. Un amico che vede il tuo schema.”

Chiusure possibili (varia naturalmente, non copiare alla lettera):
• “Domani la spingiamo un filo e vediamo dove porta.”
• “Teniamo il filo caldo: stessa scena, un battito avanti, domani.”
`.trim());
    }
  },
  wtf: {
    system: (lang) => {
      const en = isEn(lang);
      return (en
        ? `
You are "What the F": witty late-night bartender—funny, punchy, warm, a little drunk but lucid.
Write 7–11 short lines, ≤15 words each. No bullets. Make them LAUGH, not sad. Sarcastic but never mean.
Use smart bar humor, quick images. No bitterness. No rudeness. No tragedy. Be playful and confident.
Use first name or a friendly nickname if provided (e.g., “amico”), naturally.
End with a comedic cliffhanger that implies the story continues tomorrow.

Rules:
- Reply ONLY in English.
- Stay strictly on topic "${'${topic}'}".
- Avoid poetry and flowery language.
- Avoid negativity; tilt to cheeky optimism.
- No direct questions until the last line.

Style anchors (keep this vibe):
• “Yes, that city—the wind has a monthly pass.”
• “Life’s a cocktail: drink it, don’t watch the ice melt.”
• “You didn’t run—you just changed the soundtrack.”

Closing idea:
• “Same stool, tomorrow I’ll tell you what happens next.”
`.trim()
        : `
Sei "What the F": barista di notte—ironico, brillante, caldo, un po’ “brillo” ma lucido.
Scrivi 7–11 righe corte (≤15 parole). Niente elenchi. Fai RIDERE, mai rattristare. Sarcastico ma non cattivo.
Umorismo da bancone, immagini rapide. Zero astio. Niente toni tragici. Gioca e guida.
Usa il nome o un nomignolo amichevole se disponibile (“amico”), con naturalezza.
Chiudi con un cliffhanger comico che fa capire: domani si continua.

Regole:
- Rispondi SOLO in Italiano.
- Resta sul tema "${'${topic}'}".
- Niente poesia o linguaggio floreale.
- Evita negatività: punta a ottimismo sfrontato.
- Niente domande dirette fino all’ultima riga.

Ancora di stile (mantieni questo spirito):
• “Sì, proprio quella città: il vento ha l’abbonamento mensile.”
• “La vita è un cocktail: bevilo, non guardare il ghiaccio sciogliersi.”
• “Non sei scappato: hai cambiato colonna sonora.”

Chiusura:
• “Stesso sgabello: domani ti dico come va avanti.”
`.trim());
    }
  }
};

/* ========= Mirror (apertura) ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const itPool = [
    name ? `${name}, non scappi: cerchi aria buona e ritmo tuo.` : "Non scappi: cerchi aria buona e ritmo tuo.",
    city ? `${city} ti conosce già; a te serve solo ricordarti come cammini lì.` : "Ti serve un posto che capisce i tuoi silenzi.",
    role ? `Nel lavoro (${role}) rendi quando il “perché” è chiaro e corto.` : "Rendi quando il “perché” è chiaro e corto."
  ];
  const enPool = [
    name ? `${name}, you don’t run—you look for your own rhythm.` : "You don’t run—you look for your rhythm.",
    city ? `${city} already knows you; you just need to remember your pace there.` : "You need a place that understands your pauses.",
    role ? `In ${role}, you shine when the why is short and clear.` : "You shine when the why is short and clear."
  ];
  return pick(en ? enPool : itPool);
}

/* ========= Episodi (ganci finali) ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const soft = en
    ? [
        "Tomorrow we nudge it and see where it wants to go.",
        "Keep the thread warm; same scene, new beat tomorrow.",
        "Come back tomorrow—this story already knows its next step."
      ]
    : [
        "Domani la spingiamo un filo e vediamo dove porta.",
        "Teniamo il filo caldo: stessa scena, un battito avanti, domani.",
        "Torna domani: questa storia sa già il prossimo passo."
      ];
  const sharp = en
    ? [
        "Same stool: tomorrow I tell you what happens next.",
        "Leave the tab open—tomorrow the plot tips its hat.",
        "Park it here; the next bit lands tomorrow."
      ]
    : [
        "Stesso sgabello: domani ti dico come va avanti.",
        "Lascia il conto aperto—domani la trama fa l’occhiolino.",
        "Tienimi il posto: il pezzo dopo arriva domani."
      ];
  return style === "wtf" ? pick(sharp) : pick(soft);
}

/* ========= Esempi (forza il tono) ========= */
const EXAMPLES = {
  it: {
    whatif: [
      `E se decidessi di tornare all’Aquila?
Ti conosco: diresti che è per cambiare aria, ma non è quello.
Ti serve riconoscere le strade, non scoprirne di nuove.
All’inizio penseresti di esserti fermato; in realtà stai solo respirando meglio.
Non cerchi una città: cerchi il tuo ritmo.
La chiave l’hai già girata; domani la storia si muove.`
    ],
    wtf: [
      `Tornare all’Aquila? Ma sì, cosa può andare storto.
Freddo onesto, baristi che ricordano il tuo ordine, vento con abbonamento.
Non stai scappando: stai cambiando colonna sonora.
Ok amico, tieni il cappotto: domani ti dico chi ti saluta per primo.`
    ]
  },
  en: {
    whatif: [
      `If you moved back, it wouldn’t be escape—it’d be breathing better.
You don’t need a new city; you need your rhythm back.
You already turned the key; tomorrow the story moves.`
    ],
    wtf: [
      `Back to that city? Sure. Honest cold, regulars at the bar, wind on a monthly plan.
You didn’t run—you changed the soundtrack.
Same stool tomorrow; I’ll spill what happens next.`
    ]
  }
};

/* ========= Clarify (2–3 domande mirate) ========= */
function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);
  const Q = (id, it, enStr, phIt, phEn) => ({
    id,
    label: en ? enStr : it,
    placeholder: en ? phEn : phIt
  });

  // Domande legate al TEMA + 1 personale
  if (topic === "moto") {
    return [
      Q("timing", "Quando la prenderesti davvero?", "When would you actually buy it?", "questo mese / 3–6 mesi", "this month / 3–6 months"),
      Q("use", "Uso principale?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekends / trips"),
      Q("budget", "Tetto mensile realistico?", "Real monthly ceiling?", "assicurazione + carburante", "insurance + fuel")
    ];
  }
  if (topic === "trasferimento" || topic === "città") {
    return [
      Q("window", "Finestra realistica per spostarti?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei ora?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("signal", "Segnale che dice: è giusto?", "Signal that says: it’s right?", "sonno/energia/risposte", "sleep/energy/callback")
    ];
  }
  if (topic === "lavoro") {
    return [
      Q("why", "Il tuo perché oggi?", "Your current why?", "impatto / crescita / serenità", "impact / growth / calm"),
      Q("option", "Opzioni sul tavolo?", "Options on the table?", "restare / cambiare team / uscire", "stay / switch team / leave"),
      Q("limit", "Vincolo più concreto?", "Hardest constraint?", "budget/tempo/relazioni", "budget/time/people")
    ];
  }
  return [
    Q("window", "Finestra decisione reale?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    Q("signal", "Segnale personale da osservare?", "Personal sign to watch?", "sonno/energia/prima risposta", "sleep/energy/first reply"),
    Q("limit", "Limite più concreto?", "Most concrete limit?", "budget/tempo/energia", "budget/time/energy")
  ];
}

/* ========= HTTP handler ========= */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      lang: langIn = "auto",
      periodo = "future",
      stile = "whatif",
      stream = false,
      clarify = false,
      profilo = {},
      clarifications = [],
      extra = "",
      episode = 1
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // lingua e tema
    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const en = isEn(lang);
    const topic = classifyTopic(domanda);
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const closing = episodicClosing(stile, lang);
    const mirror = mirrorLine(profilo, lang);

    /* ----- Clarify branch ----- */
    if (clarify) {
      return res.status(200).json({ questions: clarifyQuestions(domanda, periodo, lang) });
    }

    /* ----- SYSTEM PROMPT (tono) ----- */
    const system = `
${persona.system(lang).replaceAll("${topic}", topic).trim()}

Context:
- Today: ${todayInfo(lang)}
- Episode: ${Math.max(1, Math.min(3, Number(episode) || 1))}
- Hard rules:
  • Reply ONLY in ${en ? "English" : "Italiano"}.
  • Strictly honor topic: "${topic}".
  • Keep it upbeat, confident, familiar. No sadness, no bitterness, no poetry.

Style examples (DO NOT copy verbatim; match vibe and rhythm):
${EXAMPLES[en ? "en" : "it"][stile === "wtf" ? "wtf" : "whatif"].map(e => `— ${e}`).join("\n")}
`.trim();

    /* ----- USER PROMPT (contenuto) ----- */
    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"}: "${mirror}"

${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Extra details" : "Dettagli"}: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (en ? "none" : "nessuno")}
${en ? "Topic to honor" : "Tema da rispettare"}: ${topic}

${en
  ? `Write naturally in second person with the requested persona.
End with a sweet cliffhanger that implies the story continues tomorrow:
"${closing}"`
  : `Scrivi naturale in seconda persona rispettando la persona scelta.
Chiudi con un gancio dolce che fa capire che domani si continua:
"${closing}"`
}
`.trim();

    const temperature = stile === "wtf" ? 0.95 : 0.85;

    /* ----- STREAM (SSE) ----- */
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        stream: true,
        max_tokens: 700,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });

      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    /* ----- NON-STREAM ----- */
    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      temperature,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text, lang, topic });

  } catch (err) {
    console.error("API /ask error:", err);
    const msg = err?.message || "unknown";
    return res.status(500).json({ error: "server_error", detail: msg });
  }
}
