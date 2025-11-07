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
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro, x-pro-sign");
}

/* ========= Helpers comuni ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
const normLang = (l="it") =>
  SUP_LANGS.includes(String(l||"it").toLowerCase().slice(0,2))
    ? String(l).toLowerCase().slice(0,2)
    : "it";

const normLine = (s="") => String(s).toLowerCase()
  .replace(/[“”"’']/g,"")
  .replace(/\s+/g," ")
  .replace(/[.,;:!?()[\]\-—]+$/g,"")
  .trim();

function tightenSentences(text, maxSentences){
  const parts=String(text||"")
    .replace(/\n+/g," ")
    .split(/(?<=[.!?…])\s+/u)
    .map(x=>x.trim())
    .filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){
    const n=normLine(p);
    if(!n || seen.has(n)) continue;
    out.push(p);
    if(out.length>=maxSentences) break;
  }
  let t=out.join(" ");
  if(!/[.!?…]$/.test(t)) t+=".";
  return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/);
  if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" ");
  const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){
  return String(s)
    .replace(/\s*\n+\s*/g," ")
    .replace(/\s{2,}/g," ")
    .replace(/\.\.\.+/g,"…")
    .replace(/\s+([.,;:!?])/g,"$1")
    .trim();
}
function stripQuestionEcho(domanda,text){
  let t=String(text||"");
  const d=String(domanda||"").replace(/[“”"’']/g,"").trim().toLowerCase();
  if(d.length>=8){
    const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"’']/g,"").trim();
    if(lead.startsWith(d)){
      const cut=t.indexOf(".");
      if(cut>-1) t=t.slice(cut+1).trim();
    }
  }
  const rx=/^(?:\s*(?:e\s*se|what\s*if|domanda:|q:)\s*[^.!?…]*[.!?…]\s+)/i;
  return t.replace(rx,"").trim();
}
const sentenceCaseAll = (s="") =>
  s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/giu,(m,p,c)=>p+c.toUpperCase());
const finalPunct = (s="") => /[.!?…]$/.test(s)?s:s+".";

/* ===== Variability utils ===== */
function hash32(s){ return createHash("sha1").update(s).digest().readUInt32BE(0); }
function makePRNG(seed){ let x = seed >>> 0; return ()=>{ x=(x*1664525+1013904223)>>>0; return x/2**32; }; }
function pick(prng, arr){ return arr[Math.floor(prng()*arr.length)] }
function pickMany(prng, arr, k){
  const a=[...arr]; const out=[];
  for(let i=0;i<Math.max(0,Math.min(k,a.length));i++){
    const idx=Math.floor(prng()*a.length);
    out.push(a.splice(idx,1)[0]);
  }
  return out;
}

/* ===== Autenticazione piani / Quote giornaliere ===== */
function boolHeader(v){ return String(v||"").trim()==="1" || String(v||"").toLowerCase()==="true"; }

function getAuthPlan(req){
  const admin = String(req.headers["x-admin-token"]||"");
  const proHdr = boolHeader(req.headers["x-pro"]);
  const proSig = String(req.headers["x-pro-sign"]||"");

  const isAdmin = !!process.env.ADMIN_TOKEN && admin === process.env.ADMIN_TOKEN;

  // Firma opzionale per PRO (leggera)
  const isSignedPro = !!process.env.PRO_SHARED_SECRET && proSig === createHash("sha256")
    .update(process.env.PRO_SHARED_SECRET + "|" + (req.headers["origin"]||""))
    .digest("hex");

  const isPro = proHdr || isSignedPro || isAdmin;
  const plan = isAdmin ? "admin" : (isPro ? "pro" : "free");
  return { isAdmin, isPro, plan };
}

// Data “oggi” in Europa/Roma come yyyymmdd
function romeYMD(date = new Date()){
  const parts = new Intl.DateTimeFormat('en-CA',{
    timeZone:'Europe/Rome', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(date).reduce((a,p)=> (a[p.type]=p.value, a), {});
  return `${parts.year}${parts.month}${parts.day}`;
}
// Prossima mezzanotte Roma ISO
function romeNextMidnightISO(date = new Date()){
  const nowRomeStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  }).format(date);
  const m = nowRomeStr.match(/(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2}):(\d{2})/);
  const nowRome = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  const next = new Date(nowRome); next.setDate(next.getDate()+1); next.setHours(0,0,0,0);
  return next.toISOString();
}

