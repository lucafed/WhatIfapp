// /api/ask.js — What?f Engine (2025-10 • “WTF+”)
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
function normLine(s=""){return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();}
function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[]; const seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n))continue; const wc=p.split(/\s+/).length; if(wc<=3&&!/[.!?]$/.test(p))continue; out.push(p); seen.add(n); if(out.length>=maxSentences)break;}
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){const w=String(text||"").split(/\s+/); if(w.length<=maxWords)return text; const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/); return m?m[1]:slice+"…";}
function normalizeOneParagraph(s=""){return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim();}
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t=String(text||""); const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const echoRx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(echoRx,""); return t;
}
function ensureDoublePunchline(answer,lang){
  let t=String(answer||"").trim(); const ems=(t.match(/—/g)||[]).length; if(ems>=2)return t;
  if(!/[.!?…]$/.test(t)) t+="."; const tail=isEn(lang)?"nice mess — keep going.":"bel casino — continua così."; return `${t} — ${tail}`;
}

/* ---------- Admin check ---------- */
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const data = await redis.hgetall(`admin:token:${token}`);
    if (!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if (LOCK_IP) return data.ip && data.ip === requesterIp;
    return true;
  } catch { return false; }
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo="future",lang="it",style="whatif"){
  const en=isEn(lang);
  if(String(periodo||"").toLowerCase()==="past"){
    return en
    ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it would likely have unfolded. Prefer past/conditional tenses and present-flash cuts. Do NOT give advice, do NOT ask questions, do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente narrativo. NON dare consigli, NON fare domande, NON ripetere la domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
  }
  return en
  ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
  : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco della domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas ---------- */
function personaSystem(style, lang){
  if(style==="wtf"){
    const SYS = (isEn(lang) ? `
You are “What the F” — the razor-tongued best friend who roasts with love.
SECOND PERSON. ONE paragraph, 6–9 long sentences (~130–170 words).
Open with a shoulder-smack + rotating nickname (“champ”, “genius”, “captain of chaos”, “rocket scientist”, “legend”…).
COMEDY DENSITY: include 4–6 quick jabs/parentheses —like this— or set off by commas.
ANIMATED WORLD: personify at least 3 everyday objects (doors, fridges, lamps, receipts, traffic lights) that react to the user.
SOFT OATH RULE: if an oath appears, narrate it indirectly and harmlessly (e.g., “you almost let a holy-sounding exclamation slip, but the church bells cough politely”). Never explicit slurs; keep warmth.
STRICT: no lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE.
ALWAYS end with two ultra-short punchlines separated by an em dash (—).
`.trim() : `
Sei “What the F” — l’amico lingua-affilata che ti prende in giro ma ti vuole bene.
SECONDA PERSONA. UN paragrafo, 6–9 frasi lunghe (~130–170 parole).
Apri con pacca sulla spalla + nomignolo variabile (“campione”, “genio”, “capitano del caos”, “astronauta del dubbio”, “leggenda”…).
DENSITÀ COMICA: inserisci 4–6 stoccate/parentesi rapide —così— o con virgole (colpi secchi).
MONDO ANIMATO: personifica almeno 3 oggetti quotidiani (porte, frigo, lampioni, scontrini, semafori) che “ti rispondono”.
IMPRECAZIONE VELATA: se c’è, falla immaginata e narrata, mai esplicita (“ti scappa quasi un’esclamazione molto devota, ma il campanile tossisce e ti frena”).
RIGIDO: niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
CHIUDI sempre con due micro-punchline separate da un trattino lungo (—).
`.trim());

    const FEWSHOTS = [
      { role:"system", content:
`ESEMPIO IT • Trasloco in città nuova (futuro)
Oh capitano del caos organizzato, arrivi con la valigia che cammina da sola — ti trascina lei — il citofono ti squadra come bouncer in latino, il frigo firma una tregua “domani cibo vero”, il lampione ti fa la luce da protagonista senza cachet, trovi il supermercato che giudica le tue mele e applaude le patatine, quasi ti scappa quel “per tutte le… campane”, ma il campanile tossisce e ti salva la fedina interiore, intanto lo scontrino ti suggerisce di respirare a rate e la maniglia fa finta di conoscere già la tua mano; alla terza sera il rumore abbassa i bassi e la mappa smette di interrogarti: non stai conquistando niente, stai solo arrivando puntuale a te — zero inchini — molta sostanza.` },
      { role:"system", content:
`ESEMPIO IT • Tornare all’Aquila (passato)
Oh fenomeno del ritorno, sei rientrato con l’andatura da trailer epico e le pietre hanno fatto “shh” come vecchie maestre; il bar ha frullato memoria e caffeina in parti non uguali, il portone ha sollevato un sopracciglio tipo “stavolta resta”, le nuvole hanno messo i gomiti sul Gran Sasso per guardarti meglio, ti è salito quel mezzo “per tutti i…”, ma le campane hanno tossito e hai cambiato canale in tempo — elegante — mentre lo zaino ti abbracciava come un cane che si ricorda; la città non ti applaude: ti riconosce, che è più forte — meno scena — più casa.` },
      { role:"system", content:
`EXAMPLE EN • Start a business (future)
Alright, legend, you clock in bulletproof and the first form eats your cape, spreadsheets do a polite eye-roll in Arial, the receipt printer coughs like a moped, the doorbell winks “one step at a time,” you nearly launch a church-adjacent exclamation but the bells clear their throat, three real faces return and the counter becomes a tiny republic; midnight opens a “victory” bottle suspiciously balsamic — it hurts, it seasons — still standing — still you.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF
  const SYS_WHATIF = (isEn(lang) ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~110–155 words).
Warm, grounded, simple; ordinary images (keys, streetlights, notebooks, hands, air).
Show small human truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice).
`.trim() : `
Sei "What If" — un amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~110–155 parole).
Tono caldo e concreto; immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Mostra verità piccole e vere; niente eroismi, niente malinconia.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).
`.trim());

  const FEWSHOTS = [
    { role:"system", content:
`ESEMPIO IT • Tornare all’Aquila
Tornare non sarebbe un passo indietro ma un passo fatto meglio. Ti stupirebbe la memoria delle strade: tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi capisci che ti rimette in orario. I volti sembrano uguali, ma li guardi con occhi più larghi. Le chiavi tornano sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede accanto e tace. Non serve ricominciare da zero: basta ricominciare da te.` },
    { role:"system", content:
`EXAMPLE EN • Move city
You’ll feel like a guest, then your hands learn the new keys. You’ll walk not to think better but to tire the noise. By the third grocery you’ll know which aisle is yours. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. And you notice that beneath the noise something of yours was already there.` },
  ];
  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res){
  cors(req, res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});
    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const admin=await isAdmin(req, ip); const bypass=admin===true;
    const isPro=String(req.headers["x-pro"]||"").trim()==="1";

    if(!bypass){ const {success}=await rl.limit(`ask:${ip}`); if(!success) return res.status(429).json({error:"rate_limited_minute"}); }

    let used=0, dailyCap=isPro?10:3;
    if(!bypass){
      const today=new Date().toISOString().slice(0,10);
      const key=`credits:${ip}:${today}`;
      used=(await redis.incr(key))??1;
      if(used===1) await redis.expire(key, 60*60*24);
      if(used>dailyCap) return res.status(402).json({error:"daily_credits_exhausted", used, dailyCap});
    }

    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const { domanda="", stile="whatif", lang="it", extra="", periodo="future" }=body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({error:"bad_request", detail:"domanda_required"});

    const { sys, fewshots } = personaSystem(stile, lang);
    const temporal = temporalSystem(periodo, lang, stile);
    const extraTemporalHint =
      stile==="wtf" && String(periodo).toLowerCase()==="past"
        ? (isEn(lang)
            ? "Write entirely in past or conditional tense, as if it already happened, keeping the teasing tragicomic tone."
            : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono pungente-tragicomico.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra||"").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra||"").trim()}". Mantieni esattamente la voce della persona.`;

    const messages=[
      {role:"system", content:sys},
      {role:"system", content:temporal},
      ...(extraTemporalHint?[{role:"system", content:extraTemporalHint}]:[]),
      ...(fewshots||[]),
      {role:"user", content:userPrompt},
    ];

    const completion=await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf"?1.02:0.82,
      top_p: 0.92,
      max_tokens: 420,
      frequency_penalty: stile==="wtf"?0.15:0.1,
      presence_penalty: stile==="wtf"?0.45:0.3,
      messages,
    });

    let answer=completion?.choices?.[0]?.message?.content?.trim()||"";
    if(!answer) throw new Error("empty_model_response");
    answer=stripQuestionEcho(domanda,answer);
    answer=tightenSentences(answer, stile==="wtf"?9:11);
    answer=clampWords(answer, stile==="wtf"?170:155);
    answer=normalizeOneParagraph(answer);
    if(stile==="wtf") answer=ensureDoublePunchline(answer,lang);
    else if(!/[.!?…]$/.test(answer)) answer+=".";

    // logs (privacy-safe)
    try{
      function tinyHash(s=""){let h=2166136261>>>0; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36);}
      const entry={ ts:Date.now(), ip, style:stile, lang, periodo,
        domanda_len:String(domanda||"").length, domanda_hash:tinyHash(domanda||""),
        answer_chars:(answer||"").length, admin:!!admin,
        user_type:bypass?"admin":(isPro?"pro":"free")
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask",0,9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style",stile,1);
      await redis.hincrby("stats:lang",lang,1);
      await redis.hincrby("stats:periodo",String(periodo||"future"),1);
      await redis.hincrby("stats:user_type",entry.user_type,1);
      const dayKey=`stats:day:${new Date().toISOString().slice(0,10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}`, 1);
      await redis.expire(dayKey, 90*24*60*60);
    }catch(e){ console.warn("log failure (non-bloccante)", e); }

    return res.status(200).json({ answer, style:stile, lang, periodo, model:MODEL, admin, pro:isPro,
      credits: bypass?null:{used, dailyCap} });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({error:"server_error", detail:String(err?.message||err)});
  }
}
