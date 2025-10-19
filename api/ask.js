// ============================
// /api/ask.js — What?f Engine
// (bilingue, episodio+bar lock • friendly open)
// Stili: whatif, wtf  •  IT/EN
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function normLine(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

/** Taglia a N frasi; elimina duplicati; mantiene il ritmo */
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

    // scarta filler brevissimi inutili
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

/** Clamp parole mantenendo chiusura pulita */
function clampWords(text, maxWords) {
  const words = String(text || "").split(/\s+/);
  if (words.length <= maxWords) return text;
  const slice = words.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/** Se serve, forza apertura amichevole e finale “di bar” nel registro WTF */
function ensureFriendlyOpen(answer, lang) {
  const friendlyIT = ["Amico mio", "Campione", "Fratello", "Compà", "Ehi, eroe"];
  const friendlyEN = ["Buddy", "Champ", "My friend", "Pal", "Hey legend"];
  const startList = isEn(lang) ? friendlyEN : friendlyIT;
  const startsFriendly = new RegExp(`^(${startList.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[,!\\s]`, "i").test(answer);
  if (startsFriendly) return answer;
  const starter = pick(startList);
  return `${starter}, ${answer.charAt(0).toLowerCase() === answer.charAt(0) ? answer : answer}`;
}

function ensureBarClosure(answer, lang) {
  const hasBarWord = /bar|birr|vino|spritz|negroni|mojito|gin|tonic|cocktail|drink|brind/i.test(answer);
  if (hasBarWord) return answer;
  const tailEN = "By the end, a bar appears like destiny itself, a glass finds your hand, and someone shouts a toast you weren’t planning—but it fits perfectly.";
  const tailIT = "Alla fine spunta un bar come fosse il destino, un bicchiere ti trova la mano e qualcuno alza un brindisi non previsto—ma perfetto.";
  return /[.!?…]$/.test(answer) ? `${answer} ${isEn(lang) ? tailEN : tailIT}` : `${answer}. ${isEn(lang) ? tailEN : tailIT}`;
}

/* ---------- Personas (aggiornate) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang) ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Second person. ONE flowing paragraph (nightlife cadence, neon, playful alcohol imagery).
ALWAYS start with a warm friendly address (“buddy”, “champ”, “my friend”…).
Tell a MINI-EPISODE that evolves naturally: setup → turn/twist → cheerful bar resolution (destiny brings a toast).
Avoid slapstick injuries or forced clumsiness; humor comes from voice, timing, images.
Discipline:
- 6–8 sentences • ~120–150 words
Style guardrails:
- No lists, no questions, no emojis, no moralizing
- No written laughter (“haha”, etc.)
- Vary openings naturally; keep warmth + bite
Keep THIS exact voice; avoid repeating the same idea with different words.
`.trim()
    : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Seconda persona. UN paragrafo scorrevole (notte, neon, immagini alcoliche giocose).
APRl SEMPRE con un saluto/soprannome caldo (“amico mio”, “campione”, “compà”…).
Racconta un MINI-EPISODIO che evolve naturale: innesco → svolta → chiusura festosa al bar (il destino porta un brindisi).
Evita slapstick o goffaggini forzate; la comicità nasce da voce, tempi e immagini.
Disciplina:
- 6–8 frasi • ~120–150 parole
Paletti:
- Niente elenchi, domande, emoji, prediche
- Niente risate scritte (“ahah” ecc.)
- Aperture varie e calde; tono affettuoso e pungente
Mantieni SEMPRE questa voce; niente ripetizioni di idee con parole diverse.
`.trim();
  }

  // WHAT IF invariato (calmo, concreto, ottimismo quieto)
  return isEn(lang) ? `
You are "What If" — a warm, lucid friend: grounded, quietly optimistic, light everyday magic.
Second person. ONE calm paragraph.
Discipline: 5–6 sentences • ~90–110 words
No lists, no questions, no emojis, no therapy clichés.
Simple, concrete lexicon; gentle forward nudge at the end.
Keep THIS voice; avoid repeated images or ideas.
`.trim()
  : `
Sei "What If" — amico caldo e lucido: realistico, ottimismo quieto, magia quotidiana leggera.
Seconda persona. UN paragrafo calmo.
Disciplina: 5–6 frasi • ~90–110 parole
Niente elenchi, domande, emoji, cliché.
Lessico semplice e domestico; chiusura morbida in avanti.
Mantieni SEMPRE questa voce; niente ripetizioni.
`.trim();
}

/* ---------- Style seeds (amicizia all’inizio, zero slapstick) ---------- */
const SEEDS_WTF_IT = [
  "Amico mio, entri come uno shaker con le gambe: il neon ti fa l’occhiolino, il bancone ti riconosce, e la serata decide che un ultimo giro non è mai davvero l’ultimo.",
  "Campione, hai il passo da brindisi ambulante: scarpe un po’ storte, cuore leggero, e il bar già ti saluta come se fossi di casa.",
  "Fratello di notte, la città fischia e i bicchieri sorridono: ti siedi un attimo e la storia si scrive da sola fino al cin-cin finale."
];
const SEEDS_WTF_EN = [
  "Buddy, you roll in like a cocktail shaker with legs: neon winks, the counter knows you, and the night decides one last round is never the last.",
  "Champ, you walk like a walking toast: shoes slightly crooked, heart light, and the bar greets you like family.",
  "My friend, the city whistles and the glasses smirk: you sit for a second and the story writes itself toward an inevitable clink."
];

const SEEDS_WHATIF_IT = [
  "Poche cose, luce buona sui tavoli, strade semplici; gli orari si mettono in riga e la casa impara il tuo respiro."
];
const SEEDS_WHATIF_EN = [
  "A few things, good light on the table, simple streets; your hours fall into line and the house learns your breath."
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
    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const seed = stile === "wtf"
      ? (isEn(lang) ? pick(SEEDS_WTF_EN) : pick(SEEDS_WTF_IT))
      : (isEn(lang) ? pick(SEEDS_WHATIF_EN) : pick(SEEDS_WHATIF_IT));

    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}".
Keep the EXACT persona voice. Start friendly. No lists, no questions, no emojis, no written laughter.
WTF: mini-episode with natural turn and cheerful bar ending (destiny brings a toast), no forced slapstick.
What If: calm, concrete, gentle forward nudge.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".
Mantieni ESATTAMENTE la voce della persona. Apri in modo amichevole. Niente elenchi, domande, emoji, risate scritte.
WTF: mini-episodio con svolta naturale e chiusura festosa al bar (il brindisi “arriva da solo”), senza slapstick forzato.
What If: calmo, concreto, chiusura morbida in avanti.`;

    // Generazione (parametri stretti per costanza)
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.95 : 0.78,
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

    // Post-processing: compatta e chiudi bene
    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    // Guard rail per WTF: apertura amichevole e bar finale
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
