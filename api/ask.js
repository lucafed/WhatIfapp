// /api/ask.js — What?f Engine (Stable Hybrid WHATIF + Friendly-WTF Demenziale) — MULTILINGUA
// Quote: FREE=3/giorno, PRO=10/giorno, ADMIN=illimitato (reset Europa/Roma). Anti-flood 10/min IP.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { randomBytes, createHash } from "node:crypto";

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
// preview tipo https://<branch>-what-ifapp-<hash>-vercel.app
const VERCEL_PREVIEW_RX = /^https:\/\/[a-z0-9-]+-what-ifapp-[a-z0-9-]+-vercel\.app$/i;
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const ok = ALLOWED_ORIGINS.includes(origin) || VERCEL_PREVIEW_RX.test(origin);
  if (ok) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro, x-pro-sign"
  );
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
const normLang = (l="it") => {
  const s = String(l||"it").toLowerCase().slice(0,2);
  return SUP_LANGS.includes(s) ? s : "it";
};
const normLine = (s="") => String(s).toLowerCase()
  .replace(/[“”"’']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();

function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/u)
    .map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){
  return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ")
    .replace(/\.\.\.+/g,"…").replace(/\s+([.,;:!?])/g,"$1").trim();
}
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"’']/g,"").trim().toLowerCase(); let t=String(text||"");
  if(d.length>=8){
    const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"’']/g,"").trim();
    if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  }
  const rx=/^(?:\s*(?:e\s*se|what\s*if|domanda:|q:)\s*[^.!?…]*[.!?…]\s+)/i;
  return t.replace(rx,"").trim();
}
const sentenceCaseAll = (s="") => s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/giu,(m,p,c)=>p+c.toUpperCase());
const finalPunct = (s="") => (/[.!?…]$/.test(s)?s:s+".");

/* ========= Random utils ========= */
function safeSeed(){ try{ return randomBytes(4).readUInt32BE(0)>>>0; }catch{ return Math.floor(Math.random()*2**32)>>>0; } }
function hash32(s){ return createHash("sha1").update(s).digest().readUInt32BE(0); }
function prng(seed){ let x=seed>>>0; return ()=>{ x=(x*1664525+1013904223)>>>0; return x/2**32; }; }
const pick = (r, arr)=> arr[Math.floor(r()*arr.length)];
function pickMany(r, arr, k){ const a=[...arr], out=[]; for(let i=0;i<Math.min(k,a.length);i++){ out.push(a.splice(Math.floor(r()*a.length),1)[0]); } return out; }

