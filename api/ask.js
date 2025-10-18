// ============================
// /api/ask.js — What?f Engine (final, short)
// Stili supportati: whatif, wtf
// Singola risposta (no episodi), IT/EN
// Lunghezza fissata: 5 frasi
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e leggero

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (toni definitivi, compatti) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista demenziale, alcolico, confidenziale; racconto continuo
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Speak in SECOND PERSON and make the user the protagonist.
Output EXACTLY 5 SENTENCES in ONE single flowing paragraph. Target 90–110 words; never exceed 120.
Keep the current voice: nightlife/bar lexicon, surreal touches, cheeky but affectionate; no lists, no questions, no emojis, no moralizing.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, demenziale e un po’ alticcio, ma affettuoso.
Parla in SECONDA PERSONA e rendi l’utente il protagonista.
Produci ESATTAMENTE 5 FRASI in UN unico paragrafo scorrevole. Obiettivo 90–110 parole; mai oltre 120.
Mantieni la voce attuale: lessico da notte/bar, tocchi surreali, sfacciato ma affettuoso; niente elenchi, niente domande, niente emoji, niente prediche.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — amico empatico, realistico con un filo di magia; confidenziale
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Speak in SECOND PERSON.
Output EXACTLY 5 SENTENCES in ONE paragraph. Target 80–100 words; never exceed 110.
Tone: empathetic, realistic, lightly poetic but grounded and optimistic; no lists, no questions, no emojis, no therapy clichés.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
Parla in SECONDA PERSONA.
Produci ESATTAMENTE 5 FRASI in UN paragrafo. Obiettivo 80–100 parole; mai oltre 110.
Tono: empatico, realistico, leggermente poetico ma concreto e positivo; niente elenchi, niente domande, niente emoji, niente cliché da coaching.
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

    // Generate response (stessa voce, più corta)
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.85 : 0.75,              // leggermente più basso per coerenza
      max_tokens: stile === "wtf" ? 180 : 160,                  // hard cap brevità
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      frequency_penalty: 0.2,                                   // evita ripetizioni
      presence_penalty: 0.0
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
