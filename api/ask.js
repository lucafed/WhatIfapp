// /api/ask.js — What?f Engine (EXPLOSIVE FINAL DELUXE)
// Stili: whatif (analitico | reale) · wtf (esplosivo e coerente)
// IT/EN — paragrafo singolo
// Rate: 10/min IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log privacy-safe (no testo domanda)

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
function tinyHash(s = ""){ let h = 2166136261 >>> 0; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,16777619);} return (h>>>0).toString(36); }
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

/* ========= Admin check ========= */
async function isAdmin(req, requesterIp){
  const token = String(req.headers["x-admin-token"] || "").trim();
  if(!token) return false;
  try{
    const data = await redis.hgetall(`admin:token:${token}`);
    if(!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if(LOCK_IP){ if(!data.ip) return false; return data.ip===requesterIp; }
    return true;
  }catch{ return false; }
}

/* ========= Temporal instruction ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en = isEn(lang);
  if(String(periodo).toLowerCase()==="past"){
    return en
      ? "Write as if it already happened."
      : "Scrivi come se fosse già successo.";
  }
  return en
    ? "Write as a near-future unfolding starting now."
    : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF examples ========= */
const EX_WHATIF_ANALITICO_IT = `Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_REALE_IT = `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF: Incipit variabili ========= */
const INCIPIT_WTF_IT = [
  "Ah, ma guarda che eroe della domenica.",
  "Oh, genio su due ruote e mezzo sorriso storto.",
  "Eccoti, temerario con l’ansia in seconda.",
  "Ah sì, libertà addosso e buon senso in retromarcia.",
  "Ehi, centauro dell’ultimo minuto, casco lucido e destino appannato.",
  "Guarda chi arriva: paladino dell’asfalto bagnato.",
  "Oh, cavaliere della rotonda infinita.",
  "Eccoti, funambolo del traffico poetico.",
  "Ah, profeta del gas leggero e dei ripensamenti pesanti.",
  "Ehi, campione di partenze teatrali e arrivi sudati."
];

/* ========= WTF: sinonimi e sfoghi ========= */
const WTF_EXPLOSION_VARIANTS = [
  "ti esplode un anatema a grandinata",
  "sganci una sacramentata sismica",
  "liberi una para-bestemmia supersonica",
  "ti scappa una detonazione spirituale",
  "erutti un’invocazione blasfema alla geologia",
  "vomiti una preghiera invertita che fa tremare i muri",
  "scagli un urlo apocalittico degno di un santo in pensione",
  "ti parte una litania da esorcismo a marce invertite",
  "detoni un ‘santa pazienza implosa!’ che spacca il tempo",
  "ti esplode in gola un requiem di santi confusi",
  "urli una bestemmietta liturgica come un fulmine in chiesa",
  "liberi una madonna della miseria in Dolby Surround",
  "scateni un anatema orchestrale, roba da far piegare i lampioni",
  "ti sfugge un rosario d’urgenza mistico e ridicolo insieme",
  "esce una sacramentata che fende l’aria come un tuono ubriaco"
];

/* ========= WTF rules ========= */
const WTF_STRICT_IT = `WTF deve rispettare questa sequenza obbligatoria:
1) PRESA IN GIRO iniziale (2 frasi ironiche, scegli tra gli incipit proposti).
2) MINI-ESCALATION: 4 micro-imprevisti realistici e comici, tutti nella stessa scena.
3) SFOGO VISCERALE (UNO solo): scegli una formula come:
   ${WTF_EXPLOSION_VARIANTS.map(v=>"– "+v).join("\n   ")}
4) REAZIONI ESILARANTI coerenti con la scena (2–3).
5) ALCOL BEAT (bar o sbronza elegante, solo se plausibile nella scena).
6) CHIUSURA con profezia breve e callback finale.
VINCOLI: niente oggetti fuori contesto, solo seconda persona, 145–165 parole.`;

/* ========= WHAT IF styles ========= */
const WHATIF_ANALITICO_STYLE_IT = `Tono concreto e sobrio: cornice economica/sociale, vincoli e scambi reali. Usa "tu". Incipit come "Sai, questa domanda girava nell’aria da un po’." Chiudi con calma riflessiva.`;
const WHATIF_REALE_STYLE_IT = `Tono poetico e sensoriale, asciutto ma empatico. Usa "tu". Incipit come "Bella questa — me l’aspettavo da te." Chiudi riconoscendo tempo e luogo come alleati.`;

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode }){
  const msgs = [
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  if(stile === "wtf"){
    const incipitBlock = `INIZI POSSIBILI (scegline UNO):\n- ${INCIPIT_WTF_IT.join("\n- ")}`;
    msgs.push(
      { role: "system", content: WTF_STRICT_IT },
      { role: "system", content: incipitBlock },
    );
  }else{
    if(mode === "analitico"){
      msgs.push(
        { role: "system", content: WHATIF_ANALITICO_STYLE_IT },
        { role: "system", content: `ESEMPIO ANALITICO:\n${EX_WHATIF_ANALITICO_IT}` },
      );
    }else{
      msgs.push(
        { role: "system", content: WHATIF_REALE_STYLE_IT },
        { role: "system", content: `ESEMPIO REALE:\n${EX_WHATIF_REALE_IT}` },
      );
    }
  }

  msgs.push({
    role: "user",
    content: `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ${lang.toUpperCase()} in un solo paragrafo.`,
  });
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if(req.method === "OPTIONS") return res.status(200).end();
  if(req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    if(!bypass){
      const { success } = await rl.limit(`ask:${ip}`);
      if(!success) return res.status(429).json({ error:"rate_limited_minute" });
    }

    let used=0, dailyCap=isPro?10:3;
    if(!bypass){
      const today=new Date().toISOString().slice(0,10);
      const key=`credits:${ip}:${today}`;
      used=(await redis.incr(key))??1;
      if(used===1) await redis.expire(key,60*60*24);
      if(used>dailyCap) return res.status(402).json({error:"daily_credits_exhausted",used,dailyCap});
    }

    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const { domanda="", stile="whatif", mode="reale", lang="it", periodo="future" }=body;
    if(!domanda) return res.status(400).json({error:"bad_request",detail:"domanda_required"});

    const messages=buildMessages({ domanda, lang, periodo, stile, mode });
    const completion=await client.chat.completions.create({
      model:MODEL,
      temperature:stile==="wtf"?0.98:0.82,
      top_p:0.92,
      max_tokens:440,
      frequency_penalty:0.1,
      presence_penalty:0.0,
      messages,
    });

    let answer=completion?.choices?.[0]?.message?.content?.trim()||"";
    if(!answer) throw new Error("empty_model_response");

    answer=stripQuestionEcho(domanda,answer);
    answer=tightenSentences(answer, stile==="wtf"?9:11);
    answer=clampWords(answer, stile==="wtf"?170:160);
    answer=normalizeOneParagraph(answer);
    if(!/[.!?…]$/.test(answer)) answer+=".";

    // no first person
    answer=answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi,"");

    return res.status(200).json({ answer, style:stile, mode, lang, periodo, model:MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:",err);
    return res.status(500).json({error:"server_error",detail:String(err?.message||err)});
  }
}
