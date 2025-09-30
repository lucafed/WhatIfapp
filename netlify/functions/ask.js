// netlify/functions/ask.js
// Node 18+ (default Netlify). Nessuna dipendenza esterna.

// === CONFIG ===
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini"; // ok anche gpt-4o-mini
const ALLOWED_ORIGIN = "*"; // se vuoi restringere: "https://TUO-DOMINIO.netlify.app"

// === HANDLER ===
export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return err(405, "Method not allowed");
  }
  if (!OPENAI_API_KEY) {
    return err(500, "Missing OPENAI_API_KEY in environment");
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return err(400, "Invalid JSON body");
  }

  const { step, mode, user = {}, question, answers = [] } = body;
  if (!step) return err(400, "Missing field: step");
  if (!question || typeof question !== "string") {
    return err(400, "Missing or invalid field: question");
  }

  try {
    if (step === "followups") {
      const prompt = buildFollowupsPrompt(question);
      const text = await callOpenAI(prompt);
      // robustezza: prova a estrarre JSON, altrimenti fallback
      let followups = [];
      try {
        const parsed = JSON.parse(safeJsonFromText(text));
        followups = Array.isArray(parsed) ? parsed : parsed.followups || [];
      } catch {
        followups = fallbackFollowups(text);
      }
      followups = (followups || [])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 3);
      if (!followups.length) followups = defaultFollowups();

      return ok({ followups });
    }

    if (step === "final") {
      if (!mode || !["sliding", "wtf"].includes(mode)) {
        return err(400, 'Missing/invalid field: mode ("sliding" | "wtf")');
      }
      const prompt = buildFinalPrompt({ mode, user, question, answers });
      const text = await callOpenAI(prompt);
      let payload = {};
      try {
        payload = JSON.parse(safeJsonFromText(text));
      } catch {
        payload = {};
      }

      const answer =
        String(payload.answer || "").trim() ||
        fallbackAnswer({ mode, user, question, answers });
      const score = clamp(Number(payload.score || 0) || estimateScore(answers), 0, 100);
      const reason =
        String(payload.reason || "").trim() ||
        "Stima basata sulle informazioni fornite (orizzonte, priorità, vincoli).";

      return ok({ answer, score, reason });
    }

    return err(400, 'Unsupported step (use "followups" or "final")');
  } catch (e) {
    console.error(e);
    return err(500, "Internal error");
  }
}

// === PROMPTS ===
function buildFollowupsPrompt(question) {
  return [
    {
      role: "system",
      content:
        "Sei un assistente. Genera 2–3 domande di chiarimento, concise e pratiche, in italiano. Rispondi STRICT JSON.",
    },
    {
      role: "user",
      content:
        `Domanda utente: "${question}". ` +
        `Formato obbligatorio: {"followups": ["domanda1","domanda2","domanda3"]} (max 3, frasi brevi).`,
    },
  ];
}

function buildFinalPrompt({ mode, user, question, answers }) {
  const style =
    mode === "wtf"
      ? "tono ironico/divertente con un tocco psichedelico ma chiaro"
      : "tono realistico, pratico e concreto";
  const persona = [
    user?.gender ? `genere: ${user.gender}` : null,
    user?.age ? `età: ${user.age}` : null,
    user?.location ? `luogo: ${user.location}` : null,
    user?.time ? `tempo: ${user.time}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return [
    { role: "system", content: "Sei un assistente che scrive risposte brevi e utili in italiano. Rispondi STRICT JSON." },
    {
      role: "user",
      content:
        `Profilo utente: { ${persona || "n/d"} }\n` +
        `Domanda: "${question}"\n` +
        `Follow-up e risposte: ${JSON.stringify(answers)}\n\n` +
        `Scrivi una risposta di 5–7 frasi, ${style}. ` +
        `Includi una percentuale di confidenza (0–100) e spiegala brevemente.\n\n` +
        `Formato STRICT JSON:\n` +
        `{"answer":"testo","score":70,"reason":"breve motivazione"}`,
    },
  ];
}

// === OPENAI CALL ===
async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

// === UTIL ===
function ok(data) {
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, ...data }) };
}
function err(status, message) {
  return { statusCode: status, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: message }) };
}
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8",
  };
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function estimateScore(answers = []) {
  // stima semplice: più risposte => score maggiore
  const base = 55 + Math.min(answers.filter(Boolean).length, 3) * 10;
  return clamp(base, 30, 90);
}
function fallbackFollowups(text) {
  // estrai righe con punto interrogativo
  const lines = String(text).split(/\n+/).map((s) => s.trim()).filter((s) => s.endsWith("?"));
  return lines.slice(0, 3);
}
function defaultFollowups() {
  return [
    "Qual è l'orizzonte temporale (3, 6 o 12 mesi)?",
    "Qual è la priorità principale (tempo, budget, rischio)?",
    "Quale vincolo o risorsa incide di più?",
  ];
}
function fallbackAnswer({ mode, user, question }) {
  const tone =
    mode === "wtf"
      ? "In un corridoio di possibilità, scegli la porta luminosa: piccoli esperimenti e umorismo ti faranno strada."
      : "Valuta rischi e impatto, fai un test rapido a basso costo e decidi con evidenze.";
  const who = [user?.gender, user?.age ? `${user.age} anni` : null, user?.location]
    .filter(Boolean)
    .join(", ");
  return (
    `Per ${who || "te"}, riguardo a «${question}»: ` +
    `inquadra obiettivo e vincoli, raccogli 2–3 segnali concreti, decidi in step. ` +
    tone
  );
}
function safeJsonFromText(text) {
  // prova a isolare il primo blocco JSON
  const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  return m ? m[0] : text;
}
