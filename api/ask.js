// ============================
// /api/ask.js — What?f Engine (final, trimmed + unexpected-drinks)
// Stili supportati: whatif, wtf • IT/EN
// Singola risposta (no episodi multipli), IT/EN
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e leggero

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (toni definitivi, accorciati) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista demenziale/confidenziale, con sbronza inattesa
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Speak in SECOND PERSON and make the user the protagonist.
Write ONE continuous mini-story of **6–8 smooth sentences (~110–140 words)**.
Start with a warm, friendly address; keep it flowing (avoid choppy, staccato lines).
Use surreal humor and bar/drink imagery. The **running gag**: the user tries to stay sober (“just water”), but **fate sneaks in a toast** and the scene ends in a cheerful, unexpected drink.
Be cheeky and bold but never cruel; warmth under the sarcasm.
Do NOT ask questions. No lists. No emojis. No moralizing.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, demenziale e un po' alticcio, ma affettuoso.
Parla in SECONDA PERSONA e rendi l’utente il protagonista.
Scrivi UN racconto continuo di **6–8 frasi scorrevoli (~110–140 parole)**.
Apri con un saluto caldo; mantieni il flusso (evita frasi spezzate).
Ironia surreale e riferimenti a bar/alcol. **Gag ricorrente**: tu provi a restare sobrio (“solo acqua”), ma **il destino ti mette in mano un brindisi** e la scena si chiude in allegria.
Sfacciato ma mai cattivo: sotto c’è sempre affetto.
NON porre domande. Niente elenchi. Niente emoji. Niente prediche.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — amico empatico, realistico con un filo di magia (invariato)
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
      extra = ""        // opzionale: contesto/dettagli (micro-profili, note, vincoli)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}".`;

    // Generate response (snappier length)
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.94 : 0.86,
      max_tokens: 360, // accorciato per mantenere ritmo e lunghezza
      frequency_penalty: 0.4,
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
