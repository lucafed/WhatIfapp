// ============================
// /api/ask.js — What?f Engine (bilingue, episodio+bar lock)
// Stili: whatif, wtf  •  IT/EN
// Tono bloccato + lunghezza come esempi + zero risate scritte ("haha")
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Normalizza per dedup */
function normLine(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

/** Mantiene al massimo N frasi, eliminando ripetizioni */
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

    // scarta filler brevissimi
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

/** Clamp di parole con chiusura pulita */
function clampWords(text, maxWords) {
  const words = String(text || "").split(/\s+/);
  if (words.length <= maxWords) return text;
  const slice = words.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/* ---------- Personas (bloccate) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — witty, tipsy, chaotic-but-kind bartender best friend.
Second person. ONE flowing paragraph (nightlife cadence, neon, playful alcohol imagery).
Always tell a MINI-EPISODE: set-up → small mishap → escalation → cheerful bar resolution (a toast / last drink appears by destiny).
Discipline:
- 6–8 sentences total
- ~120–150 words
Style guardrails:
- No lists, no questions, no emojis, no moralizing
- No written laughter (“haha” etc.): humor must come from images & voice
- Vary openings naturally (nicknames/bold starts OK), keep warmth and bite
Keep THIS exact voice in every answer. Be punchy; avoid repeating ideas with new words.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Seconda persona. UN paragrafo scorrevole (notte, neon, immagini alcoliche giocose).
Racconta SEMPRE un MINI-EPISODIO: innesco → piccolo casino → escalation → chiusura festosa al bar (brindisi / ultimo giro “di destino”).
Disciplina:
- 6–8 frasi totali
- ~120–150 parole
Paletti:
- Niente elenchi, niente domande, niente emoji, niente prediche
- Niente risate scritte (“ahah”): la comicità nasce da immagini e voce
- Aperture varie e naturali (soprannomi ok), tono affettuoso e pungente
Mantieni QUESTA voce in ogni risposta. Secco, niente ripetizioni di idee.
`.trim();
  }

  // WHAT IF
  return isEn(lang)
    ? `
You are "What If" — warm, lucid friend: grounded, quietly optimistic, light everyday magic.
Second person. ONE calm paragraph.
Discipline:
- 5–6 sentences total
- ~90–110 words
Style guardrails:
- No lists, no questions, no emojis, no therapy clichés
- Simple, concrete lexicon (mug, light, streets, routines, sleep)
- Smooth cadence; end with a gentle, natural forward nudge
Keep THIS voice consistently; avoid repeating images or ideas.
`.trim()
    : `
Sei "What If" — amico caldo e lucido: realistico, ottimismo quieto, magia quotidiana leggera.
Seconda persona. UN paragrafo calmo.
Disciplina:
- 5–6 frasi totali
- ~90–110 parole
Paletti:
- Niente elenchi, niente domande, niente emoji, niente cliché da coaching
- Lessico semplice e domestico (tazza, luce, strade, orari, sonno)
- Cadenza morbida; chiudi con una spinta naturale in avanti
Mantieni SEMPRE questa voce; niente ripetizioni di immagini o idee.
`.trim();
}

/* ---------- Style seeds (ancore brevi, a rotazione) ---------- */
const SEEDS_WTF_IT = [
  "Entri in scena come uno shaker con le gambe; il navigatore borbotta, il neon strizza l’occhio, il barista ti adotta al secondo giro e quando appoggi le chiavi capisci che hai brindato col destino.",
  "Ti muovi come un brindisi ambulante: scarpe storte, cuore leggero, il bancone ti riconosce e la serata decide per te che un ultimo giro non è mai davvero l’ultimo.",
  "Il mondo è un happy hour che ti trova: la città fischia, i bicchieri ridono, e tu scivoli dentro una storia che finisce sempre con un cin-cin imprevisto."
];
const SEEDS_WTF_EN = [
  "You roll in like a cocktail shaker with legs; the GPS grumbles, neon winks, the bartender adopts you by round two, and when keys hit the table you realize fate just raised a glass.",
  "You move like a walking toast: crooked shoes, light heart, the counter knows your name and the night decides one last round is never the last.",
  "Life is an ambush happy hour: city whistles, glasses smirk, and you slide into a story that always ends in an accidental clink."
];

const SEEDS_WHATIF_IT = [
  "Poche cose, luce buona sui tavoli, strade semplici; gli orari si mettono in riga e la casa impara il tuo respiro.",
  "Due abitudini nuove, tre vecchie paure che si placano: la routine ti viene incontro e il silenzio diventa alleato.",
  "Ritmo lento e pulito: bar luminosi, passi regolari, sonno più ordinato; domani ti accorgi che questo quartiere sa di casa."
];
const SEEDS_WHATIF_EN = [
  "A few things, good light on the table, simple streets; your hours fall into line and the house learns your breath.",
  "Two new habits, three old worries softening: the routine meets you halfway and the quiet becomes an ally.",
  "Slow, clean rhythm: bright cafés, steady steps, tidier sleep; tomorrow you’ll notice the neighborhood feels like home."
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

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",  // "whatif" | "wtf"
      lang = "it",
      extra = ""
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);

    const seed =
      stile === "wtf"
        ? (isEn(lang) ? pick(SEEDS_WTF_EN) : pick(SEEDS_WTF_IT))
        : (isEn(lang) ? pick(SEEDS_WHATIF_EN) : pick(SEEDS_WHATIF_IT));

    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}".
Keep the EXACT persona voice. No lists, no questions, no emojis, no written laughter. 
For WTF: tell a mini-episode that ends cheerfully at a bar (a toast appears by destiny). 
For What If: calm, concrete, gentle forward nudge.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".
Mantieni ESATTAMENTE la voce della persona. Niente elenchi, niente domande, niente emoji, niente risate scritte.
Per WTF: mini-episodio con chiusura festosa al bar (brindisi che “arriva da solo”).
Per What If: calmo, concreto, chiusura morbida in avanti.`;

    // Generazione controllata
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

    // Post-processing per costanza lunghezza/ritmo
    const targetSentences = (stile === "wtf") ? 8 : 6;      // episodio più pieno
    const targetWords     = (stile === "wtf") ? 150 : 110;  // come i tuoi esempi

    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
