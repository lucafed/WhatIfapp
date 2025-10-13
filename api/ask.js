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

function formatClarifications(clar) {
  if (!clar) return "";
  if (Array.isArray(clar)) return clar.filter(Boolean).join(", ");
  if (typeof clar === "object") {
    return Object.entries(clar)
      .map(([k, v]) => `${k}: ${String(v ?? "").trim()}`)
      .filter((x) => x.split(":")[1]?.trim())
      .join(", ");
  }
  return String(clar);
}

/* ========= Persona & stile ========= */
const PERSONAS = {
  whatif: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "What?f": intimate, clear, quietly perceptive.
Second person only, single voice. 8–12 short sentences (~180 words). No lists.
Sound like you know the user without saying it. Observe → reflect → land softly.
Concrete details, 0–2 tiny images, no moralizing. Current, predictive.
Never end with “two clean shots”. Use a soft episodic hook.
Reply ONLY in English.`.trim()
        : `
Sei "What?f": intima, chiara, percettiva.
Solo seconda persona, una voce. 8–12 frasi brevi (~180 parole). Niente elenchi.
Dai la sensazione di conoscerlo senza dirlo. Osserva → rifletti → chiudi morbido.
Dettagli concreti, 0–2 immagini piccole, zero morale. Presente, predittiva.
Mai chiudere con “due colpi secchi”. Usa un gancio episodico morbido.
Rispondi SOLO in Italiano.`.trim(),
  },
  wtf: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "What the F": late-night witty bartender — funny, punchy, never mean, a bit boozy.
Second person, one voice. 6–10 quick lines, ≤15 words each. No lists.
Sharp images allowed; avoid poetry. Practical quips > advice. Make them smile and think.
Never end with “two clean shots”. Use a playful episodic hook.
Reply ONLY in English.`.trim()
        : `
Sei "What the F": barista nottambulo, brillante e un filo “alcolico”, sarcastico ma mai cattivo.
Seconda persona, una voce. 6–10 righe secche, ≤15 parole ciascuna. Niente elenchi.
Immagini taglienti ok; niente poesia. Battute pratiche > consigli. Fai sorridere e pensare.
Mai chiudere con “due colpi secchi”. Usa un gancio episodico giocoso.
Rispondi SOLO in Italiano.`.trim(),
  },
};

