// /api/ask.js — What?f Engine (LOCKED OPENINGS + TOPIC WTF)
// Stili: whatif (analitico | reale) · wtf
// Un paragrafo, seconda persona, niente elenchi, niente nomi inventati.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
function randPick(a){ return a[Math.floor(Math.random()*a.length)]; }
function cap(s){ return s.replace(/(^|\.\s+)([a-zà-ÿ])/g,(_,p,m)=>p+m.toUpperCase()); }
function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; if(p.split(/\s+/).length<=3 && !/[.!?]$/.test(p)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,""); return t;
}

/* ========= Modalità temporale ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en = isEn(lang);
  if(String(periodo).toLowerCase()==="past"){
    return en
      ? "Write as if it already happened (past/conditional allowed)."
      : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en
    ? "Write as a near-future unfolding starting now."
    : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — incipit generico obbligatorio ========= */
const WHATIF_OPENINGS_IT = [
  "Ti avvicini senza fretta e metti in fila i pezzi.",
  "Oggi guardi la cosa da vicino e lasci spazio all’aria.",
  "Fai ordine sul tavolo e provi a vedere chiaro.",
  "Togli rumore, tieni l’essenziale, ascolti il passo."
];
const WHATIF_ANALITICO_STYLE_IT = `WHAT IF Analitico:
- Incipit generico (già fornito dal sistema).
- Tono concreto: routine, costi/benefici, qualità della vita.
- Chiudi con una sintesi calma.
- 135–155 parole. Seconda persona.`;
const WHATIF_REALE_STYLE_IT = `WHAT IF Reale/Poetico:
- Incipit generico (già fornito dal sistema).
- Immagini quotidiane asciutte, respiro narrativo breve.
- Chiudi riconciliando luogo e tempo.
- 135–155 parole. Seconda persona.`;

/* ========= WTF — aperture, sfoghi iperbolici, reazioni per tema ========= */
const WTF_OPENINGS = ["Ah ma guarda te,","Oh, eccoci,","Eccoti qui,","Ah, sì, certo,","Ma figurati,"];
const WTF_ROAST_GENERIC = [
  "sempre convinto che basti l’entusiasmo e due graffette.",
  "col casco delle grandi occasioni e la pazienza in prestito.",
  "con l’ottimismo a manetta e il manuale perso da tempo."
];

const WTF_SFOGHI = [
  "ti parte una bestemmia a sirena che lucida i bicchieri e piega l’aria in diagonale",
  "sganci una bestemmia compressa che rimbalza sulle piastrelle come una biglia impazzita",
  "spingi fuori una bestemmia a turbina che fa ondeggiare i tovaglioli come bandiere bianche",
  "lasci andare una bestemmia corazzata che sfiora i muri e rimette in riga le sedie",
  "ti scappa una bestemmia elastica che si allunga e torna indietro come uno yo-yo stanco",
  "spari una bestemmia a molla che fa saltare i cucchiaini in perfetta coreografia",
  "tiri fuori una bestemmia a pressione che stappa il silenzio come una bottiglia testarda",
  "liberi una bestemmia a grandinata che picchietta sull’aria e convince il ghiaccio a comportarsi bene",
  "sguscia una bestemmia a frusta che sgrana l’aria e mette in fila i pensieri",
  "ti esce una bestemmia a rullo che stende la scena e poi la spiana con garbo criminale"
];

// Reazioni per tema
const REACT_GENERIC = [
  "la lampada sfarfalla in Morse come se volesse offrirti un tutorial",
  "la tapparella si abbassa per imbarazzo e poi risale curiosa",
  "i bicchieri fanno tintinnìo di approvazione da orchestra da camera",
  "la porta automatica si apre da sola e poi si vergogna",
  "Alexa prende nota e archivia sotto ‘momenti educativi’"
];
const REACT_BAR = [
  "la moka ti applaude con un fischio da capocomico",
  "il POS fa finta di aggiornarsi e si mette in modalità timido",
  "il frigorifero sospira e decide di diventare minimalista"
];
const REACT_MOTO = [
  "il semaforo ci pensa e resta rosso per rispetto",
  "il casco scricchiola come se volesse consigliare prudenza",
  "un cane attraversa da solo, deciso a darti ragione"
];
const REACT_LOVE = [
  "la lampada si accende da sola e il bicchiere applaude piano",
  "il gatto valuta il trasloco e poi resta a giudicarti con affetto",
  "il telefono vibra a vuoto come un attore che dimentica la battuta"
];

