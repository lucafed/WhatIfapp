// /api/ask.js — What?f API (Edge, Vercel)
// Requisiti ENV: OPENAI_API_KEY = "sk-..." o "sk-proj-..."
// Funzioni: clarify (domande mirate), episodio (answer + followups), ping

export const config = { runtime: "edge" };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ---------- utils ----------
const J = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const s = v => (typeof v === "string" ? v : JSON.stringify(v || ""));
const nowISO = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

function clampLines(txt = "", max = 14) {
  const out = s(txt)
    .replace(/[“”«»]/g, '"')
    .split(/\n+|(?<=[.!?])\s+/)
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, max)
    .join("\n")
    .trim();
  return out;
}

function safeParse(jsonStr) {
  try { return JSON.parse(jsonStr); } catch { return null; }
}

const WTF_CLOSES = [
  "Clink. Stesso bancone, domani rimescoliamo.",
  "Ok, giro offerto: domani ti verso l’episodio dopo.",
  "Conto aperto, amico: domani si brinda sul seguito."
];
const pickWtfClose = () => WTF_CLOSES[Math.floor(Math.random() * WTF_CLOSES.length)];

function episodeFooter(ep, lang) {
  const it = (lang || "it").toLowerCase() !== "en";
  if (ep === 1) return it ? "Domani sblocchiamo l’Episodio 2 alle 09:00." : "Tomorrow we unlock Episode 2 at 09:00.";
  if (ep === 2) return it ? "Domani sblocchiamo l’Episodio 3 alle 09:00." : "Tomorrow we unlock Episode 3 at 09:00.";
  return it ? "Finale sbloccato: oggi chiudiamo la storia." : "Final unlocked: today we close the story.";
}

function sanitizeAnswer(ans, { stile, lang, episodio }) {
  let txt = clampLines(ans || "", 14);
  const lower = txt.toLowerCase();

  if (stile === "wtf") {
    if (!/(bancone|giro|brind|conto|domani)/.test(lower)) {
      txt += (txt.endsWith("\n") ? "" : "\n") + pickWtfClose();
    }
  } else {
    const it = (lang || "it").toLowerCase() !== "en";
    const line = it ? "Ok: si riparte domani, un passo alla volta." : "Alright: tomorrow we push one step further.";
    if (!/(domani|tomorrow)/.test(lower)) txt += (txt.endsWith("\n") ? "" : "\n") + line;
  }
  txt += "\n\n" + episodeFooter(episodio, lang);
  return txt.trim();
}

// ---------- prompts ----------
const STYLE_SYSTEM = {
  whatif: `Sei un amico brillante, empatico e asciutto.
Tono: positivo, zero malinconia e zero coaching. Frasi brevi, concrete.
Obiettivo: dare slancio e chiarezza a chi chiede “e se...?”.`,
  wtf: `Sei un narratore da bar: sarcastico, ironico, ubriaco ma lucido.
Battute intelligenti, calore, ritmo. Fai ridere senza cattiveria.`
};

function systemFor(style = "whatif", lang = "it") {
  const base = STYLE_SYSTEM[style === "wtf" ? "wtf" : "whatif"];
  const locale = (lang || "it").toLowerCase() === "en"
    ? "Write in natural, simple English."
    : "Scrivi in italiano semplice e naturale.";
  return `${base}\n${locale}`;
}

// Episodio: richiediamo SOLO JSON con {answer, followups}
function episodeUserPrompt({ domanda, episodio, periodo, stile, lang, profilo }) {
  const it = (lang || "it").toLowerCase() !== "en";
  const per = periodo === "past" ? (it ? "Passato" : "Past") : (it ? "Futuro" : "Future");
  const persona = [];
  if (profilo?.name) persona.push(`name:${profilo.name}`);
  if (profilo?.city_now || profilo?.city) persona.push(`city:${profilo.city_now || profilo.city}`);
  if (profilo?.work_role || profilo?.role) persona.push(`role:${profilo.work_role || profilo.role}`);
  const hints = persona.length ? (it ? `Segnali utente: ${persona.join(" · ")}` : `User hints: ${persona.join(" · ")}`) : "";

  const styleNotes = stile === "wtf"
    ? (it ? `Chiudi con una riga da bancone spiritosa.` : `End with a witty bar-style one-liner.`)
    : (it ? `Chiudi con una riga motivante ma asciutta (no coach).` : `End with one brisk, motivating line (no coaching).`);

  const instr = it ? `
Restituisci SOLO un JSON valido con:
{
  "answer": "testo episodio in 9–13 righe (line breaks), concreto, senza ripetizioni, ${stile==="wtf"?"con chiusura da bancone":"con chiusura asciutta"}",
  "followups": ["domanda breve e pertinente", "altra domanda breve pertinente"]
}
"answer" NON può essere vuoto.
Domanda: ${s(domanda)}
Episodio: ${episodio} · ${per}
${hints}
${styleNotes}
` : `
Return ONLY a valid JSON:
{
  "answer": "episode text in 9–13 short lines (line breaks), concrete, no repetition, ${stile==="wtf"?"with a witty bar close":"with a crisp closing line"}",
  "followups": ["short relevant question", "another short relevant question"]
}
"answer" must NOT be empty.
Question: ${s(domanda)}
Episode: ${episodio} · ${per}
${hints}
${styleNotes}
`;
  return instr.trim();
}

