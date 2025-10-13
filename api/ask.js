// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
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
  if (/(lugano|aquila|l'aquila|milano|roma|verona|bussolengo|londra|zurigo)/.test(s)) return "città";
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
const PERSONAS = {
  whatif: {
    // Intimo, concreto, "ti conosce", meno poetico
    system: (lang) =>
      isEn(lang)
        ? `
You are "What?f": intimate, clear, quietly perceptive.
Second person, one voice. 8–12 short sentences (~180 words). No lists.
Sound like you *know* the user without saying it. Observe → reflect → land softly.
Concrete details, minimal imagery (0–2 tiny), zero moralizing. Current, predictive.
Do not end with "two clean shots". Use a soft follow-up like: "If you like, we’ll keep threading this tomorrow." 
Reply ONLY in English.`
        : `
Sei "What?f": intima, chiara, percettiva.
Seconda persona, una sola voce. 8–12 frasi brevi (~180 parole). Niente elenchi.
Dai la sensazione di conoscerlo senza dirlo. Osserva → riflette → chiudi morbido.
Dettagli concreti, immagini minime (0–2), zero morale. Presente, predittiva.
Non chiudere con “due colpi secchi”. Usa un gancio morbido tipo: "Se ti va, domani riprendiamo il filo." 
Rispondi SOLO in Italiano.`
  },
  wtf: {
    // Sarcastico, al bancone, “alcolico”, fa ridere ma fa pensare
    system: (lang) =>
      isEn(lang)
        ? `
You are "What the F": late-night witty bartender — funny, punchy, never mean, a bit boozy.
Second person, one voice. 6–10 quick lines, ≤15 words each. No lists.
Sharp images allowed; avoid poetry. Practical quips > advice. Make them smile and think.
Do not end with "two clean shots". Use a playful hook like: "Same bar, same time; we’ll stir this again."
Reply ONLY in English.`
        : `
Sei "What the F": barista di notte, brillante e un filo "alcolico", sarcastico ma mai cattivo.
Seconda persona, una voce. 6–10 righe secche, max 15 parole. Niente elenchi.
Battute pratiche > consigli. Fai sorridere e riflettere. Immagini piccole, niente poesia.
Non chiudere con “due colpi secchi”. Usa un gancio giocoso tipo: "Stesso bancone, domani rimescoliamo." 
Rispondi SOLO in Italiano.`
  }
};

/* ========= Mirror (frase-specchio) ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const it = [
    name ? `${name}, non decidi per capriccio: cerchi senso.` : "Non decidi per capriccio: cerchi senso.",
    city ? `${city} ti tiene a terra, ma ogni tanto ti serve aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi finché il perché resta acceso."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims—you move for meaning.` : "You don’t move on whims—you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit."
  ];
  return pick(en ? enPool : it);
}

/* ========= Closings (senza “due colpi secchi”) ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Se ti va, domani riprendiamo il filo.",
    "Tienila calda: domani torniamo su questo punto.",
    "Lascia qui il segnalibro: ripartiamo domani."
  ];
  const itSharp = [
    "Stesso bancone, domani rimescoliamo.",
    "Lascia il bicchiere qui: domani un altro giro.",
    "Non chiudiamo il conto: passiamo domani."
  ];
  const enSoft = [
    "If you like, we’ll keep threading this tomorrow.",
    "Bookmark this; we’ll pick it up tomorrow.",
    "Hold the thread — tomorrow we nudge it forward."
  ];
  const enSharp = [
    "Same bar, tomorrow we stir again.",
    "Leave the tab open — back tomorrow.",
    "Don’t close the check; swing by tomorrow."
  ];
  return style === "wtf" ? pick(en ? enSharp : itSharp) : pick(en ? enSoft : itSoft);
}

/* ========= Clarify ========= */
function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);
  const Q = (id, it, enStr, phIt, phEn) => ({
    id,
    label: en ? enStr : it,
    placeholder: en ? phEn : phIt
  });

  if (topic === "moto") {
    return [
      Q("timing", "Quando la prenderesti davvero?", "When would you actually buy it?", "questo mese / 3–6 mesi", "this month / 3–6 months"),
      Q("use", "Uso principale?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekends / trips"),
      Q("budget", "Tetto di spesa mensile?", "Monthly budget ceiling?", "€ per assicurazione + carburante", "$ for insurance + fuel")
    ];
  }
  if (topic === "trasferimento" || topic === "città") {
    return [
      Q("window", "Finestra realistica per lo spostamento?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei ora?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("signal", "Segno che direbbe: è giusto?", "Sign that says: it’s right?", "sonno/energia/risposte", "sleep/energy/callback")
    ];
  }
  if (topic === "lavoro") {
    return [
      Q("why", "Il tuo perché oggi?", "Your current *why*?", "impatto / crescita / serenità", "impact / growth / calm"),
      Q("option", "Opzioni sul tavolo?", "Options on the table?", "restare / cambiare team / uscire", "stay / switch team / leave"),
      Q("limit", "Vincolo più concreto?", "Hardest constraint?", "budget/tempo/relazioni", "budget/time/people")
    ];
  }
  return [
    Q("window", "Finestra reale della decisione?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    Q("signal", "Segno personale da osservare?", "Personal sign to watch?", "sonno/energia/prima risposta", "sleep/energy/first reply"),
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
      /* >>>>> NUOVO: guida extra ricevuta dal front */
      extra = ""
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // lingua: auto o forzata
    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const en = isEn(lang);
    const topic = classifyTopic(domanda);

    /* ----- Clarify branch ----- */
    if (clarify) {
      return res.status(200).json({ questions: clarifyQuestions(domanda, periodo, lang) });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const system = `
${persona.system(lang).trim()}

Today: ${todayInfo(lang)}
Hard rules:
- Reply ONLY in ${en ? "English" : "Italiano"}.
- Stay strictly on topic inferred from the user question: "${topic}".
- No lists/bullets; no direct questions before the final line.
- Minimal imagery (0–2), concrete details, no purple prose.
- ${stile === "wtf" ? "Tone: witty, punchy, practical, a tad boozy." : "Tone: warm, clear, predictive."}
${extra ? `\nAdditional style guidance (must comply):\n${extra}\n` : ""}
`.trim();

    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"} (parafrasa liberamente): "${mirror}"

${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Extra details" : "Dettagli"}: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (en ? "none" : "nessuno")}
${en ? "Topic to honor" : "Tema da rispettare"}: ${topic}
${en
  ? `Write ${stile === "wtf" ? "6–10 punchy lines" : "8–12 short sentences"}, max ~180 words, single voice, second person.
Avoid lists and direct questions; use 0–2 tiny, plausible images. End with a soft episodic hook like: "${closing}".`
  : `Scrivi ${stile === "wtf" ? "6–10 righe secche" : "8–12 frasi brevi"}, max ~180 parole, una sola voce, seconda persona.
Evita elenchi e domande dirette; usa 0–2 immagini piccole e plausibili. Chiudi con un gancio morbido tipo: "${closing}".`
}
`.trim();

    const temperature = stile === "wtf" ? 0.9 : 0.82;

    // SSE opzionale
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

    // Non-stream
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
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
