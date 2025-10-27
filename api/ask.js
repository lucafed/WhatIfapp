// /api/ask.js — What?f Engine (RESET 2025)
// Stili: whatif(poetico|analitico) · wtf (sarcasmo da bar con eufemismi)
// IT/EN — paragrafo singolo, niente liste/domande/emoji

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

// ---------- Rate ----------
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

// ---------- CORS ----------
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req,res){
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro");
}

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang||"it").toLowerCase().startsWith("en");
function normLine(s=""){return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();}
function tightenSentences(text,maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; const wc=p.split(/\s+/).length; if(wc<=3 && !/[.!?]$/.test(p)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim();}
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const echoRx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(echoRx,""); return t;
}
function ensureEnd(t){let out=String(t||"").trim(); if(!/[.!?…]$/.test(out)) out+="."; return out;}
function tinyHash(s=""){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return (h>>>0).toString(36); }
function pick(arr,seed=null){ if(!arr?.length) return ""; if(seed==null) return arr[Math.floor(Math.random()*arr.length)]; const h=parseInt(tinyHash(String(seed)),36); return arr[h%arr.length]; }

/* ---------- Admin ---------- */
async function isAdmin(req,ip){
  const token=String(req.headers["x-admin-token"]||"").trim(); if(!token) return false;
  try{
    const data=await redis.hgetall(`admin:token:${token}`);
    if(!data) return false;
    const LOCK=String(process.env.ADMIN_LOCK_IP||"false").toLowerCase()==="true";
    if(LOCK){ if(!data.ip) return false; return data.ip===ip; }
    return true;
  }catch{ return false; }
}

