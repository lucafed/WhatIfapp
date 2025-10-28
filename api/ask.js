// /api/ask.js — What?f Engine (CLEAN COPY MODE • HARD-STRUCTURE v2)
// Stili: whatif (mode: analitico | reale) · wtf
// IT/EN — paragrafo singolo, niente liste/domande/emoji

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ===== Redis & rate ===== */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ===== CORS ===== */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req,res){
  const origin=String(req.headers.origin||"");
  if(ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro");
}

/* ===== Helpers ===== */
const isEn = (lang)=> String(lang||"it").toLowerCase().startsWith("en");
function tinyHash(s=""){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36); }
function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text,maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; if(p.split(/\s+/).length<=3 && !/[.!?]$/.test(p)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function countWords(t){ return String(t||"").trim().split(/\s+/).filter(Boolean).length; }
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,""); return t;
}

/* ===== 2nd person hard lock (IT/EN) ===== */
function forceSecondPerson(text, lang="it"){
  let t=" "+String(text||"")+" ";
  if(isEn(lang)){
    const map=[[/\bI\b/g,"you"],[/\bI'm\b/g,"you're"],[/\bI am\b/g,"you are"],[/\bI've\b/g,"you've"],[/\bI’d\b|\bI'd\b/g,"you’d"],[/\bmy\b/g,"your"],[/\bme\b/g,"you"],[/\bmine\b/g,"yours"]];
    for(const [rx,rep] of map) t=t.replace(rx,rep);
  }else{
    const map=[[/\bio\b/gi,"tu"],[/\bsono\b/gi,"sei"],[/\beros\b/gi,"eri"],[/\bmi\b/gi,"ti"],[/\bme\b/gi,"te"],[/\bmio\b/gi,"tuo"],[/\bmia\b/gi,"tua"],[/\bmiei\b/gi,"tuoi"],[/\bmie\b/gi,"tue"],[/\bpenso\b/gi,"pensi"],[/\bimmagino\b/gi,"immagini"],[/\bvoglio\b/gi,"vuoi"],[/\bprendo\b/gi,"prendi"],[/\bordino\b/gi,"ordini"],[/\bmi ricordo\b/gi,"ti ricordi"],[/\bsento\b/gi,"senti"],[/\bho\b/gi,"hai"]];
    for(const [rx,rep] of map) t=t.replace(rx,rep);
  }
  return t.replace(/\s{2,}/g," ").trim();
}

/* ===== What if: incipit obbligatorio ===== */
const INCIPIT_WHIF_IT = {
  analitico: [
    "Sai Luca, questa domanda girava nell’aria da un po’.",
    "Te lo dico chiaro: questa è una domanda che aveva già bussato.",
    "Diciamolo: era da tempo che ci giravi attorno."
  ],
  reale: [
    "Bella questa, Luca — me l’aspettavo da te.",
    "Apri le finestre e l’aria ti riconosce subito.",
    "La stanza è la stessa, lo sguardo no."
  ]
};
function ensureWhatIfIncipit(answer, mode="reale", lang="it"){
  if(isEn(lang)) return answer; // in EN lasciamo al prompt
  const bank = mode==="analitico" ? INCIPIT_WHIF_IT.analitico : INCIPIT_WHIF_IT.reale;
  const ok = bank.some(line => answer.startsWith(line));
  if(ok) return answer;
  const pick = bank[Math.floor(Math.random()*bank.length)];
  return `${pick} ${answer[0]==="“" ? "" : ""}${answer}`.trim();
}

/* ===== WTF: struttura e lessico forzati ===== */
const OATH_IT = ["bestemmia","imprecazione","maledizione","invettiva","scongiuro storto"];
const REACT_TEMPLATES_IT = [
  "la lampada sfarfalla come se avesse sentito tutto",
  "i bicchieri applaudono sullo sfondo",
  "il citofono finge di non aver udito",
  "un cane cambia marciapiede per prudenza",
  "il semaforo ci pensa due volte prima di restare verde"
];
const ALCOOL_BEATS_IT = [
  "Ti concedi un sorso di rosso per rimettere in fila i pensieri",
  "Ti versi un goccio di grappa che ti spiana la fronte",
  "Una birretta piccola, giusto per sciogliere i bulloni"
];
const WARM_CLOSE_IT = [
  "Alla fine ti viene da ridere: non stai tornando indietro, stai solo tornando dove il tempo conosce il tuo nome.",
  "E capisci che puoi far pace con tutto: basta prendere il ritmo giusto e lasciare il resto indietro.",
  "Poi respiri: oggi hai esagerato con i segni, ma almeno li hai messi al posto giusto."
];

