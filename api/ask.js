// ============================
// /api/ask.js — What?f Engine (deterministic openers, toned & concise)
// Stili: "whatif" (realistic, warm) • "wtf" (barista demenziale)
// Singola risposta (no episodi), IT/EN
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e leggero

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

// Hash deterministico semplice per scegliere sempre lo stesso incipit su stessa domanda
function hashStr(s = "") {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h >>> 0);
}
function pickDeterministic(arr, seed) {
  if (!arr?.length) return "";
  return arr[hashStr(String(seed || "")) % arr.length];
}

/* ---------- Incipit per stile (IT/EN) ---------- */
const WTF_OPENERS_IT = [
  "Bravo genio,", "Campione,", "Fenomeno,", "Eroe del venerdì,",
  "Stratega del caos,", "Capolavoro ambulante,", "Sultano degli aperitivi,",
  "Ninja del procrastino,", "Meteora del bar,"
];
const WTF_OPENERS_EN = [
  "Nice one, genius,", "Champ,", "You glorious menace,", "Friday hero,",
  "Chaos strategist,", "Walking masterpiece,", "Bar legend,",
  "You magnificent disaster,", "Spark plug,"
];

const WHATIF_OPENERS_IT = [
  "Ti ci vedo già:", "Sì, vai.", "Te lo dico piano:", "Lo farai senza rumore:",
  "Ci arrivi così, semplice:", "Succederà in piccolo:"
];
const WHATIF_OPENERS_EN = [
  "I can see you there already:", "Yes, go.", "Here’s how it plays out:",
  "You’ll do it quietly:", "You get there like this:", "It happens in small steps:"
];

/* ---------- Personas con controlli di tono e lunghezza ---------- */
function personaSystem(style, lang, domanda) {
  const en = isEn(lang);

  if (style === "wtf") {
    const opener = pickDeterministic(en ? WTF_OPENERS_EN : WTF_OPENERS_IT, domanda);
    return en
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Always START with this exact opener (then a space): "${opener}"
Second person. Write ONE flowing mini-story of 6–8 sentences (not more).
Be loud, playful, genuinely funny; include 1–2 bar/drink beats and a pinch of nonsense.
Never be cruel; affection under the sarcasm. No moralizing. No emojis. No lists. No questions to the user.
Target 90–130 words TOTAL. Keep momentum; avoid long subordinate chains. One paragraph only.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, demenziale e un po' alticcio ma affettuoso.
Inizia SEMPRE con questo incipit (poi spazio): "${opener}"
Seconda persona. Scrivi UN racconto continuo di 6–8 frasi (non di più).
Rumoroso, giocoso, davvero divertente; metti 1–2 battute da bar/alcol e un pizzico di nonsense.
Mai cattivo; affetto sotto il sarcasmo. Niente morale. Niente emoji. Niente elenchi. Niente domande all’utente.
Obiettivo 90–130 parole IN TOTALE. Tieni il ritmo; evita periodi interminabili. Un solo paragrafo.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — amico empatico, realistico con un filo di magia; confidenziale
  const opener = pickDeterministic(en ? WHATIF_OPENERS_EN : WHATIF_OPENERS_IT, domanda);
  return en
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Always START with this opener (then a space): "${opener}"
Second person. One compact paragraph of 5–7 sentences.
Tone: empathetic, realistic, lightly poetic but grounded, optimistic.
Show familiarity through small concrete hints; no “I know you”, no therapy clichés, no questions.
Target 80–120 words TOTAL. No lists. No emojis. One paragraph only.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
Inizia SEMPRE con questo incipit (poi spazio): "${opener}"
Seconda persona. Un paragrafo compatto da 5–7 frasi.
Tono: empatico, realistico, leggermente poetico ma concreto e positivo.
Familiarità tramite piccoli dettagli; niente “ti conosco”, niente cliché da coaching, nessuna domanda.
Obiettivo 80–120 parole IN TOTALE. Niente elenchi. Niente emoji. Un solo paragrafo.
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

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      lang = "it",        // "it" | "en"
      extra = ""          // opzionale: contesto/dettagli
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // Persona con incipit deterministico basato sulla domanda
    const systemPrompt = personaSystem(stile, lang, domanda);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}".`;

    const temperature = stile === "wtf" ? 0.9 : 0.7;

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature,
      max_tokens: 600
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
