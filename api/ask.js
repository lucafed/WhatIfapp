// ============================
// /api/ask.js — What?f Engine (tone locked to your examples)
// Stili: whatif, wtf  •  IT/EN
// Risposte corte, ritmo e lessico fissati; incipit/nickname obbligatori
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/* ---------- Openings / Nicknames ---------- */
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
  "Maledetto romantico","Astronauta da bar","Sovrano del caos",
  "Principe dello spritz","Regina del bancone"
];
const NICKS_EN_WTF = [
  "You legend","Champ","Captain","Mastermind","Chaos royalty","Bar astronaut"
];

/* ---------- Your reference examples (few-shot anchors) ---------- */
// WHAT IF — IT (tua versione)
const SAMPLE_WHATIF_IT = `Ti ci vedo già: pochi scatoloni, le cose giuste, il resto lo lasci senza sensi di colpa. Ti muovi piano ma deciso, come quando sai che il posto nuovo ti farà respirare meglio. Le prime settimane scegli bar luminosi, strade semplici, volti gentili; ti sistemi gli orari e il sonno si mette in riga. Un pomeriggio rientri e ti stupisce il silenzio buono della casa, quel suono di “ci sto riuscendo”. Piccoli rituali: la tazza preferita, il mercato del sabato, un percorso che diventa tuo senza fatica. La nostalgia passa in onde sempre più basse, l’abitudine fa il suo lavoro. Continui così, senza fretta, e domani ti accorgerai che chiamerai “casa” anche questo quartiere.`;

// WTF — IT (tua versione)
const SAMPLE_WTF_IT = `Bravo genio, prendi la valigia come fosse un cocktail shaker e ci butti dentro vita nuova, due calzini spaiati e un paio di idee marce che sanno di miracolo; arrivi in città con l’ansia che balla il twist e il navigatore che bestemmia in dialetto, ma la musica dei bar ti adotta prima ancora dell’affitto, il primo aperitivo ti chiama per nome anche se non lo hai detto, il lampione fuori casa ti fa l’occhiolino come un compare di sbronze, il barista diventa consulente spirituale dopo il secondo spritz, firmi mentalmente un patto con il marciapiede che non scivola e con il forno che sa di abbraccio, poi rientri tardi, appoggi le chiavi, guardi il neon dalla finestra e capisci che hai appena fatto un brindisi con il destino, campione.`;

/* ---------- Persona contracts (rigid) ---------- */
function systemWhatIf(lang){
  return isEn(lang) ? `
You are "What If" — calm, grounded friend.
FORMAT:
- ONE paragraph only
- 5–7 medium sentences (~90–120 words)
TONE & LEXICON:
- Empathetic, realistic, quietly energetic; everyday concrete nouns (mug, routine, streets, light, sleep, market)
- Present/imperf tenses; many coordinations; smooth flow
- NO questions, NO exclamations, NO lists, NO dialogue, NO coaching clichés
BANNED WORDS (any form): imagine, perhaps, might, dream, destiny, magic, soul, heart
CLOSE:
- End with a soft forward nudge (often “tomorrow/you’ll notice”)
`.trim() : `
Sei "What If" — amico calmo e concreto.
FORMATO:
- Un solo paragrafo
- 5–7 frasi medie (~90–120 parole)
TONO & LESSICO:
- Empatico, realistico, con energia sobria; sostantivi quotidiani (tazza, orari, strada, luce, sonno, mercato)
- Tempi presente/imperfetto; molte coordinate; scorrimento fluido
- Vietati: domande, punti esclamativi, elenchi, dialoghi, frasi da coach
PAROLE VIETATE (qualsiasi forma): immagina, forse, potresti/potrebbe, sogno, destino, magia, anima, cuore
CHIUSURA:
- Spinta morbida verso domani (“domani ti accorgerai…”, ecc.)
`.trim();
}

