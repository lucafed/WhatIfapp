// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Utils ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  // molto semplice: se trova parole inglesi comuni -> en, altrimenti it
  const enHits = (text.match(/\b(what|if|and|or|you|i|buy|move|work|motor|bike|should)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|comprare|moto|tornassi|lavorare|andare)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(barca|vela|gommone|yacht|boat)/.test(s)) return "barca";
  if (/(tornassi|trasferi|trasloco|andassi a vivere|move|relocat)/.test(s)) return "trasferimento";
  if (/(lugano|aquila|l'aquila|milano|roma|verona|bussolengo)/.test(s)) return "città";
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
    system: (lang) => (isEn(lang) ? `
You are "What?f": warm, clear, quietly perceptive.
Second person, single voice. 8–12 short sentences, ~180 words.
Sound like you *know* the user without saying it. Read the mood and anticipate the next step.
No labels like “indicator/constraint/trade-off/first step”: show, don’t name.
Low-metaphor (max 2 tiny images), realistic details, calm cadence.
Close with a soft invite to return tomorrow for 2 micro-questions.
Only answer in ${isEn(lang) ? "English" : "Italian"}.
` : `
Sei "What?f": voce empatica e lucida, come negli screenshot.
Seconda persona, una sola voce. 8–12 frasi brevi, ~180 parole.
Fai percepire che conosci l’utente senza dirlo. Leggi l’umore e anticipa il passo successivo.
Niente etichette tipo “indicatore/vincolo/trade-off/primo passo”: mostra, non nominare.
Metafore minime (max 2, leggere), dettagli realistici, ritmo calmo.
Chiudi con un invito morbido a tornare domani per 2 micro-domande.
Rispondi solo in ${isEn(lang) ? "English" : "Italiano"}.
`)
  },
  wtf: {
    system: (lang) => (isEn(lang) ? `
You are "What the F": bar-counter friend, sharp and affectionate.
Second person, one voice. 6–10 punchy lines, fast rhythm.
High wit, zero meanness, no profanity. No sermons. Concrete, no fluff.
Stay strictly on topic. Use crisp images, not poetry. Keep it practical and funny.
Close with a tight quip about “two clean shots tomorrow”.
Only answer in ${isEn(lang) ? "English" : "Italian"}.
` : `
Sei "What the F": amico da bancone, brillante e affettuosamente spietato.
Seconda persona, una voce. 6–10 righe secche, ritmo veloce.
Ironia alta, zero volgarità e zero prediche. Concreto, niente fronzoli.
Resta strettamente in tema. Immagini piccole e pratiche, niente lirica.
Chiudi con una battuta tipo “domani due colpi secchi”.
Rispondi solo in ${isEn(lang) ? "English" : "Italiano"}.
`)
  }
};

