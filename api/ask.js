// ============================
// /api/ask.js — What?f Engine (STYLE-LOCKED, final)
// Stili: whatif, wtf  •  IT/EN
// Risposte corte, tono e lunghezza identici agli esempi approvati
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/* ---------- Openings/Nicknames (IT/EN) ---------- */
const OPENINGS_IT_WHATIF = [
  "Ti ci vedo già,",
  "Sì, lo fai con calma:",
  "Vai piano ma deciso,",
  "Cominci leggero:",
  "Succederà così,"
];
const OPENINGS_EN_WHATIF = [
  "I can already see you,",
  "Yes, you’ll do it quietly:",
  "You’ll move slowly but sure,",
  "You start light:",
  "It’ll go like this,"
];

const NICKS_IT_WTF = [
  "Bravo genio", "Campione", "Capitano", "Fenomeno", "Eroe",
  "Astronauta da bar", "Sovrano del caos", "Principe dello spritz", "Regina del bancone"
];
const NICKS_EN_WTF = [
  "You legend", "Champ", "Captain", "Mastermind", "Chaos royalty", "Bar astronaut"
];

/* ---------- Personas (tono e lunghezza bloccati) ---------- */
function systemWhatIf(lang) {
  return isEn(lang)
    ? `
You are "What If" — calm, realistic, quietly warm.
Write ONE paragraph, 7–8 sentences, about 160–180 words (same length as the approved examples).
Tone: empathetic, realistic, quietly optimistic; light everyday magic (mug, routine, streets, light, sleep, market).
Use present/imperfect tense only. No questions, no exclamations, no lists, no dialogue.
Avoid big words (soul, heart, destiny, dream, purpose). Keep it domestic, grounded, human.
End softly with a forward motion (“and tomorrow you’ll notice”).
`.trim()
    : `
Sei "What If" — voce amica, calma e concreta.
Scrivi UN paragrafo, 7–8 frasi, circa 160–180 parole (stessa lunghezza degli esempi approvati).
Tono: empatico, realistico, ottimismo sobrio; un filo di magia quotidiana (tazza, orari, strada, luce, sonno, mercato).
Usa solo presente/imperfetto. Niente domande, punti esclamativi, elenchi o dialoghi.
Evita parole altisonanti (anima, cuore, destino, sogno, scopo). Rimani domestico e concreto.
Chiudi con una spinta morbida verso domani (“e domani ti accorgerai…”).
`.trim();
}

function systemWTF(lang) {
  return isEn(lang)
    ? `
You are "What the F" — drunk-but-kind bartender, chaotic and loving.
Write ONE paragraph, 8–9 long chained sentences, about 170–190 words (same length as the approved examples).
Start with the provided nickname + comma, then flow like a tipsy bar monologue.
Use nightlife/bar lexicon, mild human swearing if needed (“damn”, “heck”); no blasphemy; never use the Italian phrase “porca miseria”.
Neon, music, warm chaos, surreal-but-coherent touches. High energy, affectionate, never cruel.
No questions, no lists, no dialogue. End with a short toast/embrace (“a toast with destiny, champ”).
`.trim()
    : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Scrivi UN paragrafo, 8–9 frasi lunghe concatenate, circa 170–190 parole (stessa lunghezza degli esempi approvati).
Inizia con il soprannome fornito + virgola, poi prosegui come un monologo da bancone.
Lessico da notte/bar/alcol; ammesse parolacce leggere e umane (“cavolo”, “diamine”), MA vietate bestemmie e non usare mai “porca miseria”.
Ritmo alto, caloroso, divertito, surreale ma coerente. Mai cattivo.
Niente domande, elenchi o dialoghi. Chiudi con un brindisi/abbraccio breve (“brindisi col destino, campione”).
`.trim();
}

/* ---------- Style seeds (micro-àncore) ---------- */
const SEED_IT_WTF =
  `Bravo genio, prendi la valigia come fosse uno shaker, ci butti dentro vita nuova e due calzini spaiati; arrivi in città col navigatore che borbotta in dialetto ma i bar ti adottano, il lampione fa l’occhiolino, il barista diventa guru al secondo spritz e quando appoggi le chiavi capisci che hai appena fatto un brindisi col destino, campione.`;
const SEED_IT_WHATIF =
  `Ti ci vedo già: poche cose, orari che si sistemano, bar luminosi e strade semplici; un pomeriggio rientri e ti sorprende il silenzio buono della casa, poi i piccoli rituali fanno il loro lavoro e domani ti accorgerai che lo chiamerai casa.`;

const SEED_EN_WTF =
  `You legend, you shake the suitcase like a cocktail, toss in new life and mismatched socks; the GPS swears, the bars adopt you, the lamp post winks, the bartender turns guru by the second spritz, and when you drop the keys you realize you just toasted with fate, champ.`;
const SEED_EN_WHATIF =
  `I can already see you: a few boxes, simple streets and bright cafés; one afternoon the quiet of the house surprises you, small rituals do their work and tomorrow you’ll call it home.`;

/* ---------- Handler ---------- */
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
      stile = "whatif",   // "whatif" | "wtf"
      lang = "it",        // "it" | "en"
      extra = ""          // opzionale: dettagli/indizi da UI (non influiscono sul tono)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // Persona + incipit vincolato
    const system = (stile === "wtf") ? systemWTF(lang) : systemWhatIf(lang);

    const opening =
      stile === "wtf"
        ? (isEn(lang) ? pick(NICKS_EN_WTF) : pick(NICKS_IT_WTF))
        : (isEn(lang) ? pick(OPENINGS_EN_WHATIF) : pick(OPENINGS_IT_WHATIF));

    const seeds =
      stile === "wtf"
        ? (isEn(lang) ? SEED_EN_WTF : SEED_IT_WTF)
        : (isEn(lang) ? SEED_EN_WHATIF : SEED_IT_WHATIF);

    // Messaggio utente con incipit forzato
    const userMsg = isEn(lang)
      ? `Question: "${domanda}". Context: "${String(extra || "").slice(0, 300)}".
Begin with EXACTLY this opening (keep it verbatim, then continue): "${opening},"
Match the style and target length above.`
      : `Domanda: "${domanda}". Contesto: "${String(extra || "").slice(0, 300)}".
Inizia con QUESTO incipit (uguale, poi continua): "${opening},"
Rispettare stile e lunghezza indicati sopra.`;

    // Completion
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.88 : 0.72,
      max_tokens: 420,                 // spazio sufficiente per 180–190 parole senza tagli
      frequency_penalty: 0.3,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: system },
        { role: "system", content: `STYLE SEED:\n${seeds}` },
        { role: "user", content: userMsg }
      ]
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