/* ---------- Temporal ---------- */
function temporalSystem(periodo="future",lang="it",style="whatif"){
  const en=isEn(lang); const past = String(periodo||"").toLowerCase()==="past";
  if(past){
    return en
      ? `TEMPORAL MODE: PAST/COUNTERFACTUAL. Speak as if the choice had been made back then; mostly past/conditional, with rare present sparks. One paragraph. Keep ${style.toUpperCase()} voice.`
      : `MODALITÀ: PASSATO/CONTROFATTUALE. Parla come se la scelta fosse già stata fatta; passato/condizionale, pochi lampi di presente. Un paragrafo. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE/PROSPECTIVE. Near-future unfolding as if stepping into it now. One paragraph. Keep ${style.toUpperCase()} voice.`
    : `MODALITÀ: FUTURO/PROSPETTICO. Prossimo futuro plausibile come se ci entrassi adesso. Un paragrafo. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Voce WTF ---------- */
const WACKY_NICKS_IT = [
  "sommelier del dubbio","barone dell’ansietta","campione di rimandi","astronauta da bancone",
  "cowboy del lunedì","poeta del carrello","ministro del ‘forse’","fenomeno a pedali",
  "sultano degli scontrini","giardiniere degli alibi","ninja della lista incompleta"
];
const WACKY_OPENERS_IT = [
  "oh, domanda brillante: dev’essere il prosecco che fa brainstorming",
  "ehi, oggi la grappa ha firmato la scaletta — ottimo",
  "ah, profumo di bar alle undici: versiamo parole allora",
  "questa luccica: qualcuno ha agitato il Negroni",
  "bene, domanda col ghiaccio: si parte piano e si finisce allegri"
];
// ampio set di eufemismi (mai letterali)
const GENTLE_BLEEPS_IT = [
  "per l’amor della moka","santo cavatappi","santissima guarnizione del frigo",
  "madonna del Negroni (detto ridendo)","beata pazienza dello spritz",
  "san tappo saltato","cristoddìo del carburatore (piano, senza offesa)",
  "santa tovaglia macchiata","per tutti i bicchieri sbeccati",
  "miseriaccia del bancone","santi sottobicchieri","madre benedetta del ghiaccio finito"
];

/* ---------- Personas ---------- */
function personaSystem(style, lang, whatifMode="auto"){
  const en=isEn(lang);

  if(style==="wtf"){
    const sys = (en?`
You are “What the F”: bar-sarcasm, loving roast, visual, simple Italian if lang=it.
STRUCTURE: confidant opener with a goofy nickname + drink aside → smooth build answering the user's WHAT IF directly → a natural jolt triggers ONE playful euphemistic blasphemy mid-sentence (never literal) → objects/people react absurdly → short warm button.
STRICT: 6–9 sentences, one paragraph, no lists, no questions, no emojis. Stay on-topic.
`:
`Sei “What the F”: sarcasmo da bar affettuoso, immagini semplici.
STRUTTURA: apertura confidenziale con nomignolo + alcol → costruzione che risponde SUBITO alla domanda → piccolo inciampo che fa esplodere UNA sola “bestemmia” eufemistica dentro la frase → oggetti/persone reagiscono → chiusura breve calda.
RIGIDO: 6–9 frasi, un paragrafo, niente elenchi/domande/emoji. Resta sul tema.`);

    const fewshots = [
      { role:"system", content:
`ESEMPIO IT • “E se tornassi a vivere all’Aquila?” (futuro)
Oh, ${pick(WACKY_NICKS_IT)} — ${pick(WACKY_OPENERS_IT)}; torni giù e fai il brillante con la valigia che fischia ottimismo, le vie ti prendono il passo come un vecchio jukebox e i bar ti danno del tu, sembra tutto allineato finché l’angolo di sempre ti ricorda chi comanda e ti esce un “${pick(GENTLE_BLEEPS_IT)}” infilato tra freno a mano e dignità, i bicchieri fanno ola e il lampione anticipa l’accensione per solidarietà, ma due voci ti chiamano per nome e ti rimettono al centro, e capisci che non stai tornando indietro: stai tornando intero — il barista segna sul conto abbracci e tu paghi in risate.` }
    ];
    return { sys, fewshots };
  }

  // WHAT IF: due modalità
  const sysBase = (en?`
You are "What If" — a kind confidant. Soft, direct.
OPEN with a gentle personal nod (use name only if naturally available); then answer the WHAT IF right away.
One paragraph, no lists, no questions, no emojis. Close with a short reflective line.
`:
`Sei "What If" — un confidente gentile. Tono diretto.
APRl con un cenno personale (usa il nome solo se viene naturale); poi rispondi subito al WHAT IF.
Un paragrafo, niente elenchi/domande/emoji. Chiudi con una riga riflessiva.`);

  const sysAnalitico = sysBase + (en?`
TONE: analytical-realistic. Economy, jobs, schools/services, social fabric, pace & quality of life. Concrete, warm, grounded.
`:
`TONO: analitico-realistico. Economia/lavoro, scuola/servizi, tessuto sociale, ritmo e qualità della vita. Concreto ma caldo.`);

  const sysPoetico = sysBase + (en?`
TONE: poetic-realistic. Everyday images (keys, streetlights, hands, air). Small truths. No heroics. Gentle tempo.
`:
`TONO: poetico-realistico. Immagini quotidiane (chiavi, lampioni, mani, aria). Verità piccole. Niente eroismi. Ritmo gentile.`);

  const sys = (whatifMode==="analitico") ? sysAnalitico
            : (whatifMode==="poetico") ? sysPoetico
            : (Math.random()<0.5 ? sysPoetico : sysAnalitico);

  const fewshots = [
    { role:"system", content:
`ESEMPIO IT • Poetico
Ciao, la metto semplice: se tornassi all’Aquila, le mattine riprenderebbero il loro profumo e i passi si accorderebbero ai vicoli; conteresti ciò che manca, poi vedresti ciò che torna: saluti brevi, mani occupate da sacchetti leggeri, la luce che taglia la cucina di lato. Il centro parla poco ma ti tiene. Più che ricominciare, ricuciresti.` },
    { role:"system", content:
`ESEMPIO IT • Analitico
Ciao, te la dico chiara: restando all’Aquila avresti puntato su continuità e rete corta. Lavoro agganciato a PA, università e filiera edilizia; stipendi medi inferiori al Nord ma tempi più umani. Scuola e servizi meno densi ma supporto familiare vicino; mobilità breve, comunità di prossimità. Avresti scambiato opportunità con qualità di tempo. È una traiettoria lenta, ma leggibile.` }
  ];

  return { sys, fewshots };
}

/* ---------- API Handler ---------- */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});

    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const admin=await isAdmin(req,ip); const bypass=!!admin;
    const isPro=String(req.headers["x-pro"]||"").trim()==="1";

    if(!bypass){ const {success}=await rl.limit(`ask:${ip}`); if(!success) return res.status(429).json({error:"rate_limited_minute"}); }

    // credits
    let used=0, dailyCap=isPro?10:3;
    if(!bypass){
      const today=new Date().toISOString().slice(0,10);
      const key=`credits:${ip}:${today}`;
      used=(await redis.incr(key))??1;
      if(used===1) await redis.expire(key,60*60*24);
      if(used>dailyCap) return res.status(402).json({error:"daily_credits_exhausted",used,dailyCap});
    }

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const {
      domanda = "",
      stile   = "whatif",
      lang    = "it",
      periodo = "future",
      micro   = {},            // può contenere name/nome, sex
      sex     = "",            // m|f|nb|""
      whatif_mode = "auto"     // "poetico" | "analitico" | "auto"
    } = body;

    if(!domanda || typeof domanda!=="string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    // name opzionale (solo nome, mai cognome; uso saltuario)
    const rawName = String(micro?.name || micro?.nome || "").trim();
    const firstName = rawName.split(/\s+/)[0] || "";
    const useName = firstName && (parseInt(tinyHash(domanda),36)%100 < 60); // ~60% volte
    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    const { sys, fewshots } = personaSystem(stile, lang, whatif_mode);
    const temporal = temporalSystem(periodo, lang, stile);

    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`),36)%1000000;

    const nameLine = useName
      ? (isEn(lang) ? `Greet the user by name once, naturally: "${firstName}".`
                    : `Saluta l’utente per nome una sola volta, in modo naturale: "${firstName}".`)
      : "";

    const wtfRule = isEn(lang)
      ? `WTF specifics: one playful euphemistic “blasphemy” in-flow (rotate synonyms, NEVER literal), reacting objects ok, open with nickname+drink aside, then stay on the WHAT IF.`
      : `Specifiche WTF: una sola “bestemmia” eufemistica dentro la frase (ruota i sinonimi, MAI letterale), oggetti reattivi ok, apri con nomignolo+alcol e resta sulla domanda.`;

    const userPrompt = isEn(lang)
      ? `User WHAT IF (do NOT restate it): "${domanda}". Persona sex="${resolvedSex||"unknown"}". WHATIF_MODE="${whatif_mode}". ${nameLine} Keep exact persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Sesso utente="${resolvedSex||"unknown"}". WHATIF_MODE="${whatif_mode}". ${nameLine} Mantieni esattamente la voce. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role:"system", content: sys },
      { role:"system", content: temporal },
      ...(fewshots||[]),
      ...(stile==="wtf" ? [{role:"system", content: wtfRule}] : []),
      { role:"user", content: userPrompt }
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 400,
      frequency_penalty: stile==="wtf" ? 0.45 : 0.12,
      presence_penalty: stile==="wtf" ? 0.25 : 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf" ? 9 : 11);
    answer = clampWords(answer, stile==="wtf" ? 185 : 180);
    answer = normalizeOneParagraph(answer);
    answer = ensureEnd(answer);

    // Logs privacy-safe
    try{
      const entry = {
        ts: Date.now(), ip,
        style: stile, lang, periodo,
        sex: resolvedSex || null,
        domanda_len: String(domanda||"").length,
        domanda_hash: tinyHash(domanda||""),
        answer_chars: (answer||"").length,
        admin: !!admin,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
        whatif_mode
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
    }catch(e){}

    return res.status(200).json({
      answer, style:stile, lang, periodo, model:MODEL,
      admin, pro:isPro, credits: bypass ? null : { used, dailyCap }
    });

  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
