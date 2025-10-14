// /api/ask.js
import OpenAI from "openai";

/* =============== Setup =============== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* =============== Helpers =============== */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|and|or|you|should|would|move|work|buy|car|bike|city|how|why)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|moto|tornassi|trasfer|lavor|comprare|città)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(auto|macchina|car|elettric)/.test(s)) return "auto";
  if (/(tornassi|trasferi|trasloco|vivere a|move|relocat)/.test(s)) return "trasferimento";
  if (/(l'aquila|aquila|milano|roma|verona|londra|zurigo|bussolengo)/.test(s)) return "città";
  if (/(lavoro|job|ricercatore|ufficio|work)/.test(s)) return "lavoro";
  if (/(comprare|acquistare|buy|purchase)/.test(s)) return "acquisto";
  return "generale";
}

function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  return `${weekday}, ${date}`;
}

/* ======== Mirror (una sola riga naturale) ======== */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0] || "";
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";

  const linesIt = [
    name ? `${name}, non insegui rumore: cerchi ritmo utile.` : `Non insegui rumore: cerchi ritmo utile.`,
    city ? `${city} ti raddrizza quando tutto corre troppo.` : `Una base familiare ti raddrizza quando tutto corre troppo.`,
    role ? `Nel lavoro (${role}) per te conta il perché, non il cartellone.` : `Nel lavoro conta il perché, non il cartellone.`
  ];
  const linesEn = [
    name ? `${name}, you don’t chase noise — you chase signal.` : `You don’t chase noise — you chase signal.`,
    city ? `${city} steadies you when life spins too fast.` : `A familiar base steadies you when life spins too fast.`,
    role ? `In ${role}, purpose beats prestige for you.` : `Purpose beats prestige for you.`
  ];
  return pick(en ? linesEn : linesIt);
}

/* ======== Clarify mirato alla domanda ======== */
function extractKeywords(q = "") {
  const tokens = q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["e","ed","di","a","da","in","con","su","per","tra","fra","the","and","of","to","for","che","sei","sei?"]);
  const freq = {};
  tokens.forEach(w => { if (!stop.has(w) && w.length > 2) freq[w] = (freq[w] || 0) + 1; });
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);
}

function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);
  const hints = extractKeywords(domanda);
  const key = (i, def) => hints[i] ? hints[i] : def;

  const Q = (id, it, enStr, phIt, phEn) => ({
    id, label: en ? enStr : it, placeholder: en ? phEn : phIt
  });

  if (topic === "auto") {
    return [
      Q("budget", "Budget reale tutto compreso al mese?", "Real all-in monthly budget?", "finanziamento+assicurazione+energia", "finance+insurance+energy"),
      Q("uso", "Uso prevalente?", "Main use?", "casa-lavoro / weekend / viaggi lunghi", "commute / weekends / long trips"),
      Q("finestra", "Quando la prenderesti davvero?", "When would you actually buy it?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months")
    ];
  }
  if (topic === "moto") {
    return [
      Q("uso", "Uso principale?", "Main use?", "città / extraurbano / viaggi", "city / extra-urban / trips"),
      Q("limite", "Limite più concreto?", "Hardest constraint?", "patente / budget / meteo", "license / budget / weather"),
      Q("finestra", "Finestra decisionale reale?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months")
    ];
  }
  if (topic === "trasferimento" || topic === "città") {
    return [
      Q("ancora", "Cosa ti tiene dove sei ora?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("segnale", "Primo segnale che direbbe “è giusto”?", "First sign that says “it’s right”?", "energia / sonno / una risposta", "energy / sleep / a callback"),
      Q("finestra", "Quando potresti farlo davvero?", "When could you actually move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months")
    ];
  }
  if (topic === "lavoro") {
    return [
      Q("perche", "Il tuo perché oggi?", "Your current why?", "impatto / crescita / serenità", "impact / growth / calm"),
      Q("opzioni", "Opzioni sul tavolo?", "Options on the table?", "restare / cambiare team / uscire", "stay / switch team / leave"),
      Q("vincolo", "Vincolo concreto da rispettare?", "Concrete constraint to respect?", "budget / tempo / famiglia", "budget / time / family")
    ];
  }

  // fallback generale ma legato ai termini chiave
  return [
    Q("tempo", `Finestra decisionale su “${key(0,"la scelta")}”?`, `Decision window for “${key(0,"the move")}”?`,
      "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    Q("segnale", `Segnale di successo su “${key(1,"il tema")}”?`, `Success signal for “${key(1,"the topic")}”?`,
      "energia / risposta / €", "energy / reply / €"),
    Q("vincolo", `Un vincolo da non sforare su “${key(2,"la mossa")}”?`, `One constraint you won’t break for “${key(2,"the move")}”?`,
      "budget / tempo / relazioni", "budget / time / relationships")
  ];
}