/* ===== Oggetti contestuali dalla domanda (per WTF) ===== */
function deriveContextObjects(domanda){
  const d = String(domanda||"").toLowerCase();
  const add = [];
  const map = [
    [/citt[aà]/,"mappa piegata"],
    [/trasloc|casa|appart|affitto/,"scatolone col pennarello"],
    [/lavor|cv|curriculum|colloquio|linkedin/,"cartellina trasparente"],
    [/studio|esame|tesi|universit/,"quaderno con orecchie"],
    [/inglese|lingua|course|corso/,"post-it con verbi irregolari"],
    [/viagg|treno|volo|aereo|hotel/,"valigia che borbotta"],
    [/soldi|budget|spesa|aumento/,"calcolatrice stanca"],
    [/palestra|corsa|yoga|nuot/,"scarpe che chiedono strada"],
    [/startup|sito|e[- ]?commerce|shopify|app/,"laptop con adesivi motivazionali"],
    [/relaz|amico|partner/,"telefono che vuole essere sincero"]
  ];
  for(const [rx, obj] of map){ if(rx.test(d)) add.push(obj); }
  return Array.from(new Set(add)).slice(0,2);
}

/* ========= WHAT IF (nuova versione) ========= */
const WHATIF_RULES = {
  it: `Sei “What If”: voce lucida, empatica e luminosa. Racconti come se stessi ricordando o immaginando la vita di chi legge, in SECONDA PERSONA.
Scrivi UN SOLO PARAGRAFO (6–9 frasi, ~100–130 parole). Linguaggio fluido, poetico ma realistico. Evita moralismi, liste o consigli. Niente emoji.
Chiudi con una sensazione sospesa e aperta. Tieni come riferimento esatto gli esempi seguenti (tono, ritmo, lessico):

☕ E se non avessi mai mollato tutto?
In quell’universo ti vedo ancora alla scrivania, con la moka che borbotta e il sogno che aspetta il weekend. Qui invece sei uscito a prendere aria, e il vento ti ha riconosciuto per primo. Ti mancano certezze, ma guadagni ore piene di suoni e risate. A volte pensi “forse era più semplice restare”, poi noti la schiena dritta e il passo più largo. La paura fa rumore, ma si stanca presto. E quando chiudi la porta la sera, senti che la casa somiglia alla tua voce. Non è la vita perfetta: è la tua versione che ride piano e continua a muoversi.

🏔️ E se tornassi a vivere all’Aquila?
In una versione di te hai già rimesso le chiavi nel cassetto dell’ingresso e saluti il panettiere per nome. Le mattine hanno odore di freddo pulito e strade corte, i pomeriggi di silenzi che scaldano. A volte ti chiedi se il mondo stia correndo altrove, poi ti sorprende una risata sotto i portici. Impari che l’energia arriva anche dalle piccole cose: un lampione, una finestra aperta, due amici veri. Ti manca il caos, ma non la confusione. E quando alzi lo sguardo verso le montagne, la testa fa spazio. La vita, qui, non urla: ti fa cenno e ti invita a seguirla.

🗣️ E se imparassi davvero l’inglese?
All’inizio balbetti con le parole, come chi prova una bicicletta troppo alta. Poi una sera rispondi al volo e ti esce una frase intera senza pensarci. Le serie hanno meno sottotitoli, le email meno esitazioni, i treni più destinazioni plausibili. Scopri che la voce cambia, ma resti tu: solo con più finestre aperte. Ti perderai in qualche irregolare, riderai su qualche pronuncia. E in un caffè qualunque, capirai di aver guadagnato una porta in più sul mondo. Non serve parlare perfetto: basta parlare vivo, e lasciare che il resto arrivi camminando.`,
  en:`You are “What If”: lucid, warm, cinematic second-person voice. ONE PARAGRAPH, 6–9 sentences (~100–130 words). No advice/lists/emojis. Open, sensory ending.`
};

