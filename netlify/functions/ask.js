// netlify/functions/ask.js
// Serverless function per What?f (Netlify)
// - step: "followups"  → genera 2–3 domande mirate
// - step: "final"      → risposta finale (5–7 frasi) + % confidenza

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const ALLOWED_ORIGIN = "*"; // opzionale: metti il tuo dominio Netlify per restringere

export async function handler(event) {
  // CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return fail(405, "Method not allowed");
  }

  if (!OPENAI_API_KEY) {
    return fail(500, "Missing OPENAI_API_KEY");
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return fail(400, "Invalid JSON body"); }

  const { step, mode, user = {}, question, answers = [] } = body;
  if (!step) return fail(400, "Missing field: step");
  if (!question || typeof question !== "string") {
    return fail(400, "Missing/invalid question");
  }

  try {
    /* ---------- FOLLOWUPS ---------- */
    if (step === "followups") {
      try {
        const messages = promptFollowups({ user, mode, question });
        const text = await callOpenAI(messages);
        let followups = [];
        try {
          const j = JSON.parse(extractJson(text));
          followups = Array.isArray(j) ? j : j.followups || [];
        } catch { /* noop */ }

        if (!Array.isArray(followups) || followups.length === 0) {
          // Fallback minimo
          followups = [
            "Qual è il risultato preciso che vuoi ottenere?",
            "Quale vincolo conta di più (tempo, budget, rischio, persone)?"
          ];
        }

        return ok({
          followups: followups.slice(0, 3).map(s => String(s).trim()).filter(Boolean)
        });
      } catch (e) {
        return fail(502, `AI error (followups): ${e.message}`);
      }
    }

    /* ---------- FINALE ---------- */
    if (step === "final") {
      if (!mode || !["sliding", "wtf"].includes(mode)) {
        return fail(400, 'Missing/invalid mode ("sliding" | "wtf")');
      }
      try {
        const messages = promptFinal({ user, mode, question, answers });
        const text = await callOpenAI(messages);
        const j = JSON.parse(extractJson(text));

        const answer = String(j.answer || "").trim();
        const score  = clamp(Number(j.score || 0), 0, 100);
        const reason = String(j.reason || "").trim();

        if (!answer) throw new Error("Empty answer from AI");

        return ok({ answer, score, reason });
      } catch (e) {
        // Fallback sobrio (mai a mani vuote)
        return ok({
          answer: `Su «${question}»: chiarisci obiettivo e vincoli, esegui un passo reversibile a basso rischio, misura l'effetto e itera.`,
          score: 62,
          reason: `Fallback perché: ${e.message}`
        });
      }
    }

    return fail(400, 'Unsupported step (use "followups" or "final")');
  } catch (e) {
    console.error("[ask] unexpected", e);
    return fail(500, "Internal error");
  }
}

/* =================== PROMPTS =================== */

function promptFollowups({ user, mode, question }) {
  const tone = mode === "wtf"
    ? "tono brillante/curioso ma concreto (no battute inutili)"
    : "tono pratico e diretto";

  const profile = [
    user?.name && `nome: ${user.name}`,
    user?.gender && `genere: ${user.gender}`,
    user?.age && `età: ${user.age}`,
    user?.location && `luogo: ${user.location}`,
    user?.time && `tempo: ${user.time}`
  ].filter(Boolean).join(", ");

  return [
    { role: "system", content:
`Sei un assistente che prepara domande di chiarimento iper-precise.
Stile: ${tone}.
Regole:
- 2–3 domande massimo
- una sola informazione per domanda
- evita sì/no e genericità
- max ~12 parole per domanda
Rispondi SOLO in JSON: {"followups":["...","..."]}` },
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
    user?.name && `nome: ${user.name}`,
    user?.gender && `genere: ${user.gender}`,
    user?.age && `età: ${user.age}`,
    user?.location && `luogo: ${user.location}`,
    user?.time && `tempo: ${user.time}`
  ].filter(Boolean).join(", ");

  return [
    { role: "system", content:
`Rispondi in italiano con 5–7 frasi utili.
Stile: ${style}.
Aggiungi una percentuale di confidenza (0–100) e una breve motivazione.
Rispondi SOLO in JSON: {"answer":"...","score":70,"reason":"..."}` },
    { role: "user", content:
`Profilo utente: { ${profile || "n/d"} }
Domanda: "${question}"
Follow-up e risposte: ${JSON.stringify(answers)}` },
  ];
}

/* =================== OPENAI =================== */

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

/* =================== UTILS =================== */

function ok(data){ return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok:true, ...data }) }; }
function fail(code, msg){ return { statusCode: code, headers: cors(), body: JSON.stringify({ ok:false, error: msg }) }; }

function cors(){ return {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
};}

function extractJson(text){
  // prova a prendere l'oggetto/array JSON anche se l'AI aggiunge testo extra
  const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  return m ? m[0] : text;
}

function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
