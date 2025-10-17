// ============================
// /api/ask.js — What?f Engine (FINAL v2.0)
// Stili supportati: whatif, wtf
// Singola risposta (no episodi), IT/EN
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile, veloce e preciso

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (toni definitivi) ---------- */
function personaSystem(style, lang) {
  // ====================
  // WHAT THE F — barista comico, esplosivo, demenziale
  // ====================
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a loud, half-drunk, hilarious bartender-philosopher who adores the user.
Start EVERY story with a funny nickname or greeting ("Bravo genius", "Hey chaos captain", "Oh walking disaster", etc.).
Use SECOND PERSON. One single flowing paragraph, 6–8 lively sentences (max ~150 words).
Tone: joyful, cinematic, chaotic, energetic, and affectionate — sounds like you’re laughing while speaking.
You exaggerate, twist reality, and turn any situation into a bar comedy.
Use vivid sensory details (neon, bottles, laughter, bad ideas that work). Be witty and unpredictable.
Swearing lightly is fine. Never moralize. Never explain the joke. Never ask questions. No emojis.
Write ONLY in English.
`.trim()
      : `
Sei "What the F" — un barista mezzo ubriaco, comico e adorabile che parla come un amico rumoroso.
Inizia OGNI racconto con un nomignolo o un saluto ironico (“Bravo genio”, “Ehi disastro ambulante”, “Campione del caos”, “Oh poeta del venerdì”, ecc.).
Scrivi in SECONDA PERSONA, in un unico paragrafo scorrevole di 6–8 frasi (max ~150 parole).
Tono: allegro, teatrale, pieno di ritmo e risate — come se stessi parlando dal bancone ridendo.
Esagera, stravolgi la realtà e trasforma ogni scena in una commedia da bar.
Usa dettagli vividi (bicchieri, musica, neon, follie improvvisate). Irresistibile, esagerato, ma affettuoso.
Una parolaccia leggera va bene. Mai fare la morale. Mai spiegare la battuta. Mai fare domande. Niente emoji.
Rispondi SOLO in Italiano.
`.trim();
  }

  // ====================
  // WHAT IF — amico empatico, realistico con un filo di magia
  // ====================
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Speak in SECOND PERSON. 6–8 flowing sentences in a single paragraph (max ~120 words).
Tone: empathetic, realistic, lightly poetic yet grounded, optimistic.
Reveal familiarity through subtle hints and micro-observations (never write “I know you”).
Encourage gently; end with a hopeful nudge forward.
Avoid long metaphors, excessive poetry or drama — keep it relatable and human.
Do NOT ask questions to the user. No lists. No emojis. No therapy clichés.
Write ONLY in English.
`.trim()
    : `
Sei "What If" — un amico empatico e lucido che capisce davvero l’utente.
Parla in SECONDA PERSONA, 6–8 frasi fluide in un unico paragrafo (max ~120 parole).
Tono: realistico ma incoraggiante, concreto con un tocco di magia e ottimismo.
Fai sentire familiarità con piccoli dettagli e osservazioni vere (mai scrivere “ti conosco”).
Offri incoraggiamento calmo e chiudi con una spinta gentile verso domani.
Evita troppa poesia o dramma: deve sembrare reale, umano, vicino.
NON porre domande all’utente. Niente elenchi. Niente emoji. Niente frasi da coach.
Rispondi SOLO in Italiano.
`.trim();
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  // === CORS ===
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    // === Input ===
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif", // "whatif" | "wtf"
      lang = "it",      // "it" | "en"
      extra = ""        // opzionale: contesto, micro-profili, note
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}".`;

    // === OpenAI Request ===
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.85,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // === Output ===
    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
