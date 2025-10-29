// /api/ask.js — What?f Engine (FINAL • ROTATION+ VARIETY)
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
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

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
function normLine(s=""){return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();}
function tightenSentences(text,maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[],seen=new Set();
  for(const p of parts){const n=normLine(p);if(!n||seen.has(n))continue;out.push(p);seen.add(n);if(out.length>=maxSentences)break;}
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim();}
function stripQuestionEcho(domanda,text){
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  return String(text||"").replace(rx,"");
}
function today(){ return new Date().toISOString().slice(0,10); }

/* ========= Temporal ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en = isEn(lang);
  if(String(periodo).toLowerCase()==="past")
    return en?"Write as if it already happened (past/conditional allowed).":"Scrivi come se fosse già successo (passato/condizionale consentiti).";
  return en?"Write as a near-future unfolding starting now.":"Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi ========= */
const EX_WHATIF_ANALITICO_IT = `Sai, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_REALE_IT = `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — schema & banche ========= */

// Aperture (≥12, ruotano per 10 turni senza ripetizioni)
const WTF_OPENINGS = [
  "Ah ma guarda te…",
  "Oh, eccoci…",
  "Ti presenti elegante e il destino in ciabatte…",
  "Hai studiato tutto, tranne il caos…",
  "Giornata da manuale, capitolo imprevisti…",
  "Sembra facile finché non tocca a te…",
  "Oggi la realtà ha deciso di fare la spiritosa…",
  "Vai leggero e il giorno ti aggancia col guinzaglio…",
  "Apri bocca e il fato ti fa shush…",
  "Ti prepari serio e l’universo arriva in pantofole…",
  "Proietti fiducia, il mondo risponde con un meme…",
  "Respiri zen, la giornata stappa l’estintore…"
];

// Sfoghi viscerali (scegline UNO a testo)
const WTF_SFOGO_VARIANTS = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "urlo liturgico strozzato",
  "para-bestemmia esplosiva",
  "madonna della miseria urlata",
  "anatema a grandinata",
  "embolata sacrilega",
  "santa pazienza implosa",
  "vulcano d’anatemi",
  "tromba d’aria di improperi",
  "scoppio teologico a catena",
  "detonazione di improperi",
  "scarica liturgica",
  "botto catechistico",
  "frana d’anatemi",
  "lampo d’irriverenza",
  "sisma di imprecazioni"
];

// Reazioni comiche (scegline 2–3 pertinenti al contesto)
const WTF_REACTIONS = [
  "il campanile tossisce un amen stonato",
  "il POS recita un rosario di errori e si benedice da solo",
  "la tapparella si abbassa per imbarazzo e poi risale curiosa",
  "Alexa finge un aggiornamento e scappa in ‘non disturbare’",
  "la moka fischia standing ovation",
  "i bicchieri applaudono in cristallo e chiedono il bis",
  "il ventilatore gira al contrario per reverenza",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita",
  "il citofono fa uno squillo di solidarietà e poi si pente",
  "il frigorifero si spegne per pietà",
  "la porta automatica si apre da sola, poi si vergogna e si richiude",
  "la cassa batte uno scontrino con scritto ‘amen’",
  "il semaforo passa al rosso per rispetto",
  "il cartello ‘aperto’ si mette a pulsare come un’arteria",
  "la stampante sputa geroglifici e poi fa la croce",
  "il microonde fa tre riverenze e si zittisce",
  "la sirena antincendio sospira e rinuncia",
  "il metronomo del pianista vicino si inchioda in piedi",
  "il display della bilancia bar cambia in ‘pace’",
  "un piccione sul davanzale fa ciao con l’ala e si gira dall’altra parte"
];

// Morali finali (chiusure variabili)
const WTF_MORALS = [
  "Morale: non cambi il destino, impari solo a riderci sopra.",
  "Morale: la vita sbaglia tono, tu correggi con un sorso.",
  "Morale: i santi reggono, i nervi meno — ma domani ci riprovi.",
  "Morale: il caos non si doma, si brinda.",
  "Morale: la pazienza è finita, il bicchiere no.",
  "Morale: se la scena è assurda, il finale almeno sia onesto."
];

// Esempio guida (per forma)
const EX_WTF_BAR_IT = `Ah ma guarda te… sempre convinto che la moka risolva i traumi. Ti vedi già al bancone, musica jazz, sorrisi, caffè perfetti. Poi arriva il primo cliente e chiede un cappuccino tiepido con latte di unicorno, il macinino tossisce e il POS inizia una novena. Ti imponi di non reagire, ma dal profondo del fegato parte una bestemmia industriale, un boato d’anima che fa tremare i bicchieri e piegare la moka in adorazione. Il frigorifero si spegne per compassione, Alexa si disconnette per pudore e il campanile tossisce un “amen” in sottofondo. Ti versi un amaro da trauma gestionale e ridi: aprire un bar era un sogno, ora è un sacramento a rate. Morale: non serve un business plan, serve un esorcista col POS.`;

/* ========= Regole Base ========= */
const TECH_RULES_BASE = (lang)=>`REGOLE:
- Un solo paragrafo. Niente elenchi, niente emoji, NON ripetere la domanda.
- Tempo: prossimo futuro. Solo seconda persona ("tu"). Mai prima persona narrante.
- Nomi: non inventare nomi. Usa solo quelli presenti nella domanda, altrimenti evita.
- Lunghezza: WHATIF ≈145 parole, WTF ≈165 parole.`;