function detectTopic(q=""){
  const s = String(q).toLowerCase();
  if (/(bar|caff|locale|bancone|moka)/i.test(s)) return "bar";
  if (/(moto|motorin|casco|centauro)/i.test(s)) return "moto";
  if (/(innam|amore|fidanz|relaz|cuore)/i.test(s)) return "love";
  return "generic";
}
function roastForTopic(topic){
  if (topic==="bar") return "barista di vocazione e contabile per necessità, con il sorriso da apertura e il registratore in modalità speranza.";
  if (topic==="moto") return "centauro improvvisato con l’ego a folle e il battito in accelerazione controllata.";
  if (topic==="love") return "specialista del tuffo senza acqua, con l’orgoglio che trattiene il fiato e il cuore che fa turni extra.";
  return randPick(WTF_ROAST_GENERIC);
}
function reactionsForTopic(topic){
  if (topic==="bar") return [...REACT_BAR, ...REACT_GENERIC];
  if (topic==="moto") return [...REACT_MOTO, ...REACT_GENERIC];
  if (topic==="love") return [...REACT_LOVE, ...REACT_GENERIC];
  return REACT_GENERIC;
}

function forceWtfParagraph(core, domanda){
  const topic = detectTopic(domanda);
  const open = randPick(WTF_OPENINGS);
  const roast = roastForTopic(topic);
  const sfogo = randPick(WTF_SFOGHI);
  const reacts = reactionsForTopic(topic);
  let r1 = randPick(reacts), r2 = randPick(reacts), guard=0;
  while(r2===r1 && guard++<5) r2 = randPick(reacts);

  // prendi 1–2 frasi “di contenuto” dal core
  const parts = String(core||"").split(/(?<=[.!?])\s+/).filter(Boolean);
  const content = parts.slice(-2).join(" ");

  let out = `${open} ${roast} ${sfogo}. ${r1}, ${r2}. ` +
            `Bevi un sorso corto e onesto, che riposiziona i pensieri senza chiedere permesso. ` +
            (content ? content + " " : "") +
            `Morale: se il caos non si educa, gli offri da bere e si comporta meglio.`;

  out = normalizeOneParagraph(out);
  out = tightenSentences(out, 9);
  out = clampWords(out, 165);
  if(!/[.!?…]$/.test(out)) out+=".";
  // garantisci la parola “bestemmia”
  if(!/bestemmi\w*/i.test(out)){
    out = out.replace(/Morale:/, "Ti scappa pure un’ultima bestemmia sottovoce e nessuno fa finta di niente. Morale:");
  }
  return cap(out);
}

/* ========= What If guide ========= */
const WHATIF_RULES_IT = `WHAT IF — un paragrafo, seconda persona, 135–155 parole.
- Segui l’incipit generico dato dal sistema.
- Analitico: concreto, routine, costi/benefici. Reale: immagini quotidiane asciutte.
- Nessuna domanda/elenco/nomi inventati.
- Chiudi con riga breve, riflessiva, non un consiglio.`;

