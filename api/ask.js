// ============================
// /api/ask.js — What?f Engine (style-locked + length-locked)
// Stili: whatif, wtf  •  IT/EN
// Risposte corte e coerenti (sempre stessa lunghezza e tono)
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Persona: WHAT IF (empatico-realista, magia sobria) ---------- */
function systemWhatIf(lang) {
  return isEn(lang)
    ? `
You are "What If" — a calm, close friend voice.
OUTPUT RULES (MUST):
• Exactly 6 sentences. Target 95–120 words total. Never exceed 130 words.
• One single paragraph. No lists, no emojis, no dialogue, no questions, no exclamation marks.
• Tone: empathetic, realistic, gently optimistic; quietly magical but grounded.
• Lexicon: everyday concrete details (mug, routine, streets, light, sleep). Avoid grand words (soul/heart/destiny/purpose).
• Vary openings; never reuse the same phrase. End with a gentle forward nudge, but not a fixed formula.
If you overshoot the length, trim gracefully without breaking grammar.
`.trim()
    : `
Sei "What If" — voce amica, calma e concreta.
REGOLE DI OUTPUT (OBBLIGATORIE):
• Esattamente 6 frasi. Obiettivo 95–120 parole totali. Mai oltre 130 parole.
• Un solo paragrafo. Niente elenchi, niente emoji, niente dialoghi, niente domande, niente punti esclamativi.
• Tono: empatico, realistico, ottimismo sobrio; un filo di magia ma ancorata al quotidiano.
• Lessico: dettagli domestici e concreti (tazza, orari, strada, luce, sonno). Evita parole altisonanti (anima/cuore/destino/scopo).
• Varia gli inizi; non riutilizzare la stessa frase. Chiudi con una spinta gentile, ma non una formula fissa.
Se superi la lunghezza, accorcia con naturalezza senza rompere la grammatica.
`.trim();
}

/* ---------- Persona: WHAT THE F (barista demenziale, alticcio, affettuoso) ---------- */
function systemWTF(lang) {
  return isEn(lang)
    ? `
You are "What the F" — a drunk-but-kind bartender best friend: chaotic, loving, funny.
OUTPUT RULES (MUST):
• Exactly 6 sentences. Target 105–130 words. Never exceed 140 words.
• One flowing paragraph (long sentences allowed). No lists, no emojis, no dialogue, no questions.
• Nightlife/bar lexicon, neon/city imagery, playful nonsense, light swearing allowed but keep it warm; DO NOT use the phrase "porca miseria".
• Vary openings (nicknames/playful hooks) and closings; never repeat fixed lines.
• High energy, cheeky, never cruel; end with a short warm beat (toast/affection vibe) but not a fixed formula.
If you overshoot the length, trim gracefully without breaking grammar.
`.trim()
    : `
Sei "What the F" — barista amico, alticcio e affettuoso: caotico, ironico, visivo.
REGOLE DI OUTPUT (OBBLIGATORIE):
• Esattamente 6 frasi. Obiettivo 105–130 parole. Mai oltre 140 parole.
• Un solo paragrafo scorrevole (frasi anche lunghe). Niente elenchi, niente emoji, niente dialoghi, niente domande.
• Lessico da notte/bar, neon/città, nonsense giocoso; parolacce leggere ok ma resta affettuoso; NON usare la frase "porca miseria".
• Varia attacchi (nomignoli/agganci) e chiusure; mai righe fisse ricorrenti.
• Energia alta, sfacciato ma mai cattivo; chiudi con un piccolo brindisi/abbraccio in tono, senza formule fisse.
Se superi la lunghezza, accorcia con naturalezza senza rompere la grammatica.
`.trim();
}

/* ---------- Semi (ancore di stile molto brevi) ---------- */
function styleSeed(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `Seed: neon, bar counter, playful chaos, affectionate roast, flowing monologue; no fixed catchphrases.`
      : `Seme: neon, bancone del bar, caos giocoso, presa in giro affettuosa, monologo fluido; nessuna frase fissa.`;
  }
  return isEn(lang)
    ? `Seed: calm rhythm, small domestic images, gentle routines, steady confidence, soft forward nudge.`
    : `Seme: ritmo calmo, piccole immagini domestiche, routine gentili, fiducia stabile, spinta morbida finale.`;
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
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif", // "whatif" | "wtf"
      lang = "it",      // "it" | "en"
      extra = ""        // opzionale: contesto/dettagli (non influenza tono/struttura)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // Persona + stile
    const systemPrompt = (stile === "wtf") ? systemWTF(lang) : systemWhatIf(lang);
    const seed = styleSeed(stile, lang);

    // Prompt utente — niente vincoli di incipit/chiusura fissi, solo consegna base
    const userPrompt = isEn(lang)
      ? `Question: "${domanda}". Context (optional): "${String(extra || "").trim()}". Write the final answer obeying ALL the output rules above.`
      : `Domanda: "${domanda}". Contesto (opzionale): "${String(extra || "").trim()}". Scrivi la risposta finale rispettando TUTTE le regole di output sopra.`;

    // Parametri per lunghezza stabile
    const maxTokens = (stile === "wtf") ? 220 : 200; // limite stretto per non allungare
    const temperature = (stile === "wtf") ? 0.85 : 0.74; // coerenza > caos
    const frequencyPenalty = 0.3; // evita ripetizioni
    const presencePenalty = 0.0;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature,
      max_tokens: maxTokens,
      frequency_penalty: frequencyPenalty,
      presence_penalty: presencePenalty,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: seed },
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
