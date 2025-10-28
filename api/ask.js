// /api/ask.js — What?f Engine (FINAL CLEAN COPY)
// Nessuna personalità o descrizione di tono. Solo: regole tecniche + esempi da imitare.
// Stili supportati: whatif (mode: analitico | reale) · wtf
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis senza contenuto domanda (solo metadati + hash)

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
  const rx=/^(?:e\\s*se|what\\s*if|domanda:|q:)[^.!?…]*[.!?…]\\s+/i;
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

/* ========= ESEMPI WHAT IF ========= */
const EX_WHATIF_ANALITICO_IT = `Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini...`;
const EX_WHATIF_REALE_IT = `Bella questa, Luca — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza...`;
const EX_WHATIF_ANALYTIC_EN = `You’ll feel like a guest, then your hands learn the new keys...`;

/* ========= ESEMPI WHAT THE F ========= */
const WTF_EXAMPLES = [
`Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo...`,
`Oh, eccoci, centauro dell’inferno!...`,
`Ah, Luisa… ci risiamo, eh?...`,
`Ah ma guarda te, filosofo del venerdì!...`,
`Oh, eccoci, campione di maturità relativa!...`,
`Ah, Luisa… vestita di seta e sarcasmo...`,
`Ah ma guarda te, eroe del cartellino!...`,
`Oh, eccoci, atleta del divano!...`,
`Ah, Luisa… santo gin tonic e nervi d’acciaio...`,
`Champ, you arrive like a limited series pilot...`
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode }) {
  const en = isEn(lang);
  const msgs = [
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  if (stile === "wtf") {
    WTF_EXAMPLES.forEach(ex => msgs.push({ role: "system", content: `ESEMPIO · WTF\n${ex}` }));
  } else {
    if (mode === "analitico") {
      msgs.push({ role: "system", content: `ESEMPIO · WHAT IF (IT) Analitico\n${EX_WHATIF_ANALITICO_IT}` });
      msgs.push({ role: "system", content: `EXAMPLE · WHAT IF (EN) Analytic\n${EX_WHATIF_ANALYTIC_EN}` });
    } else {
      msgs.push({ role: "system", content: `ESEMPIO · WHAT IF (IT) Reale\n${EX_WHATIF_REALE_IT}` });
    }
  }

  const USER = en
    ? `User question (do NOT restate it): "${domanda}". Produce one single-paragraph answer in ${lang.toUpperCase()}.`
    : `Domanda (NON ripeterla): "${domanda}". Genera UNA risposta in ${lang.toUpperCase()} a paragrafo unico.`;

  msgs.push({ role: "user", content: USER });
  return msgs;
}

/* ========= Handler ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", mode = "reale", lang = "it", periodo = "future" } = body;
    if (!domanda || typeof domanda !== "string") return res.status(400).json({ error: "bad_request" });

    const messages = buildMessages({ domanda, lang, periodo, stile, mode });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 380,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 168 : 162);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    return res.status(200).json({ answer, style: stile, mode, lang, periodo, model: MODEL });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
