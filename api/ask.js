// ============================
// /api/ask.js — What?f Engine (Final Fine-Tuned)
// Stili: whatif, wtf  •  IT/EN
// Chiusure poetiche + ritmo naturale come esempi
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/* ---------- Openings/Nicknames ---------- */
const OPENINGS_IT_WHATIF = [
  "Ti ci vedo già,", "Sì, lo fai con calma:", "Vai piano ma deciso,", "Cominci leggero:", "Succederà così,"
];
const NICKS_IT_WTF = [
  "Bravo genio","Campione","Capitano","Fenomeno","Eroe",
  "Astronauta da bar","Sovrano del caos","Principe dello spritz","Regina del bancone"
];

/* ---------- Personas ---------- */
function systemWhatIf() {
  return `
Sei "What If" — voce amica, calma e concreta.
Scrivi ESATTAMENTE 6 frasi (~110–130 parole), in SECONDA PERSONA, un paragrafo unico.
Tono: empatico, realistico, ottimismo sobrio; immagini quotidiane (tazza, orari, luce, sonno, mercato).
Evita domande, esclamazioni, elenchi, frasi da coach o termini altisonanti (anima, destino, scopo).
Chiudi con una frase poetica tipo “e domani ti accorgerai che lo chiamerai casa.” o equivalente.
`.trim();
}

function systemWTF() {
  return `
Sei "What the F" — barista amico, alticcio e affettuoso.
Scrivi ESATTAMENTE 7 frasi (~120–140 parole), un paragrafo unico, in SECONDA PERSONA.
Inizia con il soprannome fornito + virgola. Lessico da bar/notte/neon; inserisci almeno DUE immagini assurde ma coerenti (lampione che fa l’occhiolino, GPS che brontola, pinguino DJ).
Usa UNA sola parolina di sfogo leggera (“cavolo” o “diamine”), mai bestemmie.
Niente domande/elenco/dialoghi. Ritmo musicale, frasi concatenate.
Chiudi con una frase affettuosa e poetica tipo “e capisci che hai appena fatto un brindisi col destino, campione.”
`.trim();
}

/* ---------- Seeds ---------- */
const SEED_IT_WHATIF = `Ti ci vedo già: poche cose, orari che si sistemano, bar luminosi e strade semplici; il silenzio buono della casa ti sorprende e domani ti accorgerai che la chiamerai casa.`;
const SEED_IT_WTF = `Bravo genio, prendi la valigia come fosse uno shaker e ci butti dentro vita nuova e calzini spaiati; i bar ti adottano, il lampione fa l’occhiolino, il barista diventa guru al secondo spritz e capisci che hai appena fatto un brindisi col destino, campione.`;

/* ---------- Post-processing ---------- */
function finalize(text, style) {
  let t = (text || "").trim();

  // pulizia
  t = t.replace(/[!?]+/g, ".").replace(/\s+/g, " ").replace(/\s*\.\s*\./g, ".").trim();

  // taglio parole
  const maxWords = style === "wtf" ? 140 : 130;
  const words = t.split(/\s+/);
  if (words.length > maxWords) t = words.slice(0, maxWords).join(" ") + ".";

  // chiusura perfetta
  if (style === "wtf" && !/brindisi col destino/.test(t))
    t = t.replace(/\.*$/, ".") + " e capisci che hai appena fatto un brindisi col destino, campione.";
  if (style === "whatif" && !/lo chiamerai casa/.test(t))
    t = t.replace(/\.*$/, ".") + " e domani ti accorgerai che lo chiamerai casa.";

  return t.trim();
}

/* ---------- Handler ---------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { domanda = "", stile = "whatif", lang = "it" } = body;
    if (!domanda) return res.status(400).json({ error: "domanda_required" });

    const system = stile === "wtf" ? systemWTF() : systemWhatIf();
    const seed = stile === "wtf" ? SEED_IT_WTF : SEED_IT_WHATIF;
    const opening = stile === "wtf" ? pick(NICKS_IT_WTF) : pick(OPENINGS_IT_WHATIF);

    const userMsg = `Domanda: "${domanda}". Inizia con: "${opening}," poi continua nello stile sopra.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.85 : 0.7,
      max_tokens: 340,
      frequency_penalty: 0.35,
      messages: [
        { role: "system", content: system },
        { role: "system", content: `STYLE SEED:\n${seed}` },
        { role: "user", content: userMsg }
      ]
    });

    const answer = finalize(completion?.choices?.[0]?.message?.content || "", stile);
    res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ /api/ask error:", err);
    res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
