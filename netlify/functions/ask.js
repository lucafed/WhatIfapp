// netlify/functions/ask.js
// Node 18+ (default su Netlify). Niente dipendenze esterne.

const ALLOW_DEV = ["http://localhost:8888", "http://127.0.0.1:8888"];
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
// Scegli un modello economico ma bravo per testo
const MODEL = "gpt-4o-mini"; // puoi cambiare in gpt-4o, o gpt-3.5-turbo se serve

// -------- CORS helpers --------
const getAllowedOrigin = (origin) => {
  const corsEnv = process.env.CORS_ORIGIN || "";
  const allow = corsEnv
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return (origin && (allow.includes(origin) || ALLOW_DEV.includes(origin)))
    ? origin
    : (allow[0] || "*"); // fallback permissivo, ma meglio settare CORS_ORIGIN
};

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": getAllowedOrigin(origin),
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json; charset=utf-8",
});

// -------- Prompt helpers --------
const systemPrompt = `
Sei "What?f", un generatore di scenari sintetici in ITALIANO.
Scrivi in modo chiaro, naturale e concreto. Evita elenchi infiniti.

Hai due modalità:

1) followups  -> restituisci JSON con 2-3 domande mirate per capire meglio.
   Formato ESATTO:
   { "followups": ["domanda 1", "domanda 2", "domanda 3"] }

2) final -> restituisci una risposta breve ma densa (6-10 frasi),
   con un piccolo titolo e una stima di probabilità.
   Formato ESATTO:
   {
     "title": "titolo breve",
     "answer": "testo multi-frase compatto",
     "probability": "70%"
   }

Se alcuni dati sono assenti, fai assunzioni ragionevoli ma dichiarale.
NON aggiungere campi extra nel JSON e non usare code-fences.
`;

const buildUserSummary = (payload) => {
  const {
    time,        // "past" | "future"
    scenario,    // "sliding" | "wtf"
    prompt,      // domanda What?f dell'utente
    place,       // luogo (opzionale)
    when,        // quando (opzionale)
    answers,     // array di risposte rapide (opzionale)
    extra,       // testo libero extra (opzionale)
  } = payload || {};

  return [
    `Tempo: ${time || "non specificato"}.`,
    `Scenario: ${scenario || "non specificato"}.`,
    `Domanda utente: ${prompt || "—"}.`,
    place ? `Luogo: ${place}.` : null,
    when ? `Quando: ${when}.` : null,
    Array.isArray(answers) && answers.length ? `Risposte rapide: ${answers.join(" | ")}.` : null,
    extra ? `Dettagli extra: ${extra}.` : null,
  ].filter(Boolean).join(" ");
};

// -------- Netlify Function --------
export default async (req, context) => {
  const headers = corsHeaders(req.headers.get("origin"));

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers,
    });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY mancante su Netlify" }), {
        status: 500,
        headers,
      });
    }

    const body = await req.json().catch(() => ({}));
    const stage = (body.stage || "final").toLowerCase(); // "followups" | "final"
    const summary = buildUserSummary(body);

    const userMsg = stage === "followups"
      ? `Dati utente: ${summary}\n\nGenera SOLO il JSON followups con 2-3 domande super mirate.`
      : `Dati utente: ${summary}\n\nGenera SOLO il JSON finale (title, answer, probability).`;

    const resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: stage === "followups" ? 0.3 : 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(JSON.stringify({ error: "OpenAI error", detail: text }), {
        status: 502,
        headers,
      });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";

    // Proviamo a fare parse del JSON che abbiamo chiesto al modello
    let json;
    try {
      json = JSON.parse(content);
    } catch {
      // fallback: prova a estrarre JSON tra graffe
      const match = content.match(/\{[\s\S]*\}/);
      json = match ? JSON.parse(match[0]) : null;
    }

    if (!json) {
      return new Response(JSON.stringify({ error: "Risposta AI non in JSON", raw: content }), {
        status: 500,
        headers,
      });
    }

    // Normalizza il payload per il frontend
    if (stage === "followups") {
      const followups = Array.isArray(json.followups) ? json.followups.slice(0, 3) : [];
      return new Response(JSON.stringify({ ok: true, stage, followups }), {
        status: 200,
        headers,
      });
    } else {
      const { title = "Scenario", answer = "", probability = "—" } = json;
      return new Response(JSON.stringify({ ok: true, stage, title, answer, probability }), {
        status: 200,
        headers,
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: "Server error", detail: String(err) }), {
      status: 500,
      headers,
    });
  }
};
