// ============================
// /api/ask.js — What?f Engine (variazioni naturali, no incipit/ending fissi)
// Stili: whatif, wtf  (IT/EN opzionale, default IT)
// Lunghezze corte come esempi
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Vibe (non verbatim) ---------- */
// Liste usate SOLO come “palette” semantica nelle istruzioni. Non vengono inserite nel testo.
const WHATIF_OPENERS_HINT = [
  "osservazione diretta e intima (es. 'ti ci vedo già', 'vai piano ma deciso')",
  "ancoraggio concreto al quotidiano",
];
const WHATIF_CLOSERS_HINT = [
  "spinta morbida verso domani",
  "presa di coscienza pacata (es. 'ti accorgerai', 'diventa casa')",
];

const WTF_NICK_HINT = [
  "nomignolo affettuoso diverso ogni volta (es. campione, capitano, genio, regina del bancone)",
];
const WTF_CLOSERS_HINT = [
  "chiusura breve da brindisi/abbraccio, varia a ogni risposta (es. 'brindiamo al casino buono', 'alla tua, campione')",
];

/* ---------- Personas (descrittive, senza frasi fisse) ---------- */
function systemWhatIf(lang) {
  return isEn(lang) ? `
You are "What If": calm, close-friend narrator.
One single paragraph, 5–6 sentences, ~95–125 words.
Open with a gentle observational anchor (not a catchphrase), keep it practical and luminous.
Lexicon: everyday, concrete (mug, routine, streets, light, sleep, market). Present/imperf tenses.
No questions, no exclamations, no lists, no coaching clichés, no grand words (soul/heart/destiny).
End with a soft forward nudge for tomorrow, phrased differently each time.
Keep it serene, grounded, slightly magical.
`.trim() : `
Sei "What If": voce amica, calma e concreta.
Un solo paragrafo, 5–6 frasi, ~95–125 parole.
Apri con un’osservazione intima (non una formula fissa), resta pratico e luminoso.
Lessico quotidiano e domestico (tazza, orari, strada, luce, sonno, mercato). Tempi presente/imperfetto.
Niente domande, niente punti esclamativi, niente elenchi, niente frasi da coach o termini altisonanti.
Chiudi con una spinta morbida verso domani, sempre variata.
Sereno, realistico, con una sobria magia.
`.trim();
}

function systemWTF(lang) {
  return isEn(lang) ? `
You are "What the F": drunk-but-kind bartender, chaotic and loving.
One single paragraph, 6–7 flowing sentences, ~110–140 words.
Start with a playful nickname (varied each time), then a breathless bar-monologue.
Nightlife lexicon, light human swears allowed ('damn' max once), NO slurs, NO blasphemy.
Add 2–3 surreal but coherent touches (neon lamp post winks, GPS grumbles, penguin DJ).
No questions, no lists, no dialogue. Musical, high-energy rhythm.
Finish with a short affectionate toast line, varied every time (no fixed wording).
`.trim() : `
Sei "What the F": barista amico, alticcio e affettuoso, caotico ma buono.
Un solo paragrafo, 6–7 frasi scorrevoli, ~110–140 parole.
Apri con un nomignolo affettuoso (sempre diverso), poi monologo da bancone a ritmo serrato.
Lessico da notte/bar/neon; con 2–3 tocchi surreali coerenti (lampione che fa l’occhiolino, GPS che brontola, pinguino DJ).
Ammesse solo paroline leggere tipo “cavolo/diamine” al massimo una volta. NIENTE bestemmie.
Niente domande, niente elenchi, niente dialoghi. Musicale, euforico, mai cattivo.
Chiudi con una riga breve di brindisi/abbraccio, ogni volta diversa (nessuna formula fissa).
`.trim();
}

/* ---------- Micro few-shot (tono, non testo da copiare) ---------- */
const SEED_WHATIF_IT = `
Esempio di ritmo: frasi medie, immagini pratiche (bar luminosi, strade semplici, silenzio buono della casa),
nessuna enfasi retorica; finale morbido che guarda a domani senza slogan.
`.trim();

const SEED_WTF_IT = `
Esempio di ritmo: soprannome al volo, catena di immagini urbane-notturne (neon, spritz, lampioni complici),
un tocco nonsense affettuoso; chiusura con brindisi affettuoso, sempre variato.
`.trim();

/* ---------- Post-processing: solo pulizia/lunghezza (nessuna frase imposta) ---------- */
function tidy(text, style) {
  let t = (text || "").trim();

  // ripulisci spacing/punteggiatura
  t = t.replace(/\s+/g, " ").replace(/\s*\.\s*\./g, ". ").trim();

  // lunghezze
  const maxWords = style === "wtf" ? 140 : 125;
  const minWords = style === "wtf" ? 100 : 90;
  const words = t.split(/\s+/);
  if (words.length > maxWords) t = words.slice(0, maxWords).join(" ") + ".";
  if (words.length < minWords) t += " ";

  // blocca bestemmie o parolacce pesanti (hard filter semplice)
  t = t.replace(/\b(c***o|vaf*****|m***a|d**o)\b/gi, "caspita");

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

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it" } = body;
    if (!domanda) return res.status(400).json({ error: "domanda_required" });

    const system = stile === "wtf" ? systemWTF(lang) : systemWhatIf(lang);
    const seed = stile === "wtf" ? SEED_WTF_IT : SEED_WHATIF_IT;

    // Prompt utente: nessun incipit/ending imposto; solo istruzioni di stile.
    const userMsg = isEn(lang)
      ? `Question: "${domanda}". Keep openings and closings varied (no fixed catchphrases).`
      : `Domanda: "${domanda}". Mantieni incipit e chiusure variati (nessuna formula fissa).`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.88 : 0.72,
      frequency_penalty: stile === "wtf" ? 0.3 : 0.25,
      presence_penalty: 0.1,
      max_tokens: 360, // sufficiente, poi tagliamo noi
      messages: [
        { role: "system", content: system },
        { role: "system", content: `STYLE HINTS:\n${(stile === "wtf" ? WTF_NICK_HINT : WHATIF_OPENERS_HINT).join("\n")}` },
        { role: "system", content: `CLOSING HINTS:\n${(stile === "wtf" ? WTF_CLOSERS_HINT : WHATIF_CLOSERS_HINT).join("\n")}` },
        { role: "system", content: `RHYTHM EXAMPLE (do not copy text, only the cadence):\n${seed}` },
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
