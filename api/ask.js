// /api/ask.js — What?f Engine (What If “realismo brillante” + What the F “bar poetico”) — MULTILINGUA
// Quote giornaliere: FREE=3/giorno, PRO=10/giorno, ADMIN=illimitato (reset Europa/Roma)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit"; // (non usato per le quote giornaliere, pronto per antiflood)
import { randomBytes, createHash } from "node:crypto";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
const VERCEL_PREVIEW_RX = /^https:\/\/[a-z0-9-]+-what-ifapp-[a-z0-9-]+-vercel\.app$/i;
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const ok = ALLOWED_ORIGINS.includes(origin) || VERCEL_PREVIEW_RX.test(origin);
  if (ok) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro, x-pro-sign");
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
const normLang = (l="it") => SUP_LANGS.includes(String(l||"it").toLowerCase().slice(0,2))
  ? String(l).toLowerCase().slice(0,2) : "it";
const normLine = (s="")=>String(s).toLowerCase().replace(/[“”"’']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()[\]\-—]+$/g,"").trim();
function tightenSentences(text, maxS){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/u).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set(); for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); if(out.length>=maxS) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxW){
  const w=String(text||"").split(/\s+/); if(w.length<=maxW) return text;
  const slice=w.slice(0,maxW).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\.\.\.+/g,"…").replace(/\s+([.,;:!?])/g,"$1").trim();}
function stripQuestionEcho(domanda,text){
  let t=String(text||""); const d=String(domanda||"").replace(/[“”"’']/g,"").trim().toLowerCase();
  if(d.length>=8){ const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"’']/g,"").trim();
    if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); } }
  const rx=/^(?:\s*(?:e\s*se|what\s*if|domanda:|q:)\s*[^.!?…]*[.!?…]\s+)/i; return t.replace(rx,"").trim();
}
const sentenceCaseAll=(s="")=>s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/giu,(m,p,c)=>p+c.toUpperCase());
const finalPunct=(s="")=>/[.!?…]$/.test(s)?s:s+".";

/* Variability */
function hash32(s){ return createHash("sha1").update(s).digest().readUInt32BE(0); }
function makePRNG(seed){ let x = seed>>>0; return ()=>{ x=(x*1664525+1013904223)>>>0; return x/2**32; }; }
function pick(prng, arr){ return arr[Math.floor(prng()*arr.length)] }
function pickMany(prng, arr, k){
  const a=[...new Set(arr)]; const out=[];
  for(let i=0;i<Math.max(0,Math.min(k,a.length));i++){
    const idx=Math.floor(prng()*a.length); out.push(a.splice(idx,1)[0]);
  }
  return out;
}

