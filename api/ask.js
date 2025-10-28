// /api/ask.js — What?f Engine (COPY EXAMPLES ONLY • HARD LOCK)
// Niente personalità. SOLO regole minime + ESEMPI. Lunghezza identica (±3%).
// Stili: whatif(mode: analitico|reale) · wtf

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL  = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ===== Rate & Redis ===== */
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ===== CORS ===== */
const ALLOWED_ORIGINS = ["https://what-ifapp.vercel.app","http://localhost:3000","http://127.0.0.1:5500"];
function cors(req,res){
  const o=String(req.headers.origin||""); if(ALLOWED_ORIGINS.includes(o)) res.setHeader("Access-Control-Allow-Origin",o);
  res.setHeader("Vary","Origin"); res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro");
}

/* ===== Helpers ===== */
const isEn = (lang)=> String(lang||"it").toLowerCase().startsWith("en");
const wc = (s)=> (String(s).trim().match(/\S+/g)||[]).length;
function clampWords(text,max){ const a=String(text).trim().split(/\s+/); if(a.length<=max) return text;
  const t=a.slice(0,max).join(" "); const m=t.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/); return (m?m[1]:t)+"…"; }
function onePara(s){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function uniqueSentences(s,max){
  const parts=String(s).replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[],seen=new Set();
  for(const p of parts){ const n=p.toLowerCase(); if(seen.has(n)) continue; seen.add(n); out.push(p); if(out.length>=max) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function tinyHash(s=""){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36); }
function stripEcho(q,txt){
  const d=String(q||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(txt||"");
  const head=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(head.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  return t.replace(rx,"");
}

/* ===== ESEMPI (Guide) ===== */
// WHAT IF — Analitico (IT) + Analytic (EN)
const EX_WHATIF_ANALITICO_IT = `Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_ANALYTIC_EN = `You’ll feel like a guest, then your hands learn the new keys. You’ll walk not to think better but to tire the noise. By the third grocery you’ll know which aisle is yours. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. And you notice that beneath the noise something of yours was already there.`;
// WHAT IF — Reale/Poetico (IT)
const EX_WHATIF_REALE_IT = `Bella questa, Luca — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;
// WTF — IT (3) + EN
const EX_WTF_BAR_IT = `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora: “questo al confessionale lo tengono in riserva”. Ti versi un goccio di liquore per calmare i santi e giuri che domani apri un bar solo per matti. Alla chiusura, il bancone ti guarda e tu, esausto, sussurri: “oggi ho bestemmiato più del prete quando finisce il vino — ma almeno ho servito verità calde”.`;
const EX_WTF_MOTO_IT = `Oh, eccoci, centauro dell’inferno! Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” talmente sonoro che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo, ma stavolta con affetto, tipo rito purificatore. Un vecchio ti dice “bella linea” e tu pensi che parlasse del nervo saltato. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio, con un sorrisetto da complice. Quando torni a casa senti ancora l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie bene calibrate.`;
const EX_WTF_AMORE_IT = `Ah, Luisa… ci risiamo, eh? Ti butti nel cuore come in un pozzo vuoto, e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e tu senti salire la pressione sanguigna come se ti stesse caricando un peccato. Ti parte un “madonna della miseria impestata!” così sincero che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento di sistema, e tu bestemmi a mezza voce come se fosse una preghiera sbagliata. Poi sorridi, bevi un sorso di rosso e dici: “ogni mia storia finisce con una bestemmia e un brindisi — ma almeno bevo meglio di come amo.” La luna fuori ti guarda e, giuro, sembra che annuisca pure lei.`;
const EX_WTF_EN = `Champ, you arrive like a limited series pilot and the buzzer rolls its eyes; the fridge hums “good luck” while the streetlights do wardrobe tests, you walk too far just to tire the nerves and a tiny beer forgives your accent, you let out a blasphemy that rattles the glasses and the mailbox pretends it didn’t hear, by grocery three you find your aisle and your pace, and the map stops asking for proof — you’re not conquering a city, you’re landing your life.`;

/* ===== Target wordcounts (stimati sugli esempi) ===== */
const TARGET = {
  "whatif:analitico:it": 145,   // ±3%
  "whatif:reale:it":     125,
  "whatif:analytic:en":  120,
  "wtf:it":              145,
  "wtf:en":              145,
};
function keyTarget(stile,mode,lang){
  if(stile==="whatif"){
    if(isEn(lang)) return "whatif:analytic:en";
    return mode==="analitico" ? "whatif:analitico:it" : "whatif:reale:it";
  }else{
    return isEn(lang) ? "wtf:en" : "wtf:it";
  }
}
function within(n,t){ const tol=Math.max(3, Math.round(t*0.03)); return n>=t-tol && n<=t+tol; }

/* ===== Rules minimaliste ===== */
const RULES = (lang)=> isEn(lang)
? `RULES:
- Single paragraph. No lists. No questions. No emojis. Don’t restate the question.
- Match the EXAMPLES’ structure exactly. New wording, same arc.
- Match the target length (±3%).`
: `REGOLE:
- Un solo paragrafo. Niente elenchi/domande/emoji. NON ripetere la domanda.
- Copia la struttura degli ESEMPI. Parole nuove, stessa arcata.
- Rispetta la lunghezza target (±3%).`;

const TIME = (periodo,lang)=> String(periodo).toLowerCase()==="past"
  ? (isEn(lang)? "Write as if it already happened." : "Scrivi come se fosse già successo.")
  : (isEn(lang)? "Write as a near-future unfolding." : "Scrivi come un prossimo futuro.");

/* ===== Istruzioni specifiche (brevi) ===== */
const WHATIF_LOCK = (lang,mode)=> isEn(lang)
? `OPEN like the examples (“You’ll feel…” OR similar calm incipit). Keep the same arc and length.`
: (mode==="analitico"
   ? `APR I con “Sai Luca, …” (stessa forma). Mantieni arcata e lunghezza identiche all’esempio.`
   : `APRI con “Bella questa, Luca — …” (stessa forma). Mantieni arcata e lunghezza identiche all’esempio.`);

const WTF_LOCK = (lang)=> isEn(lang)
? `WTF SHAPE (copy examples, new wording):
1) Longer teasing opener (2–3 lines) that pokes fun at the user.
2) A tiny event happens.
3) Then ONE narrated outburst using a SYNONYM of “blasphemy” only: “imprecation”, “curse”, “misplaced invocation”, “sacrilegious vent”, “secular yelp”.
4) Immediately 2–3 visual comic reactions by objects/ambient.
5) A short booze beat (sip/beer/shot).
6) Warm, witty close. Second person ONLY.`
: `WTF (copia gli esempi, parole nuove):
1) Apertura di presa per il culo (2–3 frasi).
2) Succede una micro-scena.
3) POI UNA imprecazione narrata usando SOLO sinonimi di “bestemmia”: “imprecazione”, “maledizione”, “invocazione fuori posto”, “sfiato sacrilego”, “strillo laico”.
4) Subito 2–3 reazioni comiche e visive di oggetti/ambiente.
5) Breve accenno di alcol (sorso/birra/shot).
6) Chiusa calda. SOLO seconda persona.`;

/* ===== Prompt builder ===== */
function buildMessages({ domanda, lang, periodo, stile, mode }){
  const msgs = [
    { role:"system", content: RULES(lang) },
    { role:"system", content: TIME(periodo, lang) },
  ];

  if(stile==="wtf"){
    msgs.push(
      { role:"system", content: WTF_LOCK(lang) },
      { role:"system", content: `ESEMPIO · WTF (IT) · Bar\n${EX_WTF_BAR_IT}` },
      { role:"system", content: `ESEMPIO · WTF (IT) · Moto\n${EX_WTF_MOTO_IT}` },
      { role:"system", content: `ESEMPIO · WTF (IT) · Amore\n${EX_WTF_AMORE_IT}` },
      { role:"system", content: `EXAMPLE · WTF (EN)\n${EX_WTF_EN}` },
    );
  }else{
    msgs.push(
      { role:"system", content: WHATIF_LOCK(lang, mode) },
      ...(mode==="analitico"
        ? [
            { role:"system", content: `ESEMPIO · WHAT IF (IT) · Analitico\n${EX_WHATIF_ANALITICO_IT}` },
            { role:"system", content: `EXAMPLE · WHAT IF (EN) · Analytic\n${EX_WHATIF_ANALYTIC_EN}` },
          ]
        : [{ role:"system", content: `ESEMPIO · WHAT IF (IT) · Reale\n${EX_WHATIF_REALE_IT}` }]
      )
    );
  }

  const u = isEn(lang)
  ? `User question (do NOT restate it): "${domanda}". Produce ONE paragraph in ${lang.toUpperCase()}.`
  : `Domanda (NON ripeterla): "${domanda}". Genera UN paragrafo in ${lang.toUpperCase()}.`;

  msgs.push({ role:"user", content: u });
  return msgs;
}

/* ===== Heuristics: WTF checks ===== */
function has1stIT(s){ return /\b(io|sono|mi|me|mio|mia|noi|nostr[oaie])\b/i.test(s); }
function hasReactionsIT(s){ return /(sfarfall|applaud|finge|toss|trema|rimbal|arross|cambia marciapiede|scampanell|fa eco)/i.test(s); }
function hasAlcoholIT(s){ return /(birra|vino|grapp|liquor|amaro|rum|whisky|bicchier|sorso|shot)/i.test(s); }

/* ===== Handler ===== */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const isPro = String(req.headers["x-pro"]||"").trim()==="1";
    const adminToken = String(req.headers["x-admin-token"]||"").trim();
    const admin = adminToken ? !!(await redis.hgetall(`admin:token:${adminToken}`)) : false;

    if(!admin){
      const { success } = await rl.limit(`ask:${ip}`);
      if(!success) return res.status(429).json({ error:"rate_limited_minute" });
    }
    let used=0, dailyCap=isPro?10:3;
    if(!admin){
      const today=new Date().toISOString().slice(0,10);
      const key=`credits:${ip}:${today}`;
      used=(await redis.incr(key))??1;
      if(used===1) await redis.expire(key, 86400);
      if(used>dailyCap) return res.status(402).json({ error:"daily_credits_exhausted", used, dailyCap });
    }

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", mode="reale", lang="it", periodo="future" } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const tkey = keyTarget(stile, mode, lang);
    const target = TARGET[tkey] || 140;

    // 1) Generate
    const messages = buildMessages({ domanda, lang, periodo, stile, mode });
    let comp = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.96 : 0.82,
      top_p: 0.92,
      max_tokens: 420,
      messages
    });

    let answer = comp?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // 2) Clean + tighten
    answer = stripEcho(domanda, answer);
    answer = uniqueSentences(answer, stile==="wtf"?8:11);
    answer = onePara(answer);
    // word tuning
    const words = wc(answer);
    if(words > target*1.06) answer = clampWords(answer, Math.round(target*1.03));
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // 3) WTF polish se serve
    if(stile==="wtf" && !isEn(lang)){
      const need2nd = has1stIT(answer);
      const needReact = !hasReactionsIT(answer);
      const needAlc = !hasAlcoholIT(answer);
      const tooShort = !within(wc(answer), target);

      if(need2nd || needReact || needAlc || tooShort){
        const fixMsgs = [
          { role:"system", content: RULES(lang) },
          { role:"system", content: WTF_LOCK(lang) },
          { role:"system", content:
`RIPARA il testo seguente SENZA cambiarne il senso:
- Forma: presa per il culo (2–3 frasi) → micro-evento → UNA imprecazione narrata (usa SOLO: "imprecazione", "maledizione", "invocazione fuori posto", "sfiato sacrilego", "strillo laico") → 2–3 reazioni comiche di oggetti → breve alcol → chiusa calda.
- Solo seconda persona.
- Lunghezza ${target} parole (±3%).`},
          { role:"user", content: answer }
        ];
        const fix = await client.chat.completions.create({
          model: MODEL, temperature: 0.7, top_p: 0.9, max_tokens: 420, messages: fixMsgs
        });
        let fixed = fix?.choices?.[0]?.message?.content?.trim() || answer;
        fixed = uniqueSentences(fixed, 8);
        fixed = onePara(fixed);
        if(!/[.!?…]$/.test(fixed)) fixed+=".";
        answer = fixed;
      }
    }

    // 4) log
    try{
      const entry={ ts:Date.now(), ip, style:stile, mode, lang, periodo,
        domanda_len:String(domanda).length, domanda_hash:tinyHash(domanda), answer_chars:answer.length,
        user_type: admin?"admin":(isPro?"pro":"free") };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask",0,9999);
    }catch{}

    return res.status(200).json({ answer, style:stile, mode, lang, periodo, model:MODEL, pro:isPro });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
