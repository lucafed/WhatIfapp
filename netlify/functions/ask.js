// netlify/functions/ask.js
// Node 18+ su Netlify. Nessuna dipendenza esterna.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-3.5-turbo"; // 👈 come richiesto
const ALLOW_ORIGINS = ["https://localhost:8888", "http://127.0.0.1:8888"]; // per sviluppo

exports.handler = async (event) => {
  // CORS base
  const origin = event.headers.origin || "";
  const cors = ALLOW_ORIGINS.includes(origin)
    ? { "Access-Control-Allow-Origin": origin }
    : { "Access-Control-Allow-Origin": "*" };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        ...cors,
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod === "GET") {
    // Ping rapido
    return json200({ ok: true, hasKey: !!process.env.OPENAI_API_KEY, model: MODEL }, cors);
  }

  if (event.httpMethod !== "POST") {
    return jsonErr(405, "Method not allowed", cors);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return jsonErr(500, "Missing OPENAI_API_KEY", cors);

  try {
    const { step, input, extra } = JSON.parse(event.body || "{}");
    if (!step || !input) return jsonErr(400, "Missing field: step or input", cors);

    if (step === "followups") {
      const msgs = buildFollowupsPrompt(input);
      const out = await callOpenAI(apiKey, msgs);
      const followups = parseFollowups(out);
      return json200({ followups }, cors);
    }

    if (step === "final") {
      const msgs = buildFinalPrompt(input, extra);
      const out = await callOpenAI(apiKey, msgs, true); // chiediamo JSON
      const parsed = parseFinal(out);
      return json200(parsed, cors);
    }

    return jsonErr(400, "Unknown step", cors);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return jsonErr(500, msg, cors);
  }
};

// ----------------- helpers -----------------

function json200(obj, cors) {
  return { statusCode: 200, headers: { "Content-Type": "application/json", ...cors }, body: JSON.stringify(obj) };
}
function jsonErr(code, msg, cors) {
  return { statusCode: code, headers: { "Content-Type": "application/json", ...cors }, body: JSON.stringify({ ok:false, error: msg }) };
}

async function callOpenAI(apiKey, messages, wantJSON=false){
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.7,
      ...(wantJSON ? { response_format: { type: "json_object" } } : {})
    }),
  });

  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = null; }

  if (!res.ok) {
    const msg = data?.error?.message || `OpenAI HTTP ${res.status}: ${txt}`;
    throw new Error(msg);
    }

  const content = data.choices?.[0]?.message?.content || "";
  return content.trim();
}

// ------- Prompt builders -------

function buildPersonaTone(mode){
  if (mode === "wtf") {
    return `Stile ironico/divertente (What the F?!), creativo ma non offensivo, con un tocco psichedelico; 5–7 righe massimo.`;
  }
  return `Stile realistico e concreto (Sliding Doors), tono empatico e pragmatico; 5–7 righe massimo.`;
}

function buildFollowupsPrompt(input){
  const tone = buildPersonaTone(input.mode);
  const base = `
Sei l'assistente di What?f. L'utente ha chiesto:

Domanda: "${input.question}"
Genere: ${input.gender || "n/d"}
Luogo: ${input.location || "n/d"}
Esplorazione: ${input.explore || "n/d"}

${tone}
Prima di rispondere, elabora ESATTAMENTE 3 domande di chiarimento, molto mirate sul contesto dell'utente.
Devono essere brevi, specifiche e rilevanti per la sua domanda.
Rispondi SOLO con un elenco di 3 domande, una per riga.
`;
  return [
    { role: "system", content: "Sei l'assistente di What?f. Genera follow-up utili e pertinenti." },
    { role: "user", content: base }
  ];
}

function parseFollowups(text){
  // accetta linee tipo "1) ...", "- ...", "• ..."
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  for(const ln of lines){
    const q = ln.replace(/^[\-\*\d\.\)\s•]+/,'').trim();
    if(q) out.push(q);
    if(out.length===3) break;
  }
  return out.slice(0,3);
}

function buildFinalPrompt(input, extra){
  const tone = buildPersonaTone(input.mode);
  const answers = (extra && Array.isArray(extra.answers)) ? extra.answers : [];
  const answersText = answers.map((x,i)=>`Domanda ${i+1}: "${x.q || ''}" → Utente: "${x.a || ''}"`).join("\n");

  const base = `
Sei l'assistente di What?f. Devi restituire SOLO JSON con questa forma:
{"answer":"testo in 5-7 righe adattato allo stile richiesto","score":0.68}

- "answer": testo conciso, personale e contestuale all'utente, senza frasi di servizio.
- "score": confidenza/probabilità tra 0 e 1 (numero), motivata internamente in base ai dati.

Dati utente:
Domanda: "${input.question}"
Genere: ${input.gender || "n/d"}
Luogo: ${input.location || "n/d"}
Esplorazione: ${input.explore || "n/d"}

Follow-up e risposte:
${answersText || "(nessuna risposta fornita)"}

Stile richiesto:
${tone}

IMPORTANTE: Rispondi SOLO JSON valido.
`;
  return [
    { role: "system", content: "Sei l'assistente di What?f. Rispondi in italiano." },
    { role: "user", content: base }
  ];
}

function parseFinal(text){
  // Se response_format è JSON, qui dovrebbe essere JSON. Facciamo anche fallback robusto.
  let obj = null;
  try { obj = JSON.parse(text); } catch { obj = null; }
  if (obj && typeof obj === 'object' && typeof obj.answer === 'string') {
    const score = (typeof obj.score === 'number') ? Math.max(0, Math.min(1, obj.score)) : null;
    return { answer: obj.answer, score };
  }
  // fallback minimo
  return { answer: text, score: null };
}
