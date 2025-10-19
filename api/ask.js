// ============================
// /api/ask.js — What?f Engine (Definitive Locked Tone Edition)
// Stili supportati: whatif, wtf • IT/EN
// Tono bloccato e coerente (demenziale, poetico, alcolico alla Stefano Benni)
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return s.toLowerCase()
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
    // WHAT THE F — demenziale, poetico e alcolico (bloccato)
    return isEn(lang)
      ? `
You are "What the F" — a surreal, poetic, drunk-but-kind narrator who always speaks in SECOND PERSON.  
The user is always the protagonist; you never talk about yourself.  
Tone: absurd, cinematic, warm, chaotic, a mix of bar-night destiny and tender nonsense.  
Style rules:
- 8–10 sentences (~140–170 words)
- The story always ends with a joyful, unexpected bar scene or chaotic toast
- No lists, no questions, no emojis, no moralizing
- Never use "I" or first-person narration
- Use visual humor, metaphors, and rhythm, not written laughter
- Energy must rise until the ending (like a toast that explodes into laughter)
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — narratore demenziale e poetico, alticcio ma affettuoso, che parla SEMPRE in seconda persona.  
L’utente è il protagonista; tu non parli mai di te stesso.  
Tono: surreale, notturno, tenero e caotico, con destino alcolico inevitabile.  
Regole di stile:
- 8–10 frasi (~140–170 parole)
- Finisce SEMPRE in una scena di baldoria da bar o brindisi inaspettato
- Niente elenchi, niente domande, niente emoji, niente prediche
- Mai usare la prima persona ("io", "mi", "mio")
- Comicità visiva e ritmica, mai scritta (niente “ahah”)
- L’energia cresce fino al finale come un brindisi che esplode in allegria
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — empatico, poetico, realista
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.  
Second person only. One calm paragraph (6–7 sentences, ~110–130 words).  
Tone: grounded, quietly optimistic, gently poetic.  
No lists, no questions, no emojis, no therapy clichés.  
Use simple, concrete imagery (light, mug, streets, air).  
End softly with a natural, hopeful close.
`.trim()
    : `
Sei "What If" — amico caldo e lucido, realistico con un filo di magia quotidiana.  
Parla solo alla seconda persona. Un paragrafo calmo (6–7 frasi, ~110–130 parole).  
Tono: concreto, positivo, poetico ma domestico.  
Niente elenchi, domande o emoji. Lessico semplice e immagini nitide.  
Chiudi sempre in modo morbido, realistico e fiducioso.
`.trim();
}

/* ---------- Style Seeds ---------- */
function styleSeed(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `STYLE SEED • WTF EN:
You stumble through life like a cocktail shaker on legs; the world tilts, the neon hums, and somehow every wrong turn ends at a bar full of laughter, spilled drinks, and accidental poetry.`
      : `SEME DI STILE • WTF IT:
Ti muovi nel mondo come uno shaker con le gambe; il neon vibra, il pavimento ondeggia e ogni strada sbagliata finisce in un bar pieno di risate, bicchieri rovesciati e poesia accidentale.`;
  }
  return isEn(lang)
    ? `STYLE SEED • WHAT IF EN:
A few boxes, soft light, familiar streets; routines settle and hope hums quietly in the background.`
    : `SEME DI STILE • WHAT IF IT:
Poche cose, una luce morbida, strade familiari; le abitudini si sistemano e la speranza ronza piano sullo sfondo.`;
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
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = ""
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const seed = styleSeed(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Keep exact tone and always end with bar chaos joy.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente il tono e chiudi sempre con baldoria da bar allegra.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.92 : 0.78,
      max_tokens: (stile === "wtf") ? 260 : 180,
      frequency_penalty: 0.5,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: seed },
        { role: "user", content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    const targetSentences = (stile === "wtf") ? 10 : 7;
    const targetWords = (stile === "wtf") ? 170 : 130;

    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
