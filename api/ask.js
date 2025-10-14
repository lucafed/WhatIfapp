// /api/ask.js
// Serverless endpoint per What?f – Vercel / Node 18+
//
// ENV richiesti:
// - OPENAI_API_KEY = "sk-..." oppure "sk-proj-..."
// Opzionali (solo log):
// - APP_ENV = "dev" per log più verbosi

export const config = {
  runtime: "edge", // Edge = più veloce su Vercel. Se preferisci Node: commenta questa riga.
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ==== Utilities ===============================================================

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function safeStr(x) {
  return typeof x === "string" ? x : JSON.stringify(x || "");
}
function clampLines(txt = "", max = 14) {
  const parts = safeStr(txt)
    .replace(/[“”«»]/g, '"')
    .split(/\n+|(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, max);
  return parts.join("\n").trim();
}

function shortNowISO() {
  const d = new Date();
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

// ==== Prompt builders =========================================================

const STYLE_SYSTEM = {
  whatif: `Sei un amico brillante, empatico e asciutto. 
Parli con ritmo, zero malinconia, zero coachate. 
Tono: “calmo ma sveglio”, intelligente, con una punta di ironia elegante. 
Scrivi in frasi brevi, concrete. Mai poesia zuccherosa.
Obiettivo: dare slancio e chiarezza a chi chiede “e se...?”, facendo venire voglia di provare.`,
  wtf: `Sei un narratore da bar: sarcastico, ironico, ubriaco ma lucido. 
Battute intelligenti, calore, ritmo. Fai ridere senza essere cattivo.
Evita acidità o tristezza. Finale con una chiusura da bancone.`,
};

// Frasi di chiusura per WTF
const WTF_CLOSES = [
  "Clink. Stesso bancone, domani rimescoliamo.",
  "Ok, giro offerto: domani ti verso l’episodio dopo.",
  "Conto aperto, amico: domani si brinda sul seguito.",
];

// Finale episodio (generico)
function episodeFooter(ep, lang) {
  const it = (lang || "it").toLowerCase() !== "en";
  if (ep === 1) return it ? "Domani sblocchiamo l’Episodio 2 alle 09:00." : "Tomorrow we unlock Episode 2 at 09:00.";
  if (ep === 2) return it ? "Domani sblocchiamo l’Episodio 3 alle 09:00." : "Tomorrow we unlock Episode 3 at 09:00.";
  return it ? "Finale sbloccato: oggi chiudiamo la storia." : "Final unlocked: we close the story today.";
}

// System prompt per episodi
function systemFor(style = "whatif", lang = "it") {
  const base =
    STYLE_SYSTEM[style === "wtf" ? "wtf" : "whatif"] ||
    STYLE_SYSTEM.whatif;
  const locale =
    (lang || "it").toLowerCase() === "en"
      ? "Scrivi in inglese semplice e naturale."
      : "Scrivi in italiano semplice e naturale.";
  return `${base}\n${locale}\nRispetta massimo ~12-14 frasi a capo singolo.`;
}

// Contenuto utente per generazione episodica + follow-up JSON
function userPromptEpisode({
  domanda,
  episodio = 1,
  periodo = "future",
  stile = "whatif",
  profilo = {},
  lang = "it",
}) {
  const it = (lang || "it").toLowerCase() !== "en";
  const head = it ? "Domanda:" : "Question:";
  const epLab = it ? "Episodio" : "Episode";
  const per = (periodo === "past") ? (it ? "Passato" : "Past") : (it ? "Futuro" : "Future");

  const personaHints =
    stile === "whatif"
      ? (it
          ? `Tono: amico intelligente, asciutto, positivo. Zero malinconia.`
          : `Tone: smart friend, concise, positive. No melancholy.`)
      : (it
          ? `Tono: bar scanzonato, ironia calda, battute brillanti.`
          : `Tone: cheeky pub vibe, warm irony, witty punchlines.`);

  const closer = stile === "wtf" ? (it
    ? `Chiudi con una riga spiritosa da bancone (senza ripetere la stessa a ogni output).`
    : `End with a witty bar-style one-liner (don't repeat the same every time).`)
    : (it ? `Chiudi con una riga motivante ma asciutta (no coaching).` : `End with one brisk, motivating line (no coaching).`);

  const jsonInstr = it
    ? `Dopo il testo dell'episodio, restituisci un JSON con questo schema:
{
  "answer": "testo episodio già scritto sopra, ripulito e senza duplicati",
  "followups": [
    "domanda breve collegata alla domanda e a quanto hai scritto",
    "altra domanda breve pertinente"
  ]
}
Stampa SOLO il JSON (senza altri commenti) alla fine.`
    : `After the episode text, return JSON with:
{
  "answer": "episode text above, cleaned and without duplicates",
  "followups": [
    "short question tied to the user's question and what you wrote",
    "another short, relevant question"
  ]
}
Print ONLY the JSON (no extra comments) at the end.`;

  const episodeAim = it
    ? `${epLab} ${episodio} · ${per}. Guida l'immaginazione in modo concreto.`
    : `${epLab} ${episodio} · ${per}. Guide the imagination concretely.`;

  // Hints dal profilo (leggeri)
  const lean = {
    name: profilo?.name,
    city: profilo?.city_now || profilo?.city,
    role: profilo?.work_role || profilo?.role,
  };
  const hints = Object.entries(lean)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  const persona = hints ? (it ? `Segnali utente: ${hints}` : `User hints: ${hints}`) : "";

  return `${head} ${safeStr(domanda)}
${episodeAim}
${personaHints}
${persona}
${closer}

${jsonInstr}
`;
}

// Domande mirate per “Chiarisci & genera”
function userPromptClarify({ domanda, lang = "it" }) {
  const it = (lang || "it").toLowerCase() !== "en";
  return (it
    ? `Sulla base di questa domanda, proponi 2–3 domande mirate per chiarire meglio e ottenere una risposta più personale. Devono essere corte (max 8 parole), concrete e senza fronzoli.
Domanda: ${safeStr(domanda)}
Rispondi in JSON puro:
{"questions":["...","...","..."]}`
    : `Based on this question, propose 2–3 targeted clarifying questions to get a more personal, precise answer. Keep them short (max 8 words), concrete.
Question: ${safeStr(domanda)}
Reply in raw JSON:
{"questions":["...","...","..."]}`);
}

// ==== OpenAI call (Edge fetch) ===============================================

async function callOpenAIJSON({ system, user, temperature = 0.7, response_json = false }) {
  if (!OPENAI_API_KEY) {
    return { ok: false, error: "OPENAI_API_KEY missing" };
  }

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
  };

  // JSON mode “soft”: chiediamo di stampare JSON, ma non imponiamo response_format
  // per massima compatibilità Edge. Faremo parse robusto a valle.

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return { ok: false, error: `OpenAI ${r.status}: ${detail.slice(0, 400)}` };
  }

  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content || "";
  return { ok: true, content };
}

function pickWtfCloser() {
  return WTF_CLOSES[Math.floor(Math.random() * WTF_CLOSES.length)];
}

function sanitizeAnswer(ans = "", { stile = "whatif", lang = "it", episodio = 1 } = {}) {
  let txt = safeStr(ans);

  // Togli eventuale JSON rimasto attaccato, se presente
  const jsonIdx = txt.indexOf("{");
  if (jsonIdx > 0 && /"followups"\s*:/.test(txt)) {
    // Manteniamo solo la parte "testo" prima del JSON
    txt = txt.slice(0, jsonIdx).trim();
  }

  // Clamp frasi
  txt = clampLines(txt, 14);

  // Chiusa WTF
  if (stile === "wtf") {
    if (!/bancone|giro|domani|conto|brind/.test(txt.toLowerCase())) {
      txt += (txt.endsWith("\n") ? "" : "\n") + pickWtfCloser();
    }
  } else {
    // Chiusa asciutta
    const it = (lang || "it").toLowerCase() !== "en";
    const line = it ? "Ok: si riparte domani, un passo alla volta." : "Alright: tomorrow we push one step further.";
    if (!/domani|tomorrow|passo/.test(txt.toLowerCase())) {
      txt += (txt.endsWith("\n") ? "" : "\n") + line;
    }
  }

  // Footer episodio
  txt += "\n\n" + episodeFooter(episodio, lang);
  return txt.trim();
}

function safeParseJSON(maybeJSON) {
  try {
    return JSON.parse(maybeJSON);
  } catch {
    return null;
  }
}

// ==== Handler =================================================================

export default async function handler(req) {
  try {
    // GET ping: /api/ask?ping=1
    const { searchParams } = new URL(req.url);
    if (req.method === "GET" && searchParams.get("ping")) {
      return jsonResponse(200, {
        ok: true,
        keyExists: !!OPENAI_API_KEY,
        keyPrefix: OPENAI_API_KEY ? OPENAI_API_KEY.slice(0, 7) + "..." : null,
        ts: shortNowISO(),
      });
    }

    if (req.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const body = await req.json().catch(() => ({}));
    const {
      domanda = "",
      lang = "it",
      periodo = "future",
      stile = "whatif",
      episodio = 1,
      clarify = false,
      profilo = {},
      // opzionali
      extra = "",
      tags = [],
    } = body || {};

    if (!domanda || typeof domanda !== "string") {
      return jsonResponse(400, { error: "Missing 'domanda' string" });
    }

    // Modalità CHIARISCI
    if (clarify) {
      const system = systemFor(stile, lang);
      const user = userPromptClarify({ domanda, lang });
      const out = await callOpenAIJSON({ system, user, temperature: 0.3, response_json: true });
      if (!out.ok) return jsonResponse(500, { error: out.error || "OpenAI error" });

      const parsed = safeParseJSON(out.content.trim());
      const qs = Array.isArray(parsed?.questions) ? parsed.questions.slice(0, 3) : [];
      const cleaned = qs
        .map(s => safeStr(s).replace(/^\p{P}+/u, "").trim())
        .filter(Boolean);

      // Fallback locali se il JSON non è arrivato bene
      const it = (lang || "it").toLowerCase() !== "en";
      const fallback = it
        ? ["In che finestra di tempo decidi?", "Primo segnale che sta funzionando?", "Vincolo concreto da rispettare?"]
        : ["Decision window?", "First signal it’s working?", "One concrete constraint?"];

      return jsonResponse(200, { questions: cleaned.length ? cleaned : fallback });
    }

    // Modalità EPISODIO (generazione risposta + followups)
    const system = systemFor(stile, lang);
    const user = userPromptEpisode({
      domanda,
      episodio: Number(episodio) || 1,
      periodo,
      stile,
      profilo,
      lang,
    });

    const out = await callOpenAIJSON({ system, user, temperature: stile === "wtf" ? 0.85 : 0.6, response_json: true });
    if (!out.ok) return jsonResponse(500, { error: out.error || "OpenAI error" });

    // L'assistente stampa prima il testo, poi il JSON. Noi prendiamo il JSON finale.
    const jsonStart = out.content.lastIndexOf("{");
    let answer = "";
    let followups = [];

    if (jsonStart >= 0) {
      const maybe = out.content.slice(jsonStart);
      const parsed = safeParseJSON(maybe);
      if (parsed && typeof parsed === "object") {
        answer = safeStr(parsed.answer || "");
        const arr = Array.isArray(parsed.followups) ? parsed.followups : [];
        followups = arr.map(s => clampLines(s, 2)).filter(Boolean).slice(0, 2);
      }
      // Aggiungiamo anche il testo prima del JSON (se l'LLM l'ha messo lì)
      const pre = out.content.slice(0, jsonStart).trim();
      if (pre && !answer) answer = pre;
    } else {
      answer = out.content;
    }

    // Sanitize + footer episodico
    answer = sanitizeAnswer(answer, { stile, lang, episodio: Number(episodio) || 1 });

    // Safety fallback followups
    if (!followups.length) {
      const it = (lang || "it").toLowerCase() !== "en";
      followups = it
        ? ["Qual è il primo segnale che ti direbbe che sta funzionando?", "Cosa potresti fare entro 7 giorni per provarci senza rischiare?"]
        : ["What’s the first signal it’s working?", "What could you try within 7 days with low risk?"];
    }

    return jsonResponse(200, {
      ok: true,
      answer,
      followups,
      meta: {
        stile,
        periodo,
        episodio: Number(episodio) || 1,
        ts: shortNowISO(),
      },
    });
  } catch (err) {
    return jsonResponse(500, { error: `Server error: ${err?.message || String(err)}` });
  }
}
