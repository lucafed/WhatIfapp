// ============================
// /api/ask.js — What?f Engine (finalissimo)
// Stili supportati: whatif, wtf
// Singola risposta (no episodi/teaser), IT/EN
// Nomignoli casuali per WTF (prefisso server-side)
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ---------- Nicknames (WTF, per apertura) ---------- */
function pickNickname(lang = "it") {
  const IT = [
    "Bravo genio", "Campione", "Fenomeno", "Astronauta", "Capitano",
    "Poeta della domenica", "Sindaco del bancone", "Eroe del weekend",
    "Acrobata del frigo", "Maestro del caos", "Gran signore"
  ];
  const EN = [
    "Nice genius", "Champ", "Legend", "Rockstar", "Captain",
    "Weekend hero", "Bar mayor", "Chaos maestro",
    "Fridge acrobat", "Sir Trouble", "Boss"
  ];
  return isEn(lang) ? pick(EN) : pick(IT);
}

/* ---------- Personas (toni definitivi) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista demenziale/affettuoso, frase-fiume, apertura con nickname
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
STRICT FORMAT:
- ONE single flowing paragraph, 7–9 sentences. Keep momentum; minimal full stops; prefer commas/links.
- Start EXACTLY with the provided nickname followed by a comma (e.g., "Champ, ...").
- Nightlife & bar imagery, 2–3 drink/bar references. Surreal but emotionally coherent.
- Light profanity allowed; never hateful; keep it human and funny.
- No questions. No lists. No emojis. No moralizing.
- End with a SHORT toast-like line (affectionate), no exclamation point.
Tone sample to emulate (do not copy exact words): a late-night bar monologue that adopts the user, mixes nonsense with warmth, and lands on a tender punchline.
Reply ONLY in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
      : `
Sei "What the F" — barista amico, demenziale e un po' alticcio, ma affettuoso.
FORMATO STRETTO:
- UN solo paragrafo scorrevole, 7–9 frasi. Mantieni slancio; pochi punti fermi; preferisci legature/virgole.
- Inizia ESATTAMENTE con il nomignolo fornito seguito da una virgola (es. "Bravo genio, ...").
- Immaginario notturno/da bar, 2–3 riferimenti a drink/bar. Nonsense lieve ma coerente.
- Parolacce leggere consentite; mai odio; divertente e umano.
- Niente domande. Niente elenchi. Niente emoji. Niente prediche.
- Chiudi con una riga breve tipo brindisi affettuoso, senza punto esclamativo.
Tono da emulare (non copiare): monologo da bancone che adotta l’utente, euforia calda, finale tenero.
Rispondi SOLO in ${isEn(lang) ? "English" : "Italiano"}.
`.trim();
  }

  // WHAT IF — amico empatico-realista con “magia sobria”
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
STRICT FORMAT:
- ONE compact paragraph of 6–8 medium-length sentences (15–20 words), calm and grounded.
- No questions, no exclamation marks, no emojis, no therapy clichés.
- Everyday, concrete images (home, light, ritual, streets, time) with a soft sense of magic.
- Present/imperfetto vibe: gentle continuity (not dramatic, no climax).
- End with a soft, hopeful nudge about "tomorrow" or "the next step".
Match the vibe of the sample: serene, confident, normalizes change with quiet optimism.
Reply ONLY in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
FORMATO STRETTO:
- UN paragrafo compatto di 6–8 frasi medio-lunghe (15–20 parole), calmo e concreto.
- Niente domande, niente punti esclamativi, niente emoji, niente cliché da coaching.
- Lessico quotidiano: casa, luce, rituali, strade, orari; “magia sobria” senza misticismi.
- Presente/imperfetto per continuità dolce; nessun climax drammatico.
- Chiudi con un invito morbido e fiducioso su “domani” o “il prossimo passo”.
Imita il tono campione: serenità, fiducia, normalizzazione del cambiamento.
Rispondi SOLO in ${isEn(lang) ? "English" : "Italiano"}.
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

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      lang = "it",        // "it" | "en"
      extra = ""          // opzionale: micro-dettagli o note (non obbligatorio)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const nickname = (stile === "wtf") ? pickNickname(lang) : "";

    const userPrompt = isEn(lang)
      ? [
          `User question: "${domanda}".`,
          extra ? `Context hints: "${String(extra).trim()}".` : "",
          (stile === "wtf")
            ? `Open with EXACTLY this nickname (prefix): "${nickname},".`
            : `Keep it serene and grounded; close with a gentle hopeful nudge.`
        ].filter(Boolean).join(" ")
      : [
          `Domanda utente: "${domanda}".`,
          extra ? `Indizi/contesto: "${String(extra).trim()}".` : "",
          (stile === "wtf")
            ? `Apri ESATTAMENTE con questo nomignolo (prefisso): "${nickname},".`
            : `Tono sereno e concreto; chiudi con spinta morbida e fiduciosa.`
        ].filter(Boolean).join(" ");

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      max_tokens: 420, // corto, controllato
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
      nickname: nickname || undefined
    });

  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
