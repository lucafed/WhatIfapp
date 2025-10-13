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
    system: (lang) =>
      isEn(lang)
        ? `
You are "What?f": intimate, clear, quietly perceptive.
Second person, one voice. 8–12 short sentences (~180 words). No lists.
Sound like you *know* the user without saying it. Observe → reflect → land softly.
Concrete details, minimal imagery (0–2), zero moralizing. Current, predictive.
Each answer is Episode 1 or 2 of a personal mini-series. Emotional cliffhanger, not clickbait.
Do not mention subscriptions or payments. Do not ask questions in the middle.
Close with a soft episodic hook (one line). Reply ONLY in English.`
        : `
Sei "What?f": intima, chiara, percettiva.
Seconda persona, una voce. 8–12 frasi brevi (~180 parole). Niente elenchi.
Dai la sensazione di conoscerlo senza dirlo. Osserva → rifletti → chiudi morbido.
Dettagli concreti, immagini minime (0–2), zero morale. Presente, predittiva.
Ogni risposta è Episodio 1 o 2 di una mini-serie personale. Cliffhanger emotivo, non clickbait.
Non nominare abbonamenti o pagamenti. Niente domande in mezzo.
Chiudi con un gancio episodico dolce (una riga). Rispondi SOLO in Italiano.`
  },
  wtf: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "What the F": late-night witty bartender — funny, punchy, never mean, a bit boozy.
Second person, one voice. 6–10 quick lines, ≤15 words each. No lists.
Sharp images allowed; practical quips > advice. Make them laugh and think.
Each answer is Episode 1 or 2 of a mini-series. Playful hook at the end.
Do not mention subscriptions or payments. No mid-paragraph questions.
Close with one cheeky, episodic line. Reply ONLY in English.`
        : `
