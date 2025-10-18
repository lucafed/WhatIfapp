// ============================
// /api/ask.js — What?f Engine (final balanced)
// Stili: whatif, wtf • IT/EN
// 5 frasi più ricche, tono identico agli esempi originali
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Speak in SECOND PERSON and make the user the protagonist.
Write ONE flowing mini-story of EXACTLY FIVE SENTENCES (each up to 30 words).
Keep your voice loud, funny, a bit drunk, warm-hearted and chaotic.
Use nightlife, bar, and surreal humor, affectionate sarcasm, a cinematic rhythm.
Do NOT ask questions to the user. No lists, no emojis, no morals.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Parla in SECONDA PERSONA e rendi l’utente il protagonista.
Scrivi UN racconto continuo di ESATTAMENTE CINQUE FRASI (ognuna fino a 30 parole).
Mantieni la voce esuberante, ironica, un po’ ubriaca ma dolce, con ritmo musicale e immagini vivide.
Usa metafore da bar, notturne, surreali ma coerenti; sarcasmo affettuoso, tono da bancone.
Niente domande, niente elenchi, niente emoji, niente morali.
Rispondi SOLO in Italiano.
`.trim();
  }

  return isEn(lang)
    ? `
You are "What If" — a calm, lucid friend who truly understands the user.
Speak in SECOND PERSON.
Write ONE paragraph of EXACTLY FIVE SENTENCES (each up to 30 words).
Keep it realistic, intimate, grounded, lightly poetic and optimistic.
Use sensory detail and small gestures; end with a calm sense of forward motion.
Do NOT ask questions to the user. No lists, no emojis, no clichés.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo, lucido e realistico che capisce davvero l’utente.
Parla in SECONDA PERSONA.
Scrivi UN paragrafo di ESATTAMENTE CINQUE FRASI (ognuna fino a 30 parole).
Tono empatico, concreto, leggermente poetico ma sobrio e fiducioso.
Descrivi dettagli piccoli e quotidiani; chiudi con una spinta morbida verso domani.
Niente domande, niente elenchi, niente emoji, niente cliché da coaching.
Rispondi SOLO in Italiano.
`.trim();
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}".`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.96 : 0.86,
      max_tokens: 340, // spazio per 5 frasi complete e ricche
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({
      error: "server_error",
      detail: String(err?.message || err)
    });
  }
}
