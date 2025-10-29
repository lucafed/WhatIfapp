// /api/ask.js — What?f Engine (FINAL EXPLOSIVE EDITION)
// Basata sulla tua FINAL BALANCED EDITION + potenziamento comicità WTF
// Stili: whatif (analitico | reale) · wtf
// Regole invarianti: un solo paragrafo, seconda persona, niente elenchi, niente nomi inventati
// Rate & Redis invariati

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
function normLine(s=""){return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();}
function tightenSentences(text,maxSentences){const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);const out=[],seen=new Set();for(const p of parts){const n=normLine(p);if(!n||seen.has(n))continue;out.push(p);seen.add(n);if(out.length>=maxSentences)break;}let t=out.join(" ");if(!/[.!?…]$/.test(t))t+=".";return t;}
function clampWords(text,maxWords){const w=String(text||"").split(/\s+/);if(w.length<=maxWords)return text;const slice=w.slice(0,maxWords).join(" ");const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);return m?m[1]:slice+"…";}
function normalizeOneParagraph(s=""){return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim();}
function stripQuestionEcho(domanda,text){const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();let t=String(text||"");const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;t=t.replace(rx,"");return t;}

/* ========= Modalità temporale ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en = isEn(lang);
  if(periodo==="past")return en?"Write as if it already happened.":"Scrivi come se fosse già successo.";
  return en?"Write as a near-future unfolding.":"Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi ========= */
const EX_WHATIF_ANALITICO_IT = `Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere.`;
const EX_WHATIF_REALE_IT = `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni.`;

/* ========= WTF — esempi ========= */
const EX_WTF_MOTO_IT = `Ah ma guarda te… ti convinci che la moto sia la cura definitiva contro la noia. I primi metri sembrano un film, poi il copione cambia: casco che appanna, giacca che s’incolla, GPS che ti manda in una rotonda infinita e un piccione che ti elegge pista d’atterraggio. Ti esplode un bestemmione corazzato che fa tremare le vetrine e interrompe la messa delle 18. Il semaforo passa al rosso per rispetto, i bicchieri applaudono sullo scaffale, e Alexa si mette in modalità penitenza. Ti fermi al bar per una sbronza elegante — doppio amaro e birra anti-trauma — e giuri che domani esci solo col sole. Poi guardi la moto: grondante come te, e pensi che la libertà, se non ti bagna, non vale niente.`;

const EX_WTF_PACE_IT = `Ti presenti elegante e il destino in ciabatte. Pensi che fare pace sia un tè con i biscotti e due scuse perfette. Poi il messaggio resta su “sta scrivendo…”, il telefono cade nella tazza, la foto del vostro peggior litigio spunta come notifica, e il cuore ti tamburella come una batteria in prova. Ti esplode un’imprecazionona a detonazione che fa tremare i portafoto; la lampada sfarfalla in Morse, il POS recita un rosario di errori, e il cane del vicino prende appunti. Ti versi un bicchiere di rosso “per lucidare la sincerità” e ti presenti con voce da sopravvissuto. L’abbraccio è goffo ma intero: le parole inciampano e si rialzano. Alla fine, il silenzio è un applauso lento. Pace fatta, pure il semaforo lampeggia in verde per solidarietà.`;

/* ========= Sinonimi esplosivi ========= */
const WTF_SFOGO_STRONG = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "para-bestemmia a raffica",
  "madonna della miseria urlata",
  "anatema a grandinata",
  "urlo liturgico strozzato",
  "embolata sacrilega"
];

/* ========= Reazioni esilaranti ========= */
const WTF_REACTIONS_BANK = [
  "la lampada fa facepalm e poi sfarfalla in Morse",
  "il campanile tossisce un amen stonato",
  "il POS recita un rosario di errori e si benedice da solo",
  "la tapparella si abbassa per imbarazzo e poi risale curiosa",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita",
  "Alexa finge un aggiornamento e scappa in modalità ‘non disturbare’",
  "il citofono fa uno squillo di solidarietà e poi si pente",
  "il semaforo passa al rosso per rispetto e resta così in silenzio",
  "i bicchieri applaudono in cristallo e chiedono il bis",
  "il ventilatore fa l’inchino e gira al contrario per reverenza",
  "la macchina del caffè sputa un getto a fontana come applauso",
  "il cane del vicino prende appunti e scuote la testa da giudice",
  "la porta automatica si apre da sola, poi si vergogna e si richiude",
  "il registratore di cassa batte uno scontrino con scritto ‘amen’",
  "la moka fischia standing ovation"
];

/* ========= Aperture ironiche ========= */
const WTF_OPENINGS = [
  "Ah ma guarda te, …",
  "Oh, eccoci, …",
  "Ti presenti elegante e il destino in ciabatte, …",
  "Giornata da manuale, capitolo imprevisti, …",
  "Hai studiato tutto, tranne il caos, …",
  "Sembra facile finché non tocca a te, …"
];