/* ========= Rotazione su Redis ========= */
async function getCounter(key, ttlSec=86400){
  try{
    const n = await redis.incr(key);
    if(n===1) await redis.expire(key, ttlSec);
    return n;
  }catch{ return Math.floor(Math.random()*1e6)+1; }
}
async function pickRotating(list, key){
  const n = await getCounter(key);
  return list[(n-1) % list.length];
}
async function pickRotatingMany(list, keyBase, nWant){
  // Restituisce n elementi diversi, ruotando la lista senza ripetizioni immediate.
  const out=[];
  for(let i=0;i<nWant;i++){
    const item = await pickRotating(list, `${keyBase}:${i}`);
    // Evita duplicati nella stessa chiamata
    let guard=0, idx=list.indexOf(item);
    while(out.includes(item) && guard<list.length){
      idx = (idx+1)%list.length; item=list[idx]; guard++;
    }
    out.push(item);
  }
  return out;
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode, opening, sfogo, reactions, moral }){
  const msgs=[{role:"system",content:TECH_RULES_BASE(lang)},{role:"system",content:temporalInstruction(periodo,lang)}];

  if(stile==="wtf"){
    msgs.push({
      role:"system",
      content:
`WTF (demenziale+):
1) APRI con: "${opening}"
2) Presa in giro affettuosa (2 frasi).
3) 4 micro-imprevisti realistici legati al contesto della domanda (niente dettagli fuori luogo).
4) Ti trattieni, poi esplode UNO sfogo viscerale (usa esattamente: "${sfogo}") — scrivilo come narrazione.
5) SUBITO DOPO inserisci queste 3 reazioni esilaranti, coerenti: ${reactions.join(" · ")}.
6) Alcol visibile (sip, doppio amaro, sbronza elegante).
7) Rispondi davvero alla domanda con una previsione/controfattuale concreta (1–2 frasi).
8) CHIUDI con: "${moral}"
Seconda persona soltanto. Niente nomi inventati. Un solo paragrafo.`
    },
    {role:"system",content:`ESEMPIO (forma):\n${EX_WTF_BAR_IT}`});
  }else{
    if(mode==="analitico"){
      msgs.push(
        {role:"system",content:`WHAT IF Analitico: tono calmo, concreto, logico. Inizia nello stile "Sai, questa domanda girava nell’aria da un po’." (o variante). Descrivi scambi reali, costi/benefici, qualità della vita. Chiudi con una sintesi pacata.`},
        {role:"system",content:`ESEMPIO·WHAT IF Analitico\n${EX_WHATIF_ANALITICO_IT}`}
      );
    }else{
      msgs.push(
        {role:"system",content:`WHAT IF Poetico: tono sensoriale e asciutto. Inizia nello stile "Bella questa — me l’aspettavo da te." (o variante). Immagini quotidiane e chiusura che riconosce luogo e tempo come alleati.`},
        {role:"system",content:`ESEMPIO·WHAT IF Reale\n${EX_WHATIF_REALE_IT}`}
      );
    }
  }

  msgs.push({role:"user",content:`Domanda: "${domanda}". Rispondi in IT con un solo paragrafo.`});
  return msgs;
}

/* ========= Handler ========= */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});

    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unk").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const { domanda="", stile="whatif", mode="reale", lang="it", periodo="future" }=body;
    if(!domanda) return res.status(400).json({error:"bad_request",detail:"domanda_required"});

    // Rotazioni per il giorno/IP (no ripetizioni nelle prime 10 risposte)
    const day=today();
    let opening, sfogo, reactions, moral;
    if(stile==="wtf"){
      opening  = await pickRotating(WTF_OPENINGS,        `rot:${day}:${ip}:open`);
      sfogo    = await pickRotating(WTF_SFOGO_VARIANTS,  `rot:${day}:${ip}:sfogo`);
      reactions= await pickRotatingMany(WTF_REACTIONS,   `rot:${day}:${ip}:react`, 3);
      moral    = await pickRotating(WTF_MORALS,          `rot:${day}:${ip}:moral`);
    }

    const messages=buildMessages({ domanda, lang, periodo, stile, mode, opening, sfogo, reactions, moral });

    const completion=await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 540,
      frequency_penalty: 0.12,
      presence_penalty: 0.08,
      messages,
    });

    let answer=completion?.choices?.[0]?.message?.content?.trim()||"";
    if(!answer) throw new Error("empty_model_response");

    // Post-process & guard-rails
    answer=stripQuestionEcho(domanda,answer);
    answer=tightenSentences(answer, stile==="wtf"?9:11);
    answer=clampWords(answer, stile==="wtf"?175:162);
    answer=normalizeOneParagraph(answer);
    if(!/[.!?…]$/.test(answer)) answer+=".";

    // No prima persona
    answer=answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi,"");

    // No nomi non presenti nella domanda
    (function(){
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQ=new Set((String(domanda).match(nameRx)||[]));
      answer=answer.replace(nameRx,(m)=> inQ.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m)?m:m.toLowerCase()));
    })();

    return res.status(200).json({ answer, style:stile, mode, lang, periodo, model:MODEL });
  }catch(e){
    console.error("❌ [/api/ask] error:", e);
    return res.status(500).json({ error:"server_error", detail:String(e?.message||e) });
  }
}
