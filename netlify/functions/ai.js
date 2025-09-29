// Netlify Function: /.netlify/functions/ai
// Node 18+ ha fetch nativo. Non servono dipendenze.
// Risponde sia con domande di chiarimento (follow-up) sia con risposta finale.

const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const okOrigin = (origin) => {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes("*")) return true;
  return ALLOWED_ORIGINS.some(o => origin === o || origin.endsWith(o));
};

const CORS_HEADERS = (origin) => ({
  "Access-Control-Allow-Origin": okOrigin(origin) ? origin : "*",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
});

export default async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS(req.headers.get("Origin")) });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), {
        status: 405, headers: CORS_HEADERS(req.headers.get("Origin")),
      });
    }

    const { question, mode, time, answers, extra } = await req.json() || {};

    if (!process.env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500, headers: CORS_HEADERS(req.headers.get("Origin")),
      });
    }
    if (!question || typeof question !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'question' string" }), {
        status: 400, headers: CORS_HEADERS(req.headers.get("Origin")),
      });
    }

    // Costruisci il prompt con il contesto base
    const scenario = mode === "wtf" ? "What the F?!" : "Sliding Doors";
    const tense = time === "future" ? "Futuro" : "Passato";

    // Regole per decidere se chiedere follow-up (2 domande massimo)
    // Se mancano dettagli essenziali (luogo/tempo/ruolo), prova a chiederli.
    let followups = [];
    const a = answers || {};
    if (!a.location) followups.push("In che luogo/geografia si svolge questa situazione?");
    if (!a.timeframe) followups.push("Qual è l’orizzonte temporale più rilevante (settimane, mesi, anni)?");
    if (!a.role) followups.push("Qual è il tuo ruolo/contesto (studio/lavoro/relazioni)?");
    // Se l’utente ha scritto 'extra' molto breve e la domanda è generica, prova un’ultima domanda di fuoco.
    if ((extra ?? "").trim().length < 10 && question.length < 30 && followups.length < 2) {
      followups.push("C’è un dettaglio chiave che potrei non sapere e che cambia tutto?");
    }
    followups = followups.slice(0, 2);

    if (followups.length > 0) {
      return new Response(JSON.stringify({ needs_followups: true, followups }), {
        status: 200, headers: CORS_HEADERS(req.headers.get("Origin")),
      });
    }

    // Prompt finale (breve e chiaro, personalizzato)
    const sys = `Sei "What?f", guida interattiva che crea scenari "${scenario}" in ${tense}.
- Tono: ${scenario === "What the F?!" ? "ironico/divertente ma coerente" : "realistico e utile"}.
- Lunghezza: 6–8 righe massimo, chiare e leggibili.
- Inserisci UNA probabilità motivata (es. "Probabilità: 72% perché ...").
- Evita ripetizioni e premesse lunghe.
- Personalizza sulla base dei dati utente (answers + extra).`;

    const user = `DOMANDA: ${question}
SCENARIO: ${scenario} | TEMPO: ${tense}
DETTAGLI UTENTE: ${JSON.stringify(answers ?? {}, null, 0)}
NOTE EXTRA: ${extra ?? "(nessuna)"} 
RESTITUISCI: un singolo paragrafo + una riga finale "Probabilità: xx% …"`;


    // Chiamata OpenAI (modello snello)
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: scenario === "What the F?!" ? 0.9 : 0.6,
        max_tokens: 350,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: "OpenAI error", detail: t }), {
        status: 502, headers: CORS_HEADERS(req.headers.get("Origin")),
      });
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "Nessuna risposta.";

    return new Response(JSON.stringify({ ok: true, answer: text }), {
      status: 200, headers: CORS_HEADERS(req.headers.get("Origin")),
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: CORS_HEADERS(req.headers.get("Origin")),
    });
  }
};