/* ========= REGOLE ========= */
const TECH_RULES_BASE = (lang)=>`REGOLE:
- Un solo paragrafo. Niente elenchi, niente emoji.
- Tempo: prossimo futuro. Solo seconda persona ("tu").
- Lunghezza: WHATIF ≈145 parole, WTF ≈165 parole.`;

const WTF_STRICT_IT = (openingShape)=>`WTF:
1) Inizia esattamente con «${openingShape}».
2) 2–3 frasi di presa in giro (roasting).
3) 4 micro-imprevisti comici e realistici.
4) Esplosione viscerale (una sola): scegli da ${WTF_SFOGO_STRONG.join(", ")}.
5) Subito dopo 3–5 reazioni esilaranti tratte da WTF_REACTIONS_BANK.
6) Alcol o sbronza visibile.
7) Chiusa ironica o poetica.
Tono brillante, ritmo serrato, ma risposta reale alla domanda.`;

/* ========= Aperture variabili ========= */
async function pickRotating(list, key){
  try{
    const n=await redis.incr(key);if(n===1)await redis.expire(key,86400);
    return list[(n-1)%list.length];
  }catch{return list[Math.floor(Math.random()*list.length)];}
}

/* ========= Prompt builder ========= */
async function buildMessages({ domanda, lang, periodo, stile, mode, ip }){
  const msgs=[{role:"system",content:TECH_RULES_BASE(lang)},{role:"system",content:temporalInstruction(periodo,lang)}];

  if(stile==="wtf"){
    const opening=await pickRotating(WTF_OPENINGS,`rot:wtf:${ip}`);
    msgs.push(
      {role:"system",content:WTF_STRICT_IT(opening)},
      {role:"system",content:`ESEMPIO · WTF (IT) · Moto\n${EX_WTF_MOTO_IT}`},
      {role:"system",content:`ESEMPIO · WTF (IT) · Pace\n${EX_WTF_PACE_IT}`}
    );
  }else{
    if(mode==="analitico")msgs.push({role:"system",content:`ESEMPIO · WHAT IF · Analitico\n${EX_WHATIF_ANALITICO_IT}`});
    else msgs.push({role:"system",content:`ESEMPIO · WHAT IF · Reale\n${EX_WHATIF_REALE_IT}`});
  }

  msgs.push({role:"user",content:`Domanda: "${domanda}". Rispondi in IT con un solo paragrafo.`});
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS")return res.status(200).end();
  if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
  try{
    if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"missing_api_key"});
    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unk").split(",")[0].trim();
    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const {domanda="",stile="whatif",mode="reale",lang="it",periodo="future"}=body;
    if(!domanda)return res.status(400).json({error:"bad_request"});

    const messages=await buildMessages({domanda,lang,periodo,stile,mode,ip});
    const completion=await client.chat.completions.create({model:MODEL,temperature:0.98,top_p:0.92,max_tokens:480,messages});
    let answer=completion?.choices?.[0]?.message?.content?.trim()||"";
    answer=stripQuestionEcho(domanda,answer);
    answer=tightenSentences(answer,9);
    answer=clampWords(answer,170);
    answer=normalizeOneParagraph(answer);

    // Salvagente incipit
    if(stile==="wtf"){
      const incipitList=WTF_OPENINGS.map(s=>s.split(",")[0].replace(" …","")).join("|");
      if(!new RegExp(`^(${incipitList})`,"i").test(answer)){
        const forced=await pickRotating(WTF_OPENINGS,`rot:wtf:open:${ip}`);
        answer=`${forced} ${answer}`;
      }
      // Se manca lo sfogo, lo iniettiamo
      const hasSfogo=WTF_SFOGO_STRONG.some(s=>answer.toLowerCase().includes(s.split(" ")[0]));
      if(!hasSfogo){
        const pick=WTF_SFOGO_STRONG[Math.floor(Math.random()*WTF_SFOGO_STRONG.length)];
        answer+=` Ti esplode un ${pick} che fa tremare pure i santi di gesso.`;
      }
      // Aggiungi 3–5 reazioni
      const afterIdx=answer.indexOf("Ti esplode");
      if(afterIdx>-1){
        const pool=[...WTF_REACTIONS_BANK];const num=3+Math.floor(Math.random()*3);const add=[];
        for(let i=0;i<num&&pool.length;i++)add.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
        answer=answer.slice(0,afterIdx+60)+" "+add.join(", ")+". "+answer.slice(afterIdx+60);
      }
    }

    return res.status(200).json({answer,style:stile,mode,lang,periodo,model:MODEL});
  }catch(e){console.error(e);return res.status(500).json({error:"server_error",detail:String(e.message||e)});}
}