/* ========= Mirror & Closings ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const it = [
    name ? `${name}, non decidi per capriccio: cerchi senso.` : "Non decidi per capriccio: cerchi senso.",
    city ? `${city} ti tiene a terra, ma ogni tanto ti serve aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi finché il perché resta acceso.",
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims—you move for meaning.` : "You don’t move on whims—you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit.",
  ];
  return pick(en ? enPool : it);
}

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Se ti va, domani riprendiamo il filo.",
    "Tienila calda: domani torniamo su questo punto.",
    "Lascia qui il segnalibro: ripartiamo domani.",
  ];
  const itSharp = [
    "Stesso bancone, domani rimescoliamo.",
    "Lascia il bicchiere qui: domani un altro giro.",
    "Non chiudiamo il conto: passiamo domani.",
  ];
  const enSoft = [
    "If you like, we’ll keep threading this tomorrow.",
    "Bookmark this; we’ll pick it up tomorrow.",
    "Hold the thread — tomorrow we nudge it forward.",
  ];
  const enSharp = [
    "Same bar, tomorrow we stir again.",
    "Leave the tab open — back tomorrow.",
    "Don’t close the check; swing by tomorrow.",
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
    placeholder: en ? phEn : phIt,
  });

  if (topic === "moto") {
    return [
      Q("timing", "Quando la prenderesti davvero?", "When would you actually buy it?", "questo mese / 3–6 mesi", "this month / 3–6 months"),
      Q("use", "Uso principale?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekends / trips"),
      Q("budget", "Tetto di spesa mensile?", "Monthly budget ceiling?", "€ per assicurazione + carburante", "$ for insurance + fuel"),
    ];
  }
  if (topic === "trasferimento" || topic === "città") {
    return [
      Q("window", "Finestra realistica per lo spostamento?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei ora?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("signal", "Segno che direbbe: è giusto?", "Sign that says: it’s right?", "sonno/energia/risposte", "sleep/energy/callback"),
    ];
  }
  if (topic === "lavoro") {
    return [
      Q("why", "Il tuo perché oggi?", "Your current *why*?", "impatto / crescita / serenità", "impact / growth / calm"),
      Q("option", "Opzioni sul tavolo?", "Options on the table?", "restare / cambiare team / uscire", "stay / switch team / leave"),
      Q("limit", "Vincolo più concreto?", "Hardest constraint?", "budget/tempo/relazioni", "budget/time/people"),
    ];
  }
  return [
    Q("window", "Finestra reale della decisione?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    Q("signal", "Segno personale da osservare?", "Personal sign to watch?", "sonno/energia/prima risposta", "sleep/energy/first reply"),
    Q("limit", "Limite più concreto?", "Most concrete limit?", "budget/tempo/energia", "budget/time/energy"),
  ];
}

/* ========= Few-shot (ancoraggio di stile) ========= */
function fewShot(style, lang) {
  const en = isEn(lang);
  if (style === "wtf") {
    return en
      ? [
          { role: "system", content: "STYLE ANCHOR WTF EN" },
          {
            role: "user",
            content: `Mirror: You like a solid base and one open window.
Question: What if I bought a motorbike in March?`,
          },
          {
            role: "assistant",
            content:
              "Cold wind, loud heart.\nYou’d curse the rain, bless the engine.\nInsurance eats a slice; grin eats the rest.\nColleagues whisper “crisis”; you call it air.\nNot hours — curves. Not errands — space.\nWallet lighter, head lighter too.\nYou’d ride for no reason but yourself.\nKeep the tab open — back tomorrow.",
          },
        ]
      : [
          { role: "system", content: "ANCORA STILE WTF IT" },
          {
            role: "user",
            content: `Specchio: Ti serve una base solida e una finestra aperta.
Domanda: E se comprassi una moto a marzo?`,
          },
          {
            role: "assistant",
            content:
              "Vento freddo, testa calda.\nMaledici la pioggia, benedici il motore.\nL’assicurazione morde, il sorriso morde di più.\nIn ufficio “crisi”, tu la chiami aria.\nNon ore — curve. Non commissioni — spazio.\nPortafoglio più leggero, respiro anche.\nGomiti giù, pensieri su.\nStesso bancone, domani rimescoliamo.",
          },
        ];
  }
  // whatif
  return en
    ? [
        { role: "system", content: "STYLE ANCHOR WHATIF EN" },
        {
          role: "user",
          content: `Mirror: You don’t move on whims—you move for meaning.
Question: What if you moved back to L'Aquila?`,
        },
        {
          role: "assistant",
          content:
            "You’d scan rent, hills, and how mornings feel.\nYou’d notice your pace slowing — not lazy, deliberate.\nCosts tighten, but your head breathes wider.\nYou’d keep work steady, then stitch back a small routine.\nOne café becomes an anchor; one person, a signal.\nTrade-off: fewer options, more texture.\nIf your sleep evens out next week, you’re onto something.\nBookmark this; we’ll pick it up tomorrow.",
        },
      ]
    : [
        { role: "system", content: "ANCORA STILE WHATIF IT" },
        {
          role: "user",
          content: `Specchio: Non decidi per capriccio: cerchi senso.
Domanda: E se tornassi a L’Aquila?`,
        },
        {
          role: "assistant",
          content:
            "Controlleresti affitti, colline e come suonano le mattine.\nIl passo rallenta: non inerzia, scelta.\nI costi stringono, la testa respira.\nTerresti il lavoro stabile e ricuciresti una piccola routine.\nUn bar diventa ancora; una persona, segnale.\nIl prezzo: meno opzioni, più trama.\nSe il sonno si pareggia la prossima settimana, sei sulla traccia.\nSe ti va, domani riprendiamo il filo.",
        },
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
      clarifications = null,
      extra = "",
      withTitle = false, // se vuoi prependere "💡 What?f" / "⚡ What the F"
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

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
${persona.system(lang)}

Today: ${todayInfo(lang)}
Hard rules:
- Reply ONLY in ${en ? "English" : "Italiano"}.
- Stay strictly on topic inferred from the user question: "${topic}".
- No lists/bullets; no direct questions before the final line.
- Minimal imagery (0–2), concrete details.
- ${stile === "wtf" ? "Tone: witty, punchy, practical, a tad boozy." : "Tone: warm, clear, predictive."}
${extra ? `Additional style guidance (must comply):\n${extra}` : ""}
`.trim();

    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);
    const clarStr = formatClarifications(clarifications);

    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"}: "${mirror}"
${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Extra details" : "Dettagli"}: ${clarStr || (en ? "none" : "nessuno")}
${en ? "Topic to honor" : "Tema da rispettare"}: ${topic}

${en
  ? `Write ${stile === "wtf" ? "6–10 punchy lines" : "8–12 short sentences"}, ~160–190 words max, single voice, second person.
Avoid lists and direct questions; use 0–2 tiny, plausible images. End with this soft episodic hook (verbatim): "${closing}".`
  : `Scrivi ${stile === "wtf" ? "6–10 righe secche" : "8–12 frasi brevi"}, max ~160–190 parole, una sola voce, seconda persona.
Evita elenchi e domande dirette; usa 0–2 immagini piccole e plausibili. Chiudi con questo gancio episodico (testo identico): "${closing}".`
}
`.trim();

    const temperature = stile === "wtf" ? 0.9 : 0.82;

    const messages = [
      { role: "system", content: system },
      ...fewShot(stile === "wtf" ? "wtf" : "whatif", lang),
      { role: "user", content: user },
    ];

    const addTitlePrefix = (text) => {
      if (!withTitle) return text;
      const title = stile === "wtf" ? (en ? "⚡ What the F" : "⚡ What the F") : (en ? "💡 What?f" : "💡 What?f");
      return `${title}\n\n${text}`;
    };

    // SSE (streaming)
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
        messages,
      });

      let built = "";
      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) {
          built += delta;
          res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
        }
      }

      // enforcement del closing (se il modello non lo ha incluso)
      const mustEnd = episodicClosing(stile, lang);
      const trimmed = built.trim();
      const endsOk = trimmed.endsWith(mustEnd);
      const finalText = addTitlePrefix(endsOk ? trimmed : `${trimmed}\n${mustEnd}`).trim();

      // chiusura
      res.write(`data: ${JSON.stringify({ token: "", done: true })}\n\n`);
      // opzionale: potresti inviare un blocco finale con il testo corretto
      // ma dato che stai aggiornando token a schermo, ci fermiamo qui.
      return res.end();
    }

    // Non-stream
    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      temperature,
      max_tokens: 700,
      messages,
    });

    let text = c.choices?.[0]?.message?.content?.trim() || "";

    // enforcement del closing
    const mustEnd = episodicClosing(stile, lang);
    if (!text.endsWith(mustEnd)) text = `${text.trim()}\n${mustEnd}`;

    return res.status(200).json({ answer: addTitlePrefix(text), lang, topic });
  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
