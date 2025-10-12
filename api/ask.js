// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Utils ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickN = (arr, n) => {
  const a = [...arr]; const out = [];
  while (a.length && out.length < n) out.push(a.splice(Math.floor(Math.random()*a.length),1)[0]);
  return out;
};

function detectLang(text = "") {
  // Semplice euristica: “auto” usa la domanda per dedurre
  const enHits = (text.match(/\b(what|if|and|or|you|i|buy|move|work|city|should|would)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|comprar|moto|tornassi|lavorare|andare|città)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(barca|vela|gommone|yacht|boat)/.test(s)) return "barca";
  if (/(tornassi|trasferi|trasloco|vivere|andassi a vivere|move|relocat)/.test(s)) return "trasferimento";
  if (/(lugano|aquila|l'aquila|milano|roma|verona|bussolengo|london|paris|berlin)/.test(s)) return "città";
  if (/(lavoro|job|azienda|ufficio|work|career)/.test(s)) return "lavoro";
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
Second person, single voice. 8–12 short sentences (~180 words).
Sound like you know the user without saying it. Read the mood; anticipate next steps.
NO labels like “indicator/constraint/trade-off/first step” — show, don’t name.
Low-metaphor (0–2 tiny images), realistic details, calm cadence. No lists, no titles, no emojis.
Stay strictly on the user’s topic. Keep it timeless.
Close with a soft, varied invite to return tomorrow for two micro-questions.
Answer ONLY in ${isEn(lang) ? "English" : "Italian"}.
` : `
Sei "What?f": voce empatica e lucida.
Seconda persona, una sola voce. 8–12 frasi brevi (~180 parole).
Fai percepire che conosci l’utente senza dirlo. Leggi l’umore; anticipa il passo successivo.
Niente etichette tipo “indicatore/vincolo/trade-off/primo passo”: mostra, non nominare.
Metafore minime (0–2), dettagli realistici, ritmo calmo. Niente elenchi, niente titoli, niente emoji.
Resta strettamente sul tema della domanda. Senza tempo.
Chiudi con un invito morbido e variato a tornare domani per due micro-domande.
Rispondi SOLO in ${isEn(lang) ? "English" : "Italiano"}.
`)
  },
  wtf: {
    system: (lang) => (isEn(lang) ? `
You are "What the F": bar-counter friend — sharp, fast, affectionate.
Second person, single voice. 6–10 punchy lines (not bullets), no titles, no emojis.
High wit, zero meanness, no profanity, no lectures. Minimal imagery, concrete and on-topic.
Keep it practical and funny; no poetry. Short cadence.
End with a tight quip like “two clean shots tomorrow”.
Answer ONLY in ${isEn(lang) ? "English" : "Italian"}.
` : `
Sei "What the F": amico da bancone — brillante, rapido, affettuosamente spietato.
Seconda persona, una voce. 6–10 righe secche (non elenchi), niente titoli, niente emoji.
Ironia alta, zero volgarità, zero prediche. Immagini minime, concreto e in tema.
Pratico e divertente; niente lirica. Ritmo corto.
Chiudi con una battuta asciutta tipo “domani due colpi secchi”.
Rispondi SOLO in ${isEn(lang) ? "English" : "Italiano"}.
`)
  }
};

/* ========= Mirror line (specchio) ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (profile?.goals && profile.goals[0]) || profile?.goal || "";

  const itPool = [
    name ? `${name}, non decidi per capriccio: cerchi senso.` : "Non decidi per capriccio: cerchi senso.",
    city ? `${city} ti tiene a terra, ma ogni tanto cerchi aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi finché il perché resta acceso.",
    goal ? `In testa gira questo: ${goal}. Il resto deve allinearsi.` : "Hai un punto fermo: il resto deve allinearsi."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims — you move for meaning.` : "You don’t move on whims — you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit.",
    goal ? `There’s a clear target: ${goal}. Everything else must align.` : "There’s a fixed point; everything else must align."
  ];
  return pick(en ? enPool : itPool);
}

/* ========= Closings (variate) ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani due micro-domande e andiamo dritti.",
    "Se torni domani, due dettagli e si chiarisce.",
    "Quando vuoi: due micro-cue e si svolta.",
    "Passa domani: due note rapide e continuiamo bene."
  ];
  const itSharp = [
    "Stop qui. Domani due colpi secchi e si decide.",
    "Bancone chiuso: domani due cue puliti.",
    "Pausa. Domani due tiri netti.",
    "Ok, chiudo qui: domani due domande veloci."
  ];
  const enSoft = [
    "Tomorrow two micro-questions and we move clean.",
    "Come back tomorrow: two small cues, clearer path.",
    "We’ll pick it up tomorrow with two quick prompts.",
    "Drop by tomorrow — two tiny notes and we keep going."
  ];
  const enSharp = [
    "Pause here. Tomorrow, two clean shots.",
    "Bar’s closed — tomorrow two sharp cues.",
    "Stop here. Two crisp hits tomorrow.",
    "Enough for now. Two quick jabs tomorrow."
  ];
  if (style === "wtf") return pick(en ? enSharp : itSharp);
  return pick(en ? enSoft : itSoft);
}

/* ========= Clarify questions (variabili per topic) ========= */
function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);

  const Q = (id, it, enStr, phIt, phEn) => ({
    id,
    label: en ? enStr : it,
    placeholder: en ? phEn : phIt
  });

  const pool = {
    moto: [
      Q("timing", "Quando la prenderesti davvero?", "When exactly would you buy it?", "questo mese / 3–6 mesi", "this month / 3–6 months"),
      Q("use", "Per cosa la useresti di più?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekend / trips"),
      Q("budget", "Tetto di spesa mensile realistico?", "Real monthly budget ceiling?", "€ X tra assicurazione/carburante", "$/£ X insurance+fuel"),
      Q("feel", "Che sensazione cerchi davvero?", "What feeling are you actually chasing?", "libertà / ritmo / sfogo", "freedom / pace / outlet"),
      Q("route", "Dove ti vedi andare nei primi 30 giorni?", "Where do you see yourself riding first 30 days?", "casa–lavoro / colline / litorale", "commute / hills / coast"),
    ],
    trasferimento: [
      Q("window", "Finestra realistica per spostarti?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei ora?", "What anchors you where you are?", "famiglia/lavoro/costi", "family/work/costs"),
      Q("signal", "Che segno ti direbbe: è la scelta giusta?", "What sign would say: it’s right?", "sonno/energia/inviti scelti", "sleep/energy/chosen invites"),
      Q("tie", "Chi o cosa vorresti portare con te?", "Who/what would you bring with you?", "persona/abitudine/luogo", "person/habit/place"),
    ],
    lavoro: [
      Q("why", "Qual è il tuo perché adesso?", "What’s your current why?", "impatto/crescita/serenità", "impact/growth/calm"),
      Q("option", "Quali opzioni hai davvero sul tavolo?", "What options are truly on the table?", "resto/cambio team/uscita", "stay/switch/leave"),
      Q("limit", "Vincolo più concreto?", "Most concrete limit?", "budget/tempo/relazioni", "budget/time/people"),
      Q("tell", "Cosa ti direbbe che stai andando bene tra 30 giorni?", "What would tell you it's working in 30 days?", "sonno/ritmo/email brevi", "sleep/pace/short emails"),
    ],
    acquisto: [
      Q("need", "È un bisogno o un upgrade?", "Need or upgrade?", "necessità/upgrade/misurabile", "need/upgrade/measurable"),
      Q("limit", "Cap di spesa realistico?", "Realistic spending cap?", "€ / rate / soglia", "$/£ / installments / cap"),
      Q("why", "Cosa deve cambiare dal giorno uno?", "What must change day one?", "tempo/qualità/serenità", "time/quality/calm"),
    ],
    barca: [
      Q("use", "Quando e con chi la useresti più spesso?", "When and with whom would you use it most?", "weekend/estate/famiglia", "weekends/summer/family"),
      Q("costs", "Hai già stimato i costi fissi?", "Estimated fixed costs?", "ormeggio/manutenzione/carburante", "mooring/maintenance/fuel"),
      Q("window", "Quando prenderesti la decisione?", "When would you decide?", "questo mese/entro 6 mesi", "this month/within 6 months"),
    ],
    generale: [
      Q("window", "Finestra reale della decisione?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
      Q("signal", "Un segno personale da osservare?", "A personal sign to watch?", "sonno/energia/prima risposta", "sleep/energy/first reply"),
      Q("limit", "Limite più concreto?", "Most concrete limit?", "budget/tempo/energia", "budget/time/energy")
    ]
  };

  // mescola + prendi 3 dal pool del topic
  const bag = pool[topic] || pool.generale;
  return pickN(bag, 3);
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

    // lingua: auto => deduci dalla domanda
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
- Stay strictly on topic derived from the user question: "${topic}".
- No lists, no headings/titles, no emojis, no rhetorical questions (except the final line).
- Keep metaphors minimal (0–2 tiny, plausible); avoid purple prose.
- ${stile === "wtf" ? (en ? "Be witty, punchy, concrete." : "Sii brillante, secco, concreto.") : (en ? "Be warm, clear, predictive." : "Sii caldo, chiaro, predittivo.")}
- Never use explicit labels like indicator/constraint/trade-off/first step. Weave them naturally.
`.trim();

    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"} (paraphrase naturally): "${mirror}"

${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Extra details" : "Dettagli"}: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (en ? "none" : "nessuno")}
${en ? "Timeframe" : "Periodo"}: ${periodo === "past" ? (en ? "counterfactual" : "controfattuale") : (en ? "near-future" : "futuro vicino")}
${en ? "Topic to honor" : "Tema da rispettare"}: ${topic}

${en
  ? `Write ${stile === "wtf" ? "6–10 punchy lines" : "8–12 short sentences"}, max ~180 words, single voice, second person.
Avoid lists and headings; use 0–2 tiny, plausible images. End with one ${stile === "wtf" ? "quip" : "soft invite"} like: "${closing}".`
  : `Scrivi ${stile === "wtf" ? "6–10 righe secche" : "8–12 frasi brevi"}, max ~180 parole, una sola voce, seconda persona.
Evita elenchi e titoli; usa 0–2 immagini piccole e plausibili. Chiudi con una ${stile === "wtf" ? "battuta" : "riga morbida"} tipo: "${closing}".`
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
