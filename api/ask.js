// /api/ask.js — What?f Engine (FINAL)
// Stili: whatif (realismo lucido) · wtf (sarcasmo ubriaco affettuoso)
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

const ALLOWED_ORIGINS = ["https://what-ifapp.vercel.app","http://localhost:3000","http://127.0.0.1:5500"];
function cors(req,res){
  const o=String(req.headers.origin||""); if(ALLOWED_ORIGINS.includes(o)) res.setHeader("Access-Control-Allow-Origin",o);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro");
}

/* ===== Utils ===== */
const isEn = (lang) => String(lang||"it").toLowerCase().startsWith("en");
function normLine(s=""){return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();}
function tightenSentences(text,maxSent){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; const wc=p.split(/\s+/).length; if(wc<=3&&!/[.!?]$/.test(p)) continue; out.push(p); seen.add(n); if(out.length>=maxSent) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){ const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text; const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/); return m?m[1]:slice+"…"; }
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function tinyHash(s=""){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36); }

/* ===== Openers & Enforcement ===== */
function getDisplayName(micro={}, extra=""){
  const fromMicro=(micro.name||micro.nome||micro.user||"").trim();
  const m=String(extra||"").match(/\b(Luca|Luisa|[A-Z][a-z]{2,})\b/);
  return fromMicro || (m?m[0]:"");
}
function buildWtfOpener(lang="it", name=""){
  const IT=["Ah, ma guarda un po’","Ah, eccoci","Ah, senti qui", `Ah, ${name?name+"…":"amico"},`];
  const EN=["Ah, look at you","Ah, here we go","Ah, listen up", `Ah, ${name||"friend"},`];
  const pool=isEn(lang)?EN:IT; let s=pool[Math.floor(Math.random()*pool.length)];
  if(!s.endsWith(",")&&!s.endsWith("…")) s+=",";
  return s+" ";
}
function buildWhatIfOpener(lang="it", name="Luca"){
  const IT=[`Sai ${name}, questa domanda era nell’aria da un po’, vero? `, `Bella questa, ${name} — te la saresti fatta prima o poi. `];
  const EN=[`You know ${name}, this question’s been in the air for a while, right? `, `Good one, ${name} — you were always going to ask this. `];
  return (isEn(lang)?EN:IT)[Math.floor(Math.random()*2)];
}
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t=String(text||"");
  t=t.replace(/^(?:what\s*the\s*f|wtf|what\s*if)\s*[•\-–—:.\s]+/i,"");
  t=t.replace(/^(?:risposta|answer)\s*:\s*/i,"");
  const lead=t.slice(0,Math.min(t.length,d.length+24)).toLowerCase().replace(/[“”"']/g,"").trim();
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(/^(?:e\s*se|what\s*if|domanda:|q:)[^.?!…]*[.?!…]\s+/i,"");
  return t.trim();
}
function enforceStyle(answer,{style="whatif",lang="it",name="Luca"}={}){
  let out=String(answer||"").trim();
  if(style==="wtf"){
    if(!/^ah[ ,!?.—–-]/i.test(out)){ out = buildWtfOpener(lang,name) + (out.charAt(0).toLowerCase()+out.slice(1)); }
  }else{
    if(!/^(sai\b|bella\b|you\s+know\b|good\s+one\b)/i.test(out)){ out = buildWhatIfOpener(lang,name)+out.replace(/^[A-ZÀ-Ü]/,c=>c.toLowerCase()); }
  }
  out=out.replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").trim();
  if(!/[.!?…]$/.test(out)) out+=".";
  return out;
}

/* ===== Admin check ===== */
async function isAdmin(req, ip){
  const token = String(req.headers["x-admin-token"]||"").trim();
  if(!token) return false;
  try{
    const data = await redis.hgetall(`admin:token:${token}`);
    if(!data) return false;
    const LOCK = String(process.env.ADMIN_LOCK_IP||"false").toLowerCase()==="true";
    if(LOCK){ if(!data.ip) return false; return data.ip===ip; }
    return true;
  }catch{ return false; }
}

/* ===== Temporal Mode ===== */
function temporalSystem(periodo="future", lang="it", style="whatif"){
  const en=isEn(lang);
  if(String(periodo||"").toLowerCase()==="past"){
    return en
      ? `TEMPORAL MODE: PAST. Speak as if the choice had already happened; prefer past/conditional. Keep EXACT ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO. Parla come se fosse già successo; prediligi passato/condizionale. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE. Describe a plausible near future as if stepping into it now. Keep EXACT ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ===== Personas + FEW-SHOT (i tuoi, identici) ===== */
function personaSystem(style, lang, sex=""){
  const SEX=String(sex||"").toLowerCase();

  if(style==="wtf"){
    const SYS = isEn(lang)
      ? `You are “What the F” — loud, loving, tipsy-roast friend. SECOND PERSON. One paragraph, 6–8 sentences. Include exactly one brief, **narrated** blasphemy (never literal word), occasional reacting objects, warm close. No lists/questions/emojis.`
      : `Sei “What the F” — l’amico rumoroso e affettuoso, da bar. SECONDA PERSONA. Un paragrafo, 6–8 frasi. Una sola bestemmia **narrata** (mai la parola esplicita), ogni tanto oggetti/persona che reagisce, chiusura calda. Niente elenchi/domande/emoji.`;
    const FEWS = [
      { role:"system", content:
`☕ E se aprissi un bar?
Ah, ma guarda un po’, Luca… il genio dell’espresso che si sveglia con la vocazione imprenditoriale.
Ti vedo: grembiule nuovo, sorriso da spot pubblicitario, la moka che sibila come un vecchio nonno stanco di vivere.
Arriva il primo cliente, ti chiede un cappuccino “senza schiuma, ma caldo, però freddo dentro” e già ti parte la pressione.
Tentando l’impossibile, ti bruci un dito, ti scappa un “porca di quella schiuma sorda e bastarda!” che fa tremare le tazzine e il cucchiaino cade in sciopero.
Il frigo rantola, la macchina del caffè fa un ruttino di protesta, e una vecchietta ti guarda come se avessi bestemmiato in latino.
Tu le sorridi, versi grappa nel caffè e pensi: “almeno oggi ho aperto un locale che fa ridere anche i mobili”.
Quando chiudi la sera, il bancone ti dice “ce la rifacciamo domani, capo?” — e tu annuisci, col fegato in disarmo ma il morale alto.` },
      { role:"system", content:
`🏍️ E se comprassi una moto?
Ah, eccoci, Luca mio, il nuovo Valentino del parcheggio condominiale.
Ti presenti con la giacca di pelle lucida, casco nuovo e l’orgoglio che fa attrito.
Accendi il motore, romba come un drago epilettico e già ti senti immortale.
Poi un piccione ti taglia la strada e parte un “porca di quella frizione ubriaca e maledetta!” che rimbalza sui muri del quartiere.
Un passante applaude, un cane ulula in do maggiore e il semaforo si gira dall’altra parte per la vergogna.
Riparti come se nulla fosse, ma il cavalletto resta giù e ti fa un colpo basso: “mannaggia al ferro storto che ti ha creato!”.
Ti fermi al bar, ordini un Negroni, e il barista ti versa due dita extra “per compassione”.
Alla fine ridi, bestemmi piano un’altra volta, e capisci che la moto non era un mezzo per scappare — era solo un modo elegante per cadere in grande stile.` },
      { role:"system", content:
`💔 E se mi innamorassi di nuovo? (versione femminile)
Ah, Luisa… di nuovo tu, eh? Giuro che ogni volta che dici “stavolta ci penso bene”, un prosecco stappa da solo da qualche parte.
Ti vedo: vestita bene ma con l’occhio lucido, messaggi che cancelli e riscrivi come se stessi trattando un’adozione internazionale.
Poi lui ti visualizza e non risponde — e ti scappa un “porca di quella chat maledetta e dell’algoritmo suo zio!” così forte che Siri finge un malfunzionamento per non sentirti.
La lampada vibra, il gatto si rifugia dietro la lavatrice, e il bicchiere di vino si riempie da solo per compassione.
Tu sospiri, bestemmi piano con grazia da signora disperata, e dici “vabbè, almeno stavolta sapevo dove mi andavo a schiantare”.
Alla fine, tra una risata e un rutto di rosé, capisci che innamorarsi è come un aperitivo: sai che finirà male, ma ci vai lo stesso perché almeno fino all’ultimo sorso è vita vera.` },
    ];
    return { sys: SYS, fewshots: FEWS };
  }

  const SYS_WHATIF = isEn(lang)
    ? `You are “What If” — lucid, kind, practical. SECOND PERSON. One paragraph, 8–11 sentences. Warm realism, everyday images, short reflective close. No lists/questions/emojis.`
    : `Sei “What If” — lucido, affettuoso, pratico. SECONDA PERSONA. Un paragrafo, 8–11 frasi. Realismo caldo, immagini quotidiane, chiusura breve riflessiva. Niente elenchi/domande/emoji.`;

  const FEWS_WHATIF = [
    { role:"system", content:
`Analitico — Tornare all’Aquila
Sai Luca, questa domanda era nell’aria da un po’, vero? Tornare all’Aquila oggi vorrebbe dire rientrare in una città che ha cambiato pelle ma non respiro. La ricostruzione ha rimesso in moto artigiani e servizi, a ritmo lento ma costante; meno industria, più impresa locale e università che trattiene giovani per scelta. Il costo della vita resta sotto il Nord, e anche gli stipendi: qui si guadagna meno ma si spende con più senso. La qualità dell’aria, i tempi corti degli spostamenti e le reti di vicinato alleggeriscono le giornate. La scuola è diffusa, le attività sportive ruotano attorno alla montagna, la sanità è vicina ma con liste d’attesa variabili. Il Veneto ti mancherebbe per velocità e mercato, certo, ma qui ritroveresti una pressione più bassa e relazioni più dense. In pratica: meno rumore, più continuità. E quando chiudi casa la sera, senti che il silenzio non è vuoto — è spazio per respirare davvero.` },
    { role:"system", content:
`Poetico — Tornare all’Aquila
Bella questa, Luca — te la saresti fatta prima o poi. Riapri le finestre e l’aria fredda sa di legna e memoria. I vicoli ti riconoscono dal passo, le montagne ti guardano come se non te ne fossi mai andato. Il bar sotto casa serve ancora il caffè corto e ruvido, e qualcuno ti chiama per nome come se il tempo avesse aspettato. I bambini imparano il calendario dalle stagioni, non dall’orologio. Le serate hanno il suono dei portoni che si chiudono e delle chiacchiere che restano sulla soglia. Ogni mattino è un inizio semplice; ogni sera è un pezzo di pace cucito al giorno. Non stai tornando indietro: stai solo tornando dove la corsa smette di comandare.` },
  ];
  return { sys: SYS_WHATIF, fewshots: FEWS_WHATIF };
}

/* ===== Handler ===== */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});
  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});

    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const admin = await isAdmin(req, ip);
    const bypass = admin===true;

    const isPro = String(req.headers["x-pro"]||"").trim()==="1";
    if(!bypass){ const {success}=await rl.limit(`ask:${ip}`); if(!success) return res.status(429).json({error:"rate_limited_minute"}); }

    let used=0, dailyCap=isPro?10:3;
    if(!bypass){
      const today=new Date().toISOString().slice(0,10);
      const key=`credits:${ip}:${today}`;
      used=(await redis.incr(key))??1;
      if(used===1) await redis.expire(key,86400);
      if(used>dailyCap) return res.status(402).json({error:"daily_credits_exhausted", used, dailyCap});
    }

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", lang="it", extra="", periodo="future", sex="", micro={} } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({error:"bad_request", detail:"domanda_required"});

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it). Continue exactly in the voice/structure of the few-shots above. Keep it one paragraph. Context: "${String(extra||"").trim()}".`
      : `Domanda (NON ripeterla). Continua esattamente nella voce/struttura dei few-shot sopra. Un solo paragrafo. Contesto: "${String(extra||"").trim()}".`;

    const messages = [
      { role:"system", content: sys },
      { role:"system", content: temporal },
      ...fewshots,
      { role:"system", content: isEn(lang)
        ? "FRONT-DOOR RULE: keep the same opener pattern (WTF = “Ah, …”; WHAT IF = “You know …”/“Good one, …”), same rhythm, same imagery level. No titles, no question echo, no lists, no emojis."
        : "REGOLA D’INGRESSO: mantieni esattamente l’apertura (WTF = “Ah, …”; WHAT IF = “Sai …”/“Bella questa, …”), stesso ritmo e livello di immagini. Niente titoli, niente eco della domanda, niente elenchi, niente emoji." },
      { role:"user", content: userPrompt },
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

    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf" ? 8 : 11);
    answer = clampWords(answer, stile==="wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);

    const displayName = getDisplayName(micro, extra) || (resolvedSex==="f" ? "Luisa" : "Luca");
    answer = enforceStyle(answer, { style: stile, lang, name: displayName });

    // Logs privacy-safe
    try{
      const entry={ ts:Date.now(), ip, style:stile, lang, periodo, sex:resolvedSex||null,
        domanda_len:String(domanda||"").length, domanda_hash:tinyHash(domanda||""),
        answer_chars:(answer||"").length, admin:!!admin, user_type: bypass?"admin":(isPro?"pro":"free") };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
    }catch{}

    return res.status(200).json({ answer, style:stile, lang, periodo, model:MODEL, admin, pro:isPro,
      credits: bypass ? null : { used, dailyCap } });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