function systemWTF(lang){
  return isEn(lang) ? `
You are "What the F" — tipsy-but-kind bartender, chaotic and loving.
FORMAT:
- ONE paragraph only
- 6–8 long flowing sentences (~110–140 words)
OPENING:
- Must start with a bold nickname (provided) + comma — nothing before it
TONALITY:
- Nightlife/bar lexicon, neon city, cheeky euphoria, 1–2 mild swears (e.g., “damn”, “hell”)
- Surreal but coherent touches; never cruel
- NO questions, NO lists, NO dialogue
BANNED WORDS: imagine, perhaps, dream, destiny, poetry
CLOSE:
- Short toast/affection finale
`.trim() : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
FORMATO:
- Un solo paragrafo
- 6–8 frasi lunghe e concatenate (~110–140 parole)
INCIPIT:
- Inizia con soprannome (fornito) + virgola — niente prima
TONO:
- Lessico da notte/bar/neon, 1–2 parolacce leggere (“cavolo”, “porca miseria”), tocchi surreali ma coerenti; mai cattivo
- Vietati: domande, elenchi, dialoghi
PAROLE VIETATE: immagina, forse, sogno, destino, poesia
CHIUSURA:
- Brindisi/abbraccio breve
`.trim();
}

/* ---------- Post-processing: enforce paragraph & length ---------- */
function clean(text){
  if(!text) return "";
  // una sola riga/paragrafo
  let t = text.replace(/\s+\n+\s*/g, " ").replace(/\s{2,}/g," ").trim();
  // niente doppie intro da modello
  t = t.replace(/^["“”]+|["“”]+$/g, "");
  return t;
}

function limitSentences(text, min, max){
  const sentences = text.split(/(?<=[\.\!\?])\s+/).filter(s=>s.trim().length);
  if(sentences.length > max) return sentences.slice(0, max).join(" ");
  if(sentences.length < min) return text; // non aggiungiamo nulla, solo evitiamo di tagliare
  return text;
}

function scrubBanned(text, list){
  const re = new RegExp(`\\b(${list.join("|")})\\b`, "gi");
  return text.replace(re, "").replace(/\s{2,}/g," ").trim();
}

/* ---------- Handler ---------- */
export default async function handler(req, res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", lang="it", extra="" } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({error:"bad_request", detail:"domanda_required"});

    const system = (stile==="wtf") ? systemWTF(lang) : systemWhatIf(lang);
    const opening = (stile==="wtf")
      ? (isEn(lang) ? pick(NICKS_EN_WTF) : pick(NICKS_IT_WTF))
      : (isEn(lang) ? pick(OPENINGS_EN_WHATIF) : pick(OPENINGS_IT_WHATIF));

    // Few-shot: ancoriamo col TUO stile esatto
    const shots = [];
    if(!isEn(lang)){
      if(stile==="whatif"){
        shots.push({ role:"user", content:'Esempio di stile "What If" (non rispondere, usalo come riferimento).' });
        shots.push({ role:"assistant", content: SAMPLE_WHATIF_IT });
      } else {
        shots.push({ role:"user", content:'Esempio di stile "What the F" (non rispondere, usalo come riferimento).' });
        shots.push({ role:"assistant", content: SAMPLE_WTF_IT });
      }
    }

    const userMsg = isEn(lang)
      ? `Question: "${domanda}". Optional context: "${String(extra||"").slice(0,300)}".
Begin with EXACTLY this opening (verbatim, then continue): "${opening},"
Do not write anything before the opening. Follow the style contract strictly.`
      : `Domanda: "${domanda}". Contesto opzionale: "${String(extra||"").slice(0,300)}".
Inizia con QUESTO incipit (identico, poi continua): "${opening},"
Non scrivere nulla prima dell'incipit. Rispetta il contratto di stile in modo rigido.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile==="wtf") ? 0.85 : 0.65,
      max_tokens: 170, // lunghezza target (100–140 parole circa)
      frequency_penalty: 0.35,
      presence_penalty: 0.0,
      messages: [
        { role:"system", content: system },
        // ancora stile
        ...shots,
        { role:"user", content: userMsg }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content || "";
    answer = clean(answer);

    // enforcement finale
    if(stile==="whatif"){
      answer = scrubBanned(answer, ["immagina","forse","potresti","potrebbe","sogno","destino","magia","anima","cuore"]);
      answer = limitSentences(answer, 5, 7);
    }else{
      answer = scrubBanned(answer, ["immagina","forse","sogno","destino","poesia"]);
      answer = limitSentences(answer, 6, 8);
    }

    if(!answer) throw new Error("empty_model_response");
    return res.status(200).json({ answer: answer.trim(), style: stile, lang });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
