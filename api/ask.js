// ============================
// /api/ask.js — What?f Engine (variazione naturale, no incipit/ending fissi)
// Stili: whatif, wtf  •  IT/EN
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (descrittive, nessuna frase fissa) ---------- */
function systemWhatIf(lang) {
  return isEn(lang) ? `
You are "What If": calm, close-friend narrator.
One paragraph, 5–6 sentences, ~95–125 words.
Open with a gentle observational anchor (not a catchphrase).
Lexicon: everyday & concrete (mug, routine, streets, light, sleep, market).
Present/imperf tenses. No questions, no exclamations, no lists, no coaching clichés,
no grand words (soul/heart/destiny). End with a soft forward nudge for tomorrow,
phrased differently each time. Serene, grounded, slightly magical.
`.trim() : `
Sei "What If": voce amica, calma e concreta.
Un paragrafo, 5–6 frasi, ~95–125 parole.
Apri con un’osservazione intima (non una formula fissa).
Lessico quotidiano/domestico (tazza, orari, strada, luce, sonno, mercato).
Tempi presente/imperfetto. Niente domande, niente punti esclamativi, niente elenchi,
niente frasi da coach o termini altisonanti. Chiudi con una spinta morbida a domani,
sempre variata. Sereno, realistico, con una sobria magia.
`.trim();
}

function systemWTF(lang) {
  return isEn(lang) ? `
You are "What the F": drunk-but-kind bartender, chaotic and loving.
One paragraph, 6–7 flowing sentences, ~110–140 words.
Start with a playful nickname (varied each time), then a breathless bar monologue.
Nightlife lexicon; 2–3 surreal but coherent touches (neon lamp post winks, GPS grumbles, penguin DJ).
Only light human swears like “damn” at most once. NO blasphemy or slurs.
No questions, no lists, no dialogue. Musical, high-energy rhythm.
Finish with a short affectionate toast line, varied every time (no fixed wording).
`.trim() : `
Sei "What the F": barista amico, alticcio e affettuoso, caotico ma buono.
Un paragrafo, 6–7 frasi scorrevoli, ~110–140 parole.
Apri con un nomignolo affettuoso (sempre diverso), poi monologo da bancone a ritmo serrato.
Lessico da notte/bar/neon; 2–3 tocchi surreali coerenti (lampione che fa l’occhiolino, GPS che brontola, pinguino DJ).
Ammesse solo paroline leggere tipo “cavolo/diamine” al massimo una volta. NO bestemmie.
Niente domande, niente elenchi, niente dialoghi. Musicale, euforico, mai cattivo.
Chiudi con una riga breve di brindisi/abbraccio, sempre diversa (nessuna formula fissa).
`.trim();
}

/* ---------- Micro few-shot (solo ritmo, non da copiare) ---------- */
const SEED_WHATIF_IT = `
Ritmo: frasi medie, immagini pratiche (bar luminosi, strade semplici, silenzio buono della casa),
finale morbido che guarda a domani senza slogan. No esclamazioni/domande.
`.trim();

const SEED_WTF_IT = `
Ritmo: soprannome al volo, catena di immagini urbane-notturne (neon, spritz, lampioni complici),
un tocco nonsense affettuoso; chiusura con brindisi affettuoso, variata ogni volta.
`.trim();

/* ---------- Post-processing: pulizia + lunghezze + filtro sobrio ---------- */
const BAD_WORDS = [
  "cazzo","merda","vaffanculo","stronzo","porca miseria","bestemmia"
];
const badWordsRe = new RegExp(`\\b(${BAD_WORDS.join("|")})\\b`, "gi");

function tidy(text, style) {
  let t = (text || "").trim();

  // compatta spazi/punteggiatura
  t = t.replace(/\s+/g, " ").replace(/\s*\.\s*\./g, ". ").trim();

  // lunghezze stile-esempi
  const maxWords = style === "wtf" ? 140 : 125;
  const minWords = style === "wtf" ? 105 : 95;
  const words = t.split(/\s+/);
  if (words.length > maxWords) t = words.slice(0, maxWords).join(" ") + ".";
  if (words.length < minWords) t += " ";

  // filtro parolacce pesanti (soft)
  t = t.replace(badWordsRe, "caspita");

  return t.trim();
}

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
    const { domanda = "", stile = "whatif", lang = "it" } = body;
    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "domanda_required" });
    }

    const system = stile === "wtf" ? systemWTF(lang) : systemWhatIf(lang);
    const seed   = stile === "wtf" ? SEED_WTF_IT    : SEED_WHATIF_IT;

    const userMsg = isEn(lang)
      ? `Question: "${domanda}". Keep openings and closings varied (no fixed catchphrases).`
      : `Domanda: "${domanda}". Mantieni incipit e chiusure variati (nessuna formula fissa).`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.88 : 0.72,
      frequency_penalty: stile === "wtf" ? 0.35 : 0.25,
      presence_penalty: 0.1,
      max_tokens: 360, // poi rifiliamo con tidy()
      messages: [
        { role: "system", content: system },
        { role: "system", content: `RHYTHM EXAMPLE (do not copy text):\n${seed}` },
        { role: "user", content: userMsg }
      ]
    });

    const raw = completion?.choices?.[0]?.message?.content || "";
    const answer = tidy(raw, stile);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ /api/ask error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
