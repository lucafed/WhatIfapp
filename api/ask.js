// /api/ask.js — What?f Engine (HARD-LOCKED STYLE • EXACTLY MATCH EXAMPLES)
// Stili: whatif (analitico | reale) · wtf
// Regole: un paragrafo, seconda persona, niente elenchi, niente emoji, NO eco della domanda, NO nomi inventati.
// Incipit obbligatori (WhatIf): Analitico → "Sai, ..."; Reale/Poetico → "Bella questa, ..."

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
function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue;
    if(p.split(/\s+/).length<=3 && !/[.!?]$/.test(p)) continue;
    out.push(p); seen.add(n); if(out.length>=maxSentences) break;
  }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\.\.\.+/g,"…").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,""); return t;
}
function ensureSentenceCase(s=""){ const t=s.trim(); if(!t) return s; return t[0].toUpperCase()+t.slice(1); }
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

/* ========= Temporal ========= */
function temporalInstruction(periodo="future"){
  if(String(periodo).toLowerCase()==="past"){
    return "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= ESEMPI VINCOLANTI — TUOI ========= */
const WHATIF_ANALITICO_RX = `Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const WHATIF_POETICO_RX = `Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

const FEWSHOT_WTF_IT = [
  `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
  `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
  `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

/* ========= Banche WTF (reazioni demenziali, drink, morali) ========= */
const WTF_BANKS_IT = {
  openings: [
    "Ah ma guarda te… contrattando col destino a colpi di caffè",
    "Oh eccoci: campione mondiale di complicarti la vita con stile",
    "Bella mossa: vuoi vincere in salita con il sorriso",
    "Uè, specialista in problemi artigianali fatti a mano",
  ],
  jabs: [
    "testa dura, cuore tenero, timing discutibile",
    "coraggio a secchiate e manuale perso",
    "piano perfetto, viti avanzate, sorriso incluso",
    "eroe del quotidiano con mantello ad asciugare",
  ],
  imprecations: [
    "ti scappa una bestemmia a fisarmonica che entra ed esce come aria d’altura",
    "ti parte un bestemmione da cartone animato che vibra come un basso funk",
    "srotoli una bestemmia in slow-motion, tutta coreografia e zero veleno",
    "ti esce una bestemmia frizzante che fa le bollicine come l’acqua tonica",
    "scocca una bestemmia da manuale, firmata e timbrata",
  ],
  reactions: [
    "la lampada sfarfalla in Morse e pare dirti «ricevuto»",
    "la tapparella si abbassa per imbarazzo e poi sbircia",
    "il POS finge un aggiornamento e si mette in «timido»",
    "la moka fa una standing ovation a vapore",
    "il citofono squilla in solidarietà e poi si pente",
    "il ventilatore gira al contrario per rispetto",
    "la sedia scricchiola come se applaudisse piano",
    "il campanello suona in do minore e si commuove",
    "la pianta grassa annuisce con foglie perplesse",
  ],
  drinks: [
    "ti versi un goccio di liquore e rimetti a posto i pensieri",
    "prendi un sorso corto di amaro e il mondo si raddrizza",
    "alzi un calice minuscolo: brindisi di manutenzione",
    "bevi un dito di rosso e respiri più largo",
  ],
  morales: [
    "Morale: il caos non si doma, gli dai del tu.",
    "Morale: se non si allinea, lo porti a bere e si convince.",
    "Morale: ridi tu per primo e il resto si arrangia.",
    "Morale: metà fortuna, metà mestiere, zero rancore.",
  ],
};

/* ========= Regole dure: COPIA STILE E INCIPIT ========= */
const BASE_RULES = `REGOLE GENERALI:
- Un solo paragrafo. Niente elenchi. Niente emoji. NON ripetere la domanda.
- Solo seconda persona. Nessun nome proprio non presente nella domanda.
- MATCH_EXAMPLES_EXACTLY: copia tono, cadenza, lunghezza frasi, registro, immagini e dispositivi degli esempi.
- Evita sinonimi “tecnici” quando il modello poetico è attivo.`;

const WHATIF_ANALITICO_RULE = `WHAT IF Analitico:
- INCIPIT OBBLIGATORIO: inizia con "Sai," (es.: "Sai, questa domanda girava nell’aria da un po’.").
- Tono concreto, scambi reali, costi/benefici, routine, qualità della vita.
- Cadenza e lessico allineati all’esempio ANALITICO qui sotto.
- 135–155 parole. Chiusura calma in stile esempio.`;

const WHATIF_POETICO_RULE = `WHAT IF Reale/Poetico:
- INCIPIT OBBLIGATORIO: inizia con "Bella questa," (es.: "Bella questa, Luca.").
- Immagini sobrie, sensoriali e quotidiane; ritmo arioso; NESSUN gergo analitico.
- Cadenza e lessico allineati all’esempio POETICO qui sotto.
- 135–155 parole. Chiusura riconciliata come l’esempio.`;

const WTF_RULE = `WHAT THE F (amichevole, comico):
- Struttura OBBLIGATORIA (6–8 frasi): presa in giro affettuosa (≤2) → 2–3 micro-imprevisti → EXACTLY ONE imprecazione teatrale (IMPRECATION) → SUBITO 2–3 reazioni di oggetti (REACTIONS) → DRINK alcolico (DRINK) → 1–2 frasi che rispondono davvero → morale calda (MORAL).
- Mai aggressivo contro persone. Max due “!”. Nessuna acqua. MATCH_EXAMPLES_EXACTLY.`;

/* ========= Seed casuale per WTF ========= */
function pick(arr, n=1){
  const out=[], used=new Set();
  while(out.length<n && used.size<arr.length){
    const i=Math.floor(Math.random()*arr.length);
    if(used.has(i)) continue; used.add(i); out.push(arr[i]);
  }
  return out;
}
function wtfSeeds(domanda, micro={}){
  const L = WTF_BANKS_IT;
  const nick = (micro?.nickname && String(micro.nickname).slice(0,20)) || "campione";
  const opening = pick(L.openings,1)[0] + (Math.random()<0.7? `: ${pick(L.jabs,1)[0]}.` : ".");
  const impre = pick(L.imprecations,1)[0];
  const reacts = pick(L.reactions, 2 + Math.floor(Math.random()*2)); // 2 o 3
  const drink  = pick(L.drinks,1)[0];
  const moral  = pick(L.morales,1)[0];
  return [
    { role:"system", content: WTF_RULE },
    { role:"system", content: `OPENING: ${opening.replace("campione", nick)}` },
    { role:"system", content: `IMPRECATION: ${impre}` },
    { role:"system", content: `REACTIONS:\n- ${reacts.join("\n- ")}` },
    { role:"system", content: `DRINK: ${drink}` },
    { role:"system", content: `MORAL: ${moral}` },
    { role:"system", content: `ESEMPI VINCOLANTI (tono/ritmo):\n- ${FEWSHOT_WTF_IT[0]}\n- ${FEWSHOT_WTF_IT[1]}\n- ${FEWSHOT_WTF_IT[2]}` },
  ];
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, periodo, stile, mode, micro }){
  const msgs = [
    { role:"system", content: BASE_RULES },
    { role:"system", content: temporalInstruction(periodo) },
  ];

  if (stile === "wtf") {
    msgs.push(...wtfSeeds(domanda, micro));
  } else if (mode === "analitico") {
    msgs.push(
      { role:"system", content: WHATIF_ANALITICO_RULE },
      { role:"system", content: `ESEMPIO ANALITICO (VINCOLANTE):\n${WHATIF_ANALITICO_RX}` },
    );
  } else {
    msgs.push(
      { role:"system", content: WHATIF_POETICO_RULE },
      { role:"system", content: `ESEMPIO POETICO (VINCOLANTE):\n${WHATIF_POETICO_RX}` },
    );
  }

  msgs.push({
    role:"user",
    content:`Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO, un solo paragrafo.`
  });
  return msgs;
}

/* ========= Post-process specifico ========= */
function keepSingleImprecazione(answer){
  const rx=/\bbestemmi\w*|imprecazion\w*|sacrament\w*|anatema\w*/gi;
  let c=0; return answer.replace(rx, m => (++c===1? m : "imprecazione a mezza voce"));
}
function ensureDrink(answer){
  if(/\b(grappa|amaro|rosso|vino|spritz|negroni|whisky|rum|birra|calice|goccio|dito|brindisi|liquore)\b/i.test(answer)) return answer;
  return finalPunct(answer)+" Ti versi un goccio di liquore e il mondo si rimette in riga.";
}
function limitExclamations(s){ return s.replace(/!{3,}/g,"!!"); }
function forbidInsults(s){ return s.replace(/\b(cazzo|cazzata|stronzo|idiota|cretino|imbecille)\b/gi,"accidente"); }

/* ========= HANDLER ========= */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body=typeof req.body==="string"? JSON.parse(req.body||"{}") : (req.body||{});
    const {
      domanda = "",
      stile   = "whatif",   // "whatif" | "wtf"
      mode    = "reale",    // "analitico" | "reale"
      periodo = "future",
      micro   = {},
    } = body;

    if(!domanda || typeof domanda!=="string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, periodo, stile, mode, micro });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process comune
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf" ? 8 : 10);
    answer = clampWords(answer, stile==="wtf" ? 170 : 155);
    answer = normalizeOneParagraph(answer);
    answer = ensureSentenceCase(answer);
    answer = finalPunct(answer);

    if(stile==="wtf"){
      answer = keepSingleImprecazione(answer);
      answer = forbidInsults(answer);
      answer = limitExclamations(answer);
      answer = ensureDrink(answer);
    }else{
      // Forza incipit corretti
      if(mode==="analitico" && !/^Sai[, ]/i.test(answer)){
        answer = "Sai, "+answer.replace(/^([A-ZÀ-Ýa-zà-ÿ]+,?\s*)/,"");
      }
      if(mode!=="analitico" && !/^Bella questa[, ]/i.test(answer)){
        answer = "Bella questa, "+answer.replace(/^([A-ZÀ-Ýa-zà-ÿ]+,?\s*)/,"");
      }
      // Rimozione lessico analitico nel poetico
      if(mode!=="analitico"){
        answer = answer
          .replace(/\b(costi|benefici|trade[- ]?off|budget|KPI|metriche|ottimizzazione|efficienza|performance)\b/gi,"respiro")
          .replace(/\b(pro/gi,"pro")
      }
    }

    // No prima persona forte
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi,"");

    // Evita nomi non in domanda
    (function(){
      const d=String(domanda||""); const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g; const inQ=new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m)=> inQ.has(m)? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m)? m : m.toLowerCase()));
    })();

    return res.status(200).json({ answer, style:stile, mode, lang:"it", periodo, model:MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
