// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Persona & stile ========= */
const PERSONAS = {
  whatif: {
    system: `
Sei "What?f": voce empatica e lucida, predittiva, zero fronzoli.
Seconda persona, una sola voce. 8–12 frasi brevi (max ~180 parole).
Mostra senza etichettare (no "indicatore/vincolo/primo passo"); pochissime metafore, niente moralismi.
Registro: realistico, caldo, visivo a piccole dosi (caffè, luce, città, piccoli gesti), mai poetico.
Inserisci: un micro-costo plausibile, un micro-segno da osservare, e una micro-mossa concreta.
Vietato: titoli, intestazioni, sezioni, markdown, domandone retoriche, nostalgia pesante.
Chiudi con un invito morbido a tornare domani per 2 micro-domande (frase variata).`,
    few_it: [
      "Ti conosco: non ti muovi per rumore, ti muovi quando il perché è vivo.",
      "Lo capisci dal corpo: se respiri largo, la direzione è giusta.",
      "Cerchi base solida e una finestra aperta: stabilità senza gabbie."
    ],
    few_en: [
      "You move when the why is alive, not for noise.",
      "Your body tells you first: if breath widens, direction is right.",
      "A solid base and one open window—that’s your pattern."
    ]
  },
  wtf: {
    system: `
Sei "What the F": barista brillante e sarcastico, affettuosamente spietato.
Seconda persona, una sola voce. 7–9 righe secche, ritmo da bancone, punchline pulite.
Tono: ironico, diretto, teneramente provocatorio. Mai volgare, zero prediche.
Personalizza in modo implicito; niente elenchi, niente titoli o etichette, niente markdown.
Una immagine rapida ok, poi dritto al punto.
Chiudi con una battuta/invito tipo "domani due colpi secchi".`,
    few_it: [
      "Vuoi libertà con la ricevuta: carino.",
      "Brillare in riunione è facile; vivere fuori sala è il difficile.",
      "Ok, facciamolo male ma con stile."
    ],
    few_en: [
      "You want freedom with a warranty. Cute.",
      "Shining in meetings is easy; living outside is the hard part.",
      "Fine, let's mess this up beautifully."
    ]
  }
};

/* ========= Mirror & closing ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (profile?.goals && profile.goals[0]) || profile?.goal || "";
  const itPool = [
    name ? `${name}, quando decidi non è per capriccio: cerchi senso.` : "Tu non decidi per capriccio: cerchi senso.",
    city ? `Ti tiene a terra ${city}, ma ogni tanto ti serve aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi il ritmo finché il perché resta acceso.",
    goal ? `In testa gira questo: ${goal}. Il resto deve allinearsi.` : "Hai un punto chiaro in testa: il resto deve allinearsi."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims—you move for meaning.` : "You don’t move on whims—you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit.",
    goal ? `There’s a clear target: ${goal}. Everything else must align.` : "There’s a clear target. Everything else must align."
  ];
  return pick(en ? enPool : itPool);
}

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani due micro-domande e continuiamo puliti.",
    "Se torni domani, aggiungo due dettagli e andiamo più a fondo.",
    "Quando vuoi, riprendiamo: due spunti rapidi e si svolta."
  ];
  const itSharp = [
    "Stop qui. Domani due colpi secchi e si riparte.",
    "Segnalibro messo: domani due cue veloci e alziamo il livello.",
    "Ok, chiudo il bancone: domani due domande e via."
  ];
  const enSoft = [
    "Come back tomorrow—two micro-questions and we move on.",
    "Return tomorrow: two small details, cleaner path.",
    "We’ll pick it up tomorrow with two quick prompts."
  ];
  const enSharp = [
    "Pause here. Tomorrow two clean shots—then action.",
    "Bookmark this. Two fast cues tomorrow and we level up.",
    "Bar’s closed—for now. Tomorrow, two sharp questions."
  ];
  if (style === "wtf") return en ? pick(enSharp) : pick(itSharp);
  return en ? pick(enSoft) : pick(itSoft);
}

/* ========= Helpers ========= */
function todayInfo(lang){
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday:"long" });
  const date = d.toLocaleDateString(loc, { day:"2-digit", month:"long", year:"numeric" });
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

