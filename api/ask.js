// /api/ask.js — versione "base": niente Upstash, CORS permissivo, runtime Node.js

import OpenAI from "openai";

export const config = {
  // Evita Edge Runtime: alcune lib e fetch possono dare problemi su Vercel Edge
  runtime: "nodejs",
};

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// CORS molto permissivo (per debug). Se vuoi, dopo che funziona, limita a un dominio.
function setCors(req, res) {
  const origin = String(req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Origin", origin === "null" ? "*" : origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\.\.+/g, "…")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function sentenceCaseAll(s = "") {
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g, (m, p, c) => p + c.toUpperCase());
}

function finalPunct(s = "") {
  return /[.!?…]$/.test(s) ? s : s + ".";
}

function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t.slice(0, Math.min(t.length, d.length + 12)).toLowerCase().replace(/[“”"']/g, "").trim();
  const rx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  return t.replace(rx, "");
}

export default async function handler(req, res) {
  setCors(req, res);

  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Health check (utile per capire se la route risponde)
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/ask", message: "alive" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key", detail: "OPENAI_API_KEY is not set" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", periodo = "future" } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // Prompt minimale ma coerente con il tuo front-end (paragrafo unico, no eco domanda)
    const isWTF = String(stile).toLowerCase() === "wtf";
    const L = (String(lang || "it").slice(0, 2) || "it").toLowerCase();

    const sys =
      L === "en"
        ? `One paragraph. No bullets. Do NOT repeat the user's question. Keep it natural.`
        : `Un solo paragrafo. Niente elenchi. NON ripetere la domanda. Tono naturale.`;

    const mode =
      String(periodo).toLowerCase() === "past"
        ? (L === "en" ? "Write as if it already happened." : "Scrivi come se fosse già successo.")
        : (L === "en" ? "Write as a near-future unfolding starting now." : "Scrivi come un futuro vicino che inizia ora.");

    const styleRule = isWTF
      ? (L === "en"
          ? `WHAT THE F: playful, absurd but helpful. 6–8 sentences. One single paragraph. Include 1 theatrical exclamation (never at people), 2–3 tiny mishaps, then 1–2 helpful lines and a warm moral.`
          : `WHAT THE F: giocosa, demenziale ma utile. 6–8 frasi. Un solo paragrafo. Includi 1 imprecazione teatrale (mai verso persone), 2–3 micro-imprevisti, poi 1–2 frasi utili e una morale calda.`)
      : (L === "en"
          ? `WHAT IF: calm, empathetic, practical. 8–11 sentences, one paragraph. First weeks + 3–6 month outlook, micro-test, inner criterion.`
          : `WHAT IF: calma, empatica, concreta. 8–11 frasi in un paragrafo. Prime settimane + outlook 3–6 mesi, micro-test e criterio interno.`);

    const userCue =
      L === "en"
        ? `Write the answer now. Do NOT restate: "${domanda}"`
        : `Scrivi ora la risposta. NON ripetere: "${domanda}"`;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: isWTF ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: sys },
        { role: "system", content: mode },
        { role: "system", content: styleRule },
        { role: "user", content: userCue },
      ],
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-process come nel tuo front-end
    answer = stripQuestionEcho(domanda, answer);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Piccola correzione per italiano (all’Aquila)
    if (L === "it") {
      answer = answer.replace(/\ball’aquila\b/g, "all’Aquila");
    }

    return res.status(200).json({
      answer,
      style: stile,
      lang: L,
      periodo,
      model: MODEL,
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    // Mostra il messaggio reale per capire subito dov'è il problema
    return res.status(500).json({
      error: "server_error",
      detail: String(err?.message || err),
    });
  }
}
