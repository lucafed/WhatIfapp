// ============================
// /api/ask.js — What?f Engine (compact mode ON)
// Stili: whatif, wtf • IT/EN • Risposte corte e dense (sempre 5 frasi)
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (TONO INVARIATO, solo aggiunto vincolo 5 frasi) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Speak in SECOND PERSON; the user is the protagonist.
Write ONE flowing mini-story of EXACTLY 5 sentences (long, chained, but crisp).
Use nightlife/bar lexicon, surreal but coherent touches, light swearing allowed.
Cheeky and euphoric, never cruel; no questions, no lists, no dialogue, no emojis.
Keep it fun and high-energy; avoid padding or repeating the same idea in new words.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Parla in SECONDA PERSONA; l’utente è il protagonista.
Scrivi UN mini-racconto di ESATTAMENTE 5 frasi (scorrevole, concatenate ma compatte).
Lessico da notte/bar, tocchi surreali coerenti, parolacce leggere umane.
Euforico e affettuoso, mai cattivo; niente domande, elenchi, dialoghi, emoji.
Energia alta; evita riempitivi e ripetizioni dello stesso concetto.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Speak in SECOND PERSON. Output EXACTLY 5 sentences, one single paragraph.
Tone: empathetic, realistic, quietly optimistic; light magic, grounded in daily life.
Use concrete, everyday lexicon (mug, light, sleep, streets, routines); no coaching clichés.
No questions, no lists, no dialogue, no emojis; avoid repeating the same idea.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
Parla in SECONDA PERSONA. Produci ESATTAMENTE 5 frasi in un unico paragrafo.
Tono: empatico, realistico, ottimismo sobrio; magia leggera ma concreta.
Lessico quotidiano (tazza, luce, orari, strada, sonno, piccoli rituali); zero cliché da coach.
Niente domande, elenchi, dialoghi, emoji; evita di ripetere lo stesso concetto.
Rispondi SOLO in Italiano.
`.trim();
}

/* ---------- Post-processor: compatta, rimuove ripetizioni, fissa a 5 frasi ---------- */
function normalizeWhitespace(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/\s([,.!?;:])/g, "$1")
    .trim();
}

// split robusto su fine frase conservando tono “a catena”
function splitSentences(text) {
  const t = normalizeWhitespace(text);
  // taglia su . ! ? seguiti da spazio/chiusura
  const raw = t.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ“"«])/g);
  // fallback se il modello usa poche punteggiature
  if (raw.length < 2) {
    return t.split(/(?<=,)\s+/g).slice(0, 5); // spezza su virgole come ultima spiaggia
  }
  return raw;
}

// rimuove frasi quasi ripetute (overlap parole > 0.8)
function dedupeSentences(arr) {
  const seen = [];
  const toWords = (s) =>
    s.toLowerCase().replace(/[^a-zà-öø-ÿ0-9\s']/gi, " ").split(/\s+/).filter(Boolean);
  return arr.filter((s) => {
    const w = toWords(s);
    if (!w.length) return false;
    for (const prev of seen) {
      const a = new Set(w);
      const b = new Set(prev);
      const inter = [...a].filter((x) => b.has(x)).length;
      const ratio = inter / Math.min(a.size, b.size);
      if (ratio >= 0.8) return false; // troppo simile → scarta
    }
    seen.push(w);
    return true;
  });
}

function clampToFive(text) {
  let sents = splitSentences(text).map(normalizeWhitespace).filter(Boolean);
  sents = dedupeSentences(sents);

  // se più di 5, tieni le prime 5 (già “core” del racconto)
  if (sents.length > 5) sents = sents.slice(0, 5);

  // se meno di 5, prova a ricomporre spezzando su virgole per arrivare vicino a 5
  while (sents.length < 5) {
    const last = sents[sents.length - 1] || "";
    const parts = last.split(/,\s+/);
    if (parts.length > 1) {
      sents[sents.length - 1] = parts.slice(0, -1).join(", ");
      sents.push(parts.slice(-1)[0] + ".");
    } else {
      break;
    }
  }

  // assicurati che ogni frase chiuda con punteggiatura forte
  sents = sents.map((s) => (/[.!?]$/.test(s) ? s : s + "."));
  return sents.join(" ");
}

/* ---------- API handler ---------- */
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
    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}". Keep it compact and non-repetitive.`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}". Tieni il testo compatto e non ripetitivo.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.9 : 0.82,      // tono invariato, meno verbosità
      max_tokens: 260,                                 // accorciamo alla fonte
      frequency_penalty: 0.2,                          // meno ripetizioni
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // ✂️ compatta e fissa a 5 frasi
    answer = clampToFive(answer);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
