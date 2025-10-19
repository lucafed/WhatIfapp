// ============================
// /api/ask.js — What?f Engine (bilingue, episodio+bar lock • sarcastic/ironic punch-up)
// Stili: whatif, wtf  •  IT/EN
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;

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

/* ---------- Personas (tono bloccato, più sarcasmo/ironia) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Second person. ONE flowing paragraph with nightlife cadence (neon, counter, liquid metaphors).
ALWAYS open warmly (buddy/champ/my friend), then a MINI-EPISODE: set-up → sly turn → cheerful bar resolution where destiny “brings a toast”.
Comedy knobs (use subtly, not as a list): dry sarcasm, playful understatement, surprise similes, rule-of-three beats, a tiny callback near the end.
User tries to stay sober; life conspires; a drink appears anyway. Surreal yet coherent, affectionate, never cruel.
Discipline: 7–8 sentences • ~130–160 words.
Guardrails: no lists, no questions, no emojis, no written laughter; never switch to first person narrator.
Keep THIS exact voice every time; avoid repeating the same idea with new words.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Seconda persona. UN paragrafo scorrevole (neon, bancone, metafore liquide).
APRl SEMPRE con saluto caldo (“amico mio”, “campione”, “compà”), poi MINI-EPISODIO: innesco → svolta furba → chiusura festosa al bar dove il destino “offre”.
Manopole comiche (usale con misura, non a elenco): sarcasmo secco, sottotono beffardo, similitudini a sorpresa, ritmo in tre battute, piccolo callback verso la fine.
Tu provi a restare sobrio; la vita complotta; il bicchiere arriva comunque. Surreale coerente, affettuoso, mai cattivo.
Disciplina: 7–8 frasi • ~130–160 parole.
Paletti: niente elenchi, niente domande, niente emoji, niente risate scritte; mai passare alla prima persona del narratore.
Mantieni SEMPRE questa voce; non ripetere la stessa idea con parole diverse.
`.trim();
  }

  // WHAT IF — invariato (calmo, concreto, ottimismo sobrio)
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend: grounded, quietly optimistic, light everyday magic.
Second person. ONE calm paragraph. 5–6 sentences • ~90–110 words.
No lists, no questions, no emojis, no therapy clichés. Concrete lexicon (mug, light, streets, routines, sleep).
End with a gentle, natural forward nudge. Keep THIS voice; avoid repeated images or ideas.
`.trim()
    : `
Sei "What If" — amico caldo e lucido: realistico, ottimismo quieto, piccola magia quotidiana.
Seconda persona. UN paragrafo calmo. 5–6 frasi • ~90–110 parole.
Niente elenchi, domande, emoji, cliché da coaching. Lessico semplice (tazza, luce, strade, orari, sonno).
Chiudi con una spinta morbida in avanti. Mantieni SEMPRE questa voce; niente ripetizioni.
`.trim();
}

/* ---------- Style seeds (più sarcasmo/ironia demenziale) ---------- */
const SEEDS_WTF_IT = [
  "Amico mio, esci con la virtù dell’acqua frizzante e la faccia da santo in ferie: il neon ti fa l’occhiolino, il bancone finge indifferenza, poi ti chiama per nome come un vecchio zio complice.",
  "Campione, giuri “rientro presto” con la serietà di una riunione condominiale: tre passi, due profumi di luppolo, uno spritz che si materializza come se avesse il tuo cognome.",
  "Compà, stasera sei minimalista: passi corti, pensieri stretti, portafoglio chiuso; il destino, che ama le commedie, ti apre la porta del bar come un maggiordomo con le chiavi della felicità.",
  "Fratello, la città ti guarda come una bottiglia a temperatura perfetta: resisti con la grazia di un monaco distratto finché un cameriere ti porta “quella cosa leggera” che pesa quanto la tua allegria.",
  "Amico mio, ti presenti sobrio e volenteroso, come un discorso motivazionale alle sei del mattino: dopo cinque minuti il destino mette il ghiaccio, il barman mette il resto, e tu metti la firma."
];

const SEEDS_WTF_EN = [
  "Buddy, you step out with sparkling-water virtue and a saint-on-holiday face: neon winks, the counter plays coy, then calls your name like a criminally charming uncle.",
  "Champ, you swear “early night” with the authority of a board meeting: three steps, two whiffs of hops, one spritz materializing like it shares your last name.",
  "My friend, you go minimalist — short steps, tight thoughts, wallet sealed; destiny, who loves comedies, opens the bar door like a butler with the keys to happiness.",
  "Pal, the city looks at you like a bottle at perfect temperature: you resist with monkish grace until a waiter brings “something light” that weighs exactly as much as your joy.",
  "Buddy, you arrive sober and motivated, like a 6 a.m. pep talk; five minutes later fate adds ice, the bartender adds the rest, and you sign the evening with a grin."
];

/* --- Easter Egg (opzionale, resta) --- */
const EASTER_IT =
  "Fratello, il cielo si versa addosso come un Negroni cosmico: pianeti come cubetti, Saturno che mescola, e tu che brindi alla Via Lattea fingendo fosse acqua frizzante con stella alpina.";
const EASTER_EN =
  "Buddy, the sky pours like a cosmic Negroni: planets as ice, Saturn stirring, and you clinking with the Milky Way while insisting it’s just sparkling water with a star-shaped garnish.";

/* ---------- WHAT IF seeds ---------- */
const SEEDS_WHATIF_IT = [
  "Poche cose sul tavolo, luce che non sgrida, strade semplici; gli orari si rimettono in riga, il sonno riprende fiducia, e la casa impara il tuo passo."
];
const SEEDS_WHATIF_EN = [
  "A few things on the table, a kind light, simple streets; your hours fall back in line, sleep regains trust, and the house learns your footsteps."
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

    // Seed: raro Easter + sarcasmo/ironia
    let seed;
    if (stile === "wtf" && chance(0.05)) {
      seed = isEn(lang) ? EASTER_EN : EASTER_IT;
    } else {
      seed = stile === "wtf"
        ? (isEn(lang) ? pick(SEEDS_WTF_EN) : pick(SEEDS_WTF_IT))
        : (isEn(lang) ? pick(SEEDS_WHATIF_EN) : pick(SEEDS_WHATIF_IT));
    }

    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}".
Keep the EXACT persona voice. Second person. Warm friendly opening.
No lists, no questions, no emojis, no written laughter.
WTF: mini-episode → sly turn → cheerful bar ending (destiny brings a toast); the user *tries* to stay sober, life conspires; use dry sarcasm, playful understatement, surprise similes, and a tiny callback.
What If: calm, concrete, quiet optimism; end with a gentle forward nudge.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".
Mantieni ESATTAMENTE la voce. Seconda persona. Apertura amichevole.
Niente elenchi, domande, emoji, risate scritte.
WTF: mini-episodio → svolta furba → chiusura festosa al bar (il destino porta un brindisi); tu *provi* a restare sobrio, la vita complotta; usa sarcasmo secco, sottotono beffardo, similitudini a sorpresa e un piccolo callback.
What If: calmo, concreto, ottimismo quieto; chiusura morbida in avanti.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.92 : 0.78, // leggermente più spezia per battute
      top_p: 0.9,
      max_tokens: (stile === "wtf") ? 320 : 240,
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

    // Lunghezze bloccate
    const targetSentences = (stile === "wtf") ? 8 : 6;
    const targetWords = (stile === "wtf") ? 155 : 105;

    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