// Clarify: SOLO JSON {questions:[...]}
function clarifyUserPrompt({ domanda, lang }) {
  const it = (lang || "it").toLowerCase() !== "en";
  return it
    ? `In base a questa domanda proponi 2–3 domande di chiarimento, corte (max 8 parole), pratiche.
Domanda: ${s(domanda)}
Rispondi SOLO JSON: {"questions":["...","...","..."]}`
    : `Based on this question propose 2–3 short clarifying questions (max 8 words), practical.
Question: ${s(domanda)}
Reply ONLY JSON: {"questions":["...","...","..."]}`;
}

// ---------- OpenAI JSON mode ----------
async function chatJSON({ system, user, temperature = 0.6, max_tokens = 800 }) {
  if (!OPENAI_API_KEY) return { ok: false, error: "OPENAI_API_KEY missing" };

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature,
    max_tokens,
    response_format: { type: "json_object" } // forza JSON
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    let detail = "";
    try { detail = await r.text(); } catch {}
    return { ok: false, error: `OpenAI ${r.status}: ${detail.slice(0, 400)}` };
  }
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content || "";
  const parsed = safeParse(content);
  if (!parsed) return { ok: false, error: "Invalid JSON from model" };
  return { ok: true, json: parsed };
}

// Fallback ultra-semplice se answer vuoto
function tinyFallback(domanda, stile, lang) {
  const it = (lang || "it").toLowerCase() !== "en";
  const base = it
    ? `Parti dal concreto: un primo passo questa settimana, un segnale chiaro che ti dica che vale.`
    : `Start concrete: one small step this week, one clear signal it’s worth it.`;
  const close = stile === "wtf"
    ? pickWtfClose()
    : (it ? "Ok: domani lo portiamo avanti." : "Alright: tomorrow we push it forward.");
  return `${s(domanda)}\n${base}\n${close}`;
}

// ---------- handler ----------
export default async function handler(req) {
  try {
    const url = new URL(req.url);

    // GET ping
    if (req.method === "GET" && url.searchParams.get("ping")) {
      return J(200, {
        ok: true,
        keyExists: !!OPENAI_API_KEY,
        keyPrefix: OPENAI_API_KEY ? OPENAI_API_KEY.slice(0, 7) + "..." : null,
        ts: nowISO()
      });
    }

    if (req.method !== "POST") return J(405, { error: "Method not allowed" });

    const body = await req.json().catch(() => ({}));
    const {
      domanda = "",
      lang = "it",
      periodo = "future",
      stile = "whatif",
      episodio = 1,
      clarify = false,
      profilo = {}
    } = body || {};

    if (!domanda || typeof domanda !== "string") return J(400, { error: "Missing 'domanda' string" });

    // CLARIFY
    if (clarify) {
      const out = await chatJSON({
        system: systemFor(stile, lang),
        user: clarifyUserPrompt({ domanda, lang }),
        temperature: 0.3,
        max_tokens: 300
      });
      if (!out.ok) return J(200, { questions: [
        (lang==="en"?"Your real decision window?":"Finestra decisionale reale?"),
        (lang==="en"?"First signal it’s working?":"Primo segnale che funziona?"),
        (lang==="en"?"One constraint you can’t ignore?":"Un vincolo che non puoi ignorare?")
      ], note: out.error });

      let q = Array.isArray(out.json?.questions) ? out.json.questions : [];
      q = q.map(x => s(x).trim()).filter(Boolean).slice(2, 5); // (evita vuoti)
      if (!q.length) {
        q = (lang==="en")
          ? ["Your decision window?", "First signal it works?", "Concrete constraint in 2 weeks?"]
          : ["Finestra decisionale?", "Primo segnale che funziona?", "Vincolo concreto (2 settimane)?"];
      }
      return J(200, { questions: q });
    }

    // EPISODIO
    const ep = Number(episodio) || 1;
    const out = await chatJSON({
      system: systemFor(stile, lang),
      user: episodeUserPrompt({ domanda, episodio: ep, periodo, stile, lang, profilo }),
      temperature: stile === "wtf" ? 0.9 : 0.65,
      max_tokens: 1200
    });

    // Se la chiamata fallisce → fallback totale
    if (!out.ok) {
      const answer = sanitizeAnswer(tinyFallback(domanda, stile, lang), { stile, lang, episodio: ep });
      const fu = (lang==="en")
        ? ["What’s the first sign it’s working?", "What small 7-day test can you try?"]
        : ["Qual è il primo segnale che sta funzionando?", "Che test piccolo puoi fare entro 7 giorni?"];
      return J(200, { ok: true, answer, followups: fu, meta: { stile, periodo, episodio: ep, ts: nowISO(), note: out.error } });
    }

    // Estraggo answer & followups dal JSON
    let answer = s(out.json?.answer || "").trim();
    let followups = Array.isArray(out.json?.followups) ? out.json.followups : [];
    followups = followups.map(x => clampLines(x, 2)).filter(Boolean).slice(0, 2);

    // Se answer è vuota → mini fallback
    if (!answer || answer.length < 20) {
      answer = tinyFallback(domanda, stile, lang);
    }

    // Sanitize + chiusure + footer
    answer = sanitizeAnswer(answer, { stile, lang, episodio: ep });

    // Follow-up di sicurezza
    if (!followups.length) {
      followups = (lang==="en")
        ? ["What’s the first sign it’s working?", "What could you try within 7 days at low risk?"]
        : ["Qual è il primo segnale che ti direbbe che sta funzionando?", "Cosa potresti fare entro 7 giorni per provarci senza rischiare?"];
    }

    return J(200, { ok: true, answer, followups, meta: { stile, periodo, episodio: ep, ts: nowISO() } });
  } catch (e) {
    return J(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}