/* ========= Piani / Quote giornaliere ========= */
const boolHeader = v => String(v||"").trim()==="1" || String(v||"").toLowerCase()==="true";
function getAuthPlan(req){
  const admin = String(req.headers["x-admin-token"]||"");
  const proHdr = boolHeader(req.headers["x-pro"]);
  const proSig = String(req.headers["x-pro-sign"]||"");
  const isAdmin = !!process.env.ADMIN_TOKEN && admin === process.env.ADMIN_TOKEN;
  const isSignedPro = !!process.env.PRO_SHARED_SECRET && proSig === createHash("sha256")
    .update(process.env.PRO_SHARED_SECRET + "|" + (req.headers["origin"]||"")).digest("hex");
  const isPro = proHdr || isSignedPro || isAdmin;
  const plan = isAdmin ? "admin" : (isPro ? "pro" : "free");
  return { isAdmin, isPro, plan };
}
function romeYMD(date=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit"})
    .formatToParts(date).reduce((a,p)=> (a[p.type]=p.value, a), {});
  return `${parts.year}${parts.month}${parts.day}`;
}
function romeNextMidnightISO(date=new Date()){
  const s=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(date);
  const m=s.match(/(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2}):(\d{2})/);
  const now=new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`); const next=new Date(now); next.setDate(next.getDate()+1); next.setHours(0,0,0,0);
  return next.toISOString();
}

/* ========= Oggetti contestuali (WTF) ========= */
function deriveContextObjects(domanda){
  const d=String(domanda||"").toLowerCase(); const add=[];
  const map=[
    [/citt[aà]|quartier|trasfer|metro|bus|piazza|portici/, ["mappa piegata","lampione","panchina","targa del citofono"]],
    [/trasloc|casa|appart|affitto|mutuo|condominio|ascensor/, ["scatolone col pennarello","tapparella","citofono","ascensore che sospira"]],
    [/lavor|cv|curriculum|colloquio|linkedin|ufficio|contratto|stipend|cliente|negozio/, ["cartellina trasparente","sedia girevole","moka","post-it rancoroso","badge scolorito","POS nervoso"]],
    [/studio|esame|tesi|universit|scuola|prof/, ["quaderno con orecchie","evidenziatore asciutto","zaino che pesa","orologio giudicante"]],
    [/inglese|lingua|course|corso|lezione/, ["post-it con verbi","cuffie stanche","dizionario che sbadiglia"]],
    [/viagg|treno|volo|aereo|hotel|mare|montagna|strada/, ["valigia che borbotta","biglietto piegato","finestrino che riflette","cartello storto"]],
    [/soldi|budget|spesa|aumento|fattur|tasse|bollette|debito/, ["calcolatrice stanca","portafoglio magro","scontrino infinito"]],
    [/palestra|corsa|yoga|nuot|bici|moto/, ["scarpe che chiedono strada","casco nervoso","asciugamano sarcastico"]],
    [/startup|sito|e[- ]?commerce|shopify|app|pdf|form|pec|server/, ["laptop con adesivi","router capriccioso","pdf riottoso","modulo in triplice copia"]],
    [/relaz|amore|amico|partner|ex|solitud|cuore/, ["telefono che vuole sincerità","specchio onesto","playlist gelosa"]],
    [/bar|vino|birra|amaro|negroni|spritz|genziana/, ["bicchiere appiccicoso","bancone appiccicoso","tovagliolo macchiato"]],
  ];
  for(const [rx, objs] of map) if(rx.test(d)) add.push(...objs);
  return Array.from(new Set(add)).slice(0,4);
}

/* ========= WHAT IF (ibrido 60/40) ========= */
const WI_STARTERS_IT = [
  "Sai, questa non è una domanda leggera.",
  "Metti sul tavolo i numeri e poi la vita vera.",
  "Se guardi bene, la scelta non è solo conti: è respiro.",
  "Qui non si tratta di coraggio o fuga, ma di proporzioni.",
  "Prima l’aritmetica, poi la schiena quando chiudi la porta."
];
const WHATIF_RULES = {
  it: `Sei “What If”: voce lucida, empatica e luminosa, SECONDA PERSONA. Paragrafo unico, 7–10 frasi (~110–150 parole).
60% analisi concreta (routine, costi/benefici, spazio mentale), 40% immagini sobrie (treni, chiavi, finestre, vento, caffè).
Evita consigli/domande/emoji. Chiudi “aperto”, con sensazione di movimento.`,
  en:`You are “What If”: lucid, warm, second-person. One paragraph, 7–10 sentences. 60% concrete analysis, 40% gentle imagery. No advice/questions/emojis. End open.`
};

/* ========= WTF (bar poetico demenziale) ========= */
const WTF_RULES = {
  it:`Sei “What the F”: barista affettuoso e sarcastico. SECONDA PERSONA. Un paragrafo, 5–7 frasi (~100–120 parole).
