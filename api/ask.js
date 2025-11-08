// /api/ask.js — What?f Engine (Stable Hybrid WHATIF + Friendly-WTF Demenziale)
// - WHATIF: 60% analisi / 40% immagini sobrie, incipit variabile (no “Bella Luca”).
// - WTF: 2–3 reazioni demenziali, una “imprecazione” teatrale, drink, morale calda.
// - Maiuscole robuste (prima lettera + dopo . ? ! … : anche con virgolette o parentesi).
// - Un paragrafo, niente elenchi, niente eco della domanda.

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
const SUP_LANGS = ["it","en","es","fr","de"];
function normLang(l="it"){ const s=String(l||"it").toLowerCase().slice(0,2); return SUP_LANGS.includes(s)?s:"it"; }

function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
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

// Maiuscole robuste: inizio stringa + dopo . ? ! … : con virgolette/parentesi
function sentenceCaseAll(s = "") {
  if (!s) return s;
  s = s.replace(/^(\s*[«“"'\(\[]*)([a-zà-ÿ])/u, (m, pre, ch) => pre + ch.toUpperCase());
  s = s.replace(/([.!?…:]\s+)([«“"'\(\[]*)([a-zà-ÿ])/gu,
    (m, p, pre, ch) => p + pre + ch.toUpperCase()
  );
  return s;
}

function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

/* ========= WHAT IF – stile 60/40 ========= */
const WHATIF_RULE_IT = `WHAT IF HYBRID (italiano): 60% analisi concreta (costi/benefici, routine, qualità di vita), 40% immagini sobrie. 8–10 frasi, tono riflessivo, paragrafo unico.`;

const WHATIF_HYBRID_EX_IT = `Sai, questa non è una domanda leggera. Guardi i numeri, poi guardi le abitudini: costi più bassi da una parte, occasioni più larghe dall’altra. La qualità della vita non è un grafico, è una routine: tempi di spostamento, servizi che funzionano, persone che senti vicine. Se stringi, il portafoglio respira un po’ di più; in cambio accetti un ritmo meno veloce e meno “vetrine” da inseguire. Le giornate si accorciano di frenesia e si allungano di fiato: un caffè fatto bene, una strada che conosci, un’aria che sa di casa. Non è una fuga né un eroismo: è ingegneria quotidiana, spostare pesi tra tempo, denaro e relazioni. A conti fatti, potresti guadagnare spazio mentale e perdere solo rumore.`;

/* ========= WHATIF — incipit variabili ========= */
const WHATIF_OPENERS = {
  it: [
    "Non è una domanda semplice e lo sai.",
    "Se guardi bene, qui non c’è solo un sì o un no.",
    "Prima di tutto: ha senso che tu sia diviso.",
    "Questa scelta tira da due lati e tu la senti.",
    "Vale la pena trattarla come un esperimento, non un verdetto.",
    "Non stai scegliendo tra giusto e sbagliato, ma tra due forme di te.",
    "È un bivio vero: curiosità da una parte, prudenza dall’altra.",
    "Qui non serve coraggio cieco: serve misura.",
    "Quello che temi e quello che desideri stanno seduti allo stesso tavolo.",
    "La domanda è grande, ma la risposta abita nella routine."
  ]
};

/* ========= WTF — banche demenziali ========= */
const WTF_IMPRE = [
  "bestemmione corazzato","imprecazionona a detonazione","sacramentata a ciel sereno","vulcano d’anatemi","tromba d’aria di improperi"
];
const WTF_REACT = [
  "la moka ti fa una standing ovation e chiede l’autografo",
  "il POS entra in modalità testimone di nozze e benedice la carta",
  "la tapparella si abbassa per pudore e poi sbircia curiosa",
  "la lampada lampeggia in Morse “ti capisco”",
  "Alexa finge un aggiornamento e scappa in modalità monaco",
  "il frigorifero sospira e decide di diventare minimalista",
];
const WTF_DRINK = [
  "ti versi un amaro doppio e metti in riga i pensieri",
  "fai un sorso corto e il mondo rientra nei bordi",
  "bevi un dito di coraggio e respiri più largo",
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const msgs = [];

  if(stile==="wtf"){
    const impre = WTF_IMPRE[Math.floor(Math.random()*WTF_IMPRE.length)];
    const react = [...WTF_REACT].sort(()=>Math.random()-0.5).slice(0,3);
    const drink = WTF_DRINK[Math.floor(Math.random()*WTF_DRINK.length)];
    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Sequenza obbligatoria: presa in giro → 2–3 micro-imprevisti → “${impre}” teatrale → ${react.length} reazioni → drink (“${drink}”) → risposta vera → morale ironica.`;
    msgs.push({ role:"system", content:WTF_RULE_IT });
  } else {
    msgs.push(
      { role:"system", content:WHATIF_RULE_IT },
      { role:"system", content:`ESEMPIO (tono):\n${WHATIF_HYBRID_EX_IT}` }
    );
  }

  msgs.push({ role:"user", content:`Domanda: "${domanda}". Rispondi in un solo paragrafo.` });
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", lang="it", periodo="future" } = body;

    if(!domanda) return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf"?0.98:0.82,
      top_p:0.92,
      max_tokens:480,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    answer = stripQuestionEcho(domanda, answer);

    // Aggiungi incipit variabile solo se manca
    if(stile==="whatif"){
      const opens = WHATIF_OPENERS.it;
      const opener = opens[Math.floor(Math.random()*opens.length)];
      const head = answer.slice(0,120).toLowerCase();
      const hasOpener = opens.some(o=>head.includes(o.slice(0,8).toLowerCase()));
      if(!hasOpener) answer = `${opener} ${answer}`;
    }

    // Post-process casing
    answer = tightenSentences(answer,8);
    answer = clampWords(answer,170);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    if(/^[a-zà-ÿ]/.test(answer)) answer = answer.charAt(0).toUpperCase()+answer.slice(1);
    answer = finalPunct(answer);

    return res.status(200).json({ answer, style:stile, lang:lang, model:MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:",err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
