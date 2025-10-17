// ============================
// /api/ask.js — The Life Cliffhanger Engine™ (definitivo)
// Stili supportati: whatif, wtf
// Singola risposta, senza episodi o follow-up
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e leggero

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — amico alticcio, demenziale ma affettuoso
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, sarcastic-but-kind best friend.
Speak in second person, make the user the protagonist.
Write 8–10 lively sentences as a continuous mini-story (not choppy).
Use humor, mild chaos, and at least one bar/drink reference.
Never be cruel; the affection must always show beneath the sarcasm.
Speak casually, like two friends laughing at life.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — un amico brillante e un po' alticcio, sarcastico ma affettuoso.
Parli in seconda persona, l'utente è il protagonista.
Scrivi 8–10 frasi vivaci, in racconto continuo (non spezzato).
Usa ironia, un pizzico di follia e almeno un riferimento a bar o alcol.
Mai cattivo, sempre affettuoso sotto la risata.
Parla come due amici che ridono insieme della vita.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — amico empatico, lucido, ottimista e realistico
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly knows the user.
Second person. 7–10 smooth sentences, no lists.
Your tone is empathetic, realistic, lightly poetic but grounded.
Encourage with calm clarity and a positive outlook.
Show familiarity without saying “I know you”; reveal it through tone and detail.
End with a small, gentle push forward — calm optimism.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che conosce davvero l’utente.
Parla in seconda persona. Scrivi 7–10 frasi fluide, senza elenchi.
Tono empatico, realistico, leggermente poetico ma concreto.
Incoraggia con chiarezza serena e ottimismo sottile.
Fai percepire che lo conosci attraverso dettagli, non dichiarazioni.
Chiudi con una piccola spinta gentile, fiduciosa.
Rispondi SOLO in Italiano.
`.trim();
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    // Input
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const {
      domanda = "",
      stile = "whatif", // "whatif" | "wtf"
      lang = "it",      // "it" | "en"
      extra = ""        // opzionale: contesto o dettagli
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // Persona system prompt
    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}".`;

    // Generate response
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.97 : 0.84,
      max_tokens: 650,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    return res.status(200).json({
      answer,
      style: stile,
      lang
    });

  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({
      error: "server_error",
      detail: String(err?.message || err)
    });
  }
}