/* ========= Mirror line ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const it = [
    name ? `${name}, non decidi per capriccio: cerchi senso.` : "Non decidi per capriccio: cerchi senso.",
    city ? `${city} ti tiene a terra, ma ti serve aria nuova ogni tanto.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi finché il perché resta acceso."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims—you move for meaning.` : "You don’t move on whims—you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit."
  ];
  return pick(en ? enPool : it);
}

/* ========= Closings ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani due micro-domande e andiamo dritti.",
    "Se torni domani, due dettagli e si chiarisce.",
    "Quando vuoi: due micro-cue e si svolta."
  ];
  const itSharp = [
    "Stop qui. Domani due colpi secchi e si decide.",
    "Bancone chiuso: domani due cue puliti.",
    "Pausa. Domani due tiri netti."
  ];
  const enSoft = [
    "Tomorrow two micro-questions and we move clean.",
    "Come back tomorrow: two small cues, clearer path.",
    "We’ll pick it up tomorrow with two quick prompts."
  ];
  const enSharp = [
    "Pause here. Tomorrow, two clean shots.",
    "Bar’s closed—tomorrow two sharp cues.",
    "Stop here. Two crisp hits tomorrow."
  ];
  if (style === "wtf") return pick(en ? enSharp : itSharp);
  return pick(en ? enSoft : itSoft);
}

/* ========= Clarify questions by topic ========= */
function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);

  const Q = (id, it, enStr, phIt, phEn) => ({
    id,
    label: en ? enStr : it,
    placeholder: en ? phEn : phIt
  });

  if (topic === "moto" || /m(ar)?zo|month|weeks?/i.test(domanda)) {
    return [
      Q("timing", "Quando la prenderesti davvero?",
        "When exactly would you buy it?",
        "questo mese / 3–6 mesi", "this month / 3–6 months"),
      Q("use", "Per cosa la useresti di più?",
        "Main use?",
        "casa-lavoro / weekend / viaggi", "commute / weekend / trips"),
      Q("budget", "Qual è il tetto di spesa mensile?",
        "Monthly budget ceiling?",
        "€ X assicurazione+carburante", "$/£ X insurance+fuel")
    ];
  }

  if (topic === "trasferimento" || topic === "città") {
    return [
      Q("window", "Finestra realistica per lo spostamento?",
        "Real window for moving?",
        "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene lì dove sei ora?",
        "What anchors you where you are?",
        "famiglia / lavoro / costi", "family / work / costs"),
      Q("signal", "Un segno che ti direbbe: è la scelta giusta?",
        "One sign that says: it’s right?",
        "sonno/energia/risposte", "sleep/energy/callback")
    ];
  }

  if (topic === "lavoro") {
    return [
      Q("why", "Qual è il tuo perché attuale?",
        "What’s your current *why*?",
        "impatto / crescita / serenità", "impact / growth / calm"),
      Q("option", "Opzioni sul tavolo?",
        "What options are on the table?",
        "restare / cambiare team / uscire", "stay / switch team / leave"),
      Q("limit", "Vincolo più concreto?",
        "Hardest constraint?",
        "budget/tempo/relazioni", "budget/time/people")
    ];
  }

  // fallback generico
  return [
    Q("window", "Finestra reale della decisione?",
      "Real decision window?",
      "questo mese / 3–6 mesi / 12 mesi", "this month / 3–6 / 12 months"),
    Q("signal", "Un segno personale da osservare?",
      "Personal sign to watch?",
      "sonno/energia/prima risposta", "sleep/energy/first reply"),
    Q("limit", "Limite più concreto?",
      "Most concrete limit?",
      "budget/tempo/energia", "budget/time/energy")
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
      lang: langIn = "it",        // "it" | "en" | "auto"
      periodo = "future",         // "future" | "past"
      stile = "whatif",           // "whatif" | "wtf"
      stream = false,             // true => SSE
      clarify = false,            // true => domande
      profilo = {},
      clarifications = []         // risposte brevi opzionali
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // lingua
    const lang = (langIn === "auto") ? detectLang(domanda) : langIn;
    const en = isEn(lang);
    const topic = classifyTopic(domanda);

    /* ----- Clarify branch ----- */
    if (clarify) {
      return res.status(200).json({
        questions: clarifyQuestions(domanda, periodo, lang)
      });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const system = `
${persona.system(lang).trim()}
Today: ${todayInfo(lang)}
Hard rules:
- Reply ONLY in ${en ? "English" : "Italiano"}.
- Stay strictly on topic: "${topic}" derived from the user question.
- No lists or bullets; no direct questions except the final soft/quip line.
- Keep metaphors minimal (0–2) and small; no purple prose.
- ${stile === "wtf" ? "Be witty, punchy, and concrete." : "Be warm, clear, and predictive."}
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
Avoid lists and direct questions; use 0–2 tiny, plausible images. End with one ${stile === "wtf" ? "quip" : "soft invite"} like: "${closing}".`
  : `Scrivi ${stile === "wtf" ? "6–10 righe secche" : "8–12 frasi brevi"}, max ~180 parole, una sola voce, seconda persona.
Evita elenchi e domande dirette; usa 0–2 immagini piccole e plausibili. Chiudi con una ${stile === "wtf" ? "battuta" : "riga morbida"} tipo: "${closing}".`
}
`.trim();

    const temperature = stile === "wtf" ? 0.9 : 0.82;

    // Streaming SSE opzionale
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
