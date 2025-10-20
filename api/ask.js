// ============================
// /api/ask.js — What?f Engine (Incazzato Illuminato + What If lucido)
// Stili: wtf | whatif  •  IT/EN
// Risposta: 1 paragrafo, tono bloccato, lunghezza controllata
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return String(s).toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map(x => x.trim())
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
  return (m && m[1]) ? m[1] : (slice + "…");
}

function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/* ---------- Personas (toni definitivi) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — Incazzato Illuminato (tragicomico, sbronza in agguato)
    return isEn(lang) ? `
You are "What the F" — the “Enlightened Furious” voice: sarcastic, tender, chaotic-but-kind.
SECOND PERSON. ONE single flowing paragraph. 5–7 sentences (~100–130 words).
Make the user the protagonist. Routine → funny collapse → self-ironic relief.
Keep it witty, colorful, a little unhinged; unexpected buzz can appear.
No lists. No questions. No emojis. No moralizing. Avoid slapstick injuries.
End on a sharp, funny line that also lands a tiny truth. Keep it punchy and human.
`.trim() : `
Sei “What the F” — versione «Incazzato Illuminato»: sarcastico, tenero, caotico-ma-buono.
SECONDA PERSONA. UN solo paragrafo scorrevole. 5–7 frasi (~100–130 parole).
Metti te al centro: routine → crollo comico → autoironia con sollievo.
Wit alto, immagini concrete, sbronza che arriva da sola. Niente elenchi, domande, emoji, prediche.
Evita slapstick forzato. Chiudi con una battuta affilata che dice una verità piccola.
Tono fisso: realismo comico da sopravvivenza emotiva.
`.trim();
  }

  // WHAT IF — lucido, empatico, con micro-ironìa tenera (stessa struttura fissa)
  return isEn(lang) ? `
You are "What If" — warm, lucid, grounded. SECOND PERSON.
ONE calm paragraph, 5–7 sentences (~90–120 words).
Be concrete and relatable: small routines, light sensory details, gentle self-ironies.
No lists. No questions. No emojis. No therapy clichés.
Keep hope practical; end with a quiet forward nudge that feels earned.
Tone: kind, witty in small doses, zero melodrama, everyday magic.
`.trim() : `
Sei “What If” — caldo, lucido, concreto. SECONDA PERSONA.
UN paragrafo calmo, 5–7 frasi (~90–120 parole).
Dettagli quotidiani, ironia lieve, zero zucchero: speranza pratica e vicina.
Niente elenchi, domande, emoji o cliché da coaching.
Chiudi con una spinta morbida e credibile, come un respiro che rimette a fuoco.
Tono: gentile, asciutto, con una micro-ironìa che sorride senza giudicare.
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
      stile = "whatif", // "wtf" | "whatif"
      lang = "it",      // "it" | "en"
      extra = ""        // opzionale: contesto (non cambia tono)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    // Generation
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.92 : 0.82,
      max_tokens: (stile === "wtf") ? 260 : 240,
      frequency_penalty: 0.4,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-processing: blocco lunghezza/ritmo in 1 paragrafo
    if (stile === "wtf") {
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 130);
    } else {
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 115);
    }
    answer = normalizeOneParagraph(answer);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
