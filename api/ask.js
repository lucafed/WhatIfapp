// ============================
// /api/ask.js — What?f Engine (SHORT & FUN)
// Stili: whatif, wtf  •  IT/EN
// Lunghezze corte tipo demo + tono bloccato
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
const OPENINGS_EN_WHATIF = [
  "I can already see you,", "Yes, you’ll do it quietly:", "You’ll move slowly but sure,", "You start light:", "It’ll go like this,"
];

const NICKS_IT_WTF = [
  "Bravo genio","Campione","Capitano","Fenomeno","Eroe",
  "Astronauta da bar","Sovrano del caos","Principe dello spritz","Regina del bancone"
];
const NICKS_EN_WTF = [
  "You legend","Champ","Captain","Mastermind","Chaos royalty","Bar astronaut"
];

/* ---------- Personas (bloccate e corte) ---------- */
function systemWhatIf(lang){
  return isEn(lang) ? `
You are "What If" — calm, realistic, warm.
Write EXACTLY 6 sentences, ~110–130 words, ONE paragraph, SECOND PERSON only.
Tone: empathetic, grounded, quiet optimism; everyday images (mug, routine, streets, light, sleep, market).
Present/imperfect only. No questions, no exclamations, no lists or dialogue, no coaching clichés.
Avoid grand words (soul/heart/destiny/purpose/dream). End with a soft tomorrow-nudge.
`.trim() : `
Sei "What If" — voce amica, calma e concreta.
Scrivi ESATTAMENTE 6 frasi, ~110–130 parole, UN paragrafo, SOLO SECONDA PERSONA.
Tono: empatico, realistico, ottimismo sobrio; immagini quotidiane (tazza, orari, strada, luce, sonno, mercato).
Solo presente/imperfetto. Niente domande, niente punti esclamativi, niente elenchi/dialoghi, niente frasi da coach.
Evita parole altisonanti (anima/cuore/destino/scopo/sogno). Chiudi con un cenno a “domani”.
`.trim();
}

function systemWTF(lang){
  return isEn(lang) ? `
You are "What the F" — drunk-but-kind bartender, high-energy and funny.
Write EXACTLY 7 long chained sentences, ~120–140 words, ONE paragraph, SECOND PERSON focus.
Start with the provided nickname + comma. Use nightlife/bar lexicon, at least TWO playful absurd images (neon/lamp post winks, penguin DJ, shaker suitcase, etc.).
Use one mild expletive in English (e.g., "damn" or "heck") max once; never blasphemy. No questions, no lists, no dialogue.
End with a short toast to destiny (“a toast with destiny, champ”).
`.trim() : `
Sei "What the F" — barista amico, alticcio e affettuoso, ritmo allegro.
Scrivi ESATTAMENTE 7 frasi concatenate, ~120–140 parole, UN paragrafo, in SECONDA PERSONA.
Inizia con il soprannome fornito + virgola. Usa lessico da bar/notte/neon e inserisci almeno DUE immagini assurde ma coerenti (es. lampione che fa l’occhiolino, GPS che brontola, pinguino DJ).
Concedi UNA sola parolina di sfogo soft (“cavolo” o “diamine”), mai bestemmie e MAI “porca miseria”.
Niente domande/elenco/dialoghi. Chiudi con un brindisi al destino (“brindisi col destino, campione”).
`.trim();
}

/* ---------- Style seeds (mini-àncora) ---------- */
const SEED_IT_WTF = `Bravo genio, prendi la valigia come fosse uno shaker e ci butti dentro vita nuova e calzini spaiati; i bar ti adottano, il lampione fa l’occhiolino, il barista diventa guru al secondo spritz e quando appoggi le chiavi capisci che hai brindato col destino, campione.`;
const SEED_IT_WHATIF = `Ti ci vedo già: poche cose, orari che si sistemano, bar luminosi e strade semplici; il silenzio buono della casa arriva e domani ti accorgerai che la chiamerai casa.`;
const SEED_EN_WTF = `You legend, you shake the suitcase like a cocktail; the bars adopt you, the lamp post winks, the bartender turns guru by the second spritz and when you drop the keys you’ve toasted with fate, champ.`;
const SEED_EN_WHATIF = `I can already see you: a few boxes, simple streets and bright cafés; the house quiet arrives and tomorrow you’ll call it home.`;

/* ---------- Post-processing (accorcia davvero) ---------- */
const BANNED = [/porca\s+miseria/gi];

function hardTrimBySentences(text, targetSentences){
  // split su punto; togli sequenze strane
  let parts = text.replace(/[!?]+/g,".").split(/\.\s+/).map(s=>s.trim()).filter(Boolean);
  if (parts.length > targetSentences) parts = parts.slice(0, targetSentences);
  // se minore, lasciamo così (meglio corto che prolisso)
  return parts.join(". ") + (parts.length ? "." : "");
}

function hardTrimByWords(text, maxWords){
  const w = text.trim().split(/\s+/);
  return (w.length>maxWords) ? (w.slice(0,maxWords).join(" ") + ".") : text;
}

function sanitize(text, {style, lang}){
  let t = (text||"").trim();

  // ban parole
  BANNED.forEach(rx => t = t.replace(rx,""));

  // niente ? o !
  t = t.replace(/[!?]+/g,".");

  // vincoli numerici
  const targetSent = (style==="wtf") ? 7 : 6;
  const maxWords   = (style==="wtf") ? 140 : 130;

  t = hardTrimBySentences(t, targetSent);
  t = hardTrimByWords(t, maxWords);

  // finale WTF: assicurare brindisi
  if (style==="wtf") {
    const toast = isEn(lang) ? " a toast with destiny, champ." : " brindisi col destino, campione.";
    if (!/[Bb]rindisi col destino|toast with destiny/.test(t)) t = t.replace(/\.*$/, ".") + toast;
  }

  // pulizia finale
  t = t.replace(/\s+/g," ").replace(/\s*\.\s*\./g,".").trim();
  return t;
}

/* ---------- Handler ---------- */
export default async function handler(req,res){
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
    if(!domanda || typeof domanda!=="string"){
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
Respect sentence count and length. Second person only. Keep it crisp.`
      : `Domanda: "${domanda}". Contesto: "${String(extra||"").slice(0,300)}".
Inizia con QUESTO incipit (identico, poi continua): "${opening},"
Rispetta numero frasi e lunghezza. Solo seconda persona. Tieni il testo compatto.`;

    const r = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile==="wtf") ? 0.9 : 0.7,
      max_tokens: 360,                 // sufficiente ma non enorme
      frequency_penalty: 0.35,
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
