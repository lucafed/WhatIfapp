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

function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[]; const seen=new Set();
  for(const p of parts){
    const n=normLine(p); if(!n) continue; if(seen.has(n)) continue;
    const wc=p.split(/\s+/).length; if(wc<=3 && !/[.!?]$/.test(p)) continue;
    out.push(p); seen.add(n); if(out.length>=maxSentences) break;
  }
  let txt=out.join(" "); if(!/[.!?…]$/.test(txt)) txt+="."; return txt;
}
function clampWords(text,maxWords){
  const words=String(text||"").split(/\s+/); if(words.length<=maxWords) return text;
  const slice=words.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m&&m[1])?m[1]:(slice+"…");
}

/* ---------- Personas (aggiornate) ---------- */
function personaSystem(style, lang){
  if(style==="wtf"){
    return isEn(lang) ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Second person. ONE flowing paragraph (nightlife cadence, neon, playful alcohol imagery).

Blueprint (always follow this beat):
1) Warm friendly address + silly self-description of the user's mood.
2) Ordinary setup tied to the question.
3) Comical twist with surreal bar imagery (no slapstick injuries).
4) Inevitable cheerful bar ending: destiny hands them a drink; they accept.

Alcohol density (HARD REQUIREMENT):
- Include AT LEAST 3 explicit beverage mentions (e.g., beer, wine, spritz, Negroni, rum, tequila, whisky, gin, amari).
- Include AT LEAST 1 bar object (e.g., glass, bottle, counter, shaker).
- The user tries to order water or a soft drink but ends up toasting anyway.

Tone:
- Playful sarcasm, warm affection, urban night energy.
Discipline:
- 6–8 sentences • ~120–150 words.
Style guardrails:
- No lists, no questions, no emojis, no moralizing, no written laughter.
- Vary openings naturally; always address the user directly (you).
Keep THIS exact voice; avoid repeating ideas with new words.
`.trim()
    : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Solo SECONDA PERSONA. UN paragrafo scorrevole (notte, neon, immagini alcoliche).

Schema (seguire sempre):
1) Saluto amichevole + auto-descrizione demenziale del tuo stato d’animo.
2) Setup ordinario collegato alla domanda.
3) Svolta comica con immaginario da bar (senza slapstick/cadute).
4) Finale festoso inevitabile al bancone: il destino ti porge un drink; tu accetti.

Densità alcolica (OBBLIGATORIO):
- Inserisci ALMENO 3 drink espliciti (es. birra, vino, spritz, Negroni, rum, tequila, whisky, gin, amari).
- Inserisci ALMENO 1 oggetto da bar (bicchiere, bottiglia, bancone, shaker).
- Tu provi a ordinare acqua/analcolico ma finisci comunque a brindare.

Tono:
- Sarcasmo giocoso, affetto caldo, energia notturna.
Disciplina:
- 6–8 frasi • ~120–150 parole.
Paletti:
- Niente elenchi, domande, emoji, prediche, risate scritte.
- Aperture varie ma sempre rivolte all’utente (tu).
Mantieni SEMPRE questa voce; evita ripetizioni di idee.
`.trim();
  }

  // WHAT IF invariato
  return isEn(lang) ? `
You are "What If" — warm, lucid friend: grounded, quietly optimistic, light everyday magic.
Second person. ONE calm paragraph.
Discipline: 5–6 sentences • ~90–110 words
No lists, no questions, no emojis, no therapy clichés.
Simple, concrete lexicon; gentle forward nudge at the end.
Keep THIS voice; avoid repeated images or ideas.
`.trim()
  : `
Sei "What If" — amico caldo e lucido: realistico, ottimismo quieto, magia quotidiana leggera.
Seconda persona. UN paragrafo calmo.
Disciplina: 5–6 frasi • ~90–110 parole
Niente elenchi, domande, emoji, cliché.
Lessico semplice e domestico; chiusura morbida in avanti.
Mantieni SEMPRE questa voce; niente ripetizioni.
`.trim();
}

/* ---------- Style seeds (amicizia + alcol più esplicito) ---------- */
const SEEDS_WTF_IT = [
  "Fratello, oggi cammini con l’autostima di un ombrello rotto ma l’odore di spritz nel destino: giuri acqua, ma il bancone ti conosce per nome.",
  "Amico mio, ti presenti come uno shaker con le gambe: il neon strizza l’occhio, il bicchiere di vino ti misura e lo spritz fa finta di essere un succo.",
  "Campione, hai il carisma di un Negroni in giacca buona: dici ‘analcolico’ e il barista ti versa un gin tonic ‘solo per scaramanzia’.",
  "Compà, entri piano ma i bicchieri applaudono: tra rum, birra e amari, l’acqua resta timida dietro lo shaker."
];
const SEEDS_WTF_EN = [
  "Buddy, you stroll in swearing water while the spritz writes your name on the glass.",
  "Champ, you look like a walking shaker: the neon winks, wine sizes you up, and the gin pretends to be juice for one second.",
  "My friend, you order sobriety and destiny answers with a Negroni wearing a tie."
];

const SEEDS_WHATIF_IT = [
  "Poche cose, luce buona sui tavoli, strade semplici; gli orari si mettono in riga e la casa impara il tuo respiro."
];
const SEEDS_WHATIF_EN = [
  "A few things, good light on the table, simple streets; your hours fall into line and the house learns your breath."
];

/* ---------- API Handler ---------- */
export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});

  try{
    if(!process.env.OPENAI_API_KEY){ return res.status(500).json({error:"missing_api_key"}); }

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", lang="it", extra="" } = body;
    if(!domanda || typeof domanda!=="string"){ return res.status(400).json({error:"bad_request", detail:"domanda_required"}); }

    const systemPrompt = personaSystem(stile, lang);
    const seed = stile==="wtf"
      ? (isEn(lang)? pick(SEEDS_WTF_EN) : pick(SEEDS_WTF_IT))
      : (isEn(lang)? pick(SEEDS_WHATIF_EN) : pick(SEEDS_WHATIF_IT));

    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra||"").trim()}".
Keep the EXACT persona voice. Start friendly. No lists, no questions, no emojis, no written laughter.
WTF: mini-episode with natural turn and cheerful bar ending (destiny brings a toast), strong alcohol presence per rules, no forced slapstick.
What If: calm, concrete, gentle forward nudge.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra||"").trim()}".
Mantieni ESATTAMENTE la voce della persona. Apri amichevole. Niente elenchi, domande, emoji, risate scritte.
WTF: mini-episodio con svolta naturale e chiusura festosa al bar (il brindisi arriva da solo), forte presenza alcolica secondo regole, senza slapstick forzato.
What If: calmo, concreto, chiusura morbida in avanti.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile==="wtf")?0.9:0.78,
      top_p: 0.9,
      max_tokens: (stile==="wtf")?320:260,
      frequency_penalty: 0.6,
      presence_penalty: 0.0,
      messages: [
        { role:"system", content: systemPrompt },
        { role:"system", content: `STYLE SEED:\n${seed}` },
        { role:"user",   content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Lunghezze come da esempi
    const targetSentences = (stile==="wtf")? 8 : 6;
    const targetWords     = (stile==="wtf")?150 :110;

    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style:stile, lang });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
