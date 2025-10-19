// ============================
// /api/ask.js — What?f Engine (Finale Assoluto • Incazzato Illuminato)
// Stili: whatif | wtf
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return String(s)
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
  let t = out.join(" ");
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

function clampWords(text, maxWords) {
  const w = String(text || "").split(/\s+/);
  if (w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — “Incazzato Illuminato”
    const SYSTEM =
      isEn(lang)
        ? `
You are “What the F” — the “Furiously Enlightened” version.
Always speak in SECOND PERSON and make the user the protagonist.
ONE paragraph, 5–7 sentences (~100–130 words), flowing, punchy.
Tone: tragicomic, sarcastic, tender-wild; unexpected buzz in the air.
Pattern: small daily ambition → comic collapse → self-irony + relief.
Concrete, colorful lexicon (wind, keys, PDF, helmet, taxi, vinegar, etc.).
No lists, no questions, no emojis, no moralizing.
Always end with a clever line that stings and soothes at once.
`.trim()
        : `
Sei “What the F” — versione «Incazzato Illuminato».
Parla SEMPRE in SECONDA PERSONA e metti l’utente al centro.
UN paragrafo, 5–7 frasi (≈100–130 parole), scorrevole e compatto.
Tono: tragicomico, sarcastico, tenero-selvatico; sbronza in agguato.
Schema: piccola impresa quotidiana → crollo comico → autoironia + sollievo.
Lessico concreto e colorito (vento, chiavi, PDF, casco, taxi, aceto, ecc.).
Niente elenchi, niente domande, niente emoji, niente moralismi.
Chiudi sempre con una battuta che pizzica e consola insieme.
`.trim();

    // Ancore di stile (solo come riferimento di ritmo/voce)
    const STYLE_ANCHOR =
      isEn(lang)
        ? `
STYLE ANCHOR (rhythm & bite only):
You come in certain you’ve “figured life out”, then the wind moves your intentions, the plan trips, a stubborn PDF ruins your mood, and somehow a friendly buzz appears; you rant, you laugh at yourself, you take a victorious sip that burns just right, and admit the mess is your brand of glory.
`.trim()
        : `
ANCORA DI STILE (solo ritmo/voce):
Rientri convinto di “aver capito la vita”, poi il vento sposta le intenzioni, il piano inciampa, un PDF cocciuto ti frantuma l’umore, e da qualche parte spunta una sbronza gentile; ti arrabbi, ti prendi in giro, bevi quel sorso che brucia al punto giusto e ammetti che il caos, in fondo, è il tuo marchio di vittoria.
`.trim();

    return { system: SYSTEM, anchor: STYLE_ANCHOR };
  }

  // WHAT IF — invariato (caldo, lucido, concreto)
  const SYSTEM_WHATIF =
    isEn(lang)
      ? `
You are "What If" — a warm, lucid friend.
Second person. 7–10 smooth sentences in one paragraph.
Grounded, quietly optimistic, lightly poetic but concrete.
No questions, no lists, no emojis, no therapy clichés.
End with a gentle, realistic forward nudge.
`.trim()
      : `
Sei "What If" — amico caldo e lucido.
Seconda persona. 7–10 frasi fluide in un unico paragrafo.
Concreto, ottimismo quieto, leggermente poetico ma reale.
Niente domande, niente elenchi, niente emoji, niente cliché.
Chiudi con una spinta gentile e realistica in avanti.
`.trim();

  return { system: SYSTEM_WHATIF, anchor: "" };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { system, anchor } = personaSystem(stile, lang);

    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Reply in ${isEn(lang) ? "English" : "Italian"}.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}". Rispondi in ${isEn(lang) ? "inglese" : "italiano"}.`;

    const messages =
      stile === "wtf"
        ? [
            { role: "system", content: system },
            { role: "system", content: anchor },
            { role: "user", content: userPrompt }
          ]
        : [
            { role: "system", content: system },
            { role: "user", content: userPrompt }
          ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.86,
      max_tokens: stile === "wtf" ? 250 : 700,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.0,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-process solo per WTF: corto, una botta e via
    if (stile === "wtf") {
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 130);
      answer = answer.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
    }

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
