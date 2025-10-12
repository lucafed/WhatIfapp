// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Personas (tono definitivo) ========= */
const PERSONAS = {
  whatif: {
    system: `
Sei "What?f": voce empatica e lucida, predittiva, zero fronzoli.
Parla in seconda persona, una sola voce, 8–12 frasi brevi, calde e nette.
Fai percepire che conosci l’utente senza dirlo: leggi lo stato d’animo e anticipi il passo.
Niente etichette (no "indicatore/vincolo/primo passo"): mostra, non nominare. Pochissime metafore.
Realismo e dettagli plausibili. Niente moralismi. Niente nostalgia pesante.
Chiudi con un invito morbido a tornare domani per 2 micro-domande (varia la frase).`,
    few_it: [
      "Ti muovi quando il perché si accende, non per rumore.",
      "Il corpo capisce prima della testa: quando respiri lungo, stai andando bene.",
      "Ti serve una base solida e una finestra aperta: equilibrio, non fuga."
    ],
    few_en: [
      "You move for meaning, not for noise.",
      "Your body knows first: longer breath means you’re on track.",
      "You want a solid base and one open window—balance, not escape."
    ],
  },
  wtf: {
    system: `
Sei "What the F": amico brillante e sarcastico da bancone, mezzo brillo ma lucidissimo.
Una sola voce, 8–10 righe secche. Ritmo da bar, punchline pulite.
Ironia alta ma mai cattiva. Zero volgarità. Niente prediche. Pochissime metafore.
Personalizza in modo implicito (luogo/ruolo), senza elencare dati.
Chiudi con una battuta/invito a tornare domani (varia la frase).`,
    few_it: [
      "Vuoi libertà ma con la ricevuta. Buon gusto.",
      "Le idee ti arrivano come gli aperitivi: quella giusta è quando smetti di contare.",
      "Ok, niente drammi: se sbagliamo, sbagliamo bene."
    ],
    few_en: [
      "You want freedom with a warranty. Classy.",
      "Ideas hit like drinks: the right one lands when you stop counting.",
      "Fine, no drama: if we mess up, let’s do it beautifully."
    ],
  },
};

