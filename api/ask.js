// ============================
// /api/ask.js — What?f Engine (versione finale definitiva)
// Stili supportati: whatif, wtf
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  // 🔹 WHAT THE F — versione definitiva ironica/sbronza/tragicomica
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, chaotic, sarcastic yet affectionate narrator.
Write a single continuous short story (8–10 flowing sentences) in SECOND PERSON.
Tone: tragicomic, self-deprecating, and sharp — everyday struggles turned absurd.
Use irony, quick wit, and small bursts of existential drunken humor.
Every scene starts real, spirals into chaos, and ends in ironic peace or drunk acceptance.
Avoid clichés, don't moralize, don't ask questions, no lists, no emojis.
It must sound like a brilliant drunk friend narrating your life with affection and sarcasm.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — narratore brillante, sarcastico, demenziale ma affettuoso.
Scrivi un racconto breve e continuo (8–10 frasi) in SECONDA PERSONA.
Tono: tragicomico, autoironico, realistico ma surreale, con humour tagliente e sbronza sottintesa.
Ogni scena parte reale, deraglia in caos quotidiano e si chiude in un'allegria assurda o poetica.
Usa battute geniali, sarcasmo, e quella lucidità ubriaca che fa ridere anche quando brucia.
Non fare domande all’utente. Niente elenchi. Niente emoji. Niente morali.
Devi far ridere, far riflettere e far sentire l’utente vivo nel suo disastro quotidiano.
Rispondi SOLO in Italiano.
`.trim();
  }

  // 🔹 WHAT IF — lasciato invariato (empatico e poetico)
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Speak in SECOND PERSON. 7–10 smooth sentences in a single paragraph.
Tone: empathetic, realistic, lightly poetic yet grounded, optimistic.
Reveal familiarity via concrete hints and micro-observations (never write “I know you”).
Encourage calmly; end with a gentle, hopeful nudge forward.
Do NOT ask questions to the user. No lists. No emojis. No therapy clichés.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
Parla in SECONDA PERSONA. 7–10 frasi fluide in un unico paragrafo.
Tono: empatico, realistico, leggermente poetico ma concreto, positivo.
Fai percepire familiarità con piccoli indizi e micro-osservazioni (mai scrivere “ti conosco”).
Incoraggia con calma; chiudi con una spinta gentile e fiduciosa.
NON porre domande all’utente. Niente elenchi. Niente emoji. Niente cliché da coaching.
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
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif", // "whatif" | "wtf"
      lang = "it",      // "it" | "en"
      extra = ""
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".`;

    // Generate
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.85,
      max_tokens: 700,
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