Attacco confidenziale (“Oh senti…”, “Sai che ti dico…”, “Guarda…”). Usa OGGETTI CONTESTUALI alla scena (non riutilizzare moka/spritz se non pertinenti).
Tono poetico-sporco, linguaggio vivo (leggera imprecazione teatrale ok). Rispondi davvero alla domanda.
CHIUDI con: 1) immagine secca; 2) una riga di “morale demenziale”.`,
  en:`You are “What the F”: sarcastic but caring bartender. One paragraph, 5–7 sentences. Use contextual judging objects. End with a sharp visual + a one-line silly moral.`
};

const WTF_SILLY_MORALS_IT = [
  "Morale scema: meno piani, più passi storti.",
  "Morale scema: dignità in tasca, resto spicci falsi.",
  "Morale scema: chiedi al vento, paga il bar.",
  "Morale scema: il coraggio puzza ma apre porte.",
  "Morale scema: se tremi, accelera e saluta."
];
const WTF_VISUALS_IT = [
  "il vento in faccia e il bicchiere che scalda la mano",
  "la notte seduta accanto che smette di giudicare",
  "le luci sulla pietra che ti tengono in piedi",
  "le tasche vuote ma il passo finalmente pieno",
  "il casco appeso e il cuore che ruggisce piano"
];

/* ========= Periodo auto-detect ========= */
function detectPeriod(domanda, lang){
  const L = normLang(lang); const d = String(domanda||"").toLowerCase();
  const itPast=/\b(se\s+(?:avessi|fossi)|avrei|sarei|non\s+avessi|non\s+fossi)\b/;
  const enPast=/\b(what\s+if\s+i\s+had|if\s+i\s+had|i\s+would\s+have|i'd\s+have)\b/;
  const esPast=/\b(si\s+hubiera|habría|hubiese)\b/;
  const frPast=/\b(si\s+j(?:'|e)\s+avais|j'aurais)\b/;
  const dePast=/\b(hätte\s+ich|ich\s+hätte)\b/;
  const map = {it:itPast,en:enPast,es:esPast,fr:frPast,de:dePast};
  return (map[L]||itPast).test(d) ? "past" : "future";
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const base = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;
  const effPeriod = (periodo==="past"||periodo==="future") ? periodo : detectPeriod(domanda, L);
  const temporal =
    effPeriod==="past"
      ? (L==="en"?"Write as if it already happened.":"Scrivi come se fosse già successo.")
      : (L==="en"?"Write as a near-future unfolding starting now.":"Scrivi come un prossimo futuro che inizia ora.");

  const msgs=[ {role:"system", content:base}, {role:"system", content:temporal} ];

  if(stile==="wtf"){
    const r = prng(hash32(domanda) ^ safeSeed());
    const ctx = deriveContextObjects(domanda);
    const visuals = pick(r, WTF_VISUALS_IT);
    const moral = pick(r, WTF_SILLY_MORALS_IT);
    const starter = pick(r, ["Oh senti","Sai che ti dico","Guarda","Oh, allora","Ehi, parliamoci chiaro"]);
    const drink = pick(r, ["un amaro doppio","una birra media","un dito di genziana","uno spritz senza vergogna","un rum corto"]);
    const wtfRule = L==="en" ? WTF_RULES.en : `${WTF_RULES.it}
