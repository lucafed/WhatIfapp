// ============================
// /api/ask.js — What?f Engine (pragmatic v2)
// Stili: whatif, wtf
// IT/EN, singola risposta, con accorciamento server-side
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e leggero

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

// Normalizza spazi, tronca per frasi e parole
function tighten(text, style = "whatif") {
  if (!text) return "";
  const clean = text
    .replace(/\s+/g, " ")
    .replace(/\n+/g, " ")
    .trim();

  const limits = (style === "wtf")
    ? { maxSent: 8, maxWords: 130 }
    : { maxSent: 7, maxWords: 110 };

  // Split su fine frase (. ! ?), mantenendo fluidità
  const sentences = clean.split(/(?<=[\.!?])\s+/).filter(Boolean);
  let clipped = sentences.slice(0, limits.maxSent).join(" ").trim();

  // Clip anche per parole
  const words = clipped.split(/\s+/);
  if (words.length > limits.maxWords) {
    clipped = words.slice(0, limits.maxWords).join(" ").trim() + "…";
  }

  return clipped;
}

/* ---------- Personas (toni pragmatici) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista amico, demenziale ma affettuoso; flusso continuo, meno puntini
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
SECOND PERSON. One continuous mini-story, natural flow (no choppy lines).
6–8 sentences, ≤130 words. Use bar/drink references, allow a touch of surreal nonsense.
Bold but never cruel; warmth must show under the sarcasm.
No lists. No emojis. Do NOT ask the user questions. No moralizing.
Keep it colloquial, like a late-night bar monologue to a dear friend.
Write ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, demenziale e un po’ alticcio, ma affettuoso.
SECONDA PERSONA. Un racconto continuo, scorrevole (evita frasi spezzate).
6–8 frasi, ≤130 parole. Riferimenti a bar/alcol, un pizzico di nonsense va bene.
Sfacciato ma mai cattivo; il calore deve sentirsi sotto il sarcasmo.
Niente elenchi. Niente emoji. NON fare domande all’utente. Niente prediche.
Tono colloquiale da bancone, tarda sera, tra amici stretti.
Scrivi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — amico empatico e concreto; meno poetico, più pragmatico
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
SECOND PERSON. 5–7 smooth sentences in a single paragraph, ≤110 words.
Tone: empathetic, realistic, grounded; lightly poetic at most, but pragmatic.
Show familiarity via micro-observations and concrete hints (never write “I know you”).
Encourage calmly; end with a small, hopeful push forward.
No lists. No emojis. Do NOT ask the user questions. No therapy clichés.
Write ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
SECONDA PERSONA. 5–7 frasi fluide in un unico paragrafo, ≤110 parole.
Tono: empatico, realistico, concreto; un filo poetico al massimo, ma pragmatico.
Fai percepire familiarità con piccole osservazioni e dettagli reali (mai scrivere “ti conosco”).
Incoraggia con calma; chiudi con una spinta gentile e fiduciosa.
Niente elenchi. Niente emoji. NON porre domande all’utente. Evita cliché da coaching.
Scrivi SOLO in Italiano.
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
      extra = ""        // opzionale: note/indizi (non è obbligatorio)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints (optional): "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto o indizi (facoltativi): "${String(extra || "").trim()}".`;

    // Generate response (più sobrio in token e temperatura)
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      max_tokens: 320,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const raw = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!raw) throw new Error("empty_model_response");

    // Accorcia in modo deterministico lato server
    const answer = tighten(raw, stile);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
