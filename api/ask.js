// /api/ask.js — What?f Engine (2025 FINAL)
// Stili: whatif (narrative / analytical / poetic) · wtf (come l’originale: nomignolo → scena → imprevisto → “bestemmia” narrata → reazione, tutto nella narrazione)
// IT/EN — paragrafo singolo, niente liste/domande/emoji. NO trattini lunghi in output.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// ---------- Upstash ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

// ---------- CORS ----------
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

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const tinyHash = (s="") => { let h=2166136261>>>0; for (let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36); };

function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[]; const seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda, text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t=String(text||""); const lead=t.slice(0, Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  return t.replace(rx,"");
}

/* --- Anti-parolacce per WHAT IF (IT/EN) --- */
const BAD_WORDS = [
  "cazz[oi]","stronz[oa]","vaffan.*","merd[ae]","porc[oai]","fott.*","puttan[ao]","crist[oi]","madonn[a]","dio.*",
  "fuck","shit","bitch","asshole","bastard","damn\\b"
];
const BAD_RX = new RegExp(`\\b(?:${BAD_WORDS.join("|")})\\b`,"gi");
function scrubForWhatIf(t){ return String(t||"").replace(BAD_RX, s=>"*".repeat(Math.min(3,s.length))); }

/* --- WTF: firma narrativa COME IL TUO ORIGINALE --- */
// pool nomignoli (apertura secca, senza verbi)
const NICKS_IT = {
  m: ["campione","fenomeno","capitano del caos","poeta da bancone","rockstar con le tasche vuote"],
  f: ["regina del casino","fenomena","capitana del caos","signora dei forse","rockstar coi tacchi comodi"],
  nb:["leggenda","asso universale","cap* del caos","icone"]
};
const NICKS_EN = {
  m: ["champ","legend","captain of chaos"],
  f: ["queen of chaos","legend in sneakers","captain of detours"],
  nb:["icon","ace","captain of chaos"]
};
// imprevisti & reazioni
const MISHAPS_IT = [
  "ti cade il telefono nella tazzina",
  "parcheggi storto davanti a tutti e il sensore urla",
  "rovesci il caffè sulla camicia ‘buona’",
  "il badge si bagna e il portone ti guarda offeso",
  "il POS rifiuta la carta tre volte di fila",
  "lo zaino si incastra alla sedia e ti porta via metà dignità"
];
const REACTIONS_IT = [
  "i bicchieri vibrano e fanno finta di niente",
  "il barista alza il sopracciglio come un giudice buono",
  "due cucchiaini applaudono piano",
  "il lampione si gira dall’altra parte, educato",
  "la cassa tossisce e poi ti perdona",
  "il tavolino scuote la testa ma ti fa spazio"
];
const MISHAPS_EN = [
  "your phone dives into the espresso",
  "you park sideways and the sensor screams",
  "the coffee baptizes your ‘good’ shirt",
  "the badge is wet and the door looks offended",
  "the card gets declined three times",
  "the backpack hooks the chair and steals half your dignity"
];
const REACTIONS_EN = [
  "the glasses rattle and pretend nothing happened",
  "the barista lifts an eyebrow like a kind judge",
  "two teaspoons clap softly",
  "the streetlight looks away, politely",
  "the till coughs and then forgives you",
  "the table shakes its head and makes room"
];
// frasi “bestemmia narrata” (mai letterale)
const BLASP_IT = [
  "ti scappa una bestemmia teatrale che fa tremare i bicchieri",
  "ti parte una bestemmia da manuale che spolvera il bancone",
  "ti esplode una bestemmia epica che raddrizza pure la sedia",
  "ti scivola via una bestemmia d’antologia che mette d’accordo i cucchiaini"
];
const BLASP_EN = [
  "you let out a theatrical blasphemy that rattles the glasses",
  "a manual-grade blasphemy slips out and dusts the counter",
  "an epic blasphemy bursts and even straightens the chair",
  "a collector’s blasphemy escapes and hushes the teaspoons"
];

// util
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)] }
function firstSentenceOnly(t){ const m=String(t).match(/^([\s\S]*?[.!?…])\s/); return m?m[1]:t; }

