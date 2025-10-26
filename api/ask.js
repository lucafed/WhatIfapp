// /api/ask.js — What?f Engine (2025 FINAL)
// Stili: whatif (narrative / analytical / poetic) · wtf (sarcasmo affettuoso con “bestemmia” narrata su evento)
// IT/EN — paragrafo singolo, niente liste/domande/emoji

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

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
  // IT (parolacce comuni; lasciamo passare “bestemmia” come parola, non slur)
  "cazz[oi]", "stronz[oa]","vaffan.*","merd[ae]","porc[oai]","fott.*","puttan[ao]","crist[oi]", "madonn[a]","dio.*",
  // EN
  "fuck","shit","bitch","asshole","bastard","damn\\b"
];
const BAD_RX = new RegExp(`\\b(?:${BAD_WORDS.join("|")})\\b`,"gi");
function scrubForWhatIf(t){ return String(t||"").replace(BAD_RX, s=>"*".repeat(Math.min(3,s.length))); }

/* --- WTF: garantisce “evento → bestemmia narrata → reazione”, senza trattini --- */
const MISHAPS_IT = [
  "ti cade il telefono dentro la tazzina",
  "il badge si bagna e non apre il portone",
  "parcheggi al contrario davanti a tutti",
  "rovesci il caffè sulla maglia nuova",
  "ti si incastra lo zaino nella sedia",
  "il POS rifiuta la carta tre volte"
];
const REACTIONS_IT = [
  "i bicchieri vibrano e fanno finta di nulla",
  "il barista alza il sopracciglio come un giudice buono",
  "due cucchiaini applaudono piano",
  "il lampione si gira dall’altra parte educatamente",
  "la cassa tossisce e poi ti perdona",
  "il tavolino ti rimette al mondo con un colpo di gomito"
];
const MISHAPS_EN = [
  "your phone dives into the espresso",
  "the badge gets wet and the door won’t buzz",
  "you park the wrong way in front of everyone",
  "the coffee baptizes your new shirt",
  "your backpack hooks the chair",
  "the card gets declined three times"
];
const REACTIONS_EN = [
  "the glasses rattle and pretend nothing happened",
  "the barista raises one eyebrow like a kind judge",
  "two teaspoons clap softly",
  "the streetlight looks away, politely",
  "the till coughs and forgives you",
  "the table nudges you back to life"
];

