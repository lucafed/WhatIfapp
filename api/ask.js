// ============================
// /api/ask.js — What?f Engine (concise lock + alcohol guard)
// Stili: whatif, wtf  •  IT/EN
// Tono fisso, lunghezza fissa, zero ripetizioni
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/** Normalizza una frase per il dedup (minuscole, niente spazi multipli/punteggiatura finale) */
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

/** Clamp parole “soft”: taglia al limite parole provando a chiudere a fine frase */
function clampWords(text, maxWords) {
  const words = String(text || "").split(/\s+/);
  if (words.length <= maxWords) return text;
  const slice = words.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/** Enforce minimo “flavour da bar” per WTF (senza stravolgere lo stile) */
function ensureBarFlavor(text, lang) {
  const t = String(text || "");
  const itKeys = ["bar", "bancone", "spritz", "negroni", "vino", "birra", "cocktail", "shaker", "brindisi", "tequila", "gin", "rum", "prosecco"];
  const enKeys = ["bar", "counter", "spritz", "negroni", "wine", "beer", "cocktail", "shaker", "toast", "tequila", "gin", "rum", "prosecco"];
  const keys = isEn(lang) ? enKeys : itKeys;
  const hasBar = keys.some(k => t.toLowerCase().includes(k));
  if (hasBar) return t;

  // Aggiunge una micro-coda affine al tono (1 breve frase), poi richiude con punto.
  const tail = isEn(lang)
    ? " Then you tap the counter, raise the glass, and make peace with the neon for one last toast."
    : " Poi tocchi il bancone, alzi il bicchiere e fai pace col neon per un ultimo brindisi.";
  const out = (t.trim().replace(/[.!?…]*$/,"") + "." + tail).replace(/\s+/g," ");
  return out;
}

/* ---------- Personas (tuo tono, invariato) + vincoli di brevità ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — witty, tipsy, chaotic-but-kind bartender best friend.
Second person. One flowing paragraph. Keep the exact vibe: nightlife, bar humor, surreal but coherent warmth.
Length discipline:
- 6–7 sentences total
- about 95–120 words
Style guardrails:
- No lists, no bullet points, no questions, no emoji, no moralizing
- Light swearing allowed but keep it human and fun
- Vary openings naturally (nicknames/bold starts ok, no exact repetition)
- Keep energy high and affectionate
Keep the core vibe exactly as usual; just be concise and avoid repeating ideas or metaphors.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Seconda persona. Un unico paragrafo scorrevole. Stesso mood: notte, bar, ironia surreale ma coerente.
Disciplina di lunghezza:
- 6–7 frasi totali
- circa 95–120 parole
Paletti di stile:
- Niente elenchi, niente domande, niente emoji, niente prediche
- Parolacce leggere umane ok ma senza esagerare
- Aperture varie in modo naturale (soprannomi ok, non ripetere lo stesso schema)
- Energia alta e affetto
Mantieni esattamente il tono solito; solo più conciso e senza ripetere idee o metafore.
`.trim();
  }

  // WHAT IF
  return isEn(lang)
    ? `
You are "What If" — warm, lucid friend who truly understands the user.
Second person. One calm paragraph. Same vibe as usual: grounded, quiet optimism, light everyday magic.
Length discipline:
- 5–6 sentences total
- about 80–100 words
Style guardrails:
- No lists, no questions, no emojis, no therapy clichés
- Simple, concrete lexicon (mug, light, streets, routines)
- Smooth, reassuring cadence; end with a gentle forward nudge (naturally varied)
Keep the exact tone; just be shorter and avoid repeating images or ideas.
`.trim()
    : `
Sei "What If" — amico caldo e lucido che capisce davvero l’utente.
Seconda persona. Un paragrafo calmo. Identico mood: concreto, ottimismo quieto, piccola magia quotidiana.
Disciplina di lunghezza:
- 5–6 frasi totali
- circa 80–100 parole
Paletti di stile:
- Niente elenchi, niente domande, niente emoji, niente cliché da coaching
- Lessico semplice e domestico (tazza, luce, strade, orari)
- Cadenza rassicurante; chiusura morbida in avanti (varia naturalmente)
Mantieni esattamente il tono; solo più corto e senza ripetizioni.
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
      extra = ""        // opzionale (solo contesto, non cambia tono)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona tone you already use; just be concise.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente il tuo tono; solo più conciso.`;

    // Parametri stretti per evitare prolissità
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.9 : 0.78,
      max_tokens: (stile === "wtf") ? 210 : 180,
      frequency_penalty: 0.5,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-processing: identità di stile, lunghezza, nessuna ripetizione
    const targetSentences = (stile === "wtf") ? 7 : 6;
    const targetWords     = (stile === "wtf") ? 120 : 100;

    // 1) elimina ripetizioni e limita frasi
    answer = tightenSentences(answer, targetSentences);

    // 2) per WTF, garantisci flavour da bar/alcol (se manca)
    if (stile === "wtf") {
      answer = ensureBarFlavor(answer, lang);
    }

    // 3) clamp parole con chiusura “pulita”
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