// Enforce stile WTF fedele al tuo
function enforceWtfSignature(raw, lang="it", sex=""){
  let out = String(raw||"").trim();

  // 0) Niente trattini lunghi
  out = out.replace(/—/g, ",");

  // 1) No domande, no emoji
  out = out.replace(/[?]+/g, ".").replace(/\p{Extended_Pictographic}/gu, "");

  // 2) Apertura SOLO con nomignolo (senza verbi)
  const sexKey = (sex==="m"||sex==="f")?sex:"nb";
  const nick = isEn(lang) ? pick(NICKS_EN[sexKey]||NICKS_EN.nb) : pick(NICKS_IT[sexKey]||NICKS_IT.nb);
  // Se non parte con una sola parola tipo soprannome, forza l’apertura
  const first = firstSentenceOnly(out).trim();
  const looksLikeNick = /^[A-Za-zÀ-ÖØ-öø-ÿ'* ]+$/.test(first) && !/\b(io|tu|sei|are|you|am|sono|sto)\b/i.test(first) && first.split(" ").length<=4;
  if(!looksLikeNick){
    out = `${nick}, ${out[0]?.toLowerCase()===out[0]?out:out[0]?.toLowerCase()+out.slice(1)}`;
  }else{
    // sostituisci la prima frase con il nick se c’è verbo
    out = out.replace(/^([\s\S]*?)[.!?…]\s+/, `${nick}. `);
  }

  // 3) Garantire: imprevisto → bestemmia narrata → reazione (una sola volta), dentro la frase
  const mish = isEn(lang) ? pick(MISHAPS_EN) : pick(MISHAPS_IT);
  const blasp = isEn(lang) ? pick(BLASP_EN)   : pick(BLASP_IT);
  const react = isEn(lang) ? pick(REACTIONS_EN) : pick(REACTIONS_IT);

  const hasBlasp = isEn(lang) ? /\bblasphemy\b/i.test(out) : /\bbestemmia\b/i.test(out);

  if(!hasBlasp){
    // append alla penultima frase per tenerla “dentro”
    out = out.replace(/([.!?…])\s*$/, `, ${mish}, ${blasp}, ${react}.`);
  }else{
    // assicura che attorno ci sia l’imprevisto prima e la reazione dopo, tutto nella stessa frase
    if(isEn(lang)){
      out = out.replace(/\b(you\s+let\s+out\s+a\s+theatrical\s+blasphemy[^,.!?…]*)/i,
        `${mish}, $1, ${react}`);
      out = out.replace(/\b(blasphemy[^,.!?…]*)/i,
        `${mish}, you let out a theatrical $1, ${react}`);
    }else{
      out = out.replace(/\b(ti\s+scappa\s+una\s+bestemmia[^,.!?…]*)/i,
        `${mish}, $1, ${react}`);
      out = out.replace(/\b(bestemmia[^,.!?…]*)/i,
        `${mish}, ${blasp}, ${react}`);
    }
  }

  // 4) Limita a una sola “bestemmia narrata”
  if(isEn(lang)){
    let seen=false;
    out = out.replace(/\bblasphemy\b/gi, (m)=> (seen? "laugh you swallow" : (seen=true, m)));
  }else{
    let seen=false;
    out = out.replace(/\bbestemmia\b/gi, (m)=> (seen? "risata strozzata" : (seen=true, m)));
  }

  // 5) Pulizia punteggiatura e chiusura
  out = out.replace(/\s+,/g,",").replace(/,\s+[.]/g,". ").replace(/\s{2,}/g," ").trim();
  out = out.replace(/[?]/g,".");
  if(!/[.!?…]$/.test(out)) out+=".";
  return out;
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo="future", lang="it", style="whatif"){
  const en = isEn(lang);
  if(String(periodo||"").toLowerCase()==="past"){
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if it already happened. Prefer past/conditional. Single paragraph. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Scrivi come se fosse già successo. Preferisci passato/condizionale. Paragrafo unico. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near future as if stepping into it now. Single paragraph. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Paragrafo unico. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex="", tone="narrative"){
  const SEX = String(sex||"").toLowerCase();

  if(style==="wtf"){
    // Sistema “tale e quale”: roast affettuoso, scena concreta, imprevisto → bestemmia → reazione, niente liste/emoji/domande
    const SYS = (isEn(lang)
      ? `You are “What the F” — loud, loving roast. SECOND PERSON. One paragraph, 6–8 sentences (~125–165 words). Open ONLY with a nickname (no verbs). Keep it colloquial and visual, but grounded. Include exactly one brief NARRATED blasphemy tied to a mishap and fused inside the sentence (never literal, never standalone). Use alcohol beats and reacting objects only if they fit the scene. No lists, no questions, no emojis, no moralizing. Close warm and funny.`
      : `Sei “What the F” — amico rumoroso e affettuoso. SECONDA PERSONA. Un paragrafo, 6–8 frasi (~125–165 parole). Apri SOLO con un nomignolo (senza verbi). Colloquiale e visivo, ma concreto. Inserisci esattamente UNA “bestemmia” narrata, legata a un imprevisto e dentro la frase (mai letterale, mai da sola). Oggetti e alcol solo se stanno in scena. Niente elenchi, niente domande, niente emoji, niente prediche. Chiudi caldo e divertente.`);
    return { sys: SYS, fewshots: [] };
  }

  // WHAT IF — toni
  const guard = isEn(lang)
    ? `SECOND PERSON. Single paragraph. Vary cadence; no clichés; no profanity; no lists/questions/emojis.`
    : `SECONDA PERSONA. Paragrafo unico. Varia ritmo; niente cliché; niente parolacce; niente elenchi/domande/emoji.`;

  if(tone==="poetic"){
    const SYS = (isEn(lang)
      ? `You are "What If" — poetic but grounded. 8–11 sentences (~115–160 words). Subtle images; end with a soft reflective line. ${guard}`
      : `Sei "What If" — poetico ma concreto. 8–11 frasi (~115–160 parole). Immagini leggere; chiudi con una riga riflessiva. ${guard}`);
    return { sys: SYS, fewshots: [] };
  }
  if(tone==="analytical"){
    const SYS = (isEn(lang)
      ? `You are "What If" — analytical and dry. 8–11 sentences. Explicitly assess economy, schools, social life, and quality of life; state trade-offs cleanly; finish with a one-line takeaway. ${guard}`
      : `Sei "What If" — analitico e asciutto. 8–11 frasi. Valuta esplicitamente economia, scuola, vita sociale e qualità della vita; dichiara i trade-off; chiudi con un takeaway in una riga. ${guard}`);
    return { sys: SYS, fewshots: [] };
  }
  // narrative (il tuo reale)
  const SYS = (isEn(lang)
    ? `You are "What If" — realistic, lucid, warm. 8–11 sentences (~115–160 words). Plain human prose, concrete details, no stock imagery. End with a short reflective line (not advice). ${guard}`
    : `Sei "What If" — realistico, lucido, caldo. 8–11 frasi (~115–160 parole). Prosa semplice, dettagli concreti, senza immagini stereotipate. Chiudi con una riga riflessiva (non un consiglio). ${guard}`);
  return { sys: SYS, fewshots: [] };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res){
  cors(req, res);
  if (req.method==="OPTIONS") return res.status(200).end();
  if (req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    // IP + admin
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const admin = await (async function isAdmin(req, requesterIp){
      const token = String(req.headers["x-admin-token"]||"").trim(); if(!token) return false;
      try{
        const data = await redis.hgetall(`admin:token:${token}`);
        if(!data) return false;
        const LOCK_IP = String(process.env.ADMIN_LOCK_IP||"false").toLowerCase()==="true";
        if(LOCK_IP){ if(!data.ip) return false; return data.ip===requesterIp; }
        return true;
      }catch{ return false; }
    })(req, ip);
    const bypass = admin===true;
    const isPro = String(req.headers["x-pro"]||"").trim()==="1";

    // Rate
    if(!bypass){
      const { success } = await rl.limit(`ask:${ip}`);
      if(!success) return res.status(429).json({ error:"rate_limited_minute" });
    }

    // Crediti
    let used=0, dailyCap=isPro?10:3;
    if(!bypass){
      const today=new Date().toISOString().slice(0,10);
      const key=`credits:${ip}:${today}`;
      used=(await redis.incr(key))??1;
      if(used===1) await redis.expire(key, 60*60*24);
      if(used>dailyCap) return res.status(402).json({ error:"daily_credits_exhausted", used, dailyCap });
    }

    // Body
    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const {
      domanda = "",
      stile   = "whatif",
      lang    = "it",
      extra   = "",
      periodo = "future",
      sex     = "",
      micro   = {},
      tone    = "narrative"   // only for whatif
    } = body;

    if(!domanda || typeof domanda!=="string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, tone);
    const temporal = temporalSystem(periodo, lang, stile);

    // Prompt utente
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${tone}`),36) % 1000000;
    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra||"").trim()}". User sex="${resolvedSex||"unknown"}". TONE="${tone}". INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra||"").trim()}". Sesso utente="${resolvedSex||"unknown"}". TONO="${tone}". SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role:"system", content: sys },
      { role:"system", content: temporal },
      ...(fewshots||[]),
      { role:"user",   content: userPrompt },
    ];

    // LLM
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : (tone==="analytical" ? 0.62 : tone==="poetic" ? 0.88 : 0.82),
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile==="wtf" ? 0.4 : 0.1,
      presence_penalty:  stile==="wtf" ? 0.2 : 0.0,
      messages,
    });

    // Post
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf" ? 8 : 11);
    answer = clampWords(answer, stile==="wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);

    if(stile==="wtf"){
      answer = enforceWtfSignature(answer, lang, resolvedSex);
    }else{
      answer = scrubForWhatIf(answer);
      if(!/[.!?…]$/.test(answer)) answer+=".";
    }

    // LOG
    try{
      const entry = {
        ts: Date.now(), ip, style:stile, lang, periodo,
        sex: resolvedSex || null, tone,
        domanda_len: String(domanda||"").length,
        domanda_hash: tinyHash(domanda||""),
        answer_chars: (answer||"").length,
        admin: !!admin,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo||"future"), 1);
      await redis.hincrby("stats:tone", tone, 1);
      if(resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey=`stats:day:${new Date().toISOString().slice(0,10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}:${tone}`, 1);
      await redis.expire(dayKey, 90*24*60*60);
    }catch(e){ console.warn("log failure (non-bloccante)", e); }

    return res.status(200).json({
      answer, style:stile, lang, periodo, tone,
      model: MODEL, admin, pro:isPro,
      credits: admin ? null : { used, dailyCap }
    });

  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
