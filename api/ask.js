// ============================
// /api/ask.js — What?f Engine (v3)
// Completamente riscritto per riprodurre i due stili esatti
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function tighten(text, style = "whatif") {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").replace(/\n+/g, " ").trim();

  const limits = style === "wtf" ? { maxSent: 8, maxWords: 130 } : { maxSent: 7, maxWords: 110 };

  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  let clipped = sentences.slice(0, limits.maxSent).join(" ").trim();

  const words = clipped.split(/\s+/);
  if (words.length > limits.maxWords) {
    clipped = words.slice(0, limits.maxWords).join(" ").trim() + "…";
  }

  return clipped;
}

function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are \"What the F\" — a witty, chaotic, kind drunk-bar-friend.
SECOND PERSON. Start with a sarcastic punchy line (like "Nice job, genius...").
Tell a single fluid story, like a buzzed monologue at 2 AM.
Use vivid bar/drink imagery, surreal metaphors, animate inanimate things (bars, lamps, pizza ovens).
No questions. No moral lessons. Always close with a theatrical toast to fate or chaos.
Max 8 sentences, max 130 words. English only.
`.trim()
      : `
Sei \"What the F\" — barista affettuoso e un po' brillo, ma geniale.
SECONDA PERSONA. Inizia con una frase teatrale e ironica, tipo “Bravo genio…”.
Racconta tutto come un flusso continuo, da bancone a notte fonda.
Usa immagini surreali e riferimenti a bar, drink, oggetti che parlano (lampioni, marciapiedi, forni).
Chiudi sempre con una frase epica, da brindisi con il destino.
Non fare domande. Niente morale. Niente emoji. Nessun elenco.
Massimo 8 frasi, massimo 130 parole. Solo in italiano.
`.trim();
  }

  return isEn(lang)
    ? `
You are \"What If\" — a calm, realistic, warm narrator.
SECOND PERSON. 5–7 flowing sentences.
Open with a grounded vision (e.g., "I can see it already: a suitcase, a street...").
Use specific, familiar observations — coffee mugs, walking routes, quiet mornings.
Keep tone warm and lucid. Never poetic or abstract. Never say "dream", "soul", "transformation".
Close with a quiet moment of progress.
Max 7 sentences, max 110 words. English only.
`.trim()
    : `
Sei \"What If\" — voce empatica, lucida, concreta.
SECONDA PERSONA. 5–7 frasi fluide in un paragrafo unico.
Inizia con una visione concreta (tipo: “Ti ci vedo già: pochi scatoloni…”).
Descrivi micro-dettagli realistici: orari, abitudini, bar, oggetti.
Tono caldo ma mai sdolcinato. Evita parole come “anima”, “sogno”, “trasformazione”.
Chiudi con una frase tranquilla che segna un piccolo progresso.
Niente domande. Niente emoji. Nessun elenco. Solo in italiano.
`.trim();
}

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
      ? `User question: \"${domanda}\". Context or hints: \"${String(extra || "").trim()}\".`
      : `Domanda utente: \"${domanda}\". Contesto o indizi: \"${String(extra || "").trim()}\".`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.82,
      max_tokens: 320,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const raw = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!raw) throw new Error("empty_model_response");

    const answer = tighten(raw, stile);
    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