/* ========= WTF (nuova versione) ========= */
const WTF_RULES = {
  it: `Sei “What the F”: barista affettuoso e sarcastico. SECONDA PERSONA. UN SOLO PARAGRAFO, 5–7 frasi (~100–115 parole).
Attacco confidenziale (“Oh senti…”, “Sai che ti dico…”, “Guarda…”).
Inserisci oggetti/luoghi che commentano o giudicano (moka, tapparella, citofono, frigo, sedia, lampione, playlist).
Linguaggio vivo, anche un filo volgare se naturale. Niente morale, niente consigli, niente elenchi, niente emoji.
Tono: ironico, poetico-sporco, sbronza accidentale ma lucida. Rispondi davvero alla domanda e CHIUDI con un’immagine secca e visiva (risata amara, vento in faccia, bicchiere che scalda).`,
  en:`You are “What the F”: sarcastic but caring bartender. ONE PARAGRAPH, 5–7 sentences (~100–115 words). Conversational opener. Judging objects. Slight swearing ok. No lists/emojis/morals. End on a sharp, visual image.`
};

/* ===== Banca minima per variare aperture/oggetti (WTF) ===== */
const BANK = {
  it: {
    starters: ["Oh senti", "Sai che ti dico", "Guarda", "Oh, allora", "Ehi, parliamoci chiaro"],
    objects: ["moka","tapparella","citofono","frigorifero","sedia girevole","lampione","stampante","ventilatore","telecomando","pianta"],
    moods: ["ti guarda storto","ti mette in muto","applaude per rispetto","fa ghosting","finge un aggiornamento","ti giudica in silenzio"],
    booze: ["negroni grande","birra media","rum in plastica","spritz di troppo","amaro doppio"]
  }
};

