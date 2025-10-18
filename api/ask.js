// ============================
// /api/ask.js — What?f Engine (final stable compact)
// Stili: whatif, wtf • IT/EN
// Stesso tono originale, ma sempre 5 frasi brevi e complete
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (identiche, solo aggiunta vincolo compatto) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Speak in SECOND PERSON and make the user the protagonist.
Write ONE continuous mini-story of exactly FIVE SENTENCES, each short and flowing (max 20 words each).
Keep the same chaotic, affectionate bar humor, surreal details, and energetic rhythm.
Use nightlife/drink metaphors, keep it human and warm, no lists, no questions, no emojis.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, demenziale e un po’ alticcio, ma affettuoso.
Parla in SECONDA PERSONA e rendi l’utente il protagonista.
Scrivi UN racconto continuo di ESATTAMENTE CINQUE FRASI, brevi e scorrevoli (massimo 20 parole ciascuna).
Mantieni lo stesso umorismo da bancone, surreale e affettuoso, ritmo alto e voce umana.
Usa metafore notturne/alcoliche, niente elenchi, niente domande, niente emoji.
Rispondi SOLO in Italiano.
`.trim();
  }

  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Speak in SECOND PERSON.
Write ONE short paragraph of exactly FIVE SENTENCES, each under 20 words, smooth and calm.
Keep the tone empathetic, grounded, lightly poetic, realistic, optimistic.
No lists, no questions, no emojis, no therapy clichés.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
Parla in SECONDA PERSONA.
Scrivi UN paragrafo di ESATTAMENTE CINQUE FRASI, brevi e fluide (massimo 20 parole ciascuna).
Tono empatico, realistico, leggermente poetico ma concreto e positivo.
Niente elenchi, niente domande, niente emoji, niente cliché da coaching.
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
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}".`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.85,
      max_tokens: 260, // alzato leggermente per chiudere bene le 5 frasi
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
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