/* ===== Auth / Quota ===== */
function boolHeader(v){ return String(v||"").trim()==="1" || String(v||"").toLowerCase()==="true"; }
function getAuthPlan(req){
  const admin = String(req.headers["x-admin-token"]||"");
  const proHdr = boolHeader(req.headers["x-pro"]);
  const proSig = String(req.headers["x-pro-sign"]||"");
  const isAdmin = !!process.env.ADMIN_TOKEN && admin === process.env.ADMIN_TOKEN;
  const isSignedPro = !!process.env.PRO_SHARED_SECRET && proSig === createHash("sha256")
    .update(process.env.PRO_SHARED_SECRET + "|" + (req.headers["origin"]||""))
    .digest("hex");
  const isPro = proHdr || isSignedPro || isAdmin;
  const plan = isAdmin ? "admin" : (isPro ? "pro" : "free");
  return { isAdmin, isPro, plan };
}
function romeYMD(date=new Date()){
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(date).reduce((a,p)=>(a[p.type]=p.value,a),{});
  return `${parts.year}${parts.month}${parts.day}`;
}
function romeNextMidnightISO(date=new Date()){
  const nowRomeStr = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date);
  const m=nowRomeStr.match(/(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2}):(\d{2})/);
  const nowRome=new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`); const next=new Date(nowRome); next.setDate(next.getDate()+1); next.setHours(0,0,0,0);
  return next.toISOString();
}

/* ===== Oggetti dal testo ===== */
function deriveContextObjects(domanda){
  const d=String(domanda||"").toLowerCase(); const add=[];
  const map=[
    [/citt[aà]|quartier|centro/i,"mappa piegata"],
    [/trasloc|casa|appart|affitto/i,"scatolone col pennarello"],
    [/lavor|cv|curriculum|colloquio|linkedin/i,"cartellina trasparente"],
    [/studio|esame|tesi|universit/i,"quaderno con orecchie"],
    [/inglese|lingua|course|corso/i,"post-it con verbi irregolari"],
    [/viagg|treno|volo|aereo|hotel/i,"valigia che borbotta"],
    [/soldi|budget|spesa|aumento|stipend/i,"calcolatrice stanca"],
    [/palestra|corsa|yoga|nuot|bici/i,"scarpe che chiedono strada"],
    [/startup|sito|e[- ]?commerce|shopify|app/i,"laptop con adesivi motivazionali"],
    [/relaz|amico|partner|ex/i,"telefono che vuole essere sincero"]
  ];
  for(const [rx,obj] of map){ if(rx.test(d)) add.push(obj); }
  return Array.from(new Set(add)).slice(0,3);
}

/* ===== Detect categoria (per lessico dinamico) ===== */
const CAT_RX = [
  {cat:'lavoro', rx:/lavor|assunz|colloqu|cv|linkedin|ufficio|azienda|capo/i},
  {cat:'studio', rx:/studio|esame|tesi|universit|corso|lezion|inglese/i},
  {cat:'viaggi', rx:/viagg|treno|volo|aereo|hotel|ostello|città|mare|montagna/i},
  {cat:'tech',   rx:/ai\b|app|sito|script|automation|notion|email|server|bug|deploy/i},
  {cat:'sport',  rx:/palestra|corsa|nuoto|bici|allen|calorie|passi|yoga/i},
  {cat:'soldi',  rx:/soldi|budget|rispar|spesa|debito|mutuo|stipend|fattur/i},
  {cat:'relaz',  rx:/partner|ex|amico|famiglia|relaz|uscire|appunt/i},
  {cat:'casa',   rx:/trasloco|affitto|arredo|ristrutt|puliz|condominio|bollette/i},
  {cat:'business',rx:/e-?commerce|shopify|cliente|fattura|newsletter|pitch|startup/i},
];
function detectCategory(q){ const t=String(q||""); for(const r of CAT_RX){ if(r.rx.test(t)) return r.cat; } return 'lavoro'; }

/* ===== WHAT IF rules ===== */
const WHATIF_RULES = {
  it:`Sei “What If”: voce lucida, empatica e luminosa. SECONDA PERSONA, UN PARAGRAFO (6–9 frasi, ~100–130 parole). 
Niente consigli, niente liste, niente emoji. Chiusura sospesa e aperta.
Segui come tono i seguenti esempi (non citarli, ma imitarne ritmo e lessico):
☕ … (omessi qui per brevità, presenti negli step precedenti)`,
  en:`You are “What If”: lucid, warm, cinematic. Second person, one paragraph, 6–9 sentences (~100–130 words). No advice/lists/emojis. Open ending.`
};

/* ===== WTF rules ===== */
const WTF_RULES = {
  it:`Sei “What the F”: barista affettuoso e sarcastico. SECONDA PERSONA. UN PARAGRAFO, 5–7 frasi (~100–115 parole).
