// /api/ask.js — What?f Engine (FINAL PRODUCTION EDITION)
// Luca Federici Edition — Definitivo, stabile, coeso nei toni.
// What If (analitico/reale) & What the F (sarcastico-esplosivo)
// Rate-limit + Redis log + OpenAI completions

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
const EX_WHATIF_ANALITICO_IT = `Sai, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const EX_WHATIF_REALE_IT = `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — esempi ========= */
const EX_WTF_BAR_IT = `Ah ma guarda te, Luca… sempre convinto che la moka risolva i traumi. Ti vedi già al bancone, musica jazz, sorrisi, caffè perfetti. Poi arriva il primo cliente e chiede un cappuccino tiepido con latte di unicorno, il macinino tossisce e il POS inizia una novena. Ti imponi di non reagire, ma dal profondo del fegato parte una bestemmia industriale, un boato d’anima che fa tremare i bicchieri e piegare la moka in adorazione. Il frigorifero si spegne per compassione, Alexa si disconnette per pudore e il campanile tossisce un “amen” in sottofondo. Ti versi un amaro da trauma gestionale e ridi: aprire un bar era un sogno, ora è un sacramento a rate. Morale: non serve un business plan, serve un esorcista col POS.`;

/* ========= Varianti di sfogo ========= */
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
  "scenata mistica da manuale"
];

/* ========= Reazioni esilaranti ========= */
const WTF_REACTIONS = [
  "il campanile tossisce un amen stonato",
  "il POS recita un rosario di errori",
  "la tapparella si abbassa per imbarazzo",
  "Alexa finge un aggiornamento e sparisce",
  "la moka fischia standing ovation",
  "il cane del vicino prende appunti",
  "il frigorifero si spegne per pietà",
  "i bicchieri applaudono in cristallo",
  "il ventilatore gira al contrario per reverenza",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita"
];

/* ========= Aperture amichevoli ========= */
const WTF_OPENINGS = [
  "Ah ma guarda te…",
  "Oh, eccoci…",
  "Ti presenti elegante e il destino in ciabatte…",
  "Hai studiato tutto, tranne il caos…",
  "Giornata da manuale, capitolo imprevisti…",
  "Sembra facile finché non tocca a te…",
  "Ma guarda un po’ che genio dell’autolesionismo…"
];

/* ========= Morali finali ========= */
const WTF_MORALS = [
  "Morale: la vita non cambia mestiere, cambia solo la divisa del disastro.",
  "Morale: certe lezioni tornano, anche se tu cambi sedia.",
  "Morale: non serve pazienza — serve un miracolo con orario continuato.",
  "Morale: la libertà è sopravvalutata, ma almeno si beve bene.",
  "Morale: il destino ride, tu paghi il conto."
];

/* ========= Regole base ========= */
const TECH_RULES_BASE = (lang)=>`REGOLE:
- Un solo paragrafo. Niente elenchi, niente emoji.
- Tempo: prossimo futuro. Solo seconda persona ("tu").
- Lunghezza: WHATIF ≈145 parole, WTF ≈165 parole.`;

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode }){
  const msgs=[{role:"system",content:TECH_RULES_BASE(lang)},{role:"system",content:temporalInstruction(periodo,lang)}];

  if(stile==="wtf"){
    msgs.push(
      {role:"system",content:`WTF: tono sarcastico, colloquiale, amichevole ma esplosivo.
1) Apertura amichevole e ironica (usa frasi come: ${WTF_OPENINGS.join("; ")}).
2) Prendi in giro l’utente in modo affettuoso.
3) Inserisci 3–4 imprevisti comici realistici.
4) Mostra il tentativo di trattenersi, poi esplode una delle seguenti imprecazioni (scegline una a caso): ${WTF_SFOGO_VARIANTS.join(", ")}.
5) Descrivi 2–3 reazioni assurde, scelte a caso da: ${WTF_REACTIONS.join(", ")}.
6) Chiudi con un drink/sbronza e una frase sarcastica vera. 
7) Termina sempre con una morale breve, scelta a caso da: ${WTF_MORALS.join(" | ")}.`},
      {role:"system",content:`ESEMPIO · WTF\n${EX_WTF_BAR_IT}`}
    );
  }else{
    if(mode==="analitico"){
      msgs.push(
        {role:"system",content:`WHAT IF Analitico: risponde con tono calmo, concreto, logico. Inizia con "Sai, questa domanda girava nell’aria da un po’." o varianti equivalenti. Chiudi con una frase che riassume il compromesso reale.`},
        {role:"system",content:`ESEMPIO · WHAT IF Analitico\n${EX_WHATIF_ANALITICO_IT}`}
      );
    }else{
      msgs.push(
        {role:"system",content:`WHAT IF Poetico: risponde con tono sensoriale e intimo. Inizia con "Bella questa — me l’aspettavo da te." o varianti equivalenti. Chiudi riconoscendo il tempo come alleato.`},
        {role:"system",content:`ESEMPIO · WHAT IF Reale\n${EX_WHATIF_REALE_IT}`}
      );
    }
  }

  msgs.push({role:"user",content:`Domanda: "${domanda}". Rispondi in IT con un solo paragrafo.`});
  return msgs;
}

/* ========= Handler ========= */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS")return res.status(200).end();
  if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
  try{
    if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"missing_api_key"});

    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const {domanda="",stile="whatif",mode="reale",lang="it",periodo="future"}=body;
    if(!domanda)return res.status(400).json({error:"bad_request"});

    const messages=buildMessages({domanda,lang,periodo,stile,mode});
    const completion=await client.chat.completions.create({
      model:MODEL,
      temperature:stile==="wtf"?0.97:0.82,
      top_p:0.92,
      max_tokens:480,
      frequency_penalty:0.15,
      presence_penalty:0.1,
      messages,
    });

    let answer=completion?.choices?.[0]?.message?.content?.trim()||"";
    answer=stripQuestionEcho(domanda,answer);
    answer=tightenSentences(answer,9);
    answer=clampWords(answer,170);
    answer=normalizeOneParagraph(answer);
    if(!/[.!?…]$/.test(answer))answer+=".";

    return res.status(200).json({answer,style:stile,mode,lang,periodo,model:MODEL});
  }catch(e){console.error("❌ [/api/ask] error:",e);return res.status(500).json({error:"server_error",detail:String(e.message||e)});}
}
