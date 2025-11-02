// /api/suggest.js — Generatore spunti (personalizzate/generiche/assurde)
// Stessa impostazione di /api/ask.js: OpenAI + Upstash Rate + CORS.

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
  limiter: Ratelimit.slidingWindow(20, "1 m"),
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
const normLang = (l="it") => {
  const s = String(l||"it").toLowerCase().slice(0,2);
  return SUP_LANGS.includes(s) ? s : "it";
};
const fallbackPools = {
  it:{
    generic: [
      "E se cambiassi lavoro quest’anno?",
      "E se ti trasferissi all’estero per 6 mesi?",
      "E se aprissi una piccola attività nel weekend?",
      "E se impostassi davvero un piano per l’inglese B2?",
      "E se provassi la settimana corta per un mese?",
      "E se spegnessi i social dopo le 22 per 30 giorni?",
      "E se organizzassi un esperimento di 7 giorni per un’abitudine che rimandi?",
      "E se delegassi una cosa che ti pesa ogni settimana?"
    ],
    absurd: [
      "E se domani il frigorifero ti suggerisse il menù della vita?",
      "E se aprissi una scuola per gatti allergici alle riunioni?",
      "E se diventassi l’allenatore non ufficiale del condominio?",
      "E se allenassi una squadra di cuscini gonfiabili la sera?"
    ]
  },
  en:{
    generic:[
      "What if you changed jobs this year?",
      "What if you lived abroad for 6 months?",
      "What if you started a weekend micro-business?",
      "What if you actually planned English B2?",
      "What if you tried a 4-day workweek for a month?",
      "What if you turned off social media after 10pm for 30 days?"
    ],
    absurd:[
      "What if tomorrow your fridge pitched you a life menu?",
      "What if you opened a school for cats who hate meetings?",
      "What if you became your building’s unofficial coach?"
    ]
  }
};
const finalQ = (q="", L="it") => {
  let t = String(q).replace(/[?？]+$/,"").trim();
  if(!t) return "";
  if(L==="es"){ if(!t.startsWith("¿")) t="¿"+t; if(!t.endsWith("?")) t+="?"; return t; }
  if(L==="fr"){ if(!t.endsWith("?")) t+=" ?"; return t.replace(/\s*\?$/," ?"); }
  if(!t.endsWith("?")) t+="?";
  return t;
};
function safeJSONPick(text){
  if(typeof text!=="string") return null;
  // prova a trovare il primo blocco JSON
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if(!m) return null;
  try{ return JSON.parse(m[0]); }catch{ return null; }
}

/* ========= Prompt ========= */
function buildSuggestPrompt({ lang, periodo, boost }){
  const L = normLang(lang);
  const instr = (L==="en")
    ? `Generate suggestions for the text field "What if…".`
    : (L==="it")
    ? `Genera suggerimenti per il campo "E se…".`
    : (L==="es")
    ? `Genera sugerencias para el campo "¿Y si…?".`
    : (L==="fr")
    ? `Génère des suggestions pour le champ "Et si…".`
    : `Erzeuge Vorschläge für das Feld „Was wäre, wenn…“.`;

  const tense = (String(periodo).toLowerCase()==="past")
    ? (L==="en" ? "Past hypothetical tone." : "Tono ipotetico al passato.")
    : (L==="en" ? "Near-future tone." : "Tono di prossimo futuro.");

  const spec = (L==="en")
    ? `Write short, well-formed questions. No lists, no numbering, no emojis.`
    : `Scrivi domande brevi e ben formate. Niente elenchi, numerazione o emoji.`;

  const out = (L==="en")
    ? `Return STRICT JSON: {"personalized":[...12], "generic":[...8], "absurd":[...4]}`
    : `Restituisci JSON STRETTO: {"personalizzate":[...12], "generiche":[...8], "assurde":[...4]}`;

  const boostHint = (L==="en")
    ? (boost ? `Prioritize topics related to: ${boost}` : `If no user profile, keep it broadly useful.`)
    : (boost ? `Dai priorità a temi legati a: ${boost}` : `Se non ci sono dati utente, mantieni utilità generale.`);

  const keyNames = (L==="en")
    ? `Use keys exactly "personalized", "generic", "absurd".`
    : `Usa esattamente le chiavi "personalized", "generic", "absurd".`;

  return [
    { role:"system", content:`You are a suggestion generator. ${instr} ${tense} ${spec} ${keyNames}` },
    { role:"user", content:`Language: ${L}\nBoost: ${boost || "(none)"}\n${out}\n${boostHint}` }
  ];
}

/* ========= Handler ========= */
export default async function handler(req, res){
  cors(req, res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    // Rate limit per IP
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`suggest:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const lang = normLang(body.lang || "it");
    const periodo = String(body.periodo || "future");
    const boost = String(body.boost || "").slice(0, 400);

    // Ping veloce (per tasto "Test AI")
    if (body.ping === true) {
      return res.status(200).json({ ok:true, ping:true, model: MODEL, ts: Date.now() });
    }

    const messages = buildSuggestPrompt({ lang, periodo, boost });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.6,
      top_p: 0.9,
      max_tokens: 500,
      messages,
    });

    let raw = completion?.choices?.[0]?.message?.content || "";
    let data = safeJSONPick(raw);
    if(!data || typeof data!=="object") throw new Error("bad_json");

    // Accetta sia chiavi EN sia eventuali localizzate
    const personalized = (data.personalized || data.personalizzate || []).map(x=>finalQ(x, lang)).filter(Boolean).slice(0,12);
    const generic      = (data.generic      || data.generiche      || []).map(x=>finalQ(x, lang)).filter(Boolean).slice(0,8);
    const absurd       = (data.absurd       || data.assurde        || []).map(x=>finalQ(x, lang)).filter(Boolean).slice(0,4);

    // Fallback se una categoria è vuota
    const pools = fallbackPools[lang] || fallbackPools.it;
    const ensure = (arr, need, from)=> (arr.length>=need) ? arr : [...arr, ...from].slice(0,need);
    const out = {
      personalized,
      generic: ensure(generic, 8, (pools.generic||[]).map(s=>finalQ(s, lang))),
      absurd: ensure(absurd, 4, (pools.absurd||[]).map(s=>finalQ(s, lang))),
      used: "ai"
    };

    return res.status(200).json(out);
  }catch(err){
    console.error("❌ [/api/suggest] error:", err);
    // Fallback totale
    const lang = normLang((req.body && req.body.lang) || "it");
    const pools = fallbackPools[lang] || fallbackPools.it;
    return res.status(200).json({
      personalized: [],                 // senza boost, lasciamo vuoto
      generic: (pools.generic||[]).map(s=>finalQ(s, lang)).slice(0,8),
      absurd: (pools.absurd||[]).map(s=>finalQ(s, lang)).slice(0,4),
      used: "fallback",
      error: String(err?.message||err)
    });
  }
}
