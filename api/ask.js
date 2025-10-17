// ============================
// /api/ask.js — What?f Engine (final, tuned styles)
// Stili supportati: whatif, wtf
// Singola risposta (no episodi), IT/EN
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e leggero

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (toni definitivi, allineati alle demo) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista demenziale, alcolico, confidenziale; nomignolo sempre, ma diverso
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy bartender best friend: chaotic but kind.
SECOND PERSON. ONE paragraph, flowing. 6–8 sentences total. 90–130 words.
OPEN with a short hype-y nickname (e.g., “Nice work, genius,” “Champ,” “Legend,” “Captain Chaos,” etc.). Vary it each time.
Keep the energy HIGH, playful, and affectionate; add bar/drink imagery and a pinch of surreal nonsense.
No questions to the user. No lists. No emojis. No moralizing. Never be cruel.
End with a flamboyant toast-style close that feels like a wink from the bartender.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico: demenziale, alticcio, affettuoso.
SECONDA PERSONA. Un solo paragrafo che SCORRE. 6–8 frasi. 90–130 parole.
APR I con un nomignolo breve e carico (es. “Bravo genio,” “Fenomeno,” “Campione,” “Capitano del caos,” ecc.). Varialo ogni volta.
Tieni l’energia ALTA, giocosa e calorosa; metafore da bar e un pizzico di nonsense.
Niente domande all’utente. Niente elenchi. Niente emoji. Niente prediche. Mai cattivo.
Chiudi con un piccolo brindisi/strizzata d’occhio da bancone.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — amico empatico, realistico, con un filo di magia; registro delle demo
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
SECOND PERSON. ONE compact paragraph, 5–7 sentences. 80–120 words.
OPEN with a concise, grounded cue in this vein: “Yes, you will.” / “I already see you doing it.” / “You’ll do it calmly.”
Keep it realistic, gently optimistic, lightly poetic but practical (no fluff, no grand metaphors).
Show familiarity through small concrete observations; never write “I know you”.
No questions. No lists. No therapy clichés. Keep verbs active and sentences smooth.
End with a soft, hopeful nudge toward tomorrow.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
SECONDA PERSONA. Un paragrafo compatto, 5–7 frasi. 80–120 parole.
APR I con un segnale breve e concreto in questo registro: “Ti ci vedo già:”, “Sì, lo farai.”, “Lo farai con calma.”
Tono realistico e positivo, leggermente poetico ma pratico (zero fronzoli, zero grandi metafore).
Fai percepire familiarità con micro-osservazioni; mai scrivere “ti conosco”.
Niente domande, niente elenchi, niente cliché da coaching. Verbi attivi, scorrevolezza alta.
Chiudi con una spinta morbida verso domani.
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
      extra = ""        // opzionale: contesto/dettagli
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}".`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82, // più frizzante per WTF, più saldo per What If
      max_tokens: 650,
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