/* ===== Periodo auto-detect ===== */
function detectPeriod(domanda, lang){
  const L = normLang(lang);
  const d = String(domanda||"").toLowerCase();
  const itPastRx = /\b(se\s+(?:avessi|fossi)|avrei|sarei|non\s+avessi|non\s+fossi)\b/;
  const enPastRx = /\b(what\s+if\s+i\s+had|if\s+i\s+had|i\s+would\s+have|i'd\s+have)\b/;
  const esPastRx = /\b(si\s+hubiera|habría|hubiese)\b/;
  const frPastRx = /\b(si\s+j(?:'|e)\s+avais|j'aurais)\b/;
  const dePastRx = /\b(hätte\s+ich|ich\s+hätte)\b/;
  const map = { it: itPastRx, en: enPastRx, es: esPastRx, fr: frPastRx, de: dePastRx };
  const rx = map[L] || itPastRx;
  return rx.test(d) ? "past" : "future";
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);

  const baseRules = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;

  const effectivePeriodo = (periodo==="past" || periodo==="future") ? periodo : detectPeriod(domanda, L);

  const temporal =
    effectivePeriodo === "past"
      ? (L==="en" ? "Write counterfactual: as if it had already happened."
         : L==="es" ? "Escribe contrafactual: como si ya hubiera pasado."
         : L==="fr" ? "Écris en contrefactuel : comme si c’était déjà arrivé."
         : L==="de" ? "Schreibe kontrafaktisch: als wäre es bereits geschehen."
         : "Scrivi controfattuale: come se fosse già successo.")
      : (L==="en" ? "Write predictive: near-future unfolding starting now."
         : L==="es" ? "Escribe predictivo: un futuro cercano que empieza ahora."
         : L==="fr" ? "Écris prédictif : futur proche qui commence maintenant."
         : L==="de" ? "Schreibe prädiktiv: nahe Zukunft ab jetzt."
         : "Scrivi predittivo: un prossimo futuro che inizia ora.");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if(stile==="wtf"){
    // ===== WTF: monologo continuo da bar
    const b = BANK[L] || BANK.it;
    const prng = makePRNG(hash32(domanda) ^ randomBytes(4).readUInt32BE(0));
    const starter = (b.starters||["Oh senti"])[Math.floor(prng()*(b.starters||["Oh senti"]).length)];
    const objs = pickMany(prng, (b.objects||[]).concat(deriveContextObjects(domanda)), 2 + Math.floor(prng()*2)); // 2–3
    const moods = pickMany(prng, b.moods||[], Math.min(3, objs.length));
    const booze = pickMany(prng, b.booze||[], 1 + (prng()<0.5?1:0));

    const wtfRule =
      L==="en"
        ? WTF_RULES.en
        : `${WTF_RULES.it}
Suggerimenti da intrecciare naturalmente (no elenchi, niente etichette):
- Attacco confidenziale tipo: “${starter}…”.
- Oggetti di scena possibili: ${objs.join(", ")}${moods.length?` (es. “${objs[0]} ${moods[0]}”)`:""}.
- Sbronza accidentale: ${booze.join(" + ")}.`;

    msgs.push({ role:"system", content: wtfRule });

  } else {
    // ===== WHAT IF
    msgs.push({ role:"system", content: WHATIF_RULES[L] || WHATIF_RULES.it });
  }

  const ask =
    stile==="wtf"
      ? (L==="en"
          ? `Do NOT repeat the question. ONE PARAGRAPH (5–7 sentences, ~100–115 words). Conversational, gritty, slightly drunk. Include judging objects naturally. "${domanda}"`
          : `Non ripetere la domanda. UN PARAGRAFO (5–7 frasi, ~100–115 parole). Tono confidenziale, continuo, ironico, con oggetti che commentano. Linguaggio vivo, anche un filo volgare se serve. "${domanda}"`)
      : (L==="en"
          ? `Do not restate the question. ONE PARAGRAPH (6–9 sentences, ~100–130 words). Bright, warm, everyday imagery. No advice or questions. "${domanda}"`
          : `Non ripetere la domanda. UN PARAGRAFO (6–9 frasi, ~100–130 parole). Luminoso, concreto, senza consigli o domande. "${domanda}"`);
  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= Chiusure di sicurezza (WTF/WhatIf) ========= */
function ensureWtfClosing(text, L){
  const t = String(text||"").trim();
  if(/[.!?…]$/.test(t) && /vento|bicchiere|faccia|sorriso|risata|notte|bar|strada|cuore/i.test(t)) return t;
  // aggiunta chiusura visiva coerente
  const add =
    L==="en" ? " And you end up laughing alone, wind on your face and the glass warming your hand."
  : L==="es" ? " Y te ríes solo, con el viento en la cara y el vaso que te calienta la mano."
  : L==="fr" ? " Et tu te surprends à sourire, le vent sur le visage et le verre qui réchauffe la paume."
  : L==="de" ? " Und du grinst allein, Wind im Gesicht und das Glas wärmt die Hand."
  : " E ti scappa una risata storta, col vento in faccia e il bicchiere che ti scalda la mano.";
  return finalPunct(t.replace(/[.!?…]*$/,"")) + add;
}
function ensureWhatIfOpen(text, L){
  const t = String(text||"").trim();
  if(/[.!?…]$/.test(t) && /(continua|camminando|pronto|ancora|apre|aperta|aprirsi|sospesa|curios|vento|luce)$/i.test(t)) return t;
  const add =
    L==="en" ? " And it doesn’t end there; it keeps moving, softly."
  : L==="es" ? " Y no termina ahí: sigue, despacio."
  : L==="fr" ? " Et ça ne s’arrête pas là : ça continue, doucement."
  : L==="de" ? " Und es endet nicht hier: es geht leise weiter."
  : " E non finisce lì: continua piano, mentre ti muovi.";
  return finalPunct(t.replace(/[.!?…]*$/,"")) + add;
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });
    if(!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN){
      return res.status(500).json({ error:"missing_redis_env" });
    }

    // Piano & quota giornaliera
    const { isAdmin, isPro, plan } = getAuthPlan(req);

    // Admin può simulare PRO se invia anche x-pro:1
    const effectivePlanForQuota = (isAdmin && isPro) ? "pro" : plan;

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();
    const FREE_LIMIT = 3;
    const PRO_LIMIT  = 10;

    const limit =
      effectivePlanForQuota === "admin" ? Infinity :
      (effectivePlanForQuota === "pro" ? PRO_LIMIT : FREE_LIMIT);

    const day = romeYMD();
    const quotaKey = `ask:quota:${effectivePlanForQuota}:${ip}:${day}`;

    let used = 0;
    if(effectivePlanForQuota !== "admin"){
      used = await redis.incr(quotaKey);
      if(used === 1){ await redis.expire(quotaKey, 36*60*60); } // TTL di sicurezza
      if(used > limit){
        return res.status(429).json({
          error: "quota_daily_exceeded",
          plan: effectivePlanForQuota,
          used,
          limit,
          reset_at_rome: romeNextMidnightISO(),
        });
      }
    }

    // Body & parametri
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", periodo = "", micro = {} } = body;
    if(!domanda || typeof domanda !== "string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, micro });

    // Risposte: PRO un filo più ricche
    const MAX_TOKENS = effectivePlanForQuota === "pro" ? 520 : 420;
    const TEMP_WTF = effectivePlanForQuota === "pro" ? 1.02 : 1.0;
    const TEMP_WI  = effectivePlanForQuota === "pro" ? 0.70 : 0.68;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? TEMP_WTF : TEMP_WI,
      top_p: 0.92,
      max_tokens: MAX_TOKENS,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // ===== Post-process =====
    answer = stripQuestionEcho(domanda, answer);
    const maxSentences = stile === "wtf" ? (effectivePlanForQuota === "pro" ? 7 : 6) : 9;
    answer = tightenSentences(answer, maxSentences);
    const maxWords = stile === "wtf" ? (effectivePlanForQuota === "pro" ? 125 : 115) : (effectivePlanForQuota === "pro" ? 140 : 130);
    answer = clampWords(answer, maxWords);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Rinforzo chiusura nello stile richiesto
    const L = normLang(lang);
    if(stile === "wtf") answer = ensureWtfClosing(answer, L);
    else answer = ensureWhatIfOpen(answer, L);

    // IT normalizzazioni
    if(L==="it"){
      const d=String(domanda||"");
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/gu;
      const inQuestion=new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m, _g1, offset, str)=>{
        if(offset===0) return m;
        const before = str.slice(0, offset);
        if(/[.!?…]["'”)\]]?\s*$/.test(before)) return m; // inizio frase: lascia Maiuscola
        return inQuestion.has(m) || ["Ah","Oh","Ehi","Sai","Guarda","Oh, allora"].includes(m) ? m : m.toLowerCase();
      });
      answer = answer.replace(/\ball’aquila\b/g, "all’Aquila");
    }

    // Maiuscola iniziale
    answer = answer.replace(/^\s*([a-zà-ÿ])/u, (m,c)=>c.toUpperCase());

    return res.status(200).json({
      answer,
      style: stile,
      lang: L,
      periodo: periodo || detectPeriod(domanda, lang),
      model: MODEL,
      plan: effectivePlanForQuota,
      quota: effectivePlanForQuota === "admin" ? null : { used, limit, reset_at_rome: romeNextMidnightISO() }
    });

  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
