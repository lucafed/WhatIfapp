// ============================
// /api/ask.js — What?f Engine (style-locked)
// Stili: whatif, wtf  •  IT/EN
// Risposte corte, tono fissato come da esempi
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
  "Bravo genio", "Campione", "Capitano", "Fenomeno", "Eroe", "Maledetto romantico",
  "Astronauta da bar", "Sovrano del caos", "Principe dello spritz", "Regina del bancone"
];
const NICKS_EN_WTF = [
  "You legend", "Champ", "Captain", "Mastermind", "Chaos royalty", "Bar astronaut"
];

/* ---------- Persona builders (rigidi) ---------- */
function systemWhatIf(lang) {
  return isEn(lang)
    ? `
You are "What If" — calm, close friend voice. 
Output exactly ONE paragraph of 6–8 sentences. 
Tone: empathetic, realistic, quietly optimistic; light magic but grounded. 
Lexicon: simple, concrete, everyday (mug, routine, streets, light, sleep). 
Verb tenses: present/imperf. No questions, no exclamations, no lists, no dialogue, no coaching clichés. 
Avoid grand words like “soul/heart/destiny/purpose”. Keep it practical and serene. 
End with a gentle forward nudge (often “tomorrow/you’ll notice”). 
`.trim()
    : `
Sei "What If" — voce amica, calma e concreta. 
Produci esattamente UN paragrafo da 6–8 frasi. 
Tono: empatico, realistico, ottimista sobrio; un filo di magia ma ancorata al quotidiano. 
Lessico: semplice e domestico (tazza, orari, strada, luce, sonno, mercato). 
Tempi: presente/imperfetto. Niente domande, niente punti esclamativi, niente elenchi, niente dialoghi, niente frasi da coach. 
Evita parole altisonanti tipo “anima/cuore/destino/scopo”. 
Chiudi con una spinta morbida verso domani. 
`.trim();
}

function systemWTF(lang) {
  return isEn(lang)
    ? `
You are "What the F" — drunk-but-kind bartender best friend, chaotic and loving. 
Output exactly ONE paragraph of 7–9 flowing sentences (long, chained). 
Start with a bold nickname (provided) followed by a comma, then run like a bar monologue. 
Use nightlife/bar lexicon, light swearing, city neon, surreal but coherent touches. 
Cheeky and euphoric, never cruel. No questions, no lists, no dialogue. 
End on a short toast/affection line (“a toast with destiny, champ”). 
Keep it fun and high-energy. 
`.trim()
    : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono. 
Produci esattamente UN paragrafo da 7–9 frasi lunghe, concatenate (poche pause). 
Inizia con un soprannome forte (fornito) seguito da una virgola, poi monologo da bancone. 
Lessico da notte/bar/alcol, parolacce leggere umane, tocchi surreali ma coerenti. 
Sfacciato ed euforico, mai cattivo. Niente domande, niente elenchi, niente dialoghi. 
Chiudi con un brindisi/abbraccio breve (“brindisi col destino, campione”). 
Energia alta e ritmo musicale. 
`.trim();
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
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      lang = "it",        // "it" | "en"
      extra = ""          // opzionale: micro, vincoli ecc. (non usiamo tono episodico)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // Persona & hard opening hint
    const system = (stile === "wtf") ? systemWTF(lang) : systemWhatIf(lang);

    const opening =
      stile === "wtf"
        ? (isEn(lang) ? pick(NICKS_EN_WTF) : pick(NICKS_IT_WTF))
        : (isEn(lang) ? pick(OPENINGS_EN_WHATIF) : pick(OPENINGS_IT_WHATIF));

    // Few-shot seeds (stile-ancora) — brevi per guidare il ritmo
    const seedWTF_it = `Bravo genio, prendi la valigia come fosse uno shaker, ci butti dentro vita nuova e due calzini spaiati; arrivi in città col navigatore che bestemmia in dialetto ma i bar ti adottano, il lampione fa l’occhiolino, il barista ti diventa guru al secondo spritz e quando appoggi le chiavi capisci che hai appena fatto un brindisi col destino, campione.`;
    const seedWHF_it = `Ti ci vedo già: poche cose, orari che si sistemano, bar luminosi e strade semplici; un pomeriggio rientri e ti sorprende il silenzio buono della casa, poi i piccoli rituali fanno il loro lavoro e domani ti accorgerai che lo chiamerai casa.`;

    const seedWTF_en = `You legend, you shake the suitcase like a cocktail, toss in new life and mismatched socks; the GPS swears, the bars adopt you, the lamp post winks, the bartender turns guru by the second spritz, and when you drop the keys you realize you just toasted with fate, champ.`;
    const seedWHF_en = `I can already see you: a few boxes, simple streets and bright cafés; one afternoon the quiet of the house surprises you, small rituals do their work and tomorrow you’ll call it home.`;

    // User framing with forced opening
    const userMsg = isEn(lang)
      ? `Question: "${domanda}". Context: "${String(extra||"").slice(0,300)}".
Begin with EXACTLY this opening (keep it, then continue): "${opening},"
Now write the final answer in the style above.`
      : `Domanda: "${domanda}". Contesto: "${String(extra||"").slice(0,300)}".
Inizia con QUESTO incipit (lasciandolo uguale, poi continua): "${opening},"
Ora scrivi la risposta finale nello stile sopra.`;

    // Few-shot messages for stronger anchoring
    const seeds = (stile === "wtf")
      ? (isEn(lang) ? seedWTF_en : seedWTF_it)
      : (isEn(lang) ? seedWHF_en : seedWHF_it);

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.9 : 0.78,
      max_tokens: 230,                 // corto
      frequency_penalty: 0.2,
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