Attacco confidenziale (“Oh senti…”, “Sai che ti dico…”, “Guarda…”).
Oggetti/luoghi commentano o giudicano. Linguaggio vivo, anche un filo volgare se naturale.
Niente morale, niente elenchi, niente emoji. Chiudi con immagine secca (vento in faccia, risata storta, bicchiere che scalda).`,
  en:`You are “What the F”: sarcastic but caring bartender. One paragraph, 5–7 sentences (~100–115 words). Conversational opener, judging objects, gritty, end on a sharp image.`
};

/* ===== Lessico dinamico per WTF ===== */
const LEXICON = {
  base:{
    starters:["Oh senti","Sai che ti dico","Guarda","Oh, allora","Ehi, parliamoci chiaro","Senti qua","Diciamocelo"],
    drinks:["genziana","amaro del Capo","mirto","grappa fredda","vino sfuso","negroni","spritz","birra media","rum economico"],
    objects:["moka","tapparella","citofono","frigorifero","sedia girevole","lampione","stampante","ventilatore","telecomando","pianta","portachiavi","tenda","zaino","scarponi","notes","bicicletta"],
    places:["bar di quartiere","balcone","androne","banchina del treno","panchina in piazza","corridoio dell’ufficio","stazione rumorosa","garage","cucina in penombra"],
    sounds:["scricchiolio della sedia","citofono nervoso","sirena lontana","tapparella che sbatte","goccia dal rubinetto","tram che fischia","casse che gracchiano"]
  },
  lavoro:{objects:["badge scolorito","monitor stanco","cartellina di plastica","timbro che sbaglia l’ora"], places:["corridoio dell’ufficio","open space vuoto"], drinks:["caffè bruciato in sala","lager tiepida"], sounds:["stampante che tossisce"]},
  studio:{objects:["evidenziatore secco","quaderno piegato","zaino troppo pieno"], places:["biblioteca rumorosa","aula fredda"], drinks:["caffè della macchinetta"], sounds:["ventilazione che ronza"]},
  viaggi:{objects:["valigia che borbotta","trolley testardo","mappa spiegazzata"], places:["banchina del treno","uscita dal casello","terminal affollato"], drinks:["amaro al bancone","birra in plastica"], sounds:["annuncio in ritardo","ruote sul pavé"]},
  tech:{objects:["laptop con adesivi","cavo che non va","server permaloso"], places:["scrivania caotica","coworking notturno"], drinks:["energy drink stanco","americano lungo"], sounds:["ventola che urla"]},
  sport:{objects:["scarpe che chiedono strada","tuta che fruscia","asciugamano insofferente"], places:["pista bagnata","spogliatoio vuoto"], drinks:["isotonica anonima"], sounds:["respiro a scatti"]},
  soldi:{objects:["portafoglio magro","calcolatrice stanca","scontrini arrotolati"], places:["posta affollata","sportello luminoso"], drinks:["amaro amaro"], sounds:["monete che tintinnano"]},
  relaz:{objects:["telefono geloso","specchio onesto","giacca appesa male"], places:["panchina al parco","scalinata del palazzo"], drinks:["vino troppo sincero"], sounds:["messaggi che non arrivano"]},
  casa:{objects:["scopa appoggiata","aspirapolvere offeso","piatti accatastati"], places:["cucina stretta","sgabuzzino eroico"], drinks:["tisana triste","birra dal frigo"], sounds:["goccia dal lavandino"]},
  business:{objects:["POS nervoso","scontrini che scappano","insegna storta"], places:["retro del negozio","magazzino in disordine"], drinks:["caffè del vicino"], sounds:["saracinesca che cigola"]}
};
function buildDynamicLexicon(domanda){
  const cat = detectCategory(domanda);
  const b = LEXICON.base;
  const c = LEXICON[cat] || {};
  return {
    starters: b.starters,
    drinks: [...b.drinks, ...(c.drinks||[])],
    objects: [...b.objects, ...(c.objects||[])],
    places:  [...b.places,  ...(c.places||[])],
    sounds:  [...b.sounds,  ...(c.sounds||[])]
  };
}

/* ===== Periodo ===== */
function detectPeriod(domanda, lang){
  const L=normLang(lang); const d=String(domanda||"").toLowerCase();
  const itPast=/\b(se\s+(?:avessi|fossi)|avrei|sarei|non\s+avessi|non\s+fossi)\b/;
  const enPast=/\b(what\s+if\s+i\s+had|if\s+i\s+had|i\s+would\s+have|i'd\s+have)\b/;
  const esPast=/\b(si\s+hubiera|habría|hubiese)\b/; const frPast=/\b(si\s+j(?:'|e)\s+avais|j'aurais)\b/; const dePast=/\b(hätte\s+ich|ich\s+hätte)\b/;
  const map={it:itPast,en:enPast,es:esPast,fr:frPast,de:dePast}; const rx=map[L]||itPast; return rx.test(d)?"past":"future";
}

/* ===== Prompt builder ===== */
function buildMessages({ domanda, lang, periodo, stile }){
  const L=normLang(lang);
  const baseRules = L==="en" ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.` :
    `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;
  const effP = (periodo==="past"||periodo==="future")?periodo:detectPeriod(domanda,L);
  const temporal = effP==="past"
    ? (L==="en"?"Write counterfactual: as if it had already happened.":"Scrivi controfattuale: come se fosse già successo.")
    : (L==="en"?"Write predictive: near-future unfolding starting now.":"Scrivi predittivo: un prossimo futuro che inizia ora.");

  const msgs=[{role:"system",content:baseRules},{role:"system",content:temporal}];

  if(stile==="wtf"){
    // ==== Lessico dinamico + contesto
    const daySalt = new Date().getUTCDate(); // piccolo sale quotidiano per variare
    const prng = makePRNG(hash32(domanda) ^ daySalt ^ randomBytes(4).readUInt32BE(0));
    const lex = buildDynamicLexicon(domanda);
    const starter = pick(prng, lex.starters);
    const objs = pickMany(prng, [...lex.objects, ...deriveContextObjects(domanda)], 2 + Math.floor(prng()*3)); // 2–4
    const places = pickMany(prng, lex.places, 1 + (prng()<0.5?0:1)); // 1–2
    const sounds = pickMany(prng, lex.sounds, prng()<0.5?1:2);
    const drinks = pickMany(prng, lex.drinks, 1 + (prng()<0.5?1:0));

    const hintIt = `${WTF_RULES.it}
