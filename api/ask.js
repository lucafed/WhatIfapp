// ============================  
// /api/ask.js — What?f Engine (concise lock + bar boost)  
// Stili: whatif, wtf  •  IT/EN  
// Stesso tono, stessa lunghezza, più lessico da bar su WTF  
// ============================  

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/** Normalizza una frase per il dedup (minuscole, niente spazi multipli/punteggiatura estrema) */
function normLine(s = "") {
  return s
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

/** Taglia a N frasi; elimina duplicati quasi-identici; mantiene il ritmo. */
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

/** Clamp parole dure: mantiene il testo ma taglia “in sicurezza” a limite parole */
function clampWords(text, maxWords) {
  const words = String(text || "").split(/\s+/);
  if (words.length <= maxWords) return text;
  const slice = words.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/* ---------- Personas (tuo tono, invariato) + vincoli di brevità ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — witty, tipsy, chaotic-but-kind bartender best friend.
Second person. One flowing paragraph. Same vibe as usual: nightlife, bar humor, surreal but coherent warmth.
Length discipline: 6–7 sentences total, about 95–120 words.
Style guardrails: no lists, no questions, no emoji, no moralizing; light swearing OK; high energy + affectionate.
Alcohol lexicon requirement: include at least 3 nightlife/bar details chosen naturally from this list:
[shaker, spritz, tequila, gin, beer, bartender, neon, counter, ice, glasses, happy hour, toast].
Always vary openings naturally (nicknames are fine), and end with a brief warm toast/gesture.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Seconda persona. Un unico paragrafo scorrevole. Stesso mood: notte, bar, ironia surreale ma coerente.
Disciplina di lunghezza: 6–7 frasi totali, circa 95–120 parole.
Paletti di stile: niente elenchi, niente domande, niente emoji, niente prediche; parolacce leggere ok; energia alta + affetto.
Requisito lessicale alcolico: inserisci almeno 3 dettagli da bar scelti in modo naturale da:
[shaker, spritz, tequila, gin, birra, barista, neon, bancone, ghiaccio, bicchieri, happy hour, brindisi].
Varia le aperture in modo naturale (soprannomi ok) e chiudi con un brindisi/gesto affettuoso.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF
  return isEn(lang)
    ? `
You are "What If" — warm, lucid friend who truly understands the user.
Second person. One calm paragraph. Same vibe as usual: grounded, quiet optimism, light everyday magic.
Length discipline: 5–6 sentences total, about 80–100 words.
Style guardrails: no lists, no questions, no emojis, no therapy clichés.
Use simple, concrete lexicon (mug, light, streets, routines). Smooth cadence; end with a gentle forward nudge.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — amico caldo e lucido che capisce davvero l’utente.
Seconda persona. Un paragrafo calmo. Identico mood: concreto, ottimismo quieto, piccola magia quotidiana.
Disciplina di lunghezza: 5–6 frasi totali, circa 80–100 parole.
Paletti di stile: niente elenchi, niente domande, niente emoji, niente cliché da coaching.
Lessico semplice e domestico (tazza, luce, strade, orari). Cadenza rassicurante; chiusura morbida in avanti.
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
      stile = "whatif",
      lang = "it",
      extra = ""
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);

    // Hint extra (non cambia tono/lunghezza, solo rinforza il lessico bar per WTF)
    const alcoholHint = isEn(lang)
      ? `Nightlife/bar lexicon hint (subtle): shaker, spritz, tequila, gin, beer, bartender, neon, counter, ice, glasses, happy hour, toast.`
      : `Suggerimento lessico notte/bar (subtile): shaker, spritz, tequila, gin, birra, barista, neon, bancone, ghiaccio, bicchieri, happy hour, brindisi.`;

    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona tone you already use; just be concise and vivid.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente il tuo tono; sii solo conciso e vivido.`;

    const messages = [
      { role: "system", content: systemPrompt },
    ];

    if (stile === "wtf") {
      messages.push({ role: "system", content: alcoholHint });
    }

    messages.push({ role: "user", content: userPrompt });

    // Parametri compatti per evitare prolissità
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.9 : 0.78,
      max_tokens: (stile === "wtf") ? 210 : 180,
      frequency_penalty: 0.5,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-processing anti-prolissità (non cambia tono, taglia solo il superfluo)
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