function enforceWtfStructure(answer){
  let t = String(answer||"").trim();

  // 1) Assicura UNA parola di giuramento (senza diminutivi)
  const oathRx = new RegExp(`\\b(${OATH_IT.join("|")})\\b`, "i");
  const allOaths = t.match(new RegExp(`\\b(${OATH_IT.join("|")})\\b`, "gi")) || [];
  if(allOaths.length===0){
    // inserisco dopo la prima frase
    const idx = t.indexOf("."); 
    if(idx>-1) t = t.slice(0, idx+1) + ` Ti scappa una ${OATH_IT[0]} che vibra nell’aria.` + t.slice(idx+1);
    else t = `Ti scappa una ${OATH_IT[0]} che vibra nell’aria. ` + t;
  } else if(allOaths.length>1){
    // mantieni la prima, rimuovi le altre
    let kept = false;
    t = t.replace(new RegExp(`\\b(${OATH_IT.join("|")})\\b`, "gi"), (m)=>{
      if(!kept){ kept=true; return m; }
      return "fiato";
    });
  }

  // 2) Reazioni visive subito dopo la frase col giuramento (garantire 2)
  const firstOathPos = t.search(oathRx);
  if(firstOathPos>-1){
    // trova fine frase contenente il giuramento
    const end = t.indexOf(".", firstOathPos);
    if(end>-1){
      const after = t.slice(end+1).trimStart();
      const before = t.slice(0, end+1);
      // quante reazioni già presenti?
      const haveReactions = (after.match(/\b(lampad|bicchier|citofon|semaforo|cane)\w*/gi)||[]).length;
      const needed = Math.max(0, 2 - haveReactions);
      let inject = "";
      for(let i=0;i<needed;i++){
        inject += " " + REACT_TEMPLATES_IT[(i + firstOathPos)%REACT_TEMPLATES_IT.length] + ".";
      }
      t = before + inject + " " + after;
    }
  }

  // 3) Accenno di alcol (se manca)
  if(!/\b(sorso|grappa|birr|vino|liquor)\w*\b/i.test(t)){
    const beat = ALCOOL_BEATS_IT[Math.floor(Math.random()*ALCOOL_BEATS_IT.length)];
    // Inserisci dopo le reazioni (dopo 2-3 punti)
    let pos = 0, dots=0;
    while(dots<3 && pos<t.length){ if(t[pos]==='.') dots++; pos++; }
    t = t.slice(0,pos) + " " + beat + ". " + t.slice(pos);
  }

  // 4) Chiusa calda (se manca)
  if(!/[.!?…]\s*$/.test(t)) t += ".";
  if(!/(alla fine|alla chiusura|poi respiri|e capisci)\b/i.test(t)){
    const close = WARM_CLOSE_IT[Math.floor(Math.random()*WARM_CLOSE_IT.length)];
    t = t.replace(/[.!?…]\s*$/,". " + close);
  }

  return t;
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

/* ===== Temporal instruction ===== */
function temporalInstruction(periodo="future", lang="it"){
  const en=isEn(lang);
  if(String(periodo).toLowerCase()==="past"){
    return en? "Write as if it already happened (past/conditional allowed)."
             : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en? "Write as a near-future unfolding starting now."
           : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ===== ESEMPI (come da tuoi definitivi) ===== */
const EX_WHATIF_ANALITICO_IT = `Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_ANALYTIC_EN = `You’ll feel like a guest, then your hands learn the new keys. You’ll walk not to think better but to tire the noise. By the third grocery you’ll know which aisle is yours. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. And you notice that beneath the noise something of yours was already there.`;
const EX_WHATIF_REALE_IT = `Bella questa, Luca — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;
const EX_WTF_BAR_IT = `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora: “questo al confessionale lo tengono in riserva”. Ti versi un goccio di liquore per calmare i santi e giuri che domani apri un bar solo per matti. Alla chiusura, il bancone ti guarda e tu, esausto, sussurri: “oggi ho bestemmiato più del prete quando finisce il vino — ma almeno ho servito verità calde”.`;
const EX_WTF_MOTO_IT = `Oh, eccoci, centauro dell’inferno! Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” talmente sonoro che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo, ma stavolta con affetto, tipo rito purificatore. Un vecchio ti dice “bella linea” e tu pensi che parlasse del nervo saltato. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio, con un sorrisetto da complice. Quando torni a casa senti ancora l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie bene calibrate.`;
const EX_WTF_AMORE_IT = `Ah, Luisa… ci risiamo, eh? Ti butti nel cuore come in un pozzo vuoto, e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e tu senti salire la pressione sanguigna come se ti stesse caricando un peccato. Ti parte un “madonna della miseria impestata!” così sincero che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento di sistema, e tu bestemmi a mezza voce come se fosse una preghiera sbagliata. Poi sorridi, bevi un sorso di rosso e dici: “ogni mia storia finisce con una bestemmia e un brindisi — ma almeno bevo meglio di come amo.” La luna fuori ti guarda e, giuro, sembra che annuisca pure lei.`;
const EX_WTF_EN = `Champ, you arrive like a limited series pilot and the buzzer rolls its eyes; the fridge hums “good luck” while the streetlights do wardrobe tests, you walk too far just to tire the nerves and a tiny beer forgives your accent, you let out a blasphemy that rattles the glasses and the mailbox pretends it didn’t hear, by grocery three you find your aisle and your pace, and the map stops asking for proof — you’re not conquering a city, you’re landing your life.`;

/* ===== Regole tecniche ===== */
const TECH_RULES_BASE = (lang)=> isEn(lang)
? `RULES:
- Second person ONLY (no first person).
- Single paragraph. Match examples’ length (WHAT IF ~140–160; WTF ~140–165 words).
- No lists. No questions. No emojis. Do not restate the user question.`
: `REGOLE:
- Solo seconda persona (nessuna prima persona).
- Un solo paragrafo. Lunghezze come esempi (WHAT IF ~140–160; WTF ~140–165 parole).
- Niente elenchi. Niente domande. Niente emoji. NON ripetere la domanda.`;

const WHF_INCIPIT_RULE = (lang)=> isEn(lang)
? `WHAT IF must open with a one-line incipit like the examples; then keep their arc.`
: `WHAT IF deve aprire con un'incipit identico nella forma agli esempi; poi stesso arco narrativo.`;

// WTF strettissimo
const WTF_STRICT = (lang)=> isEn(lang)
? `WTF SHAPE: tease → ONE oath word (“blasphemy/oath/curse/invective/crooked charm”) → 2–3 visual reactions → tiny alcohol beat → warm witty close. No diminutives. Second person only.`
: `WTF STRUTTURA: presa in giro → UNA parola tra “bestemmia/imprecazione/maledizione/invettiva/scongiuro storto” → 2–3 reazioni visive → accenno alcol → chiusa calda. Niente diminutivi. Solo seconda persona.`;

/* ===== Prompt builder ===== */
function buildMessages({ domanda, lang, periodo, stile, mode }){
  const msgs=[
    { role:"system", content: TECH_RULES_BASE(lang) },
    { role:"system", content: temporalInstruction(periodo, lang) },
  ];
  if(stile==="wtf"){
    msgs.push(
      { role:"system", content: WTF_STRICT(lang) },
      { role:"system", content: `ESEMPIO · WTF (IT) · Bar\n${EX_WTF_BAR_IT}` },
      { role:"system", content: `ESEMPIO · WTF (IT) · Moto\n${EX_WTF_MOTO_IT}` },
      { role:"system", content: `ESEMPIO · WTF (IT) · Amore\n${EX_WTF_AMORE_IT}` },
      { role:"system", content: `EXAMPLE · WTF (EN)\n${EX_WTF_EN}` },
    );
  }else{
    msgs.push({ role:"system", content: WHF_INCIPIT_RULE(lang) });
    if(mode==="analitico"){
      msgs.push(
        { role:"system", content: `ESEMPIO · WHAT IF (IT) · Analitico\n${EX_WHATIF_ANALITICO_IT}` },
        { role:"system", content: `EXAMPLE · WHAT IF (EN) · Analytic\n${EX_WHATIF_ANALYTIC_EN}` },
      );
    }else{
      msgs.push({ role:"system", content: `ESEMPIO · WHAT IF (IT) · Reale\n${EX_WHATIF_REALE_IT}` });
    }
  }
  const USER = isEn(lang)
    ? `User question (do NOT restate it): "${domanda}". One single-paragraph answer in ${lang.toUpperCase()}.`
    : `Domanda (NON ripeterla): "${domanda}". Una risposta in ${lang.toUpperCase()} a paragrafo unico.`;
  msgs.push({ role:"user", content: USER });
  return msgs;
}

/* ===== Handler ===== */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const admin = await isAdmin(req, ip);
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
      used=(await redis.incr(key)) ?? 1;
      if(used===1) await redis.expire(key, 60*60*24);
      if(used>dailyCap) return res.status(402).json({ error:"daily_credits_exhausted", used, dailyCap });
    }

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", mode="reale", lang="it", periodo="future" } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, mode });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf"?8:11);
    answer = normalizeOneParagraph(answer);
    // Forzature di stile
    if(stile==="whatif" && !isEn(lang)){
      answer = ensureWhatIfIncipit(answer, mode, lang);
    }
    if(stile==="wtf" && !isEn(lang)){
      answer = enforceWtfStructure(answer);
    }
    // Hard lock 2a persona
    answer = forceSecondPerson(answer, lang);

    // Lunghezze come esempi (soft pad/clamp)
    const target = stile==="wtf" ? {min:140,max:165} : {min:140,max:160};
    const w = countWords(answer);
    if(w < target.min){
      const pad = stile==="wtf"
        ? " E va bene così: ridendo ci si sistema anche il casco della giornata."
        : " È un passo avanti lento, ma finalmente tuo.";
      answer += pad;
    }
    answer = clampWords(answer, target.max);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // Log minimo, privacy-safe
    try{
      const entry={ ts:Date.now(), ip, style:stile, mode, lang, periodo,
        domanda_len:String(domanda||"").length, domanda_hash:tinyHash(domanda||""), answer_chars:answer.length,
        user_type: bypass? "admin" : (isPro? "pro":"free") };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
    }catch{}

    return res.status(200).json({ answer, style:stile, mode, lang, periodo, model:MODEL,
      admin, pro:isPro, credits: bypass? null : { used, dailyCap } });

  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
    }
