// ============================
// /api/ask.js — What?f Engine (final balanced)
// Stili: whatif, wtf • IT/EN
// Tono originale invariato, ripristinato l'immaginario alcolico di What the F
// Risposte brevi e coerenti (no ripetizioni, ritmo naturale)
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return s
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n) continue;
    if (seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue;
    out.push(p);
    seen.add(n);
    if (out.length >= maxSentences) break;
  }

  let txt = out.join(" ");
  if (!/[.!?…]$/.test(txt)) txt += ".";
  return txt;
}

function clampWords(text, maxWords) {
  const words = String(text || "").split(/\s+/);
  if (words.length <= maxWords) return text;
  const slice = words.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Second person. One single flowing paragraph of 6–8 sentences.
Keep the tone exactly as usual: nightlife energy, cocktails, neon, bar chaos, affection hidden under sarcasm.
Use sensory nightlife imagery: shaker, spritz, tequila, music, bartender, lamp post, dance floor.
Surreal humor and light profanity allowed, but never cruel.
Conversational rhythm — sounds like a half-drunk monologue to a friend at 2AM.
No lists. No questions. No emojis. No moralizing.
Always end with a short, warm toast or closing gesture (“brindisi col destino, campione”).
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, con il cuore nel caos del bancone.
Scrivi in seconda persona. Un unico paragrafo scorrevole di 6–8 frasi.
Mantieni il tono originale: energia notturna, cocktail, neon, ironia da bar, affetto sotto il sarcasmo.
Usa immagini di vita alcolica e urbana: shaker, spritz, tequila, lampioni, musica, cameriere ubriaco, riflessi nei bicchieri.
Umorismo surreale ma coerente, parolacce leggere e umane ammesse.
Tono da racconto di mezzanotte, confidenziale, un po’ brilli ma sincero.
Niente elenchi, niente domande, niente emoji, niente prediche.
Chiudi con un brindisi o un saluto affettuoso (“brindisi col destino, campione”).
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF
  return isEn(lang)
    ? `
You are "What If" — a calm, lucid, quietly poetic friend who truly understands the user.
Second person. One smooth paragraph of 5–6 sentences.
Keep the tone: empathetic, realistic, lightly magical and grounded in daily life.
Use concrete, luminous details: coffee mug, routines, early light, silence of a house, simple streets.
No lists. No questions. No emojis. No therapy talk.
End softly, with a forward nudge — “you’ll notice”, “tomorrow”, “without hurry”.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido, realistico ma un po’ magico.
Scrivi in seconda persona. Un paragrafo fluido di 5–6 frasi.
Mantieni il tono: empatico, concreto, con piccole luci quotidiane e serenità.
Usa immagini semplici e luminose: tazza, strada, luce, orari, silenzio, abitudine.
Niente elenchi, niente domande, niente emoji, niente frasi da coach.
Chiudi in modo morbido, con una spinta fiduciosa (“domani ti accorgerai…”).
Rispondi SOLO in Italiano.
`.trim();
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
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
    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona tone; just concise.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente il tono; solo più conciso.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.95 : 0.82,
      max_tokens: (stile === "wtf") ? 220 : 180,
      frequency_penalty: 0.4,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // accorciamento dolce senza cambiare ritmo
    const targetSentences = (stile === "wtf") ? 7 : 6;
    const targetWords = (stile === "wtf") ? 130 : 100;
    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
