// /api/ask.js — What?f Engine (FINAL ENFORCED OPENINGS & WTF ARC)
// Stili: whatif (mode: analitico | reale) · wtf
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log privacy-safe (no testo domanda)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
function tinyHash(s = ""){ let h = 2166136261 >>> 0; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,16777619);} return (h>>>0).toString(36); }
function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; if(p.split(/\s+/).length<=3 && !/[.!?]$/.test(p)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,""); return t;
}

/* ========= Admin check ========= */
async function isAdmin(req, requesterIp){
  const token = String(req.headers["x-admin-token"] || "").trim();
  if(!token) return false;
  try{
    const data = await redis.hgetall(`admin:token:${token}`); // { ip, ua }
    if(!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if(LOCK_IP){ if(!data.ip) return false; return data.ip===requesterIp; }
    return true;
  }catch{ return false; }
}

/* ========= Modalità temporale ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en = isEn(lang);
  if(String(periodo).toLowerCase()==="past"){
    return en
      ? "Write as if it already happened (past/conditional allowed)."
      : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en
    ? "Write as a near-future unfolding starting now."
    : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= ESEMPI ========= */
// WHAT IF — Analitico
const EX_WHATIF_ANALITICO_IT = `Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_ANALYTIC_EN = `You’ll feel like a guest, then your hands learn the new keys. You’ll walk not to think better but to tire the noise. By the third grocery you’ll know which aisle is yours. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. And you notice that beneath the noise something of yours was already there.`;
// WHAT IF — Reale/Poetico
const EX_WHATIF_REALE_IT = `Bella questa, Luca — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

// WTF — IT + EN
const EX_WTF_BAR_IT = `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora: “questo al confessionale lo tengono in riserva”. Ti versi un goccio di liquore per calmare i santi e giuri che domani apri un bar solo per matti. Alla chiusura, il bancone ti guarda e tu, esausto, sussurri: “oggi ho bestemmiato più del prete quando finisce il vino — ma almeno ho servito verità calde”.`;
const EX_WTF_MOTO_IT = `Oh, eccoci, centauro dell’inferno! Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” talmente sonoro che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo, ma stavolta con affetto, tipo rito purificatore. Un vecchio ti dice “bella linea” e tu pensi che parlasse del nervo saltato. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio, con un sorrisetto da complice. Quando torni a casa senti ancora l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie bene calibrate.`;
const EX_WTF_AMORE_IT = `Ah, Luisa… ci risiamo, eh? Ti butti nel cuore come in un pozzo vuoto, e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e tu senti salire la pressione sanguigna come se ti stesse caricando un peccato. Ti parte un “madonna della miseria impestata!” così sincero che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento di sistema, e tu bestemmi a mezza voce come se fosse una preghiera sbagliata. Poi sorridi, bevi un sorso di rosso e dici: “ogni mia storia finisce con una bestemmia e un brindisi — ma almeno bevo meglio di come amo.” La luna fuori ti guarda e, giuro, sembra che annuisca pure lei.`;
const EX_WTF_EN = `Champ, you arrive like a limited series pilot and the buzzer rolls its eyes; the fridge hums “good luck” while the streetlights do wardrobe tests, you walk too far just to tire the nerves and a tiny beer forgives your accent, you let out a blasphemy that rattles the glasses and the mailbox pretends it didn’t hear, by grocery three you find your aisle and your pace, and the map stops asking for proof — you’re not conquering a city, you’re landing your life.`;

/* ========= Regole tecniche ========= */
const TECH_RULES_BASE = (lang) => isEn(lang)
  ? `RULES:
- Single paragraph. WHATIF: 115–160 words. WTF: 135–155 words.
- No lists. No emojis. Do not restate the user question.`
  : `REGOLE:
- Un solo paragrafo. WHATIF: 115–160 parole. WTF: 135–155 parole.
- Niente elenchi. Niente emoji. NON ripetere la domanda.`;

/* ========= Regole aggiuntive SOLO per WTF ========= */
const WTF_STRICT = (lang) => isEn(lang)
  ? `WTF OUTPUT — COPY THE EXAMPLES' SHAPE WITH NEW WORDS ONLY.
LENGTH: 135–155 words. Single paragraph. Second person only.
ORDER (exact): tease opening → tiny trigger → one narrated oath (“bestemmia” allowed once OR a synonym) → 2–3 visual object reactions → small booze beat → warm funny close.`
  : `WTF — COPIA LA FORMA DEGLI ESEMPI CAMBIANDO SOLO LE PAROLE.
LUNGHEZZA: 135–155 parole. Un paragrafo. Solo seconda persona.
ORDINE: presa in giro → micro-evento → una “bestemmia” (o sinonimo) narrata → 2–3 reazioni visive → sorsata → chiusa calda.`;

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode }){
  const msgs = [
    { role: "system", content: TECH_RULES_BASE(lang) },
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  if (stile === "wtf") {
    msgs.push(
      { role: "system", content: WTF_STRICT(lang) },
      { role: "system", content: `ESEMPIO · WTF (IT) · Bar\n${EX_WTF_BAR_IT}` },
      { role: "system", content: `ESEMPIO · WTF (IT) · Moto\n${EX_WTF_MOTO_IT}` },
      { role: "system", content: `ESEMPIO · WTF (IT) · Amore\n${EX_WTF_AMORE_IT}` },
      { role: "system", content: `EXAMPLE · WTF (EN)\n${EX_WTF_EN}` },
    );
  } else {
    if (mode === "analitico") {
      msgs.push(
        { role: "system", content: `ESEMPIO · WHAT IF (IT) · Analitico\n${EX_WHATIF_ANALITICO_IT}` },
        { role: "system", content: `EXAMPLE · WHAT IF (EN) · Analytic\n${EX_WHATIF_ANALYTIC_EN}` },
      );
    } else {
      msgs.push(
        { role: "system", content: `ESEMPIO · WHAT IF (IT) · Reale\n${EX_WHATIF_REALE_IT}` },
      );
    }
  }

  const USER = isEn(lang)
    ? `User question (do NOT restate it): "${domanda}". Produce ONE single-paragraph answer in ${lang.toUpperCase()}.`
    : `Domanda (NON ripeterla): "${domanda}". Genera UNA risposta in ${lang.toUpperCase()} a paragrafo unico.`;

  msgs.push({ role: "user", content: USER });
  return msgs;
}

/* ========= Aperture obbligate WHAT IF ========= */
const WHIF_OPEN_IT = {
  analitico: "Sai Luca,",
  reale: "Bella questa, Luca —"
};
const WHIF_OPEN_EN = {
  analitico: "You’ll feel",
  reale: "You open the windows"
};

/* ========= Vocabolario e pattern per WTF ========= */
const IMPRECATION_SYNS = [
  "urlo laico", "scatto profano", "ringhio sconsacrato",
  "sbotto irreligioso", "strillo secolare", "sfogo profano"
];
const REACTION_SENTENCES = [
  "il lampione sfarfalla e i bicchieri tintinnano come un applauso",
  "il citofono finge di non sentirti e la tenda vibra offesa",
  "la vetrina si appanna e il cestino annuisce educato",
  "il semaforo lampeggia per imbarazzo e la panchina distoglie lo sguardo",
  "le tazzine battono il tempo e l’insegna tossisce una nota stonata"
];
const BOOZE_BEATS = [
  "Ti concedi un dito d’amaro e i nervi si mettono in fila.",
  "Un sorso di birra raddrizza la giornata quel tanto che basta.",
  "Un goccetto di grappa ti rimette le viti al loro posto.",
  "Un sorso di vino spegne l’eco e accende il passo."
];
const START_WTF_RX = /^(ah|oh)[,!\s]/i;

/* ========= Handler ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    if(!bypass){
      const { success } = await rl.limit(`ask:${ip}`);
      if(!success) return res.status(429).json({ error:"rate_limited_minute" });
    }

    let used=0, dailyCap = isPro ? 10 : 3;
    if(!bypass){
      const today = new Date().toISOString().slice(0,10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if(used === 1) await redis.expire(key, 60*60*24);
      if(used > dailyCap){
        return res.status(402).json({ error:"daily_credits_exhausted", used, dailyCap });
      }
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",
      mode  = "reale",
      lang  = "it",
      periodo = "future"
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, mode });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 420,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = stile === "wtf" ? tightenSentences(answer, 8) : tightenSentences(answer, 11);
    answer = clampWords(answer, stile === "wtf" ? 168 : 162);
    answer = normalizeOneParagraph(answer);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    /* ===== WHAT IF: forza l’incipit degli esempi ===== */
    if (stile === "whatif") {
      const openings = isEn(lang) ? WHIF_OPEN_EN : WHIF_OPEN_IT;
      const must = (mode === "analitico") ? openings.analitico : openings.reale;
      if (!answer.startsWith(must)) {
        // Inserisci l'incipit con uno spazio, mantenendo il resto
        answer = `${must} ${answer.charAt(0).toUpperCase()}${answer.slice(1)}`;
      }
    }

    /* ===== WTF: forza arco completo come gli esempi ===== */
    if (stile === "wtf") {
      // 2a persona
      answer = answer
        .replace(/\bio\b/gi, "tu")
        .replace(/\bsono\b/gi, "sei")
        .replace(/\bme\b/gi, "te")
        .replace(/\bmi\b/gi, "ti")
        .replace(/\bho\b/gi, "hai");

      // Apertura presa in giro se manca
      if (!START_WTF_RX.test(answer)) {
        answer = `Ah ma guarda te, fai lo spiritoso e la città ti corregge l’intonazione. ` + answer;
      }

      // Garantisci un’imprecazione (bestemmia o sinonimo) dopo il primo evento
      const hasBestemmia = /\bbestemmi\w*\b/i.test(answer);
      const hasSyn = IMPRECATION_SYNS.some(s => answer.toLowerCase().includes(s));
      if (!hasBestemmia && !hasSyn) {
        const firstDot = answer.indexOf("."); // dopo prima frase
        const inj = Math.random()<0.6
          ? " Ti scappa una bestemmia ben assestata che fa vibrare i bicchieri."
          : ` Ti esce uno ${IMPRECATION_SYNS[Math.floor(Math.random()*IMPRECATION_SYNS.length)]} che fa vibrare i bicchieri.`;
        answer = (firstDot>0) ? answer.slice(0, firstDot+1) + inj + answer.slice(firstDot+1) : inj + " " + answer;
      }

      // Reazioni comiche se non presenti
      const needReactions = !/(lampion|bicchier|citofon|vetrin|semafor|tazzin|insegna|panchin|tenda|cestino)/i.test(answer);
      if (needReactions) {
        const r1 = REACTION_SENTENCES[Math.floor(Math.random()*REACTION_SENTENCES.length)];
        const r2 = REACTION_SENTENCES[Math.floor(Math.random()*REACTION_SENTENCES.length)];
        answer += ` ${r1}, ${r2}.`;
      }

      // Sorsata se manca
      if (!/(birra|amaro|grappa|vino|whisky|liquor|rum)/i.test(answer)) {
        const b = BOOZE_BEATS[Math.floor(Math.random()*BOOZE_BEATS.length)];
        answer += ` ${b}`;
      }

      // Chiusa calda se manca un tono di atterraggio
      if (!/[—–-].+?$/.test(answer) && !/più tua\.$|va bene così\.$|si sistema\.$/i.test(answer)) {
        answer += " E ti accorgi che la scena, alla fine, ti vuole bene quanto basta.";
      }

      // Range stretto
      answer = clampWords(answer, 155);
    }

    // Log privacy-safe
    try{
      const entry = {
        ts: Date.now(),
        style: stile,
        mode,
        lang,
        periodo,
        domanda_len: String(domanda||"").length,
        domanda_hash: tinyHash(domanda||""),
        answer_chars: (answer||"").length,
        user_type: (isPro ? "pro" : "free")
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo||"future"), 1);
    }catch{}

    return res.status(200).json({
      answer, style: stile, mode, lang, periodo, model: MODEL,
      pro: isPro, credits: (isPro? { used, dailyCap } : { used, dailyCap })
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
        }