function ensureWtfEventFlow(t, lang="it"){
  let out = String(t||"");

  // togli i trattini lunghi: user li odia
  out = out.replace(/—/g, ",");

  // se non c’è una “bestemmia narrata”, prova a inserirla in modo naturale
  const hasMarkerIT = /bestemmia/i.test(out);
  const hasMarkerEN = /blasphemy/i.test(out);
  if(!(hasMarkerIT||hasMarkerEN)){
    const mish = (lang.startsWith("en")?MISHAPS_EN:MISHAPS_IT);
    const react= (lang.startsWith("en")?REACTIONS_EN:REACTIONS_IT);
    const m = mish[Math.floor(Math.random()*mish.length)];
    const r = react[Math.floor(Math.random()*react.length)];
    if(lang.startsWith("en")){
      out = out.replace(/([.!?…])\s*$/, `, you let out a theatrical blasphemy that rattles the glasses, ${r}.`);
    }else{
      out = out.replace(/([.!?…])\s*$/, `, ti scappa una bestemmia teatrale che fa tremare i bicchieri, ${r}.`);
    }
  }else{
    // c’è: assicura che sia legata a un evento e seguita da reazione, e che non sia da sola
    const mish = (lang.startsWith("en")?MISHAPS_EN:MISHAPS_IT);
    const react= (lang.startsWith("en")?REACTIONS_EN:REACTIONS_IT);
    const m = mish[Math.floor(Math.random()*mish.length)];
    const r = react[Math.floor(Math.random()*react.length)];
    // collega l’evento prima della “bestemmia” se manca
    if(lang.startsWith("en")){
      out = out.replace(/(^|\s)(you\s+let\s+out\s+a\s+blasphemy[^,.!?]*)([,.!?])/i,
        (_,pre,b,tail)=> `${pre}${m}, ${b}, ${r}${tail}`);
    }else{
      out = out.replace(/(^|\s)(ti\s+scappa\s+una\s+bestemmia[^,.!?]*)([,.!?])/i,
        (_,pre,b,tail)=> `${pre}${m}, ${b}, ${r}${tail}`);
    }
  }

  // contieni a una “bestemmia” sola
  if(lang.startsWith("en")){
    out = out.replace(/you\s+let\s+out\s+a\s+blasphemy/gi, (m, off, full)=>{
      const first = out.indexOf(m); return (off===first)?m:"a laugh you swallow";
    });
  }else{
    out = out.replace(/ti\s+scappa\s+una\s+bestemmia/gi, (m, off)=>{
      const first = out.toLowerCase().indexOf("ti scappa una bestemmia");
      return (off===first)?m:"una risata che soffochi";
    });
  }

  // pulizia spazi/virgole
  out = out.replace(/\s+,/g,",").replace(/,\s+[.]/g,". ").replace(/\s{2,}/g," ").trim();
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
  const nickIT = (SEX==="f")
    ? ["regina del casino","fenomena","capitana del caos","signora dei forse","rockstar coi tacchi comodi"]
    : (SEX==="m")
      ? ["campione","fenomeno","capitano del caos","poeta da bancone","rockstar con tasche vuote"]
      : ["leggenda","icone","asso universale","cap* del caos"];
  const nickEN = (SEX==="f")
    ? ["queen of chaos","legend in sneakers","captain of detours"]
    : (SEX==="m")
      ? ["champ","legend","captain of chaos"]
      : ["icon","ace","captain of chaos"];

  if(style==="wtf"){
    const SYS = (isEn(lang)
      ? `You are “What the F” — loud, loving roast. SECOND PERSON. One paragraph, 6–8 sentences (~125–165 words). Open ONLY with a nickname. Use alcohol beats and reacting objects only if relevant. Include exactly one brief narrated blasphemy tied to a mishap and fused inside the sentence (no separate sentence, never literal). No lists, no questions, no emojis. Close warm and funny. Nicknames: ${nickEN.join(", ")}.`
      : `Sei “What the F” — amico rumoroso ma buono. SECONDA PERSONA. Un paragrafo, 6–8 frasi (~125–165 parole). Apri SOLO con un nomignolo. Usa alcol e oggetti che “reagiscono” solo se servono. Inserisci esattamente una bestemmia narrata legata a un imprevisto e dentro la frase (mai a sé, mai letterale). Niente elenchi/domande/emoji. Chiudi caldo e divertente. Nomignoli: ${nickIT.join(", ")}.`);
    return { sys: SYS, fewshots: [] };
  }

  // WHAT IF — tre toni distinti
  const guard = isEn(lang)
    ? `SECOND PERSON. Single paragraph. Vary cadence; no clichés; no profanity; no lists/questions/emojis.`
    : `SECONDA PERSONA. Paragrafo unico. Varia ritmo; niente cliché; niente parolacce; niente elenchi/domande/emoji.`;

  if(tone==="poetic"){
    const SYS = (isEn(lang)
      ? `You are "What If" — poetic but grounded, intimate images, light irony. 8–11 sentences (~115–160 words). End with a soft reflective line. ${guard}`
      : `Sei "What If" — poetico ma concreto, immagini leggere, ironia lieve. 8–11 frasi (~115–160 parole). Chiudi con una riga riflessiva. ${guard}`);
    return { sys: SYS, fewshots: [] };
  }

  if(tone==="analytical"){
    const SYS = (isEn(lang)
      ? `You are "What If" — analytical and dry. 8–11 sentences. Evaluate economy, schools, social life, and quality of life for the scenario; spell trade-offs plainly; point to likely outcomes; finish with a one-line takeaway. ${guard}`
      : `Sei "What If" — analitico e asciutto. 8–11 frasi. Valuta esplicitamente economia, scuola, vita sociale e qualità della vita; descrivi i trade-off con prosa pulita; indica esiti probabili; chiudi con un takeaway in una riga. ${guard}`);
    return { sys: SYS, fewshots: [] };
  }

  // narrative (il tuo esempio: caldo, umano, realistico)
  const SYS = (isEn(lang)
    ? `You are "What If" — realistic, lucid, warm. 8–11 sentences (~115–160 words). Plain human prose, concrete details, no stock imagery. End with a short reflective line (not advice). ${guard}`
    : `Sei "What If" — realistico, lucido, caldo. 8–11 frasi (~115–160 parole). Prosa semplice, dettagli concreti, niente immagini stereotipate. Chiudi con una riga riflessiva (non un consiglio). ${guard}`);
  return { sys: SYS, fewshots: [] };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res){
  cors(req, res);
  if (req.method==="OPTIONS") return res.status(200).end();
  if (req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

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

    if(!bypass){
      const { success } = await rl.limit(`ask:${ip}`);
      if(!success) return res.status(429).json({ error:"rate_limited_minute" });
    }

    let used=0, dailyCap=isPro?10:3;
    if(!bypass){
      const today=new Date().toISOString().slice(0,10);
      const key=`credits:${ip}:${today}`;
      used=(await redis.incr(key))??1;
      if(used===1) await redis.expire(key, 60*60*24);
      if(used>dailyCap) return res.status(402).json({ error:"daily_credits_exhausted", used, dailyCap });
    }

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const {
      domanda = "",
      stile   = "whatif",
      lang    = "it",
      extra   = "",
      periodo = "future",
      sex     = "",
      micro   = {},
      tone    = "narrative"   // narrative | analytical | poetic
    } = body;

    if(!domanda || typeof domanda!=="string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, tone);
    const temporal = temporalSystem(periodo, lang, stile);

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

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : (tone==="analytical" ? 0.62 : tone==="poetic" ? 0.88 : 0.82),
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile==="wtf" ? 0.4 : 0.1,
      presence_penalty:  stile==="wtf" ? 0.2 : 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf" ? 8 : 11);
    answer = clampWords(answer, stile==="wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);

    if(stile==="wtf"){
      answer = ensureWtfEventFlow(answer, lang);
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
      credits: bypass ? null : { used, dailyCap }
    });

  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
