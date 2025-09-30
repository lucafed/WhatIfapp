// netlify/functions/ask.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini"; // ok anche gpt-4o-mini
const ALLOWED_ORIGIN = "*"; // metti il tuo dominio Netlify se vuoi restringere

export async function handler(event) {
  // CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return fail(405, "Method not allowed");
  }
  if (!OPENAI_API_KEY) return fail(500, "Missing OPENAI_API_KEY");

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return fail(400, "Invalid JSON body"); }

  const { step, mode, user = {}, question, answers = [] } = body;
  if (!step) return fail(400, "Missing field: step");
  if (!question || typeof question !== "string") return fail(400, "Missing/invalid question");

  try {
    if (step === "followups") {
      const messages = promptFollowups({ user, mode, question });
      const text = await callOpenAI(messages);
      let followups = [];
      try {
        const j = JSON.parse(extractJson(text));
        followups = Array.isArray(j) ? j : j.followups || [];
      } catch {}
      if (!Array.isArray(followups) || followups.length === 0) {
        // fallback minimo se l'AI non risponde in JSON valido
        followups = [
          "Qual è il risultato preciso che vuoi ottenere?",
          "C’è qualche vincolo forte (tempo, budget, rischi, persone)?"
        ];
      }
      return ok({ followups: followups.slice(0, 3).map(s => String(s).trim()).filter(Boolean) });
    }

    if (step === "final") {
      if (!mode || !["sliding", "wtf"].includes(mode)) {
        return fail(400, 'Missing/invalid mode ("sliding" | "wtf")');
      }
      const messages = promptFinal({ user, mode, question, answers });
      let answer = "", score = 0, reason = "";
      try {
        const text = await callOpenAI(messages);
        const j = JSON.parse(extractJson(text));
        answer = String(j.answer || "").trim();
        score = Number(j.score || 0);
        reason = String(j.reason || "").trim();
      } catch (e) {
        // fallback sobrio
        answer = `Riguardo a «${question}»: chiarisci obiettivo e vincoli, prova un passo reversibile a basso rischio, misura il risultato e itera.`;
        score = 62;
        reason = "Stima euristica basata su informazioni parziali.";
      }
      return ok({ answer, score: clamp(score, 0, 100), reason });
    }

    return fail(400, 'Unsupported step (use "followups" or "final")');
  } catch (e) {
    console.error(e);
    return fail(500, "Internal error");
  }
}

/* ---------- PROMPTS ---------- */
function promptFollowups({ user, mode, question }) {
  const tone = mode === "wtf"
    ? "tono brillante/curioso ma concreto (no battute inutili)"
    : "tono pratico e diretto";
  const profile = [
    user?.gender && `genere: ${user.gender}`,
    user?.age && `età: ${user.age}`,
    user?.location && `luogo: ${user.location}`,
    user?.time && `tempo: ${user.time}`
  ].filter(Boolean).join(", ");
  return [
    { role: "system", content:
`Sei un assistente che prepara domande di chiarimento **iper-precise**.
Stile: ${tone}.
Regole:
- 2–3 domande massimo
- una sola informazione per domanda
- niente sì/no, niente domande generiche
- domande brevi (<= 12 parole)
Rispondi **SOLO** in JSON: {"followups":["...","..."]}` },
    { role: "user", content:
`Profilo utente: { ${profile || "n/d"} }
Domanda: "${question}"
Genera ora le domande.` },
  ];
}

function promptFinal({ user, mode, question, answers }) {
  const style = mode === "wtf"
    ? "ironico/divertente con un tocco psichedelico ma chiaro"
    : "realistico, pratico e concreto";
  const profile = [
    user?.gender && `genere: ${user.gender}`,
    user?.age && `età: ${user.age}`,
    user?.location && `luogo: ${user.location}`,
    user?.time && `tempo: ${user.time}`
  ].filter(Boolean).join(", ");
  return [
    { role: "system", content:
`Rispondi in italiano, **5–7 frasi utili**.
Stile: ${style}.
Aggiungi una percentuale di confidenza (0–100) e una breve motivazione.
Rispondi **SOLO** in JSON: {"answer":"...","score":70,"reason":"..."}` },
    { role: "user", content:
`Profilo utente: { ${profile || "n/d"} }
Domanda: "${question}"
Follow-up e risposte: ${JSON.stringify(answers)}` },
  ];
}

/* ---------- OPENAI ---------- */
async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.7 })
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> "");
    throw new Error(`OpenAI HTTP ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

/* ---------- UTILS ---------- */
function ok(data){ return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok:true, ...data }) }; }
function fail(code, msg){ return { statusCode: code, headers: cors(), body: JSON.stringify({ ok:false, error: msg }) }; }
function cors(){ return {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
};}
function extractJson(text){ const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/); return m ? m[0] : text; }
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