Suggerimenti da intrecciare NATURALMENTE (non come lista, non nominare le categorie):
- Attacco confidenziale tipo: “${starter}…”.
- Oggetti/scene: ${[...objs, ...places].join(", ")}.
- Dettagli sonori: ${sounds.join(", ")}.
- Sbronza accidentale: ${drinks.join(" + ")}.`;

    msgs.push({ role:"system", content: (L==="en")?WTF_RULES.en:hintIt });

  } else {
    msgs.push({ role:"system", content: WHATIF_RULES[L] || WHATIF_RULES.it });
  }

  const ask = (stile==="wtf")
    ? (L==="en"
        ? `Do NOT repeat the question. ONE PARAGRAPH (5–7 sentences, ~100–115 words). Conversational, gritty, slightly drunk. Include judging objects naturally. "${domanda}"`
        : `Non ripetere la domanda. UN PARAGRAFO (5–7 frasi, ~100–115 parole). Tono confidenziale, continuo, ironico. Inserisci gli oggetti/luoghi/suoni in modo naturale. Linguaggio vivo. "${domanda}"`)
    : (L==="en"
        ? `Do not restate the question. ONE PARAGRAPH (6–9 sentences, ~100–130 words). Bright, warm, everyday imagery. No advice or questions. "${domanda}"`
        : `Non ripetere la domanda. UN PARAGRAFO (6–9 frasi, ~100–130 parole). Luminoso, concreto, senza consigli o domande. "${domanda}"`);
  msgs.push({role:"user",content:ask});
  return msgs;
}

/* ===== Chiusure di sicurezza ===== */
function ensureWtfClosing(text, L){
  const t=String(text||"").trim();
  if(/[.!?…]$/.test(t) && /vento|bicchiere|faccia|sorriso|risata|notte|bar|strada|cuore/i.test(t)) return t;
  const add = L==="en" ? " And you end up laughing alone, wind in your face and the glass warming your hand."
    : " E ti scappa una risata storta, col vento in faccia e il bicchiere che ti scalda la mano.";
  return finalPunct(t.replace(/[.!?…]*$/,"")) + add;
}
function ensureWhatIfOpen(text, L){
  const t=String(text||"").trim();
  if(/[.!?…]$/.test(t) && /(continua|camminando|pronto|ancora|apre|aperta|aprirsi|sospesa|curios|vento|luce)$/i.test(t)) return t;
  const add = L==="en" ? " And it doesn’t end there; it keeps moving, softly." : " E non finisce lì: continua piano, mentre ti muovi.";
  return finalPunct(t.replace(/[.!?…]*$/,"")) + add;
}

/* ===== OpenAI retry ===== */
async function askOpenAI(payload){
  let last; for(let i=0;i<2;i++){ try{ return await client.chat.completions.create(payload); } catch(e){ last=e; await new Promise(r=>setTimeout(r, 400*(i+1))); } }
  throw last;
}

/* ===== Handler ===== */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});
    if(!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return res.status(500).json({error:"missing_redis_env"});

    const { isAdmin, isPro, plan } = getAuthPlan(req);
    const effectivePlanForQuota = (isAdmin && isPro) ? "pro" : plan;

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const FREE_LIMIT=3, PRO_LIMIT=10;
    const limit = effectivePlanForQuota==="admin" ? Infinity : (effectivePlanForQuota==="pro"?PRO_LIMIT:FREE_LIMIT);

    const day=romeYMD(); const quotaKey=`ask:quota:${effectivePlanForQuota}:${ip}:${day}`;
    let used=0;
    if(effectivePlanForQuota!=="admin"){
      try{
        used=await redis.incr(quotaKey);
        if(used===1) await redis.expire(quotaKey, 36*60*60);
        if(used>limit) return res.status(429).json({error:"quota_daily_exceeded", plan:effectivePlanForQuota, used, limit, reset_at_rome:romeNextMidnightISO()});
      }catch(e){ console.error("⚠️ Redis transient:", e?.message||e); used=-1; }
    }

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", lang="it", periodo="" } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({error:"bad_request", detail:"domanda_required"});

    const messages = buildMessages({ domanda, lang, periodo, stile });

    const MAX_TOKENS = isPro ? 520 : 420;
    const TEMP_WTF = isPro ? 1.02 : 1.0;
    const TEMP_WI  = isPro ? 0.70 : 0.68;

    const completion = await askOpenAI({
      model: MODEL,
      temperature: stile==="wtf" ? TEMP_WTF : TEMP_WI,
      top_p: 0.92,
      max_tokens: MAX_TOKENS,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    const maxS = stile==="wtf" ? (isPro?7:6) : 9;
    answer = tightenSentences(answer, maxS);
    const maxW = stile==="wtf" ? (isPro?125:115) : (isPro?140:130);
    answer = clampWords(answer, maxW);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    const L = normLang(lang);
    answer = (stile==="wtf") ? ensureWtfClosing(answer, L) : ensureWhatIfOpen(answer, L);

    if(L==="it"){
      const d=String(domanda||"");
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/gu;
      const inQ=new Set(d.match(nameRx)||[]);
      answer = answer.replace(nameRx,(m,_g1,off,str)=>{
        if(off===0) return m;
        const before=str.slice(0,off);
        if(/[.!?…]["'”)\]]?\s*$/.test(before)) return m;
        return inQ.has(m) || ["Ah","Oh","Ehi","Sai","Guarda","Oh, allora","Senti"].includes(m) ? m : m.toLowerCase();
      });
      answer = answer.replace(/\ball’aquila\b/g,"all’Aquila");
    }
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
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
