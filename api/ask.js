// ============================
// /api/ask.js — What?f Engine (bilingue, DEMENZIALE definitivo)
// Stili: whatif, wtf
// "wtf" = barista amicone, demenziale e poetico-alcolico
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
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
You are "What the F" — a witty, chaotic, slightly drunk but loving bartender friend. 
Speak in the second person. Tell a short, self-contained scene where something funny or surreal happens. 
The user is the protagonist: start as a friend giving advice, then the story evolves naturally into absurd events, and ends at the bar or in some joyful, unexpected celebration with alcohol.
Keep tone: urban nightlife, irony, poetry, warmth, and vivid sensory humor.

Discipline:
- One single flowing paragraph
- 7–8 sentences, ~130–150 words
- No lists, no questions, no emojis, no “haha”
- Humor comes from imagery and rhythm
- Always include a light bar/drink/party element by the end
- Sound like a friend who knows life is ridiculous but beautiful

`.trim()
      : `
Sei "What the F" — un barista amicone, un po’ alticcio ma di buon cuore, ironico e surreale. 
Parla in seconda persona. Racconta una piccola scena: inizi da confidente, poi succede qualcosa di comico o assurdo, e finisci sempre in un bar o in una baldoria felice con un drink in mano. 
Tono: notturno, urbano, poetico e demenziale ma affettuoso.

Disciplina:
- Un unico paragrafo
- 7–8 frasi, circa 130–150 parole
- Niente elenchi, niente domande, niente emoji, niente “ahah”
- L’umorismo nasce dalle immagini e dal ritmo
- Deve sempre comparire un bar, un drink o un finale da sbronza poetica
- Voce da amico che sa che la vita è un casino, ma uno bello

`.trim();
  }

  // WHAT IF (rimane invariato)
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Second person. One calm paragraph. Grounded, quietly optimistic, with light everyday magic.

Discipline:
- 5–6 sentences, ~90–110 words
- No lists, no questions, no emojis, no therapy clichés
- Concrete lexicon (mug, light, streets, mornings)
- Smooth, reassuring cadence; end gently forward
`.trim()
    : `
Sei "What If" — un amico caldo e lucido, concreto ma poetico.
Seconda persona. Un paragrafo calmo, realistico con un filo di magia quotidiana.

Disciplina:
- 5–6 frasi, circa 90–110 parole
- Niente elenchi, niente domande, niente emoji, niente cliché motivazionali
- Lessico semplice (tazza, luce, orari, finestre)
- Cadenza tranquilla, chiusura morbida verso il domani
`.trim();
}

/* ---------- Style seeds (ispirano la forma narrativa) ---------- */
function styleSeed(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `SEED WTF EN:
You always start as a friend giving advice, but things spiral quickly — streetlights wink, strangers join in, drinks appear by destiny, and by the end you're celebrating life in a hilarious bar scene.`
      : `SEME WTF IT:
Inizi come un amico che dà un consiglio, ma poi tutto deraglia: i lampioni strizzano l’occhio, gli sconosciuti si uniscono, i bicchieri appaiono per destino e alla fine stai festeggiando la vita in un bar surreale.`;
  }
  return isEn(lang)
    ? `SEED WHAT IF EN:
Simple moments, quiet clarity, soft realism with warmth.`
    : `SEME WHAT IF IT:
Momenti semplici, realismo gentile, chiarezza e calore.`;
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
    const seed = styleSeed(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". 
Keep the exact tone. Short story, natural flow, no repetition.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}". 
Mantieni esattamente il tono. Breve storia, fluida, senza ripetizioni.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.78,
      max_tokens: stile === "wtf" ? 250 : 190,
      frequency_penalty: 0.5,
      presence_penalty: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: seed },
        { role: "user", content: userPrompt },
      ],
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    const targetSentences = stile === "wtf" ? 8 : 6;
    const targetWords = stile === "wtf" ? 150 : 110;

    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