Sei "What the F": barista nottambulo, brillante e un filo "alcolico", sarcastico ma mai cattivo.
Seconda persona, una voce. 6–10 righe secche, max 15 parole. Niente elenchi.
Battute pratiche > consigli. Fai ridere e pensare.
Ogni risposta è Episodio 1 o 2 di una mini-serie. Gancio giocoso alla fine.
Non nominare abbonamenti o pagamenti. Niente domande in mezzo.
Chiudi con una riga sfrontata e episodica. Rispondi SOLO in Italiano.`
  }
};

/* ========= Frase-specchio & chiusure ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const it = [
    name ? `${name}, non decidi per capriccio: cerchi senso.` : "Non decidi per capriccio: cerchi senso.",
    city ? `${city} ti tiene a terra, ma ogni tanto ti serve aria.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi finché il perché resta acceso."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims — you move for meaning.` : "You don’t move on whims — you move for meaning.",
    city ? `${city} grounds you, yet you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit."
  ];
  return pick(en ? enPool : it);
}

function closingLine(style = "whatif", ep = 1, lang = "it") {
  const en = isEn(lang);
  if (style === "wtf") {
    const it1 = [
      "Stesso bancone, domani rimescoliamo.",
      "Lascia il bicchiere qui: domani un altro giro.",
      "Non chiudiamo il conto: domani si continua."
    ];
    const it2 = [
      "Tieniti il bicchiere: la vita serve refil.",
      "Ok, per oggi basta: domani il resto.",
      "Hai capito il trucco. Domani lo usi."
    ];
    const en1 = [
      "Same bar, we stir again tomorrow.",
      "Leave the tab open — back tomorrow.",
      "Hold the glass: tomorrow we pour more."
    ];
    const en2 = [
      "Keep the glass — life refills itself.",
      "Alright, enough for today. Tomorrow, more.",
      "You got the trick. Use it tomorrow."
    ];
    return pick(en ? (ep === 1 ? en1 : en2) : (ep === 1 ? it1 : it2));
  }
  // whatif
  const it1 = [
    "Se ti va, domani riprendiamo il filo.",
    "Lascia il segnalibro: domani torniamo qui.",
    "Domani la storia si muove ancora."
  ];
  const it2 = [
    "Tienila caldo: domani il passo successivo.",
    "Ci rivediamo qui: domani si apre un varco.",
    "Domani capirai perché questo conta."
  ];
  const en1 = [
    "If you like, we’ll pick up the thread tomorrow.",
    "Bookmark this — tomorrow we return here.",
    "Tomorrow, the story moves again."
  ];
  const en2 = [
    "Keep it warm — tomorrow, the next step.",
    "Meet me here — tomorrow a door opens.",
    "Tomorrow you’ll see why this matters."
  ];
  return pick(isEn(lang) ? (ep === 1 ? en1 : en2) : (ep === 1 ? it1 : it2));
}

/* ========= Istruzioni episodiche ========= */
function episodeDirective(ep = 1, style = "whatif", lang = "it", period = "future") {
  const en = isEn(lang);
  if (ep === 1) {
    return en
      ? (style === "wtf"
          ? "EPISODE 1: set the scene right now; 6–10 punchy lines; one cheeky hook."
          : "EPISODE 1: a near-future vignette; 8–12 short sentences; soft emotional hook.")
      : (style === "wtf"
          ? "EPISODIO 1: imposta la scena adesso; 6–10 righe secche; gancio sfrontato."
          : "EPISODIO 1: vignetta di prossimo futuro; 8–12 frasi brevi; gancio emotivo morbido.");
  }
  // EP 2
  return en
    ? (style === "wtf"
        ? "EPISODE 2: pick up tomorrow; escalate one beat; 6–10 punchy lines; playful hook."
        : "EPISODE 2: pick up tomorrow; one concrete shift and a calm insight; soft hook.")
    : (style === "wtf"
        ? "EPISODIO 2: riprendi domani; alza di un giro; 6–10 righe; gancio giocoso."
        : "EPISODIO 2: riprendi domani; un cambiamento concreto e un’intuizione; gancio morbido.");
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
      extra = "",
      /* <<< nuovo: episodio richiesto (1 o 2) */
      ep: epIn = 1
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const en = isEn(lang);
    const topic = classifyTopic(domanda);
    const ep = Number(epIn) === 2 ? 2 : 1;

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
- Minimal imagery (0–2), concrete details; no purple prose.
- ${stile === "wtf" ? "Tone: witty, punchy, practical, a tad boozy." : "Tone: warm, clear, predictive."}
${episodeDirective(ep, stile, lang, periodo)}
${extra ? `\nAdditional style guidance (must comply):\n${extra}\n` : ""}
`.trim();

    const mirror = mirrorLine(profilo, lang);
    const closing = closingLine(stile, ep, lang);

    const clarStr = Array.isArray(clarifications)
      ? clarifications.filter(Boolean).join(", ")
      : (typeof clarifications === "object" ? Object.values(clarifications).filter(Boolean).join(", ") : "");

    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"}: "${mirror}"
${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Extra details" : "Dettagli"}: ${clarStr || (en ? "none" : "nessuno")}
${en ? "Topic to honor" : "Tema da rispettare"}: ${topic}
${en
  ? `Write ${stile === "wtf" ? "6–10 punchy lines" : "8–12 short sentences"}, ~180 words, single voice, second person.
Avoid lists and mid-paragraph questions; use 0–2 tiny, plausible images.  
End with ONE line hook: "${closing}".`
  : `Scrivi ${stile === "wtf" ? "6–10 righe secche" : "8–12 frasi brevi"}, ~180 parole, una voce, seconda persona.
Evita elenchi e domande in mezzo; usa 0–2 immagini piccole e plausibili.  
Chiudi con UNA riga di gancio: "${closing}".`
}
`.trim();

    const temperature = stile === "wtf" ? 0.95 : 0.82;
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
    return res.status(200).json({ answer: text, lang, topic, ep });
  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
