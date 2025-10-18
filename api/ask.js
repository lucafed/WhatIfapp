// ============================
// /api/ask.js — What?f Engine (STYLE-LOCKED, hardened)
// Stili: whatif, wtf  •  IT/EN
// Tono, incipit, frasi e lunghezza forzati + sanificazione output
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/* ---------- Openings/Nicknames ---------- */
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
  "Bravo genio","Campione","Capitano","Fenomeno","Eroe",
  "Astronauta da bar","Sovrano del caos","Principe dello spritz","Regina del bancone"
];
const NICKS_EN_WTF = [
  "You legend","Champ","Captain","Mastermind","Chaos royalty","Bar astronaut"
];

/* ---------- Personas (bloccate) ---------- */
function systemWhatIf(lang){
  return isEn(lang) ? `
You are "What If" — calm, realistic, warm.
Write EXACTLY 8 sentences, ~160–180 words, ONE paragraph, SECOND PERSON only.
Tone: empathetic, grounded, quiet optimism; everyday images (mug, routine, streets, light, sleep, market).
Present/imperfect tenses only. No questions, no exclamations, no lists, no dialogue, no coaching clichés.
Avoid grand words (soul/heart/destiny/purpose/dream). End with a soft forward nudge about tomorrow.
`.trim() : `
Sei "What If" — voce amica, calma e concreta.
Scrivi ESATTAMENTE 8 frasi, ~160–180 parole, UN paragrafo, SOLO SECONDA PERSONA.
Tono: empatico, realistico, ottimismo sobrio; immagini quotidiane (tazza, orari, strada, luce, sonno, mercato).
Solo presente/imperfetto. Niente domande, niente punti esclamativi, niente elenchi o dialoghi, niente frasi da coach.
Evita parole altisonanti (anima/cuore/destino/scopo/sogno). Chiudi con un accenno a “domani”.
`.trim();
}

function systemWTF(lang){
  return isEn(lang) ? `
You are "What the F" — drunk-but-kind bartender.
Write EXACTLY 9 long chained sentences, ~170–190 words, ONE paragraph, SECOND PERSON focus.
Start with the provided nickname + comma. Nightlife/bar lexicon, neon, music, playful mild swearing (“damn/heck”), no blasphemy.
NEVER use the Italian phrase “porca miseria”. No questions, no lists, no dialogue. High-energy, affectionate, surreal-but-coherent.
End with a short toast to destiny (“a toast with destiny, champ”).
`.trim() : `
Sei "What the F" — barista amico, alticcio e affettuoso.
Scrivi ESATTAMENTE 9 frasi lunghe concatenate, ~170–190 parole, UN paragrafo, focalizzate sulla SECONDA PERSONA.
Inizia con il soprannome fornito + virgola. Lessico da bar/notte/neon; parolacce leggere (“cavolo”, “diamine”), MA niente bestemmie
e NON usare mai “porca miseria”. Niente domande/elenco/dialoghi. Energia alta, surreale ma coerente.
Chiudi con un brindisi al destino (“brindisi col destino, campione”).
`.trim();
}

/* ---------- Style seeds (àncore brevi) ---------- */
const SEED_IT_WTF = `Bravo genio, prendi la valigia come fosse uno shaker, ci butti dentro vita nuova e due calzini spaiati; arrivi in città col navigatore che borbotta in dialetto ma i bar ti adottano, il lampione fa l’occhiolino, il barista diventa guru al secondo spritz e quando appoggi le chiavi capisci che hai appena fatto un brindisi col destino, campione.`;
const SEED_IT_WHATIF = `Ti ci vedo già: poche cose, orari che si sistemano, bar luminosi e strade semplici; il silenzio buono della casa ti sorprende e domani ti accorgerai che la chiamerai casa.`;
const SEED_EN_WTF = `You legend, you shake the suitcase like a cocktail, toss in new life and mismatched socks; the bars adopt you, the lamp post winks, the bartender turns guru by the second spritz, and when you drop the keys you’ve just toasted with fate, champ.`;
const SEED_EN_WHATIF = `I can already see you: a few boxes, simple streets and bright cafés; the quiet of the house arrives and tomorrow you’ll call it home.`;

/* ---------- Post-processing: filtri & vincoli ---------- */
const BANNED = [/porca\s+miseria/gi];

function sanitize(text, {style, lang}) {
  let t = (text || "").trim();

  // filtri parole vietate
  BANNED.forEach(rx => t = t.replace(rx, ""));

  // niente ? o !
  t = t.replace(/[!?]+/g, ".");

  // taglia eventuali spazi strani
  t = t.replace(/\s+/g, " ").replace(/\s*\.\s*\./g, ".").trim();

  // vincolo frasi
  const targetSentences = style === "wtf" ? 9 : 8;
  // split “morbido” su punto
  let parts = t.split(/\.\s+/).map(s => s.trim()).filter(Boolean);
  if (parts.length > targetSentences) parts = parts.slice(0, targetSentences);
  if (parts.length < targetSentences) {
    // se corto, non forziamo padding testuale: lasciamo così
  }
  t = parts.join(". ") + (parts.length ? "." : "");

  // range parole (soft trim)
  const words = t.split(/\s+/);
  const maxWords = style === "wtf" ? 190 : 180;
  if (words.length > maxWords) t = words.slice(0, maxWords).join(" ") + ".";

  // finale WTF: brindisi se manca
  if (style === "wtf") {
    const toast = isEn(lang) ? " A toast with destiny, champ." : " Brindisi col destino, campione.";
    if (!/[Bb]rindisi col destino|toast with destiny/.test(t)) t = t.replace(/\.*$/, ".") + toast;
  }

  return t;
}

/* ---------- Handler ---------- */
export default async function handler(req, res){
  // CORS
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", lang="it", extra="" } = body;
    if(!domanda || typeof domanda !== "string"){
      return res.status(400).json({error:"bad_request", detail:"domanda_required"});
    }

    const system = (stile==="wtf") ? systemWTF(lang) : systemWhatIf(lang);
    const opening = (stile==="wtf")
      ? (isEn(lang)? pick(NICKS_EN_WTF) : pick(NICKS_IT_WTF))
      : (isEn(lang)? pick(OPENINGS_EN_WHATIF) : pick(OPENINGS_IT_WHATIF));
    const seed = (stile==="wtf")
      ? (isEn(lang)? SEED_EN_WTF : SEED_IT_WTF)
      : (isEn(lang)? SEED_EN_WHATIF : SEED_IT_WHATIF);

    const userMsg = isEn(lang)
      ? `Question: "${domanda}". Context: "${String(extra||"").slice(0,300)}".
Begin with EXACTLY this opening (keep it verbatim, then continue): "${opening},"
Respect sentence count and length. Second person only.`
      : `Domanda: "${domanda}". Contesto: "${String(extra||"").slice(0,300)}".
Inizia con QUESTO incipit (identico, poi continua): "${opening},"
Rispetta numero frasi e lunghezza. Solo seconda persona.`;

    const r = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile==="wtf") ? 0.86 : 0.72,
      max_tokens: 520,                 // ampio per non tagliare
      frequency_penalty: 0.3,
      presence_penalty: 0.0,
      messages: [
        { role:"system", content: system },
        { role:"system", content: `STYLE SEED:\n${seed}` },
        { role:"user",   content: userMsg }
      ]
    });

    let answer = r?.choices?.[0]?.message?.content || "";
    answer = sanitize(answer, {style:stile, lang});

    return res.status(200).json({ answer: answer.trim(), style: stile, lang });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
