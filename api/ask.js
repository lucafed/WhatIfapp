// ============================
// /api/ask.js — What?f Engine (final, same style + shorter)
// Stili supportati: whatif, wtf
// Singola risposta (no episodi), IT/EN
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e leggero

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (toni identici, ma con lunghezza limitata) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista demenziale, alcolico, confidenziale; racconto continuo
    // SOLO accorciamo: 6–8 frasi, ~110–140 parole, un unico paragrafo.
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Speak in SECOND PERSON and make the user the protagonist.
Write ONE continuous mini-story in a single paragraph: 6–8 flowing sentences, around 110–140 words total.
Use surreal humor and bar/drink references; a little nonsense is welcome.
Be cheeky and bold but never cruel; affection must show under the sarcasm.
Keep it conversational, like a late-night bar monologue to a dear friend.
Do NOT ask questions to the user. No lists. No emojis. No moralizing.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, demenziale e un po' alticcio, ma affettuoso.
Parla in SECONDA PERSONA e rendi l’utente il protagonista.
Scrivi UN racconto continuo in un unico paragrafo: 6–8 frasi scorrevoli, circa 110–140 parole totali.
Usa ironia surreale e riferimenti a bar/alcol; un po' di nonsense va bene.
Sfacciato ma mai cattivo: l’affetto deve sentirsi sotto il sarcasmo.
Tono da bancone a tarda sera, confidenziale.
NON fare domande all’utente. Niente elenchi. Niente emoji. Niente prediche.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — amico empatico, realistico con un filo di magia; confidenziale
  // SOLO accorciamo: 5–6 frasi, ~85–110 parole, un unico paragrafo.
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Speak in SECOND PERSON.
Write ONE smooth paragraph: 5–6 sentences, around 85–110 words total.
Tone: empathetic, realistic, lightly poetic yet grounded, optimistic.
Reveal familiarity via concrete hints and micro-observations (never write “I know you”).
Encourage calmly; end with a gentle, hopeful nudge forward.
Do NOT ask questions to the user. No lists. No emojis. No therapy clichés.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
Parla in SECONDA PERSONA.
Scrivi UN paragrafo fluido: 5–6 frasi, circa 85–110 parole totali.
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
      extra = ""        // opzionale: contesto/dettagli (micro-profili, note, vincoli)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}". Keep the text within the specified sentence and word ranges.`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}". Mantieni il testo dentro i range di frasi e parole indicati.`;

    // Generate response (solo più corta: abbasso max_tokens)
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.97 : 0.86, // tuoi valori, tono invariato
      max_tokens: 320, // prima 700 — ora corto per stare nella lunghezza degli esempi
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
