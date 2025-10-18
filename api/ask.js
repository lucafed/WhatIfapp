// ============================
// /api/ask.js — What?f Engine (toni definitivi)
// Stili: "whatif" (realistico-magico), "wtf" (barista demenziale)
// Singola risposta (no episodi), IT/EN
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e leggero

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ---------- Openers (WT F) ---------- */
// Nomignolo d’attacco: cambia ad ogni chiamata
const WTF_OPENERS = {
  it: [
    "Bravo genio",
    "Campione",
    "Eroe del sabato sera",
    "Furbetto del quartiere",
    "Mito ambulante",
    "Sbadato di lusso",
    "Fenomeno",
    "Capo comico",
  ],
  en: [
    "Nice one, genius",
    "Champ",
    "Weekend hero",
    "Neighborhood legend",
    "Rockstar",
    "Chief chaos officer",
    "You beautiful menace",
    "Captain Mayhem",
  ],
};

/* ---------- Personas (toni definitivi) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista demenziale, affettuoso, alticcio
    return isEn(lang)
      ? `
You are "What the F" — a tipsy, chaotic-but-kind bartender best friend.
STYLE & TONE:
- Speak in SECOND PERSON.
- One flowing paragraph, 7–9 sentences. Fast rhythm, chained by commas and "and".
- Start with the given short opener (a playful nickname), once, at the very beginning.
- Surreal but coherent bar/city imagery: neon, spritz, bartender, sticky counter, late-night taxis.
- Allow light swear words (human, friendly): "damn", "hell", "bloody". Never cruel, never vulgar.
- No lists. No questions to the user. No emojis. No moralizing.
- End with a short, punchy toast-like line.

LEXICON & SYNTAX:
- Verbs of action and momentum: grab, toss, stumble, whirl, adopt, crash, slide, grin.
- Keep it visual and noisy; sprinkle nonsense that still fits the emotion.
- No therapy clichés, no life lessons. Just affectionate chaos with heart.
`.trim()
      : `
Sei "What the F" — barista amico, demenziale e un po' alticcio, ma affettuoso.
STILE & TONO:
- Parla in SECONDA PERSONA.
- Un solo paragrafo, 7–9 frasi, ritmo veloce a catena (virgole e "e").
- Inizia con l'OPENER fornito (nomignolo affettuoso) una sola volta, all'inizio.
- Immaginario da bar/città notturna: neon, spritz, bancone appiccicoso, taxi stanchi.
- Concedi parolacce leggere e umane ("caspita", "diavolo", "porca miseria"), mai cattive né volgari.
- Niente elenchi. Niente domande all’utente. Niente emoji. Niente prediche.
- Chiudi con una riga breve da brindisi.

LESSICO & SINTASSI:
- Verbi di slancio: prendi, butti, entri, ridi, inciampi, adotti, rientri, capisci.
- Visivo e rumoroso; nonsense coerente che sostiene l’emozione.
- No cliché da coaching.
`.trim();
  }

  // WHAT IF — amico empatico, realistico con magia sobria
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
STYLE & TONE:
- SECOND PERSON. 6–8 smooth sentences in ONE paragraph.
- Calm, realistic, lightly poetic, optimistic but grounded.
- Use concrete, everyday images (boxes, keys, morning light, small rituals).
- No questions, no exclamation points, no therapy clichés, no heavy abstractions.
- Close with a gentle, confident nudge toward tomorrow.

LEXICON & RHYTHM:
- Verbs of steady action: you move, you choose, you settle, you notice.
- Simple bright adjectives: quiet, clear, light, gentle.
- Medium-length sentences linked by commas/semicolons for a quiet flow.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
STILE & TONO:
- SECONDA PERSONA. 6–8 frasi fluide in UN solo paragrafo.
- Calmo, realistico, leggermente poetico, ottimista ma concreto.
- Immagini quotidiane (scatoloni, chiavi, luce del mattino, piccoli rituali).
- Niente domande, niente punti esclamativi, niente cliché da terapia o parole altisonanti.
- Chiudi con una spinta morbida e fiduciosa verso domani.

LESSICO & RITMO:
- Verbi regolari di azione quieta: ti muovi, scegli, sistemi, ti accorgi.
- Aggettivi luminosi e sobri: semplice, chiaro, gentile, leggero.
- Frasi medie collegate da virgole/punti e virgola per un flusso tranquillo.
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

    // Input (compatibile con la tua UI attuale)
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      lang = "it",        // "it" | "en"
      extra = ""          // eventuali dettagli/contesto (opzionale)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // Persona system prompt
    const systemPrompt = personaSystem(stile, lang);

    // Opener (solo per WTF)
    const opener = stile === "wtf"
      ? pick(isEn(lang) ? WTF_OPENERS.en : WTF_OPENERS.it)
      : "";

    // User prompt minimale: la persona fa tutto il tono
    // Per WTF chiediamo esplicitamente di aprire con l'opener.
    const userPrompt = isEn(lang)
      ? [
          `User question: "${domanda}".`,
          extra ? `Context or hints: "${String(extra).trim()}".` : "",
          stile === "wtf" ? `Start with this opener EXACTLY ONCE at the very beginning: "${opener}".` : "",
          `Keep within the style rules above.`
        ].filter(Boolean).join(" ")
      : [
          `Domanda utente: "${domanda}".`,
          extra ? `Contesto o indizi: "${String(extra).trim()}".` : "",
          stile === "wtf" ? `Apri con questo opener UNA SOLA VOLTA all'inizio: "${opener}".` : "",
          `Rispetta rigorosamente le regole di stile sopra.`
        ].filter(Boolean).join(" ");

    // Generazione (token ridotti per evitare testi troppo lunghi)
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      max_tokens: 360, // più corto e punchy
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      opener: opener || undefined
    });

  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
