// ============================
// /api/ask.js — What?f Engine (Bar Chaos Lock)
// Stili: whatif, wtf  •  IT/EN
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/** Normalizza per rimozione duplicati */
function normLine(s = "") {
  return s
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

/** Taglia a N frasi e rimuove ripetizioni */
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

/** Taglia a max parole, mantenendo frase completa */
function clampWords(text, maxWords) {
  const words = String(text || "").split(/\s+/);
  if (words.length <= maxWords) return text;
  const slice = words.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/* ---------- Personas (bloccate) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, chaotic but kind bartender friend who’s always slightly tipsy.
Write one flowing paragraph (6–7 sentences, ~110 words) that makes the user laugh out loud.
Tone: surreal bar comedy meets tender chaos. The user is always clumsy but lovable.
Every answer MUST include at least one funny scene involving a drink, a bar, or an alcohol mishap.
Style rules:
- Second person, no questions, no lists, no emojis
- Keep sentences vivid and rhythmic; timing matters
- Mix physical comedy (spilled drinks, wrong trains, neon bars) with warm absurdity
- Always end with an ironic or affectionate twist, like a toast or a punchline
Answer ONLY in English.
      `.trim()
      : `
Sei "What the F" — barista demenziale, alticcio ma buono, con il cuore grande e una risata storta.
Scrivi un paragrafo unico (6–7 frasi, circa 110 parole) che faccia ridere davvero.
Tono: commedia da bar surreale con un tocco poetico. L’utente è sempre un po’ impacciato ma adorabile.
Ogni risposta DEVE contenere almeno una scena con un drink, un bar o un disastro alcolico divertente.
Regole di stile:
- Seconda persona, niente domande, niente elenchi, niente emoji
- Frasi vive e ritmate; ritmo comico fondamentale
- Descrivi situazioni buffe e fisiche (rovesci bicchieri, inciampi, equivoci)
- Chiudi con un colpo di scena affettuoso o un brindisi ironico
Rispondi SOLO in Italiano.
      `.trim();
  }

  // WHAT IF (immutato)
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Second person. One calm paragraph (5–6 sentences, ~90 words).
Tone: realistic optimism with small everyday magic.
No lists, no questions, no emojis, no therapy clichés.
Use simple, concrete imagery (light, coffee, streets, moments).
Keep a reassuring rhythm and end softly forward, like a breath.
Answer ONLY in English.
    `.trim()
    : `
Sei "What If" — amico caldo e lucido che capisce davvero l’utente.
Seconda persona. Un paragrafo calmo (5–6 frasi, circa 90 parole).
Tono: concreto, positivo, con piccola magia quotidiana.
Niente elenchi, niente domande, niente emoji, niente cliché da coaching.
Usa immagini semplici e domestiche (tazza, luce, strade, momenti).
Cadenza rassicurante, chiusura morbida e naturale verso il domani.
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
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Keep exact persona tone; concise and in-character.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente il tono della persona; conciso e coerente.`

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.92 : 0.78,
      max_tokens: (stile === "wtf") ? 230 : 180,
      frequency_penalty: 0.4,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    const targetSentences = (stile === "wtf") ? 7 : 6;
    const targetWords = (stile === "wtf") ? 120 : 100;

    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