/* ========= WTF — few-shots con i TUOI esempi per tono ========= */
const WTF_FEWSHOTS_IT = [
  { role:"system", content:
`ESEMPIO WTF • Bar
Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi il primo cliente pretende un “latte tiepido che non sa di latte”. Ti parte una bestemmia a sirena che lucida i bicchieri e piega l’aria in diagonale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta giura che al confessionale ti tengono in lista. Bevi un goccio per abbassare il volume del cervello e giuri che domani apri solo per professionisti del caos. Alla chiusura ridi: oggi hai bestemmiato più della pazienza, ma hai servito verità calde.` },
  { role:"system", content:
`ESEMPIO WTF • Moto
Oh, eccoci, centauro con l’ansia lucidata. Casco nuovo, ego in folle, aria di rivincita. Parti e un’ape decide che il tuo collo è mitologico. Esce un bestemmione che spacca l’aria, il semaforo cambia umore e un cane attraversa da solo per rispetto. Al bar lavi via la bestemmia con un doppio, complicità senza verbale. Torni a casa con l’eco del motore e la tua voce, fuse in una sinfonia che ti sta bene addosso.` },
  { role:"system", content:
`ESEMPIO WTF • Innamorarsi
Eccoti qui, specialista del tuffo senza acqua. Lui ti visualizza e scappa, e il sangue sale come un ascensore arrabbiato. Parte una bestemmia della miseria che accende la lampada e fa applaudire il bicchiere; il gatto valuta il trasloco e Alexa si mette in aggiornamento spirituale. Bevi un sorso di rosso e ti rimetti a fuoco: l’amore lo impari a colpi di scena. Alla fine ridi, bestemmi piano come fosse stretching, e la notte annuisce: domani ricominci meglio.` },
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode }){
  const msgs = [
    { role: "system", content: isEn(lang)
        ? `RULES: one paragraph, no bullets, no emojis, do NOT restate the question. Near-future. Second person only. No invented names. Length: WHATIF 135–155, WTF 145–165.`
        : `REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Prossimo futuro. Solo seconda persona. Niente nomi inventati. Lunghezza: WHATIF 135–155, WTF 145–165.` },
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  if (stile === "wtf") {
    msgs.push(
      { role: "system", content: `WHAT THE F — tono rude, ironico, adulto. Usa “bestemmia/bestemmione/bestemmie” come parola fisica e comica, senza riferimenti religiosi.` },
      ...WTF_FEWSHOTS_IT
    );
  } else {
    msgs.push({ role: "system", content: WHATIF_RULES_IT });
    msgs.push({ role: "system", content: mode==="analitico" ? WHATIF_ANALITICO_STYLE_IT : WHATIF_REALE_STYLE_IT });
    // Forzo l’incipit generico come prima frase
    msgs.push({ role: "system", content: `INIZIO OBBLIGATORIO: "${randPick(WHATIF_OPENINGS_IT)}"` });
  }

  msgs.push({
    role: "user",
    content: `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ${lang.toUpperCase()} a paragrafo unico.`
  });
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      mode  = "reale",    // per whatif: "analitico" | "reale"
      lang  = "it",
      periodo = "future"
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, mode });

    const completion = await client.chat.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.7 : 0.82,
      top_p: 0.9,
      max_tokens: 480,
      frequency_penalty: 0.15,
      presence_penalty: 0.05,
      messages,
    });

    let core = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!core) throw new Error("empty_model_response");

    // Pulizia base
    core = stripQuestionEcho(domanda, core);
    core = normalizeOneParagraph(core);

    let answer;
    if (stile === "wtf") {
      answer = forceWtfParagraph(core, domanda);
    } else {
      answer = tightenSentences(core, 11);
      answer = clampWords(answer, 155);
      if(!/[.!?…]$/.test(answer)) answer += ".";
      // garantisci l'incipit generico in prima frase (se il modello l'ha ignorato)
      const inc = WHATIF_OPENINGS_IT.find(op => answer.toLowerCase().startsWith(op.toLowerCase()));
      if(!inc){
        answer = `${randPick(WHATIF_OPENINGS_IT)} ${answer}`;
      }
      answer = cap(answer);
    }

    // Guard-rail: niente prima persona
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, "");

    // Guard-rail nomi non presenti nella domanda
    (function(){
      const d = String(domanda||"");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion = new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m)=>{
        return inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai","Ma","Eccoti"].includes(m) ? m : m.toLowerCase());
      });
    })();

    return res.status(200).json({ answer, style: stile, mode, lang, periodo, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
