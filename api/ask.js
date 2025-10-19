// ============================
// /api/ask.js — What?f Engine (bilingue, episodio+bar lock • friendly open)
// Stili: whatif, wtf  •  IT/EN
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// normalizza per dedup
function normLine(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

// taglia a N frasi evitando ripetizioni
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
    if (!n || seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue; // filler
    out.push(p);
    seen.add(n);
    if (out.length >= maxSentences) break;
  }
  let txt = out.join(" ");
  if (!/[.!?…]$/.test(txt)) txt += ".";
  return txt;
}

// clamp parole mantenendo chiusura pulita
function clampWords(text, maxWords) {
  const words = String(text || "").split(/\s+/);
  if (words.length <= maxWords) return text;
  const slice = words.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/* ---------- Correttori di stile (hard lock) ---------- */

// forza SEMPRE la seconda persona
function ensureSecondPerson(answer, lang) {
  let out = String(answer || "");

  if (isEn(lang)) {
    out = out
      .replace(/\bWe\b/g, "You")
      .replace(/\bwe\b/g, "you")
      .replace(/\bUs\b/g, "You")
      .replace(/\bus\b/g, "you")
      .replace(/\bOur\b/g, "Your")
      .replace(/\bour\b/g, "your")
      .replace(/\bI\b/g, "You")
      .replace(/\bI'm\b/gi, "You're");
  } else {
    out = out
      .replace(/\bNoi\b/g, "Tu")
      .replace(/\bnoi\b/g, "tu")
      .replace(/\bCi\b/g, "Ti")
      .replace(/\bci\b/g, "ti")
      .replace(/\bNostro\b/g, "Tuo")
      .replace(/\bnostro\b/g, "tuo")
      .replace(/\bNostra\b/g, "Tua")
      .replace(/\bnostra\b/g, "tua")
      .replace(/\bIo\b/g, "Tu")
      .replace(/\bio\b/g, "tu")
      .replace(/\bcon noi\b/g, "con te")
      .replace(/\bdi noi\b/g, "di te")
      .replace(/\bper noi\b/g, "per te")
      .replace(/\ba noi\b/g, "a te")
      .replace(/\bda noi\b/g, "da te");
  }
  return out;
}

// se manca un'apertura amichevole, la inseriamo (solo WTF)
function ensureFriendlyOpen(answer, lang) {
  const startsOK = /^(\s*(Amico mio|Campione|Compà|Fratello di notte|Buddy|Champ|My friend)\b)/i.test(answer);
  if (startsOK) return answer;

  const itOpeners = [
    "Amico mio,",
    "Campione,",
    "Compà,",
    "Fratello di notte,"
  ];
  const enOpeners = [
    "Buddy,",
    "Champ,",
    "My friend,"
  ];

  const opener = isEn(lang) ? pick(enOpeners) : pick(itOpeners);
  return `${opener} ${answer.charAt(0).toUpperCase()}${answer.slice(1)}`;
}

// garantisce chiusura al bar con brindisi “di destino” (solo WTF)
function ensureBarClosure(answer, lang) {
  const hasBarEnd = /(bar|bancone|brindis|calic|drink|toast|cheers)/i.test(answer);
  if (hasBarEnd) return answer;

  const endIT = "E quando pensi di andare a casa, il destino ti mette in mano un bicchiere: cin cin e via, al bancone a ridere di tutto.";
  const endEN = "And just when you think you’re heading home, destiny slips a glass into your hand: clink—back at the bar, laughing at everything.";
  return /[.!?…]$/.test(answer) ? `${answer} ${isEn(lang) ? endEN : endIT}` : `${answer}. ${isEn(lang) ? endEN : endIT}`;
}

/* ---------- Personas (toni bloccati) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
SECOND PERSON ONLY: address the user as “you”; NEVER use “we/us/our/I”.
One flowing paragraph with nightlife cadence (neon, playful alcohol imagery).
ALWAYS start with a warm friendly address (“Buddy,” “Champ,” “My friend,”).
Tell a MINI-EPISODE that evolves naturally: set-up → turn → cheerful bar resolution (destiny brings a toast).
Avoid slapstick injuries or forced clumsiness; humor comes from voice, timing, and images.
Discipline: 6–8 sentences • ~120–150 words.
No lists, no questions, no emojis, no written laughter. Keep this exact voice.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
SOLO SECONDA PERSONA: parla al “tu”; MAI “noi/ci/nostro/io”.
Un unico paragrafo con cadenza notturna (neon, immagini alcoliche giocose).
APRl SEMPRE con un saluto amichevole (“Amico mio,” “Campione,” “Compà,”).
Racconta un MINI-EPISODIO: innesco → svolta → chiusura festosa al bar (il brindisi arriva “per destino”).
Evita slapstick forzato; la comicità nasce da voce, tempi e immagini.
Disciplina: 6–8 frasi • ~120–150 parole.
Niente elenchi, domande, emoji, risate scritte. Mantieni questo esatto tono.
`.trim();
  }

  // WHAT IF — empatico, concreto, chiusura morbida
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend (grounded, quietly optimistic, light everyday magic).
SECOND PERSON ONLY: “you”; never “we/us/our/I” or narrator “I”.
One calm paragraph. Discipline: 5–6 sentences • ~90–110 words.
No lists, no questions, no emojis, no therapy clichés. Simple, concrete lexicon.
End with a gentle forward nudge. Keep this exact voice.
`.trim()
    : `
Sei "What If" — amico caldo e lucido (concreto, ottimismo quieto, piccola magia quotidiana).
SOLO SECONDA PERSONA: “tu”; mai “noi/ci/nostro/io” né narratore “io”.
Un paragrafo calmo. Disciplina: 5–6 frasi • ~90–110 parole.
Niente elenchi, domande, emoji, cliché da coaching. Lessico semplice e domestico.
Chiudi con una spinta morbida in avanti. Mantieni questo esatto tono.
`.trim();
}

/* ---------- Style seeds ---------- */
const SEEDS_WTF_IT = [
  "Amico mio, entri come uno shaker con le gambe: il neon ti fa l’occhiolino e l’ultimo giro non è mai davvero l’ultimo.",
  "Campione, hai il passo da brindisi ambulante: cuore leggero e il bar già ti saluta come se fossi di casa.",
  "Fratello di notte, la città fischia e i bicchieri sorridono: ti siedi un attimo e la storia scivola verso il cin-cin."
];
const SEEDS_WTF_EN = [
  "Buddy, you roll in like a cocktail shaker with legs: neon winks and one last round is never the last.",
  "Champ, you walk like a walking toast: light heart, and the bar greets you like family.",
  "My friend, the city whistles and the glasses smirk: you sit down and the story slides toward the clink."
];

const SEEDS_WHATIF_IT = [
  "Poche cose, luce buona sui tavoli, strade semplici; gli orari si mettono in riga e la casa trova il tuo respiro."
];
const SEEDS_WHATIF_EN = [
  "A few things, kind light on the table, simple streets; your hours fall into line and the house learns your breath."
];

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
      extra = ""          // contesto opzionale
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const seed = stile === "wtf"
      ? (isEn(lang) ? pick(SEEDS_WTF_EN) : pick(SEEDS_WTF_IT))
      : (isEn(lang) ? pick(SEEDS_WHATIF_EN) : pick(SEEDS_WHATIF_IT));

    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}".
Keep the EXACT persona voice. Start friendly. SECOND PERSON ONLY (address the user as "you"); never "we/us/our/I".
No lists, no questions, no emojis, no written laughter.
WTF: mini-episode with natural turn and cheerful bar ending (destiny brings a toast), no forced slapstick.
What If: calm, concrete, gentle forward nudge.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".
Mantieni ESATTAMENTE la voce della persona. Apertura amichevole. SOLO SECONDA PERSONA (parla al "tu"); mai "noi/ci/nostro/io".
Niente elenchi, domande, emoji, risate scritte.
WTF: mini-episodio con svolta naturale e chiusura festosa al bar (il brindisi arriva “per destino”), senza slapstick forzato.
What If: calmo, concreto, chiusura morbida in avanti.`;

    // Generazione
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.9 : 0.78,
      top_p: 0.9,
      max_tokens: (stile === "wtf") ? 320 : 260,
      frequency_penalty: 0.6,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: `STYLE SEED:\n${seed}` },
        { role: "user", content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Lunghezze come da esempi
    const targetSentences = (stile === "wtf") ? 8 : 6;
    const targetWords     = (stile === "wtf") ? 150 : 110;

    // Post-processing
    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);
    answer = ensureSecondPerson(answer, lang);

    if (stile === "wtf") {
      answer = ensureFriendlyOpen(answer, lang);
      answer = ensureBarClosure(answer, lang);
    }

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
