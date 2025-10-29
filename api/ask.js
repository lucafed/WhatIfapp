// /api/ask.js — What?f Engine (FINAL PRODUCTION • DEMENZIALE+)
// Basato sulla tua versione stabile, con WTF più esplosivo e variabile.
// Stili: whatif (analitico | reale) · wtf
// Regole invarianti: un solo paragrafo, seconda persona, niente elenchi, niente nomi inventati.

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

/* ========= Temporal ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en = isEn(lang);
  if(periodo==="past") return en?"Write as if it already happened.":"Scrivi come se fosse già successo.";
  return en?"Write as a near-future unfolding.":"Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi ========== */
const EX_WHATIF_ANALITICO_IT = `Sai, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const EX_WHATIF_REALE_IT = `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — esempi guida ========== */
const EX_WTF_BAR_IT = `Ah ma guarda te… sempre convinto che la moka risolva i traumi. Ti vedi già al bancone, musica jazz, sorrisi, caffè perfetti. Poi arriva il primo cliente e chiede un cappuccino tiepido con latte di unicorno, il macinino tossisce e il POS inizia una novena. Ti imponi di non reagire, ma dal profondo del fegato parte una bestemmia industriale, un boato d’anima che fa tremare i bicchieri e piegare la moka in adorazione. Il frigorifero si spegne per compassione, Alexa si disconnette per pudore e il campanile tossisce un “amen” in sottofondo. Ti versi un amaro da trauma gestionale e ridi: aprire un bar era un sogno, ora è un sacramento a rate. Morale: non serve un business plan, serve un esorcista col POS.`;

/* ========= Banche WTF (DEMENZIALE+) ========= */
// Aperture (ruotano per ridurre ripetizioni)
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

// Sfoghi (sceglierne UNO a testo, più viscerali/varî)
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
  "scoppio teologico a catena"
];

// Reazioni (da scegliere 2–3 pertinenti)
const WTF_REACTIONS = [
  "il campanile tossisce un amen stonato",
  "il POS recita un rosario di errori",
  "la tapparella si abbassa per imbarazzo e poi risale",
  "Alexa finge un aggiornamento e scappa in ‘non disturbare’",
  "la moka fischia standing ovation",
  "i bicchieri applaudono in cristallo",
  "il ventilatore gira al contrario per reverenza",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita",
  "il citofono fa uno squillo di solidarietà e poi si pente",
  "il frigorifero si spegne per pietà",
  "la porta automatica si apre da sola, poi si vergogna e si richiude"
];

// Morali finali (varietà di chiusure)
const WTF_MORALS = [
  "Morale: non cambi il destino, impari solo a riderci sopra.",
  "Morale: la vita sbaglia tono, tu correggi con un sorso.",
  "Morale: i santi reggono, i nervi meno — ma domani ci riprovi.",
  "Morale: il caos non si doma, si brinda.",
  "Morale: la pazienza è finita, il bicchiere no."
];

/* ========= Regole Base ========= */
const TECH_RULES_BASE = (lang)=>`REGOLE:
- Un solo paragrafo. Niente elenchi, niente emoji, NON ripetere la domanda.
- Tempo: prossimo futuro. Solo seconda persona ("tu"). Mai prima persona narrante.
- Nomi: non inventare nomi. Usa solo quelli presenti nella domanda, altrimenti evita.
- Lunghezza: WHATIF ≈145 parole, WTF ≈165 parole.`;

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode }){
  const msgs=[{role:"system",content:TECH_RULES_BASE(lang)},{role:"system",content:temporalInstruction(periodo,lang)}];

  if(stile==="wtf"){
    // Istruzioni compatte ma rigide (sequenza corretta)
    msgs.push({
      role:"system",
      content:
`WTF (demenziale+):
1) Apertura ironica amichevole (scegli una tra: ${WTF_OPENINGS.join(" · ")}).
2) Presa in giro affettuosa (2 frasi).
3) 4 micro-imprevisti realistici legati al contesto della domanda (NO dettagli fuori luogo).
4) Provi a trattenerti, poi esplode UNO sfogo viscerale (scegli 1 tra: ${WTF_SFOGO_VARIANTS.join(", ")}). Scrivilo come narrazione.
5) Subito dopo, 2–3 reazioni esilaranti coerenti (scegli da: ${WTF_REACTIONS.join(", ")}).
6) Alcol visibile (sip, doppio amaro, sbronza elegante).
7) Rispondi davvero alla domanda (breve previsione/controfattuale concreta).
8) Chiudi con una morale (scegli 1 tra: ${WTF_MORALS.join(" | ")}).
SEMPRE seconda persona. Nessun nome inventato.`
    },
    {role:"system",content:`ESEMPIO · WTF\n${EX_WTF_BAR_IT}`});
  }else{
    if(mode==="analitico"){
      msgs.push(
        {role:"system",content:`WHAT IF Analitico: tono calmo, concreto, logico. Inizia nello stile "Sai, questa domanda girava nell’aria da un po’." (o variante). Descrivi scambi reali, costi/benefici, qualità della vita. Chiudi con un compromesso netto e pacato.`},
        {role:"system",content:`ESEMPIO · WHAT IF Analitico\n${EX_WHATIF_ANALITICO_IT}`}
      );
    }else{
      msgs.push(
        {role:"system",content:`WHAT IF Poetico: tono sensoriale e asciutto. Inizia nello stile "Bella questa — me l’aspettavo da te." (o variante). Immagini quotidiane e chiusura che riconosce luogo e tempo come alleati.`},
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
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});

    // Rate limit per IP
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unk").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const { domanda="", stile="whatif", mode="reale", lang="it", periodo="future" } = body;
    if(!domanda) return res.status(400).json({error:"bad_request",detail:"domanda_required"});

    const messages = buildMessages({ domanda, lang, periodo, stile, mode });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 520,
      frequency_penalty: 0.12,
      presence_penalty: 0.08,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf" ? 9 : 11);
    answer = clampWords(answer, stile==="wtf" ? 175 : 162);
    answer = normalizeOneParagraph(answer);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // Guard-rail: NO prima persona
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, (m)=>"");

    // Guard-rail: NO nomi non presenti nella domanda (evita "Marco" & co.)
    (function(){
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQ = new Set((String(domanda).match(nameRx) || []));
      answer = answer.replace(nameRx, (m)=>{
        return inQ.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m) ? m : m.toLowerCase());
      });
    })();

    return res.status(200).json({ answer, style:stile, mode, lang, periodo, model:MODEL });
  }catch(e){
    console.error("❌ [/api/ask] error:", e);
    return res.status(500).json({ error:"server_error", detail:String(e?.message||e) });
  }
}
