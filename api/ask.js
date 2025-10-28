// /api/ask.js — Voce bloccata sui few-shot di Luca (2025-10)
// IT/EN · 1 paragrafo · niente elenchi/domande/emoji · opener fisso per stile

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// --- Upstash / Ratelimit
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

// --- CORS
const ALLOWED_ORIGINS = ["https://what-ifapp.vercel.app","http://localhost:3000","http://127.0.0.1:5500"];
function cors(req,res){
  const o=String(req.headers.origin||"");
  if(ALLOWED_ORIGINS.includes(o)) res.setHeader("Access-Control-Allow-Origin",o);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro");
}

// --- Helpers
const isEn = (lang)=>String(lang||"it").toLowerCase().startsWith("en");
function tinyHash(s=""){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(36);}
function normLine(s=""){return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();}
function tighten(text,maxSent){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[],seen=new Set(); for(const p of parts){const n=normLine(p);if(!n||seen.has(n))continue;out.push(p);seen.add(n);if(out.length>=maxSent)break;}
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clamp(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const s=w.slice(0,maxWords).join(" "); const m=s.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/); return m?m[1]:s+"…";
}
function normalizeOne(s=""){return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim();}
function stripEcho(q,t){
  const d=String(q||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let out=String(t||"");
  const lead=out.slice(0,Math.min(out.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){const cut=out.indexOf("."); if(cut>-1) out=out.slice(cut+1).trim();}
  return out.replace(rx,"");
}

// --- Admin
async function isAdmin(req,ip){
  const token=String(req.headers["x-admin-token"]||"").trim();
  if(!token) return false;
  try{
    const data=await redis.hgetall(`admin:token:${token}`);
    if(!data) return false;
    const LOCK=String(process.env.ADMIN_LOCK_IP||"false").toLowerCase()==="true";
    return LOCK ? (data.ip && data.ip===ip) : true;
  }catch{return false;}
}

// --- Openers (frasi iniziali fisse, ruotate col seed)
const OPENERS = {
  it:{
    whatif:[
      "La stanza è la stessa, lo sguardo no: è già un inizio.",
      "Entrare qui non cambia il mondo, cambia il passo: è abbastanza.",
      "Oggi l’aria è chiara: basta metterci il nome e diventa casa."
    ],
    wtf:[
      "Entri piano, il caos ti riconosce ma oggi ti lascia passare.",
      "Oggi il casino ti fa l’inchino e ti dice: accomodati, che ridiamo assieme.",
      "Ti siedi nel frastuono e il frastuono ti fa spazio: educazione rara."
    ]
  },
  en:{
    whatif:[
      "Same room, different gaze: that’s already a beginning.",
      "You don’t change the world, just your pace: it’s enough.",
      "Air’s clear today; put your name on it and it becomes home."
    ],
    wtf:[
      "Step in slow, chaos knows you and lets you pass today.",
      "Noise bows and says: sit, we’ll laugh together.",
      "You drop into the mess and the mess makes room: rare courtesy."
    ]
  }
};

// --- FEW-SHOTS (ESATTAMENTE quelli forniti da Luca)
const FEWSHOTS_IT = {
  WHATIF_ANALITICO:
`Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`,
  WHATIF_POETICO:
`Bella questa, Luca — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`,
  WTF_BAR:
`Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo.
Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”.
Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale.
La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora: “questo al confessionale lo tengono in riserva”.
Ti versi un goccio di liquore per calmare i santi e giuri che domani apri un bar solo per matti.
Alla chiusura, il bancone ti guarda e tu, esausto, sussurri: “oggi ho bestemmiato più del prete quando finisce il vino — ma almeno ho servito verità calde”.`,
  WTF_MOTO:
`Oh, eccoci, centauro dell’inferno! Casco lucido, cuore impavido, orgoglio pronto all’incidente.
Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino.
Ti scappa un “bestemmione che spacca l’aria!” talmente sonoro che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo.
Ti fermi, respiri, bestemmi di nuovo, ma stavolta con affetto, tipo rito purificatore.
Un vecchio ti dice “bella linea” e tu pensi che parlasse del nervo saltato.
Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio, con un sorrisetto da complice.
Quando torni a casa senti ancora l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie bene calibrate.`,
  WTF_AMORE:
`Ah, Luisa… ci risiamo, eh? Ti butti nel cuore come in un pozzo vuoto, e poi ti lamenti dell’eco.
Lui ti visualizza, poi sparisce, e tu senti salire la pressione sanguigna come se ti stesse caricando un peccato.
Ti parte un “madonna della miseria impestata!” così sincero che la lampada sfarfalla e il bicchiere applaude da solo.
Il gatto scappa, Alexa finge un aggiornamento di sistema, e tu bestemmi a mezza voce come se fosse una preghiera sbagliata.
Poi sorridi, bevi un sorso di rosso e dici: “ogni mia storia finisce con una bestemmia e un brindisi — ma almeno bevo meglio di come amo.”
La luna fuori ti guarda e, giuro, sembra che annuisca pure lei.`
};

// --- Modalità temporale
function temporalSystem(periodo="future", lang="it", style="whatif"){
  const en=isEn(lang);
  if(String(periodo).toLowerCase()==="past"){
    return en
      ? `TEMPORAL MODE: PAST. Speak as if it already happened. Keep EXACT ${style.toUpperCase()} voice. No lists, no questions, no echo.`
      : `MODALITÀ: PASSATO. Parla come se fosse già successo. Mantieni la voce ${style.toUpperCase()} ESATTA. Niente elenchi, niente domande, niente eco.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE. Describe a near-future unfolding. Keep EXACT ${style.toUpperCase()} voice. No lists, no questions, no echo.`
    : `MODALITÀ: FUTURO. Descrivi un prossimo futuro plausibile. Mantieni la voce ${style.toUpperCase()} ESATTA. Niente elenchi, niente domande, niente eco.`;
}

// --- Personas bloccate
function personaSystem(style, lang){
  const en=isEn(lang);
  if(style==="wtf"){
    const sys = (en
      ? `You are “What the F”: loud, loving roast. SECOND PERSON. ONE paragraph, 6–8 sentences, ~125–165 words. Start EXACTLY with the injected opener sentence. Include exactly one brief narrated blasphemy or its euphemistic variant (“bestemmione”, “mannaggia al porco volante…”, etc.). Adult, rude but affectionate. No lists, no questions, no emojis. No proper names. Stay on topic.`
      : `Sei “What the F”: sarcasmo demenziale affettuoso. SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Inizia ESATTAMENTE con la frase di apertura iniettata. Inserisci una sola bestemmia narrata o derivati (“bestemmione”, “mannaggia al porco volante…”) e due reazioni vive attorno. Ruvido ma affettuoso. Niente elenchi/domande/emoji. Niente nomi propri. Resta in tema.`);
    const few = [
      { role:"system", content: FEWSHOTS_IT.WTF_BAR },
      { role:"system", content: FEWSHOTS_IT.WTF_MOTO },
      { role:"system", content: FEWSHOTS_IT.WTF_AMORE },
    ];
    return { sys, few };
  } else {
    const sys = (en
      ? `You are "What If": lucid, kind, slightly ironic. SECOND PERSON. ONE paragraph, 7–9 sentences (~110–150 words). Everyday imagery. End with a short reflective line. No lists, no questions, no emojis. Keep the exact tone of the few-shots.`
      : `Sei "What If": lucido, caldo, leggermente ironico. SECONDA PERSONA. UN paragrafo, 7–9 frasi (~110–150 parole). Immagini quotidiane. Chiudi con una riga riflessiva breve. Niente elenchi/domande/emoji. Mantieni il tono esatto dei few-shot.`);
    const few = [
      { role:"system", content: FEWSHOTS_IT.WHATIF_ANALITICO },
      { role:"system", content: FEWSHOTS_IT.WHATIF_POETICO },
    ];
    return { sys, few };
  }
}

// --- API
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const admin=await isAdmin(req,ip);

    if(!admin){ const { success } = await rl.limit(`ask:${ip}`); if(!success) return res.status(429).json({ error:"rate_limited_minute" }); }

    const isPro = String(req.headers["x-pro"]||"").trim()==="1";
    let used=0, dailyCap=isPro?10:3;
    if(!admin){
      const today=new Date().toISOString().slice(0,10);
      const key=`credits:${ip}:${today}`;
      used=(await redis.incr(key))??1;
      if(used===1) await redis.expire(key,86400);
      if(used>dailyCap) return res.status(402).json({ error:"daily_credits_exhausted", used, dailyCap });
    }

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", lang="it", periodo="future" } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const { sys, few } = personaSystem(stile, lang);
    const temporal = temporalSystem(periodo, lang, stile);

    // tema + opener
    const topic = String(domanda||"").toLowerCase().replace(/[“”"']/g,"").split(/[^a-zàèéìòóù0-9]+/i).filter(w=>w.length>=4).slice(0,7).join(", ");
    const seed=parseInt(tinyHash(`${domanda}|${stile}|${lang}`),36);
    const openers=OPENERS[isEn(lang)?"en":"it"][stile==="wtf"?"wtf":"whatif"];
    const opener=openers[seed % openers.length];

    const rules = (isEn(lang)
      ? `ADHERENCE: stay strictly on the user's topic [${topic}]. Do not invent side themes. No proper names. Start EXACTLY with this opener: "${opener}"`
      : `ADERENZA: resta strettamente sul tema [${topic}]. Non inventare sotto-trame. Niente nomi propri. Inizia ESATTAMENTE con questa frase: "${opener}"`);

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate): "${domanda}". Match few-shot tone exactly.`
      : `Domanda (NON ripeterla): "${domanda}". Rispetta il tono dei few-shot al millimetro.`;

    const messages = [
      { role:"system", content: sys },
      { role:"system", content: temporal },
      { role:"system", content: rules },
      ...few,
      { role:"user", content: userPrompt },
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf"?0.92:0.82,
      top_p: 0.92,
      max_tokens: 380,
      frequency_penalty: stile==="wtf"?0.35:0.1,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");
    if(!answer.trim().startsWith(opener)) answer = `${opener} ${answer}`;
    answer = stripEcho(domanda, answer);
    answer = tighten(answer, stile==="wtf"?8:9);
    answer = clamp(answer, stile==="wtf"?165:150);
    answer = normalizeOne(answer);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    try{
      const entry={ ts:Date.now(), ip, style:stile, lang, periodo, domanda_len:String(domanda).length,
        domanda_hash: tinyHash(domanda), answer_chars: answer.length, admin:!!admin,
        user_type: admin? "admin" : (isPro? "pro":"free") };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask",0,9999);
      await redis.incr("stats:total");
    }catch(e){ console.warn("log failure", e); }

    return res.status(200).json({ answer, style:stile, lang, periodo, model:MODEL, admin, pro:isPro, credits: admin?null:{used,dailyCap} });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