/* ========= Mirror (specchio) & chiusure episodiche ========= */
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0]?.trim();
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (Array.isArray(profile?.goals) && profile.goals[0]) || profile?.goal || "";

  const itPool = [
    name ? `${name}, quando scegli non è mai per capriccio: cerchi senso.` : "Tu non scegli per capriccio: cerchi senso.",
    city ? `Ti tiene a terra ${city}, ma ogni tanto ti serve aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi il ritmo finché il perché resta acceso.",
    goal ? `In testa gira questo: ${goal}. Il resto si deve allineare.` : "Hai un punto chiaro in testa: il resto si deve allineare."
  ];
  const enPool = [
    name ? `${name}, you don’t choose on whims — you choose for meaning.` : "You don’t choose on whims — you choose for meaning.",
    city ? `${city} keeps you grounded, but you still need fresh air sometimes.` : "You like a solid base and a bit of open air.",
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
    "Bancone chiuso per ora: domani due domande e via."
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

/* ========= Time helper ========= */
function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

/* ========= Clarify prompts (AI + fallback) ========= */
function clarifySystem(lang = "it") {
  const en = isEn(lang);
  return en
    ? `You generate 3 short, focused clarifying questions tied to the user's main question.
Return ONLY a JSON array of {"id","label","placeholder"}.
Style: concrete, no generic stuff, each question one line.`
    : `Generi 3 domande brevi e mirate legate alla domanda principale.
Restituisci SOLO un array JSON di {"id","label","placeholder"}.
Stile: concreto, niente genericismi, una riga per domanda.`;
}

function clarifyUser({ domanda, periodo, profilo, lang }) {
  const en = isEn(lang);
  const digest = [
    profilo?.city_now || profilo?.city ? (en ? `city=${profilo.city_now || profilo.city}` : `città=${profilo.city_now || profilo.city}`) : null,
    profilo?.work_role || profilo?.role ? (en ? `role=${profilo.work_role || profilo.role}` : `ruolo=${profilo.work_role || profilo.role}`) : null,
    profilo?.goal ? (en ? `goal=${profilo.goal}` : `obiettivo=${profilo.goal}`) : null
  ].filter(Boolean).join(" • ");

  let periodHint = "";
  if (periodo === "past") {
    periodHint = en
      ? `Ask about: pivot year/event, place/context back then, key sign it worked.`
      : `Chiedi: anno/evento di svolta, luogo/contesto di allora, segno chiave che avrebbe indicato che funzionava.`;
  } else {
    periodHint = en
      ? `Ask about: real decision window, personal sign to watch, concrete limit/resource.`
      : `Chiedi: finestra decisionale reale, segno personale da osservare, limite/risorsa concreta.`;
  }

  return `${en ? "QUESTION" : "DOMANDA"}: ${domanda}
${en ? "TIMEFRAME" : "PERIODO"}: ${periodo}
${digest ? (en ? "PROFILE DIGEST: " : "SINTESI PROFILO: ") + digest : ""}

${periodHint}
Return ONLY the JSON array.`;
}

function localClarify(domanda = "", lang = "it", periodo = "future") {
  const en = isEn(lang);
  if (periodo === "past") {
    return [
      { id: "pivot", label: en ? "Turning point year/event?" : "Anno/evento di svolta?", placeholder: en ? "e.g., 2015 move / 2010 offer" : "es. trasferimento 2015 / offerta 2010" },
      { id: "place", label: en ? "Where & what context then?" : "Dove e quale contesto allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" },
      { id: "sign", label: en ? "One sign it worked?" : "Un segno che funzionava?", placeholder: en ? "sleep/energy/text back" : "sonno/energia/richiami" },
    ];
  }
  return [
    { id: "window", label: en ? "Real decision window?" : "Finestra reale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" },
    { id: "signal", label: en ? "Personal sign to watch?" : "Segno personale da osservare?", placeholder: en ? "sleep/energy/first reply" : "sonno/energia/prima risposta" },
    { id: "limit", label: en ? "Most concrete limit?" : "Limite più concreto?", placeholder: en ? "budget/time/energy" : "budget/tempo/energia" },
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

    /* ----- Clarify branch (AI + fallback) ----- */
    if (clarify) {
      let questions = [];
      try {
        const sys = clarifySystem(lang);
        const usr = clarifyUser({ domanda, periodo, profilo, lang });
        const r = await client.chat.completions.create({
          model: MODEL_TEXT,
          temperature: 0.6,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: usr },
          ],
        });
        const raw = r.choices?.[0]?.message?.content?.trim() || "[]";
        const start = raw.indexOf("[");
        const end = raw.lastIndexOf("]");
        if (start >= 0 && end > start) {
          questions = JSON.parse(raw.slice(start, end + 1));
        }
      } catch { /* ignore */ }

      if (!Array.isArray(questions) || !questions.length) {
        questions = localClarify(domanda, lang, periodo);
      }

      // normalizza
      questions = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i + 1}`),
        label: String(q.label || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));

      // header di servizio (facoltativo, utile al client)
      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        res.setHeader("X-Whatif-Clarify", JSON.stringify({ date: todayIso, used: questions.length }));
      } catch {}
      return res.status(200).json({ questions });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    const system = `
${isEn(lang) ? "Write strictly in English." : "Scrivi rigorosamente in italiano."}
Oggi: ${todayInfo(lang)}
${persona.system.trim()}

Linee guida forti:
- Seconda persona, zero "io".
- Pochissime metafore. Niente etichette (“indicatore”, “vincolo”, “primo passo”, ecc.).
- Varia lessico e struttura; evita frasi stampino.
- Integra in modo implicito città/ruolo/valori se presenti (niente elenco).
- Periodo: ${periodo === "past" ? (isEn(lang) ? "counterfactual past" : "controfattuale") : (isEn(lang) ? "near-future" : "futuro vicino") }.

Esempi IT:
${persona.few_it.map(s => `• ${s}`).join("\n")}
Esempi EN:
${persona.few_en.map(s => `• ${s}`).join("\n")}
`.trim();

    const user = `
Apri con una breve riga “specchio” (parafrasa, non copiare): "${mirror}".

Domanda: "${domanda}"
Dettagli utente (se presenti): ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (isEn(lang) ? "none" : "nessuno")}

Scrivi ${stile === "wtf" ? "8–10 righe secche, ritmo da bar, sarcastiche ma affettuose" : "8–12 righe fluide, empatiche e predittive"}, massimo ~180 parole.
Niente elenco puntato, niente domande all’utente, niente morale.
Chiudi con una sola riga episodica variata nello spirito: "${closing}".
`.trim();

    const temperature = stile === "wtf" ? 0.95 : 0.85;
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
    return res.status(200).json({ answer: text });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
