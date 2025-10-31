// /api/ask.js — What?f Engine (INCIPIT FIX + DEMENZIALE WTF + GRAMMAR)
// Stili: whatif (analitico | reale) · wtf — Un paragrafo, 2ª persona, nessuna eco della domanda.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ========= CORS ========= */
const ALLOWED_ORIGINS = ["https://what-ifapp.vercel.app","http://localhost:3000","http://127.0.0.1:5500"];
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
  const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; if(p.split(/\s+/).length<=3 && !/[.!?…]$/.test(p)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){ const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text; const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/); return m?m[1]:slice+"…"; }
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\.{3,}/g,"…").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){ const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||""); const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim(); const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.?!…]*[.?!…]\s+/i; if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); } return t.replace(rx,""); }
function capAfterStopsIt(s=""){ let t=String(s).trim(); if(!t) return s; t=t.replace(/^\s*([a-zà-ÿ])/,(m,c)=>c.toUpperCase()); return t.replace(/([.!?…]\s+)([a-zà-ÿ])/g,(m,p,c)=>p+c.toUpperCase()); }

/* ========= Temporal ========= */
function temporalInstruction(periodo="future", lang="it"){
  if(String(periodo).toLowerCase()==="past") return "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  return "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi fissi (TUOI) ========= */
const WHATIF_ANALITICO_RX = `Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const WHATIF_POETICO_RX  = `Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WHAT IF — incipit & stile (forzatura) ========= */
function stripLeadingPoetico(t=""){ return t.replace(/^\s*(bella\s+questa[, ]\s*luca\.?\s*)/i, ""); }
function stripLeadingAnalitico(t=""){ return t.replace(/^\s*(sai\s+luca[, ]\s*)/i, ""); }
function enforceWhatIf(answer, mode){
  let t=String(answer||"").trim();
  if(mode==="analitico"){
    t=stripLeadingPoetico(t); t=stripLeadingAnalitico(t);
    t=`Sai Luca, ${t}`.replace(/^Sai Luca,\s*,\s*/,"Sai Luca, ");
    // de-poeticizzatore soft
    t=t.replace(/\b(aria|eco|orizzonte|amante|profumo|risate|portoni|carezza|abbraccio|montagne)\b/gi,(m)=>({
      aria:"tempo", eco:"ritmo", orizzonte:"prospettiva", amante:"abitudine", profumo:"routine",
      risate:"serate", portoni:"quartieri", carezza:"comodità", abbraccio:"stabilità", montagne:"weekend"
    }[m.toLowerCase()]||m));
    return capAfterStopsIt(t);
  }
  // mode === reale (poetico)
  t=stripLeadingAnalitico(t); t=stripLeadingPoetico(t);
  t=`Bella questa, Luca. ${t}`.replace(/Bella questa, Luca\.\s*Bella questa, Luca\.\s*/i,"Bella questa, Luca. ");
  // sgrassatore analitico
  t=t.replace(/\b(affitt[oi]|bollett[ea]e?|stipend[iio]|budget|costi|benefici|kpi|okrs?|fornit[o]ri?|multinazional[ei]|trasport[oi]|logistica|turn[io])\b/gi,"");
  return capAfterStopsIt(t).replace(/\s{2,}/g," ").trim();
}

/* ========= WTF — banca demenziale ========= */
const WTF_SFOGO_BANK=[
  "bestemmione corazzato","imprecazionona a detonazione","sacramentata a ciel sereno","urlo liturgico strozzato",
  "para-bestemmia esplosiva","madonna della miseria urlata","anatema a grandinata","embolata sacrilega",
  "santa pazienza implosa","vulcano d’anatemi","tromba d’aria di improperi","scoppio teologico a catena"
];
const WTF_REACTIONS_BANK=[
  "la lampada sfarfalla in Morse come se capisse tutto",
  "il campanile tossisce un amen stonato",
  "i bicchieri fanno la ola e chiedono il bis",
  "la tapparella si abbassa per imbarazzo e poi risale curiosa",
  "Alexa finge un aggiornamento e scappa in ‘non disturbare’",
  "il POS recita un rosario di errori e si benedice da solo",
  "la moka fischia una standing ovation",
  "il ventilatore gira al contrario per reverenza",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita",
  "il frigorifero sospira e diventa minimalista",
  "il citofono suona in solidarietà e poi si pente",
  "un piccione fa moonwalk sul davanzale e ti giudica",
  "il tostapane sputa coriandoli inesistenti",
  "il semaforo passa al rosso per rispetto"
];
function pick(arr,n=1){ const out=[],used=new Set(); while(out.length<n && used.size<arr.length){ const i=Math.floor(Math.random()*arr.length); if(used.has(i)) continue; used.add(i); out.push(arr[i]); } return out; }

/* ========= Prompt builder ========= */
function buildMessages({ domanda, periodo, stile, mode }){
  const msgs=[
    { role:"system", content: "REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Solo seconda persona. Niente nomi inventati." },
    { role:"system", content: temporalInstruction(periodo, "it") }
  ];

  if(stile==="wtf"){
    const reacts = pick(WTF_REACTIONS_BANK,3).join(" · ");
    msgs.push({ role:"system", content:
`WHAT THE F (amichevole e demenziale ma utile). 145–165 parole.
1) Presa in giro affettuosa (≤2 frasi).
2) 3–4 micro-imprevisti legati alla domanda.
3) Ti trattieni… provi… riprovi… POI UNO sfogo teatrale (es.: ${WTF_SFOGO_BANK.slice(0,6).join(", ")}). Mai contro persone.
4) SUBITO queste 3 reazioni: ${reacts}.
5) DRINK alcolico obbligatorio (grappa/amaro/vino/whisky/spritz).
6) 1–2 frasi che rispondono davvero alla domanda.
7) Morale ironica breve.
Tutte le frasi iniziano con la maiuscola.`});
  }else if(mode==="analitico"){
    msgs.push(
      { role:"system", content: "WHAT IF Analitico: inizia con ‘Sai Luca,’ o variante coerente. Tono concreto: costi/benefici, routine, qualità della vita; 135–155 parole; chiusura calma come nell’esempio." },
      { role:"system", content: `ESEMPIO VINCOLANTE:\n${WHATIF_ANALITICO_RX}` }
    );
  }else{ // reale/poetico
    msgs.push(
      { role:"system", content: "WHAT IF Reale/Poetico: inizia con ‘Bella questa, Luca.’ Tono sensoriale sobrio, immagini quotidiane; 135–155 parole; chiusura riconciliata come nell’esempio." },
      { role:"system", content: `ESEMPIO VINCOLANTE:\n${WHATIF_POETICO_RX}` }
    );
  }

  msgs.push({ role:"user", content: `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO a paragrafo unico.` });
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});
  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});
    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({error:"rate_limited_minute"});

    const body = typeof req.body === "string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", mode="reale", lang="it", periodo="future" } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({error:"bad_request", detail:"domanda_required"});

    const messages = buildMessages({ domanda, periodo, stile, mode });
    const completion = await client.chat.completions.create({ model: MODEL, temperature: stile==="wtf"?0.98:0.82, top_p:0.92, max_tokens:480, frequency_penalty:0.1, presence_penalty:0.0, messages });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf"?9:11);
    answer = clampWords(answer, stile==="wtf"?168:160);
    answer = normalizeOneParagraph(answer);

    // Enforce incipit & registro per WHAT IF
    if(stile!=="wtf") answer = enforceWhatIf(answer, mode==="analitico"?"analitico":"reale");

    // WTF: drink + maiuscole + reazioni davvero presenti
    if(stile==="wtf"){
      // Maiuscole dopo punteggiatura
      answer = capAfterStopsIt(answer);
      // Drink alcolico garantito
      if(!/(grappa|amaro|vino|spritz|birra|whisky|rum|gin|negroni|martini|prosecco|spumante)/i.test(answer)){
        answer += " Ti versi un dito di grappa di servizio e il mondo si rimette seduto.";
      }
      // Se per caso non ha messo 2–3 reazioni, aggiungi 2 in coda prima della morale
      const hasReaction = /(lampada|campanile|bicchieri|tapparella|Alexa|POS|moka|ventilatore|statua|frigorifero|citofono|piccione|tostapane|semaforo)/i.test(answer);
      if(!hasReaction){ const add = pick(WTF_REACTIONS_BANK,2).join(" "); answer = answer.replace(/(Morale:)/i, `${add} $1`); }
    }

    // Maiuscole finali
    answer = capAfterStopsIt(answer);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // No prima persona forte IT
    if(String(lang).toLowerCase().startsWith('it')){ answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, ""); }

    // Evita nomi non in domanda
    (function(){ const d=String(domanda||""); const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g; const inQ=new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx,(m)=> inQ.has(m)?m:(["Ah","Oh","Ehi","Bella","Sai"].includes(m)?m:m.toLowerCase())); })();

    return res.status(200).json({ answer, style: stile, mode, lang, periodo, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
