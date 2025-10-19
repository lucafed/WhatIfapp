// ============================
// /api/ask.js — What?f Engine (bilingue, tone+length lock — versione “lunga”)
// Stili: whatif, wtf  •  IT/EN
// Lunghezza come gli esempi, tono bloccato, niente ripetizioni inutili
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/** Normalizza una frase per dedup */
function normLine(s = "") {
  return s
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

/** Deduplica e limita il numero massimo di frasi senza comprimere troppo */
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
    if (seen.has(n)) continue; // salta quasi-duplicati

    // scarta filler brevissimi inutili
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue;

    out.push(p);
    seen.add(n);
    if (out.length >= maxSentences) break; // fermati solo al tetto alto
  }

  let txt = out.join(" ");
  if (!/[.!?…]$/.test(txt)) txt += ".";
  return txt;
}

/** Clamp parole “soft”: taglia solo se davvero oltre il massimo, chiude pulito a fine frase */
function clampWords(text, minWords, maxWords) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text; // se dentro i limiti, non toccare
  const slice = words.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/* ---------- Personas (toni definitivi, bloccati) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista demenziale-affettuoso, alticcio, urbano-notturno con “destino alcolico”
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Second person. ONE flowing paragraph. Exact vibe: nightlife, bar humor, neon, playful alcohol imagery, surreal-but-coherent tenderness.
Discipline:
- 8–9 sentences total
- ~135–175 words
Style guardrails:
- No lists, no questions, no emojis, no moralizing
- No “haha”/written laughter; humor comes from voice and images
- Vary openings naturally (nicknames/bold starts OK) without formula
- Keep energy high, affectionate, a little unhinged but warm
Alcohol destiny rule:
- Every answer MUST include at least one funny bar/drink scene AND a small mishap (spill, wrong toast, mixed-up order), because life always drifts you back to a drink.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Seconda persona. UN solo paragrafo scorrevole. Mood fisso: notte, bar, neon, immagini alcoliche giocose, surreale coerente, cuore caldo.
Disciplina:
- 8–9 frasi totali
- ~135–175 parole
Paletti:
- Niente elenchi, niente domande, niente emoji, niente prediche
- Niente “ahah”/risate scritte; la comicità nasce da voce e immagini
- Aperture varie (soprannomi/attacchi forti OK) senza schemi ripetuti
- Energia alta e affetto
Regola del destino alcolico:
- Ogni risposta DEVE includere almeno una scena da bar/bicchiere e un piccolo casino (rovesci, brindisi sbagliato, ordine confuso), perché la vita ti riporta sempre lì.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — empatico-realista con magia sobria (lunghezza come gli esempi)
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Second person. ONE calm paragraph. Grounded, quietly optimistic, with light everyday magic.
Discipline:
- 6–7 sentences total
- ~105–130 words
Style guardrails:
- No lists, no questions, no emojis, no therapy clichés
- Simple, concrete lexicon (mug, light, streets, routines)
- Smooth, reassuring cadence; end with a gentle, natural forward nudge
Always keep this voice. Avoid repeated images or ideas.
`.trim()
    : `
Sei "What If" — amico caldo e lucido, realistico con un filo di magia quotidiana.
Seconda persona. UN paragrafo calmo. Ottimismo sobrio, concreto, domestico.
Disciplina:
- 6–7 frasi totali
- ~105–130 parole
Paletti:
- Niente elenchi, niente domande, niente emoji, niente cliché da coaching
- Lessico semplice e quotidiano (tazza, luce, strade, orari, sonno)
- Cadenza rassicurante; chiusura morbida e naturale verso avanti
Mantieni SEMPRE questa voce. Evita ripetizioni di immagini o idee.
`.trim();
}

/* ---------- Micro style seeds (ancore sintetiche ma forti) ---------- */
function styleSeed(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `STYLE SEED • WTF EN:
You roll in like a cocktail shaker with legs; the GPS mutters, neon winks, the bartender adopts you by the second round, and fate keeps steering you back to a glass—where a tiny spill becomes a friendly toast.`
      : `SEME DI STILE • WTF IT:
Entri come uno shaker con le gambe; il navigatore brontola, il neon ti fa l’occhiolino, il barista ti adotta al secondo giro, e il destino ti riporta sempre a un bicchiere—dove un piccolo rovescio diventa un brindisi amico.`;
  }
  return isEn(lang)
    ? `STYLE SEED • WHAT IF EN:
A few boxes, bright cafés, simple streets; routines settle, the house finds a good quiet, and tomorrow you notice the neighborhood feels like home.`
    : `SEME DI STILE • WHAT IF IT:
Poche cose, bar luminosi, strade semplici; gli orari si mettono in riga, la casa ha un silenzio buono, e domani ti accorgi che il quartiere sa di casa.`;
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
      stile = "whatif",   // "whatif" | "wtf"
      lang = "it",        // "it" | "en"
      extra = ""          // opzionale: contesto (NON cambia tono)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const seed = styleSeed(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}".
Keep the exact persona voice. Do not shorten the natural flow. Avoid repeated ideas.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".
Mantieni esattamente la voce della persona. Non accorciare il flusso naturale. Evita idee ripetute.`;

    // Generazione — più spazio per non troncare
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.88 : 0.76,
      max_tokens: (stile === "wtf") ? 360 : 300,
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

    // Vincoli di lunghezza “da esempio”
    const MAX_SENTENCES = (stile === "wtf") ? 9 : 7;
    const MIN_WORDS     = (stile === "wtf") ? 135 : 105;
    const MAX_WORDS     = (stile === "wtf") ? 175 : 130;

    // 1) dedup + tetto frasi alto (non comprime se sotto)
    answer = tightenSentences(answer, MAX_SENTENCES);

    // 2) clamp “soft” solo se supera il massimo parole
    const wc = answer.split(/\s+/).filter(Boolean).length;
    if (wc > MAX_WORDS) {
      answer = clampWords(answer, MIN_WORDS, MAX_WORDS);
    }

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
