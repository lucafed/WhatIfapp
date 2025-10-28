// /api/ask.js — What?f Engine (lock toni + fix ripetizioni + no nomi) — 2025-10
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// ---------------- Upstash / rate ----------------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

// ---------------- CORS ----------------
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

// ---------------- Helpers ----------------
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const MAGIC_WTF = "Entri piano, il caos ti riconosce ma oggi ti lascia passare.";
const MAGIC_WI  = "La stanza è la stessa, lo sguardo no: è già un inizio.";

function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function normLine(s=""){return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]—-]+$/,"").trim();}
function tightenSentences(text, maxSentences) {
  const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(t=>t.trim()).filter(Boolean);
  const out=[]; const seen=new Set();
  for(const p of parts){
    const n=normLine(p); if(!n||seen.has(n)) continue;
    out.push(p); seen.add(n); if(out.length>=maxSentences) break;
  }
  let t = out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords) {
  const w = String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice = w.slice(0,maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice+"…";
}
function normalizeOneParagraph(s=""){return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim();}
function stripEcho(domanda, text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i,"");
  return t;
}
function dropMagicDuplicates(text){
  return String(text||"")
    .replace(new RegExp("^\\s*"+MAGIC_WTF.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\s*", "i"), "")
    .replace(new RegExp("^\\s*"+MAGIC_WI.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\s*", "i"), "")
    .trim();
}
function noNames(text){
  // soft guard: rimuove nomi persona comuni senza toccare toponimi frequenti
  const block = ["Marco","Luisa","Luca","Giulia","Matteo","Francesca","Paolo","Simone","Chiara"];
  let t=String(text||"");
  for(const n of block){
    const rx = new RegExp(`\\b${n}\\b`, "g");
    t=t.replace(rx, "ehi");
  }
  return t;
}
function wtfSafety(t){ let out=String(t||"").trim(); if(!/[.!?…]$/.test(out)) out+="."; return out; }

function temporalSystem(periodo="future", lang="it", style="whatif"){
  const en=isEn(lang);
  const past = en
    ? `TEMPORAL MODE: PAST. Tell it like it already happened. Keep exact ${style} voice.`
    : `MODALITÀ: PASSATO. Racconta come se fosse già accaduto. Mantieni esattamente la voce ${style}.`;
  const fut = en
    ? `TEMPORAL MODE: FUTURE. Describe a plausible near-future unfolding. Keep exact ${style} voice.`
    : `MODALITÀ: FUTURO. Descrivi un prossimo futuro plausibile. Mantieni esattamente la voce ${style}.`;
  return (String(periodo).toLowerCase()==="past")?past:fut;
}

// ---------- Personas & few-shots (esempi tuoi inchiodati) ----------
function personas(style, lang, sex=""){
  const SEX=String(sex||"").toLowerCase();
  const nickIT = (SEX==="f")
    ? ["regina del casino","fenomena","capitana del caos","sirena urbana","rockstar con tacchi comodi"]
    : (SEX==="m")
      ? ["campione","fenomeno","capitano del caos","poeta del bar","rockstar con le tasche vuote"]
      : ["leggenda","asso universale","cap* del caos","astronauta del dubbio"];

  if(style==="wtf"){
    const sys = `
Sei “What the F” — amico rumoroso, sarcastico ma affettuoso.
SECONDA PERSONA. 1 paragrafo, 6–8 frasi (~125–165 parole).
APRI SOLO con un nomignolo secco (senza verbi). Nicknames IT: ${nickIT.join(", ")}.
Inserisci UNA sola bestemmia narrata o variante (“mannaggia al porco volante…”, “bestemmione…”, ecc.) MAI letterale.
Dopo l’esplosione, metti SEMPRE due micro-reazioni di scena (oggetti/persone) pertinenti.
Alcol e “oggetti che reagiscono” ok, ma solo se servono alla scena.
RIGIDO: niente elenchi, niente domande, niente emoji, niente nomi propri di persona. Non rivolgere mai l’utente per nome.
Tono: adulto, grezzo, ma con chiusura calda/ironica. Rispetta la MODALITÀ TEMPORALE.
`.trim();

    const few = [
      {role:"system", content:
`ESEMPIO (IT) • Tornare all’Aquila — STILE BLOCCATO
Ah, guarda chi si rivede! Tu e l’Aquila, una storia d’amore che sa di antichi monumenti e caffè amari. Ti ritrovi tra le strade, con il cuore che batte come un tamburo impazzito, ma già sai che il primo parcheggio sarà una bestemmia da raccontare ai nipoti. I vicoli ti chiamano, ma i sassi sembrano far festa e tu hai voglia di rispondere a quel “ben tornato!” con un “mannaggia al porco volante delle buche!”. Una vecchia signora ti scambia per un fantasma e tu sputi un “ci vediamo nel prossimo secolo!”, mentre il tuo stomaco chiede perdono per tutti gli arrosticini che si prepara a incontrare. Poi, quando meno te l’aspetti, il vento porta un profumo di legno bagnato e pietra viva che ti mette pace nelle ossa. Non stai tornando indietro: stai tornando dove la tua confusione sa stare seduta senza fare rumore.`}
    ];
    return {sys, few};
  }

  // WHAT IF (analitico/poetico) esattamente come i tuoi
  const sysWI = `
Sei "What If" — amico lucido e affettuoso.
SECONDA PERSONA. 1 paragrafo, 7–10 frasi (~105–145 parole).
Linguaggio semplice, immagini quotidiane. Niente elenchi, niente domande, niente emoji, niente nomi propri di persona.
Chiusa breve e riflessiva (non moralistica).`.trim();

  const few = [
    {role:"system", content:
`WHAT IF — Analitico (realistico / sociale)
Domanda: E se tornassi a vivere all’Aquila?
Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`},
    {role:"system", content:
`WHAT IF — Poetico (emotivo / narrativo)
Domanda: E se tornassi a vivere all’Aquila?
Bella questa, Luca — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`}
  ];
  return {sys:sysWI, few};
}

// --------------- API ---------------
export default async function handler(req, res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});
  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const token = String(req.headers["x-admin-token"]||"").trim();
    const admin = !!(token && await redis.hgetall(`admin:token:${token}`));
    const isPro = String(req.headers["x-pro"]||"").trim()==="1";

    if(!admin){
      const {success}=await rl.limit(`ask:${ip}`); if(!success) return res.status(429).json({error:"rate_limited_minute"});
    }
    let used=0, dailyCap = admin?Infinity:(isPro?10:3);
    if(!admin){
      const today=new Date().toISOString().slice(0,10);
      const key=`credits:${ip}:${today}`;
      used=(await redis.incr(key))??1;
      if(used===1) await redis.expire(key, 86400);
      if(used>dailyCap) return res.status(402).json({error:"daily_credits_exhausted", used, dailyCap});
    }

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", lang="it", extra="", periodo="future", sex="", micro={}, substyle="" } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({error:"bad_request", detail:"domanda_required"});

    const {sys, few} = personas(stile, lang, sex || micro?.sex || "");
    const temporal = temporalSystem(periodo, lang, stile);

    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${periodo}|${substyle}`),36)%1000000;

    const rulesExtra = (stile==="wtf")
      ? `Hard rules: OPEN WITH ONLY a nickname (no verbs). Exactly ONE narrated blasphemy/variant, then two short scene reactions; no names of persons; no lists/questions; keep ~135–160 words.`
      : `Hard rules: one paragraph; no lists/questions; no names of persons; ~105–135 words; end with a short reflective line.`;

    const userPrompt = isEn(lang)
      ? `Question (do NOT restate): "${domanda}". Extra context: "${String(extra||"").trim()}". Substyle="${substyle||"-"}". SEED=${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra||"").trim()}". Sottostile="${substyle||"-"}". SEED=${seedNum}.`;

    const messages = [
      {role:"system", content:sys},
      {role:"system", content:temporal},
      {role:"system", content:rulesExtra},
      ...few,
      {role:"system", content:"NON usare mai nomi propri di persona. Se ti scappa, sostituisci con 'ehi' o nulla."},
      {role:"user", content:userPrompt},
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile==="wtf" ? 0.4 : 0.1,
      presence_penalty: stile==="wtf" ? 0.2 : 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // post-process
    answer = stripEcho(domanda, answer);
    answer = dropMagicDuplicates(answer);
    answer = noNames(answer);
    answer = tightenSentences(answer, stile==="wtf" ? 8 : 10);
    answer = clampWords(answer, stile==="wtf" ? 165 : 140);
    answer = normalizeOneParagraph(answer);
    answer = (stile==="wtf") ? wtfSafety(answer) : (/[.!?…]$/.test(answer)?answer:answer+".");

    // log (no testo domanda)
    try{
      const entry={ts:Date.now(), ip, style:stile, lang, periodo, domanda_len:String(domanda).length,
        domanda_hash: tinyHash(domanda||""), answer_chars:(answer||"").length, pro:isPro, admin:!!admin};
      await redis.lpush("logs:ask", JSON.stringify(entry)); await redis.ltrim("logs:ask",0,9999);
    }catch(e){ console.warn("log skip", e); }

    return res.status(200).json({ answer, style:stile, lang, periodo, model:MODEL, pro:isPro,
      magic: (stile==="wtf")?MAGIC_WTF:MAGIC_WI, substyle: substyle||null,
      credits: admin?null:{used, dailyCap} });
  }catch(err){
    console.error("[/api/ask] error:", err);
    return res.status(500).json({error:"server_error", detail:String(err?.message||err)});
  }
}