Suggerimenti (intreccia, niente elenchi visibili):
- Attacco: “${starter}…”.
- Oggetti dalla scena: ${ctx.length?ctx.join(", "):"sceglili in base alla risposta"}.
- Drink: ${drink}.
- Immagine finale: ${visuals}.
- Morale: ${moral}`;
    msgs.push({role:"system", content:wtfRule});
  } else {
    // WHAT IF con incipit variabile
    const r = prng(hash32(domanda) ^ safeSeed());
    const starter = (L==="it" ? pick(r, WI_STARTERS_IT) : null);
    const wiRule = WHATIF_RULES[L] || WHATIF_RULES.it;
    const starterHint = starter ? ` Inizia con un incipit analitico nello stile: “${starter}” (varialo liberamente, non ripetere sempre uguale).` : "";
    msgs.push({role:"system", content: wiRule + starterHint});
  }

  // Utente
  const ask =
    L==="en" ? `Question (do not repeat it): "${domanda}". ONE answer in ENGLISH, single paragraph.` :
    L==="es" ? `Pregunta (no la repitas): "${domanda}". Una sola respuesta en ESPAÑOL, un párrafo.` :
    L==="fr" ? `Question (ne la répète pas): « ${domanda} ». Une seule réponse en FRANÇAIS, un paragraphe.` :
    L==="de" ? `Frage (nicht wiederholen): „${domanda}“. Eine Antwort auf DEUTSCH, ein Absatz.` :
    `Domanda (non ripeterla): "${domanda}". Una sola risposta in ITALIANO, paragrafo unico.`;
  msgs.push({ role:"user", content: ask });

  return msgs;
}

/* ========= Chiusure di sicurezza ========= */
function ensureWtfClosing(text, L){
  let t=String(text||"").trim();
  t=t.replace(/\s*Morale scema:[\s\S]*$/i,"").trim();
  const visual = pick(prng(safeSeed()), WTF_VISUALS_IT);
  const moral  = pick(prng(safeSeed()^1234), WTF_SILLY_MORALS_IT);
  t = finalPunct(t);
  return `${t} ${visual}. ${moral}`;
}
function ensureWhatIfOpen(text){
  const t=String(text||"").trim();
  if(/[.!?…]$/.test(t) && /(continua|ancora|camminando|apre|aperta|aprirsi|sospesa|curios|vento|luce)$/i.test(t)) return t;
  return finalPunct(t.replace(/[.!?…]*$/,"")) + " E non finisce qui: continua piano, mentre ti muovi.";
}

/* ========= OpenAI retry + timeout ========= */
async function askOpenAI(payload){
  const controller = new AbortController(); const to=setTimeout(()=>controller.abort(), 22000);
  let lastErr;
  for(let i=0;i<2;i++){
    try{
      const res = await client.chat.completions.create({ ...payload, signal: controller.signal });
      clearTimeout(to); return res;
    }catch(e){ lastErr=e; await new Promise(r=>setTimeout(r, 500*(i+1))); }
  }
  clearTimeout(to); throw lastErr;
}

/* ========= HANDLER ========= */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });

  const errId = Math.random().toString(36).slice(2,8);
  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });
    if(!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return res.status(500).json({ error:"missing_redis_env" });
    }

    // Anti-flood 10/min
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    // Piani & quote giornaliere
    const { isAdmin, isPro, plan } = getAuthPlan(req);
    const effectivePlanForQuota = isAdmin && isPro ? "pro" : plan;
    const FREE_LIMIT = 3, PRO_LIMIT = 10;
    const limit = effectivePlanForQuota==="admin" ? Infinity : (effectivePlanForQuota==="pro" ? PRO_LIMIT : FREE_LIMIT);
    const day = romeYMD();
    const quotaKey = `ask:quota:${effectivePlanForQuota}:${ip}:${day}`;
    let used = 0;
    if(effectivePlanForQuota!=="admin"){
      try{
        used = await redis.incr(quotaKey);
        if(used===1) await redis.expire(quotaKey, 36*60*60);
        if(used>limit){
          return res.status(429).json({ error:"quota_daily_exceeded", plan:effectivePlanForQuota, used, limit, reset_at_rome: romeNextMidnightISO() });
        }
      }catch(e){
        console.error("⚠️ Redis transient:", e?.message || e); used=-1; // soft-fail
      }
    }

    // Body
    let body={};
    try{ body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{}); }
    catch{ return res.status(400).json({ error:"bad_request", detail:"invalid_json" }); }
    const { domanda="", stile="whatif", lang="it", periodo="" } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    // Prompt
    const messages = buildMessages({ domanda, lang, periodo, stile });

    // Model params
    const MAX_TOKENS = isPro ? 520 : 440;
    const TEMP = stile==="wtf" ? (isPro?1.02:1.0) : (isPro?0.72:0.70);

    const completion = await askOpenAI({
      model: MODEL,
      temperature: TEMP,
      top_p: 0.92,
      max_tokens: MAX_TOKENS,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf" ? 7 : 10);
    answer = clampWords(answer, stile==="wtf" ? 125 : 150);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Chiusure coerenti
    const L = normLang(lang);
    if(stile==="wtf") answer = ensureWtfClosing(answer, L);
    else answer = ensureWhatIfOpen(answer);

    // Normalizzazioni IT
    if(L==="it"){
      const d=String(domanda||"");
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/gu;
      const inQ=new Set(d.match(nameRx)||[]);
      answer = answer.replace(nameRx,(m,_g1,offset,str)=>{
        if(offset===0) return m;
        const before=str.slice(0,offset);
        if(/[.!?…]["'”)\]]?\s*$/.test(before)) return m;
        return inQ.has(m) || ["Ah","Oh","Ehi","Sai","Guarda","Oh, allora"].includes(m) ? m : m.toLowerCase();
      });
      answer = answer.replace(/\ball’aquila\b/g,"all’Aquila");
    }
    // Maiuscola iniziale
    answer = answer.replace(/^\s*([a-zà-ÿ])/u,(m,c)=>c.toUpperCase());

    return res.status(200).json({
      answer,
      style: stile,
      lang: L,
      periodo: periodo || detectPeriod(domanda, lang),
      model: MODEL,
      plan,
      quota: effectivePlanForQuota==="admin" ? null : { used, limit, reset_at_rome: romeNextMidnightISO() }
    });

  }catch(err){
    const msg=String(err?.message||err);
    const code = /aborted|AbortError/i.test(msg)?504 : /rate|quota|429/i.test(msg)?429 : /invalid_api_key|401/i.test(msg)?401 : 500;
    console.error(`❌ [/api/ask] [${errId}]`, err);
    return res.status(code).json({ error:"server_error", code, id:errId, detail: msg.slice(0,400) });
  }
}

// Next.js: body limit
export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };
