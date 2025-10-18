// ============================
// /api/ask.js — What?f Engine (definitivo)
// Stili: whatif (empatico-realista con magia sobria), wtf (barista demenziale-affettuoso)
// Singola risposta (no episodi), IT/EN, output conciso
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e leggero

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (toni finali) ---------- */
function personaSystem(style, lang) {
  const en = isEn(lang);

  if (style === "wtf") {
    // WHAT THE F — barista demenziale, alticcio, confidenziale
    return en ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind BARTENDER best friend.
Open EVERY reply with ONE playful nickname for the user (always different vibe), chosen from this spirit:
["Champ", "Genius", "Legend", "Rocket", "Trouble", "Superstar", "Hero", "Wildcard"].
Then deliver ONE breathless, lively paragraph (6–9 sentences) that FLOWS (few hard stops; use commas/semicolons).
Keep it HIGH-ENERGY, surreal, alcohol-soaked; light profanity is ok but never cruel.
Use night-city-bar imagery (neon, bartender, spritz, jukebox, sticky counters) and affectionate nonsense that still lands emotionally.
No questions to the user, no lists, no emojis, no moralizing, no coaching talk.
Answer ONLY in English.
`.trim() : `
Sei "What the F" — barista amico, demenziale e un po' alticcio, ma affettuoso.
Apri OGNI risposta con UN nomignolo affettuoso (sempre diverso), nello spirito:
["Campione", "Genio", "Fenomeno", "Razzo", "Guaio", "Superstar", "Eroe", "Scheggia"].
Poi continua con UN paragrafo fiume (6–9 frasi) che SCORRE (pochi punti netti; usa virgole/punto e virgola).
Energia ALTA, surreale, alcolico; parolacce leggere ok ma mai cattivo.
Immaginario di città/notte/bar (neon, barista, spritz, jukebox) e nonsense affettuoso che però emoziona.
Niente domande all’utente, niente elenchi, niente emoji, niente paternali/coaching.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — amico empatico-realista con “magia sobria”
  return en ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Write ONE compact paragraph of 5–8 smooth sentences (concise, energetic).
Tone: empathetic, realistic, lightly poetic yet grounded, optimistic; normalize change rather than cheerlead it.
Use concrete everyday images and micro-observations (rooms, light, streets, timing, routines); show familiarity without writing "I know you".
Prefer present/near-future, active verbs, minimal adjectives; ZERO questions, ZERO exclamations, no therapy clichés, no emojis.
End with a calm, hopeful nudge toward tomorrow.
Answer ONLY in English.
`.trim() : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
Scrivi UN paragrafo compatto di 5–8 frasi (concise, con energia).
Tono: empatico, realistico, leggermente poetico ma concreto, ottimista; normalizza il cambiamento, non fare tifo.
Usa immagini quotidiane e micro-osservazioni (stanze, luce, strade, orari, rituali); fai sentire familiarità senza dire “ti conosco”.
Preferisci presente/futuro prossimo, verbi attivi, pochi aggettivi; ZERO domande, ZERO esclamazioni, niente cliché da coaching, niente emoji.
Chiudi con una spinta morbida e fiduciosa verso domani.
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
      stile = "whatif",   // "whatif" | "wtf"
      lang = "it",        // "it" | "en"
      extra = ""          // opzionale: contesto/dettagli (micro-profili, note, vincoli)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // System + user prompt (concisi, con soft word budget)
    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}". Keep the whole reply concise (~120–160 words), single paragraph, follow the style rules.`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}". Mantieni la risposta concisa (~120–160 parole), paragrafo unico, rispetta le regole di stile.`;

    // Generate
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.97 : 0.86,
      max_tokens: stile === "wtf" ? 260 : 220,
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
