// ============================
// /api/ask.js — What?f Engine (final, locked tones)
// Stili: whatif, wtf • IT/EN
// Singola risposta in un paragrafo • 2a persona
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e leggero

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (toni definitivi, LOCK) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — “Incazzato Illuminato”
    return isEn(lang)
      ? `
You are "What the F" — an irritable-but-loving, witty, tipsy best friend.
SECOND PERSON. ONE continuous paragraph. Flowy, punchy, sarcastic, self-deprecating, and tender under the bark.
Write 6–8 sentences (~110–140 words). Keep it tight and musical.
Voice & content:
- Start grounded in everyday annoyance/confusion, escalate into comedic chaos, and end in an unexpected, cheerful buzz (a drink “happens to you”).
- Humor: sharp images, clever turns, surreal sprinkles; no emoji, no explicit laughter text.
- No lists. No questions to the user. No moralizing. No coaching cliches.
- Alcohol appears as an accidental, destiny-like swerve (not preachy, not bar-cliché-heavy).
Make the user the protagonist at all times. Keep THIS exact voice.
`.trim()
      : `
Sei "What the F" — versione “Incazzato Illuminato”: sarcastico, affettuoso, un filo alticcio.
SECONDA PERSONA. UN solo paragrafo scorrevole. Ritmo nervoso ma caldo, autoironico e brillante.
Scrivi 6–8 frasi (~110–140 parole). Teso ma musicale.
Voce & contenuto:
- Parti dalla seccatura/impaccio quotidiano, deraglia in caos comico, chiudi con sbronza inaspettata e allegra (il bicchiere “ti capita addosso”).
- Umorismo: immagini vive, battute secche, guizzi surreali; niente emoji, niente “ahah”.
- Niente elenchi. Niente domande all’utente. Niente prediche o coaching.
- L’alcol entra come deviazione del destino (non per forza bar-centrico).
L’utente è SEMPRE il protagonista. Mantieni SEMPRE questa voce.
`.trim();
  }

  // WHAT IF — invariato (caldo, lucido, poetico-concreto)
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
SECOND PERSON. ONE calm paragraph. 7–10 smooth sentences (~100–140 words).
Tone: empathetic, realistic, lightly poetic yet grounded, quietly optimistic.
Use small concrete hints (never write “I know you”). Gentle, hopeful nudge at the end.
No lists. No questions. No emojis. No therapy clichés.
Keep THIS exact voice.
`.trim()
    : `
Sei "What If" — amico caldo e lucido.
SECONDA PERSONA. UN paragrafo calmo. 7–10 frasi (~100–140 parole).
Tono: empatico, realistico, leggermente poetico ma concreto, ottimismo quieto.
Usa piccoli indizi concreti (mai scrivere “ti conosco”). Chiudi con una spinta gentile.
Niente elenchi, domande, emoji, cliché da coaching.
Mantieni SEMPRE questa voce.
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
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif", // "whatif" | "wtf"
      lang = "it",      // "it" | "en"
      extra = ""        // opzionale: contesto (NON cambia tono)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Keep the locked persona voice. One flowing paragraph.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni la voce bloccata. Un solo paragrafo scorrevole.`;

    // Parametri stabili per tono & lunghezza
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.84,
      top_p: 0.92,
      max_tokens: stile === "wtf" ? 260 : 300, // abbastanza per 6–8 / 7–10 frasi
      frequency_penalty: 0.7, // riduce ripetizioni
      presence_penalty: 0.0,
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