/* ======== PERSONAS (pulite, senza etichette da eco) ======== */
function systemFor(style, lang) {
  const en = isEn(lang);
  const base =
`${en ? "You are" : "Sei"} What?f / What the F.
${en ? "Date" : "Data"}: ${todayInfo(lang)}

Hard rules:
- ${en ? "Answer ONLY in" : "Rispondi SOLO in"} ${en ? "English" : "Italiano"}.
- ${en ? "No meta-text, no labels, no headings, no lists." : "Niente meta-testo, niente etichette, niente titoli, niente elenchi."}
- ${en ? "One voice, second person, short paragraphs." : "Una sola voce, seconda persona, paragrafi brevi."}
- ${en ? "Never write words like: mirror, JSON, example, system, prompt." : "Non scrivere mai parole come: specchio, mirror, JSON, esempio, system, prompt."}
- ${en ? "End with a soft cliffhanger that suggests we continue tomorrow (no exact times)." : "Chiudi con un cliffhanger morbido che invita a continuare domani (senza orari esatti)."}
`;

  if (style === "wtf") {
    // What the F
    return base + (en ? `
Persona: witty late-night bartender; tipsy but lucid; kind, never mean.
Style: 7–11 lively lines, clever jokes, warm vibe; zero sadness; tiny concrete image ok; no poetry.
` : `
Persona: barista notturno brillante; un po’ alticcio ma lucido; affettuoso, mai cattivo.
Stile: 7–11 righe vive, battute intelligenti, calore; zero tristezza; una piccola immagine concreta ok; niente poesia.
`);
  }

  // What?f
  return base + (en ? `
Persona: calm, clear, quietly perceptive friend; optimistic and practical.
Style: 9–13 concise sentences; upbeat; zero melancholy; no syrupy poetry; feels like you know the user (light, plausible details).
` : `
Persona: amico lucido e asciutto; ottimista e pratico.
Stile: 9–13 frasi concise; allegro; zero malinconia; niente zucchero poetico; sembra che lo conosci (dettagli plausibili e leggeri).
`);
}

/* ======== Follow-ups coerenti ======== */
function followupPrompt(lang, domanda, answer, style) {
  const en = isEn(lang);
  return `
${en ? "Propose exactly 2 short follow-up questions tied to the user's question AND your answer. Return JSON only." :
       "Proponi esattamente 2 domande brevi di follow-up legate sia alla domanda dell’utente SIA alla tua risposta. Restituisci solo JSON."}
Schema: {"followups":["q1","q2"]}
Tone: ${style === "wtf" ? (en ? "witty bartender, playful" : "barista brillante, giocoso") : (en ? "empathetic, upbeat" : "empatico, positivo")}
Question: "${domanda}"
Answer excerpt: "${(answer||"").replace(/\s+/g," ").slice(0,400)}"
`.trim();
}

/* =============== Handler HTTP =============== */
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
      extra = ""
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const topic = classifyTopic(domanda);

    /* ---- Clarify branch ---- */
    if (clarify) {
      const qs = clarifyQuestions(domanda, periodo, lang);
      return res.status(200).json({ questions: qs });
    }

    /* ---- Generation ---- */
    const system = systemFor(stile === "wtf" ? "wtf" : "whatif", lang);
    const mirror = mirrorLine(profilo, lang);
    const en = isEn(lang);

    // Istruzione utente pulita (niente etichette)
    const userMsg = [
      // 1) Una riga di mirror da integrare naturalmente
      (en
        ? `Open with ONE natural sentence that reflects the user: ${mirror}`
        : `Apri con UNA frase naturale che rispecchia l’utente: ${mirror}`),

      // 2) Domanda + contesto
      (en ? `User question: "${domanda}"` : `Domanda utente: "${domanda}"`),
      (en
        ? `Context (brief, optional): ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : "none"}`
        : `Contesto (breve, opzionale): ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : "nessuno"}`),

      // 3) Vincoli di stile specifici
      (stile === "wtf"
        ? (en
          ? `Write 7–11 lively lines, witty bartender tone, playful and warm. Zero melancholy, zero meanness, no lists.`
          : `Scrivi 7–11 righe vive, tono da barista brillante, giocoso e caldo. Zero malinconia, zero cattiveria, niente elenchi.`)
        : (en
          ? `Write 9–13 concise upbeat sentences, empathetic and practical. Zero melancholy, no lists, no poetry.`
          : `Scrivi 9–13 frasi concise e allegre, empatiche e pratiche. Zero malinconia, niente elenchi, niente poesia.`)
      ),

      // 4) Chiusura soft
      (en
        ? `Close with a soft cliffhanger that implies we continue tomorrow. Do not mention exact times.`
        : `Chiudi con un cliffhanger morbido che invita a continuare domani. Non citare orari esatti.`),

      // 5) Parole proibite da NON stampare
      (en
        ? `Never output these words: mirror, JSON, example, system, prompt, label, heading.`
        : `Non scrivere mai queste parole: specchio, mirror, JSON, esempio, system, prompt, etichetta, titolo.`),

      extra ? (en ? `Additional guidance: ${extra}` : `Indicazioni extra: ${extra}`) : ""
    ].filter(Boolean).join("\n");

    const temperature = stile === "wtf" ? 0.95 : 0.82;
    const max_tokens = 700;

    // Streaming SSE opzionale
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL,
        temperature,
        max_tokens,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg }
        ]
      });

      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // Non-stream: testo + followups coerenti
    const c = await client.chat.completions.create({
      model: MODEL,
      temperature,
      max_tokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg }
      ]
    });
    const text = (c.choices?.[0]?.message?.content || "").trim();

    // Follow-up (JSON)
    let followups = [];
    try {
      const f = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 120,
        messages: [
          { role: "system", content: isEn(lang) ? "Return JSON only." : "Restituisci solo JSON." },
          { role: "user", content: followupPrompt(lang, domanda, text, stile) }
        ]
      });
      const raw = (f.choices?.[0]?.message?.content || "").trim();
      const j = JSON.parse(raw);
      if (Array.isArray(j.followups)) followups = j.followups.slice(0,2).map(s => String(s).trim()).filter(Boolean);
    } catch {
      followups = isEn(lang)
        ? [
            "What small sign tomorrow would tell you this is right?",
            "What constraint would you relax for a week to test it?"
          ]
        : [
            "Quale piccolo segnale domani ti direbbe che è la direzione giusta?",
            "Quale vincolo allenteresti per una settimana per testarlo?"
          ];
    }

    return res.status(200).json({ answer: text, lang, topic, followups });

  } catch (err) {
    console.error("API /ask error:", err?.message || err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