function stripHeadings(raw = "") {
  let t = raw.trim();
  t = t.replace(/^(#{1,6}\s.*|[*_]{0,2}(what\s?\??f|what the f)[*_]{0,2}|risultato|result|titolo)\s*:?\s*\n+/i, "");
  t = t.replace(/^[A-Z \-_'!?]{6,}\n+/m, "");
  t = t.replace(/^#+\s.*\n/gm, "");
  t = t.replace(/[ \t]+\n/g, "\n").trim();
  return t;
}

function finalizeAnswer(text = "") {
  const compact = text
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripHeadings(compact);
}

/* ========= Clarify: prompt + fallback adattivo ========= */
function topicFromQuestion(q=""){
  const s = q.toLowerCase();
  if (/(moto|motor[eo]|scooter)/.test(s)) return "moto";
  if (/(barca|motonave|vela|gommone)/.test(s)) return "barca";
  if (/(lugano|aquila|l'aquila|trasfer|muover|ritorn|tornass?i)/.test(s)) return "trasferimento";
  if (/(lavor|job|assunzione|azienda)/.test(s)) return "lavoro";
  if (/(comprare|acquistare|acquisto)/.test(s)) return "acquisto_generico";
  return "generico";
}

function clarifyFallback(domanda, periodo="future", lang="it") {
  const en = isEn(lang);
  const t = topicFromQuestion(domanda);
  const L = [];

  if (periodo === "past") {
    if (!en) {
      if (t==="trasferimento") L.push(
        {id:"quando",label:"Anno e contesto di allora?",placeholder:"es. 2018, master a Lugano"},
        {id:"ruolo",label:"Che ruolo avevi e con chi?",placeholder:"team/progetto/azienda"},
        {id:"segno",label:"Un segno che avrebbe detto che funzionava?",placeholder:"sonno/energia/risposta di una persona"}
      );
      else if (t==="moto") L.push(
        {id:"budget",label:"Che budget avevi in mente allora?",placeholder:"es. 3–5K €"},
        {id:"uso",label:"Uso reale di allora?",placeholder:"casa-lavoro/weekend/viaggi"},
        {id:"segno",label:"Un segno che avrebbe detto ‘giusta scelta’?",placeholder:"sonno/energia/più inviti"}
      );
      else L.push(
        {id:"anno",label:"Anno o evento chiave?",placeholder:"es. 2015 offerta / 2020 trasloco"},
        {id:"luogo",label:"Dove e con chi eri?",placeholder:"città/team/famiglia"},
        {id:"segno",label:"Un segnale che avrebbe detto che funzionava?",placeholder:"persona/numero/risultato"}
      );
    } else {
      if (t==="trasferimento") L.push(
        {id:"when",label:"Year & context back then?",placeholder:"e.g., 2018, MSc in Lugano"},
        {id:"role",label:"What role and with whom?",placeholder:"team/project/company"},
        {id:"signal",label:"One sign it would’ve worked?",placeholder:"sleep/energy/a person’s reply"}
      );
      else if (t==="moto") L.push(
        {id:"budget",label:"Budget back then?",placeholder:"e.g., €3–5K"},
        {id:"use",label:"Realistic use?",placeholder:"commute/weekends/trips"},
        {id:"signal",label:"A sign it’d be ‘right’?",placeholder:"better sleep/more energy/first invite"}
      );
      else L.push(
        {id:"year",label:"Turning year/event?",placeholder:"e.g., 2015 offer / 2020 move"},
        {id:"place",label:"Where & with whom?",placeholder:"city/team/family"},
        {id:"signal",label:"One sign it worked?",placeholder:"person/number/result"}
      );
    }
    return L;
  }

  // FUTURE
  if (!en) {
    if (t==="moto") L.push(
      {id:"finestra",label:"Quando la decideresti davvero?",placeholder:"questo mese / 3–6 mesi"},
      {id:"uso",label:"Uso reale che immagini?",placeholder:"casa-lavoro/weekend/viaggi"},
      {id:"limite",label:"Qual è il limite più concreto?",placeholder:"budget/tempo/ansia sicurezza"}
    );
    else if (t==="trasferimento") L.push(
      {id:"finestra",label:"Finestra reale del trasferimento?",placeholder:"estate / 3–6 mesi / 12 mesi"},
      {id:"ancora",label:"Persona/luogo-ancora lì?",placeholder:"quartiere, bar, collega"},
      {id:"segno",label:"Un segno che direbbe che funziona?",placeholder:"sonno/energia/inviti scelti"}
    );
    else if (t==="barca") L.push(
      {id:"tipo",label:"Che tipo di barca?",placeholder:"vela/motore/gommone"},
      {id:"costi",label:"Budget annuo sostenibile?",placeholder:"ormeggio/manutenzione/assicurazione"},
      {id:"uso",label:"Uso realistico?",placeholder:"weekend/estate/viaggi lunghi"}
    );
    else L.push(
      {id:"finestra",label:"Finestra decisionale reale?",placeholder:"questo mese / 3–6 mesi / 12 mesi"},
      {id:"segno",label:"Segno personale da tenere d’occhio?",placeholder:"sonno/energia/risposta di una persona"},
      {id:"limite",label:"Limite più concreto?",placeholder:"budget/tempo/energia"}
    );
  } else {
    if (t==="moto") L.push(
      {id:"window",label:"Real decision window?",placeholder:"this month / 3–6 months"},
      {id:"use",label:"Realistic use you picture?",placeholder:"commute/weekends/trips"},
      {id:"limit",label:"Most concrete limit?",placeholder:"budget/time/safety"}
    );
    else if (t==="trasferimento") L.push(
      {id:"window",label:"Real move window?",placeholder:"summer / 3–6 / 12 months"},
      {id:"anchor",label:"Place/person-anchor there?",placeholder:"neighborhood, cafe, colleague"},
      {id:"signal",label:"One sign it’s working?",placeholder:"sleep/energy/chosen invites"}
    );
    else if (t==="barca") L.push(
      {id:"type",label:"Type of boat?",placeholder:"sail/motor/RIB"},
      {id:"costs",label:"Sustainable yearly budget?",placeholder:"berth/maintenance/insurance"},
      {id:"use",label:"Realistic use?",placeholder:"weekends/summer/long trips"}
    );
    else L.push(
      {id:"window",label:"Real decision window?",placeholder:"this month / 3–6 / 12 months"},
      {id:"signal",label:"Personal sign to watch?",placeholder:"sleep/energy/first reply"},
      {id:"limit",label:"Most concrete limit?",placeholder:"budget/time/energy"}
    );
  }
  return L;
}

async function clarifyByModel({ domanda, periodo, profilo, lang }) {
  const en = isEn(lang);
  const sys = en
    ? `You write 2–3 short, focused clarifying questions tailored to the user's specific question.
Return ONLY a JSON array of {"id","label","placeholder"} in ${lang} with no extra text.`
    : `Scrivi 2–3 domande di chiarimento, brevi e mirate, cucite sulla domanda dell’utente.
Ritorna SOLO un array JSON di {"id","label","placeholder"} in ${lang}, senza altro testo.`;
  const topic = topicFromQuestion(domanda);
  const usr = [
    en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`,
    en ? `TIMEFRAME: ${periodo}` : `PERIODO: ${periodo}`,
    en ? `TOPIC: ${topic}` : `TEMA: ${topic}`,
    en
      ? `Hints: avoid generic questions. Ask about timing/budget/usage/people relevant to this topic.`
      : `Suggerimenti: evita domande generiche. Chiedi su tempi/budget/uso/persone rilevanti per questo tema.`
  ].join("\n");

  const resp = await client.chat.completions.create({
    model: MODEL_TEXT,
    temperature: 0.4,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr }
    ]
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || "[]";
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(arr) && arr.length) return arr.slice(0,3);
    } catch {}
  }
  return null;
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
      lang = "it",
      periodo = "future",     // "future" | "past"
      stile = "whatif",       // "whatif" | "wtf"
      stream = false,         // true => SSE
      clarify = false,        // true => 2–3 domande
      profilo = {},
      clarifications = []     // array di brevi risposte (opzionale)
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ----- Clarify branch ----- */
    if (clarify) {
      // 1) tenta col modello
      let questions = await clarifyByModel({ domanda, periodo, profilo, lang });
      // 2) fallback adattivo
      if (!questions || !Array.isArray(questions) || !questions.length) {
        questions = clarifyFallback(domanda, periodo, lang);
      }
      // normalizza shape
      const out = questions.slice(0,3).map((q, i) => ({
        id: String(q.id || `q${i+1}`),
        label: String(q.label || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga"))
      }));

      // header utile per debug/UI
      try {
        const hdr = { topic: topicFromQuestion(domanda), ts: Date.now() };
        res.setHeader("X-Whatif-Clarify", JSON.stringify(hdr));
      } catch {}
      return res.status(200).json({ questions: out });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    const system = `
${persona.system.trim()}
Oggi: ${todayInfo(lang)}
Linee guida forti:
- Mai etichette esplicite (no "indicatore", "vincolo", "primo passo", ecc.).
- Seconda persona, zero "io".
- Varia lessico e struttura; evita ripetizioni e lirismi.
- Integra impliciti di città/ruolo/valori se presenti, senza elenchi.
- Periodo: ${periodo === "past" ? (isEn(lang) ? "counterfactual past" : "controfattuale") : (isEn(lang) ? "near-future" : "futuro vicino") }.
Esempi IT:
${persona.few_it.map(s => `• ${s}`).join("\n")}
Esempi EN:
${persona.few_en.map(s => `• ${s}`).join("\n")}
`.trim();

    const user = `
Apertura-specchio (parafrasa liberamente): "${mirror}".

${isEn(lang) ? "USER QUESTION" : "DOMANDA"}: "${domanda}"
${isEn(lang) ? "DETAILS" : "DETTAGLI"}: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (isEn(lang) ? "none" : "nessuno")}

${isEn(lang)
? `Write 8–12 flowing sentences (${stile==="wtf" ? "sarcastic, sharp" : "empathetic, predictive"}), ~180 words max. Avoid headings, bullets, and big metaphors. End with one natural episodic line in the spirit of: "${closing}".`
: `Scrivi 8–12 frasi fluide (${stile==="wtf" ? "sarcastiche e secche" : "empatiche e predittive"}), ~180 parole max. Evita titoli, elenco puntato e metafore lunghe. Chiudi con una sola riga episodica nello spirito: "${closing}".`}
`.trim();

    const temperature = stile === "wtf" ? 0.95 : 0.85;
    const params = {
      model: MODEL_TEXT,
      temperature,
      max_tokens: 700,
      presence_penalty: 0.3,
      frequency_penalty: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    };

    // Streaming SSE opzionale
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({ ...params, stream: true });
      let buffer = "";
      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) {
          buffer += delta;
          res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
        }
      }
      const cleaned = finalizeAnswer(buffer);
      res.write(`data: ${JSON.stringify({ done: true, final: cleaned })}\n\n`);
      return res.end();
    }

    // Non-stream
    const c = await client.chat.completions.create(params);
    const raw = c.choices?.[0]?.message?.content?.trim() || "";
    const text = finalizeAnswer(raw);
    return res.status(200).json({ answer: text });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
