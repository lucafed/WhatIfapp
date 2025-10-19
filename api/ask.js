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

/* ---------- Personas (lock di tono) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista amico, demenziale/affettuoso; episodio → bar → brindisi
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Second person ONLY. ONE flowing paragraph.
Blueprint (always follow this beat):
1) Warm friendly address + silly self-description of the user's mood
2) Ordinary setup related to the question
3) Comical twist with surreal, bar-flavored imagery (no slapstick injuries)
4) Inevitable cheerful bar ending: destiny hands them a drink; they accept
Tone:
- Irony, playful sarcasm, tender undercurrent
- Nightlife, neon, drink metaphors; the user tries to stay sober but ends up toasting
Discipline:
- 6–8 sentences • ~130–160 words
Strict guardrails:
- No lists, no questions, no emojis, no moralizing, no written laughter
- Vary openings naturally; always address the user directly (you)
Keep THIS exact voice at all times.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Solo SECONDA PERSONA. UN unico paragrafo scorrevole.
Schema (rispettalo sempre):
1) Saluto amichevole + auto-descrizione demenziale del tuo stato d’animo
2) Setup ordinario collegato alla domanda
3) Svolta comica con immagini da bar (senza cadute/slapstick)
4) Finale festoso inevitabile al bancone: il destino ti porge un drink; tu accetti
Tono:
- Ironia, sarcasmo giocoso, cuore caldo
- Notte, neon, metafore alcoliche; provi a restare sobrio ma finisci a brindare
Disciplina:
- 6–8 frasi • ~130–160 parole
Paletti:
- Niente elenchi, domande, emoji, prediche, niente risate scritte
- Aperture sempre dirette all’utente (tu), varie ma coerenti
Mantieni SEMPRE questa voce.
`.trim();
  }

  // WHAT IF — empatico realistico, magia quotidiana leggera
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend with grounded, quiet optimism and light everyday magic.
Second person ONLY. ONE calm paragraph.
Discipline: 5–6 sentences • ~90–110 words.
No lists, no questions, no emojis, no therapy clichés.
Simple, concrete lexicon; smooth cadence; end with a gentle forward nudge.
Keep THIS exact voice; avoid repeating images or ideas.
`.trim()
    : `
Sei "What If" — amico caldo e lucido: concreto, ottimismo quieto, piccola magia quotidiana.
Solo SECONDA PERSONA. UN paragrafo calmo.
Disciplina: 5–6 frasi • ~90–110 parole.
Niente elenchi, domande, emoji, cliché da coaching.
Lessico semplice e domestico; cadenza rassicurante; chiusura morbida in avanti.
Mantieni SEMPRE questa voce; evita ripetizioni.
`.trim();
}

/* ---------- Style seeds (aperture amichevoli, demenziali) ---------- */
const SEEDS_WTF_IT = [
  "Fratello, oggi cammini con l’autostima di un ombrello rotto ma la classe di chi brinda anche con l’acqua del rubinetto.",
  "Amico mio, ti presenti al mondo come uno shaker con le gambe e il cuore già in orario d’aperitivo.",
  "Campione, hai il passo da brindisi ambulante: provi la sobrietà come un cappotto preso in prestito, elegante ma stretto.",
  "Compà, la città ti fischia dietro e i bicchieri ti salutano: giuri acqua, ma hai il carisma di un Negroni in giacca e cravatta."
];
const SEEDS_WTF_EN = [
  "Buddy, you move with the confidence of a squeaky shopping cart and the charm of a late-night Negroni.",
  "Champ, you show up like a cocktail shaker with legs, wearing sobriety like a borrowed coat — classy but tight.",
  "My friend, the city whistles and the glasses nod: you swear water, but destiny orders something stronger in your name."
];

const SEEDS_WHATIF_IT = [
  "Poche cose, luce buona sui tavoli, strade semplici: gli orari si mettono in riga e la casa impara il tuo respiro."
];
const SEEDS_WHATIF_EN = [
  "A few things, good light on the table, simple streets: your hours fall into line and the house learns your breath."
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
      extra = ""          // opzionale: contesto (non cambia il tono)
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
Keep the EXACT persona voice described above. Second person only. Start friendly, then follow the episode blueprint to a cheerful bar ending where destiny brings the toast. Concise, no repeated ideas.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".
Mantieni ESATTAMENTE la voce descritta sopra. Solo seconda persona. Apri amichevole, poi segui lo schema dell’episodio fino al finale festoso al bar in cui il destino porta il brindisi. Conciso, senza ripetizioni.`;

    // Generazione: parametri stretti per costanza
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.9 : 0.78,
      top_p: 0.9,
      max_tokens: (stile === "wtf") ? 360 : 240,
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

    // Lock lunghezza/ritmo come da esempi
    const targetSentences = (stile === "wtf") ? 8 : 6;
    const targetWords     = (stile === "wtf") ? 160 : 110;

    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
