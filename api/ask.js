// /api/ask.js — What?f Engine (2025 FINAL) + MEMORY + WHATIF TONES + WTF VARIANTS
// Stili: whatif (toni: real | poetic) · wtf (sarcasmo alto, oggetti reattivi, “scoppio” comico variabile, non letterale)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto della domanda (solo metadati + hash non reversibile)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// ---------- OpenAI ----------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.WHATF_MODEL || "gpt-4o-mini";

// ---------- Upstash ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ---------- Rate limit ----------
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

// ---------- CORS ----------
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
  res.setHeader("Access-Control-Max-Age", "86400");
}

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
function normLine(s = "") {
  return String(s).toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "").trim();
}
function tightenSentences(text, maxSentences) {
  const parts = String(text || "").replace(/\n+/g, " ")
    .split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);
  const out = []; const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue;
    out.push(p); seen.add(n);
    if (out.length >= maxSentences) break;
  }
  let t = out.join(" ");
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}
function clampWords(text, maxWords) {
  const w = String(text || "").split(/\s+/);
  if (w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}
function normalizeOneParagraph(s = "") {
  return String(s).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t.slice(0, Math.min(t.length, d.length + 12)).toLowerCase().replace(/[“”"']/g, "").trim();
  const echoRx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) { const cut = t.indexOf("."); if (cut > -1) t = t.slice(cut + 1).trim(); }
  t = t.replace(echoRx, "");
  return t;
}
function ensureSpicyButSafeWTF(t) {
  let out = String(t || "").trim();
  // oscuramento ulteriore evenienze casuali
  out = out.replace(/\b(beste[mn]{1,2}[a-z]*)\b/gi, "*");
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ---------- Admin check ---------- */
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const data = await redis.hgetall(`admin:token:${token}`);
    if (!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if (LOCK_IP) {
      if (!data.ip) return false;
      return data.ip === requesterIp;
    }
    return true;
  } catch {
    return false;
  }
}

/* ---------- STYLE GUARDIANS ---------- */
const EMOJI_RX = /[\p{Extended_Pictographic}\uFE0F]/gu;
const LIST_RX  = /^[\-\•\–\—\*]\s+/gm;
function stripEmoji(s=""){ return String(s).replace(EMOJI_RX, ""); }
function stripLists(s=""){ return String(s).replace(LIST_RX, ""); }
function banQuestions(s=""){ return String(s).replace(/\?/g, "."); }
function oneParagraph(s=""){ return s.replace(/\s*\n+\s*/g, " "); }
function sentenceSplit(s=""){
  return s.replace(/\s+/g," ")
          .split(/(?<=[.!?…])\s+/)
          .map(x=>x.trim()).filter(Boolean);
}
function joinSentences(arr){ 
  let t = arr.join(" ");
  if(!/[.!?…]$/.test(t)) t+=".";
  return t;
}

// nomignoli
const NICKS = {
  it: {
    f: ["regina del casino","fenomena","capitana del caos","sirena urbana","signora dei forse","rockstar con tacchi comodi"],
    m: ["campione","fenomeno","capitano del caos","poeta del bar","sumo dei forse","rockstar con le tasche vuote"],
    nb:["leggenda","fenomen*","cap* del caos","asso universale","rockstar del forse","astronauta del dubbio"]
  },
  en: {
    f: ["queen of chaos","ace of ‘maybe’","legend in sneakers","captain of detours"],
    m: ["champ","legend","captain of chaos","rocket scientist of ‘maybe’"],
    nb:["icon","legend","ace","captain of chaos"]
  }
};
function pickNick(seed, lang="it", sex=""){
  const L = lang.startsWith("en") ? "en" : "it";
  const S = (sex==="f"||sex==="m")? sex : "nb";
  const pool = NICKS[L][S];
  const n = Math.abs(parseInt(tinyHash(String(seed)),36)) % pool.length;
  return pool[n];
}

/* ---------- WTF Explosion Variants (varietà sicura) ---------- */
const WTF_EXPLETIVES_IT = [
  "imprecazione mitologica","turpiloquio siderale","invocazione impropria",
  "vaffa cosmico narrato","grido iconoclasta da cartone","esclamazione da cometa",
  "anatema elasticizzato","romanzesco “non si dice”","urlo apocrifo",
  "latrato teologico non pervenuto","improperio barocco","urletto agnostico deluxe"
];
const WTF_EXPLETIVES_EN = [
  "mythic expletive","sidereal swear (narrated)","improper invocation",
  "cosmic vaffa (cleaned)","iconoclast cartoon yell","comet-class outcry",
  "elastic anathema","novelistic ‘not to be said’","apocryphal roar",
  "agnostic yelp deluxe","baroque outburst","low-church thunderclap"
];
const OBJ_REACTIONS_IT = [
  "il lampione si copre la faccia","la tazzina vibra come un telefono geloso",
  "le sedie del bar battono in legno","il citofono finge di non averti sentito",
  "il semaforo resta giallo per solidarietà","il neon starnutisce luce",
  "il cucchiaino fischia come un treno","la moka risponde a vapore",
  "il POS vibra da standing ovation","la porta automatica si apre solo per applaudire",
  "lo scontrino si arriccia indignato","la pianta cambia lato per non arrossire"
];
const OBJ_REACTIONS_EN = [
  "the streetlight covers its face","the coffee cup buzzes like a jealous phone",
  "the chairs clap in wood","the buzzer pretends it heard nothing",
  "the traffic light stays yellow in solidarity","the neon sneezes light",
  "the teaspoon whistles like a train","the moka replies in steam",
  "the card reader hums a standing ovation","the sliding door opens just to clap",
  "the receipt curls up in protest","the office plant turns away to blush"
];
const CROWD_REACTIONS_IT = [
  "il barista trattiene una risata professionale","due signori alzano il sopracciglio sincronizzato",
  "il vicino annuisce: rito di quartiere","tre ragazzi ridono a catena",
  "il giornalaio piega il quotidiano per nascondere la risata",
  "il cane del vicino applaude con la coda","la sala finge niente ma gode",
  "qualcuno mormora “finalmente” e torna al cappuccino"
];
const CROWD_REACTIONS_EN = [
  "the barista stifles a professional laugh","two neighbors raise a synchronized eyebrow",
  "someone nods: local ritual","three teens laugh in relay",
  "the newsstand guy hides a smile behind the paper",
  "the dog applauds with its tail","the room pretends not to notice but enjoys",
  "someone whispers “finally” and sips their cappuccino"
];
function pickFrom(pool, seed, salt=0){
  const n = Math.abs(parseInt(tinyHash(String(seed)+":"+salt),36));
  return pool[n % pool.length];
}
function ensureWTFBeats(sentences, lang="it", seed=0){
  const L = isEn(lang) ? "en" : "it";
  const EXPL = L==="en" ? WTF_EXPLETIVES_EN : WTF_EXPLETIVES_IT;
  const OBJ  = L==="en" ? OBJ_REACTIONS_EN  : OBJ_REACTIONS_IT;
  const PPL  = L==="en" ? CROWD_REACTIONS_EN: CROWD_REACTIONS_IT;

  const hasBlast = sentences.some(s => /imprecazione|turpiloquio|invocazione impropria|vaffa|iconoclast|cometa|anatema|apocrif|agnostic|barocc|expletive|swear|anathema|apocryphal|outburst/i.test(s));
  const hasObj   = sentences.some(s => /(lampione|tazzina|sedia|citofono|semaforo|neon|cucchiaino|moka|POS|porta|scontrino|pianta|streetlight|coffee cup|chairs|buzzer|traffic light|card reader|sliding door|receipt|plant)/i.test(s));

  if (!hasBlast){
    const e = pickFrom(EXPL, seed, 1);
    const o = pickFrom(OBJ,  seed, 2);
    const c = pickFrom(PPL,  seed, 3);
    const line = isEn(lang)
      ? `you drop a ${e} that rattles the glasses, ${o}, and ${c}.`
      : `ti scappa un’${/^[aeiouàèéìòù]/i.test(e) ? e : (" " + e)} che fa tremare i bicchieri, ${o}, e ${c}.`;
    sentences.splice(Math.min(3, sentences.length), 0, line);
  } else if (!hasObj){
    const o = pickFrom(OBJ,  seed, 4);
    sentences.splice(Math.min(4, sentences.length), 0, `${o}.`);
  }
  return sentences.map(s => /[.!?…]$/.test(s) ? s : (s + "."));
}

/* ---------- WHATIF/WTF formatters ---------- */
function enforceWTF(answer, lang="it", sex="", seed=0){
  let t = oneParagraph(stripEmoji(stripLists(banQuestions(answer))));
  let S = sentenceSplit(t);
  if (S.length < 6){ const stub = isEn(lang) ? "you hold the scene together" : "tieni in piedi la scena"; while (S.length < 6) S.push(stub + "."); }
  if (S.length > 8) S = S.slice(0,8);
  const nick = pickNick(seed, lang, sex);
  S[0] = ""; S.unshift(nick + ".");
  S = ensureWTFBeats(S, lang, seed);
  t = joinSentences(S);
  return ensureSpicyButSafeWTF(t);
}
function enforceWHATIF(answer, tone="real"){
  let t = oneParagraph(stripEmoji(stripLists(banQuestions(answer))));
  let S = sentenceSplit(t);
  const min = tone==="poetic" ? 9 : 8;
  const max = tone==="poetic" ? 12 : 11;
  if (S.length < min){ const stub = tone==="poetic" ? "E l’aria fa spazio a quello che resta" : "E le cose trovano posto"; while (S.length < min) S.push(stub + "."); }
  if (S.length > max) S = S.slice(0, max);
  let last = S[S.length-1] || "";
  const wc = (last.match(/\S+/g)||[]).length;
  if (wc > 9){ const cut = last.split(/\s+/).slice(0,9).join(" "); S[S.length-1] = /[.!?…]$/.test(cut) ? cut : (cut + "."); }
  t = joinSentences(S);
  if (!/[.!?…]$/.test(t)) t+=".";
  return t;
}

/* ---------- Temporal mode ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made then and show how it unfolded. Prefer past/conditional. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe andata. Preferisci passato/condizionale. Niente elenchi, domande, eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente elenchi, domande, eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (whatif: two tones; wtf: comic beats) ---------- */
function personaSystem(style, lang, sex = "", whatif_tone = "real") {
  const en = isEn(lang);
  if (style === "wtf") {
    const SYS = (en ? `
You are “What the F” — loud, loving, more sarcastic toward the end too.
SECOND PERSON. ONE paragraph, 6–8 sentences.
Open ONLY with a nickname (no verbs). Keep jokes dense till the end.
Exactly one brief, narrated blasphemy (never literal); make nearby OBJECTS react absurdly and crowd respond.
No lists, no questions, no emojis. Respect TEMPORAL MODE.
` : `
Sei “What the F” — rumoroso, affettuoso e più sarcastico fino alla fine.
SECONDA PERSONA. UN paragrafo, 6–8 frasi.
Apri SOLO con un nomignolo (senza verbi). Densità di battute alta fino alla chiusura.
Una breve bestemmia narrata (mai letterale); gli OGGETTI reagiscono e le persone fanno da spalla.
Niente elenchi, niente domande, niente emoji. Rispetta la MODALITÀ TEMPORALE.
`).trim();

    const FEW = [
      { role: "system", content:
(en ? `EXAMPLE EN • Moving city
Champ. You land with a napkin-plan, the buzzer rolls its eyes; you walk too far just to tire the noise, you drop a mythic expletive that rattles the glasses, the coffee cup buzzes like a jealous phone, someone whispers “finally” and sips their cappuccino; you’re not conquering a city, you’re landing your life.` :
`ESEMPIO IT • Mettersi in proprio
Campione. Arrivi col piano sul tovagliolo e l’Excel ti guarda stanco; ti scappa un’imprecazione mitologica che fa tremare i bicchieri, il lampione si copre la faccia e il barista trattiene una risata professionale; non stai vincendo il mondo, stai tenendo in piedi te.`)} ],
    ];
    return { sys: SYS, fewshots: FEW };
  }

  // whatif — two tones
  const SYS_REAL = (en ? `
You are "What If" — lucid, kind, grounded. SECOND PERSON. One paragraph, 8–11 sentences.
Plain images (keys, streetlights, notebooks, hands). Small truths. End with a short reflective line.
No lists, no questions, no emojis.
` : `
Sei "What If" — lucido, affettuoso, concreto. SECONDA PERSONA. Un paragrafo, 8–11 frasi.
Immagini quotidiane (chiavi, lampioni, taccuini, mani). Verità piccole. Chiudi con una riga riflessiva breve.
Niente elenchi, domande, emoji.
`).trim();

  const SYS_POETIC = (en ? `
You are "What If" — narrative-poetic, intimate yet clear. SECOND PERSON. One paragraph, 9–12 sentences.
Warm imagery, gentle cadence, present-tense drift. End with a short reflective line (≤ 9 words). No purple.
No lists, no questions, no emojis.
` : `
Sei "What If" — narrativo-poetico, intimo ma limpido. SECONDA PERSONA. Un paragrafo, 9–12 frasi.
Immagini calde, cadenza dolce, presente che scivola. Chiudi con una riga breve (≤ 9 parole). Senza eccessi.
Niente elenchi, domande, emoji.
`).trim();

  const tone = String(whatif_tone||"real").toLowerCase()==="poetic" ? "poetic" : "real";
  return { sys: tone==="poetic" ? SYS_POETIC : SYS_REAL, fewshots: [] };
}

/* ---------- MEMORIA (per IP) ---------- */
const QA_MAX = 200;
const MICRO_MAX = 90;
const RETENTION_SECONDS = 90 * 24 * 60 * 60;
function keysFor(ip) {
  const base = `mem:${ip}`;
  return {
    qa: `${base}:qa`,
    micro: `${base}:micro`,
  };
}
async function saveQA(ip, item) {
  const k = keysFor(ip).qa;
  await redis.lpush(k, JSON.stringify(item));
  await redis.ltrim(k, 0, QA_MAX - 1);
  await redis.expire(k, RETENTION_SECONDS);
}
async function saveMicro(ip, micro) {
  if (!micro || typeof micro !== "object") return;
  const hasUseful = micro.date || micro.mood || micro.decide || micro.anchor || micro.jung;
  if (!hasUseful) return;
  const k = keysFor(ip).micro;
  await redis.lpush(k, JSON.stringify(micro));
  await redis.ltrim(k, 0, MICRO_MAX - 1);
  await redis.expire(k, RETENTION_SECONDS);
}
async function loadMemory(ip, limitQA = 15, limitMicro = 30) {
  const ks = keysFor(ip);
  const [qaRaw, microRaw] = await Promise.all([
    redis.lrange(ks.qa, 0, limitQA - 1),
    redis.lrange(ks.micro, 0, limitMicro - 1),
  ]);
  const qa = (qaRaw || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  const micro = (microRaw || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  return { qa, micro };
}
function synthesizeProfile(microList = []) {
  if (!Array.isArray(microList) || microList.length === 0) return null;
  const freq = (arr, key) => arr.reduce((m, x) => { const v = (x && x[key]) ? String(x[key]) : ""; if (!v) return m; m[v] = (m[v] || 0) + 1; return m; }, {});
  const pickTop = (obj) => Object.entries(obj).sort((a,b)=>b[1]-a[1])[0]?.[0] || "";
  const last = microList[0];
  return {
    lastDate: last?.date || null,
    lastMood: last?.mood || null,
    moodTop: pickTop(freq(microList, "mood")),
    decideTop: pickTop(freq(microList, "decide")),
    anchorTop: pickTop(freq(microList, "anchor")),
    jungTop: pickTop(freq(microList, "jung"))
  };
}
function buildMemorySystemPrompt(memProfile, qaRecent, lang = "it") {
  if (!memProfile && (!qaRecent || qaRecent.length === 0)) return "";
  const en = isEn(lang);
  const microLine = memProfile
    ? (en
        ? `USER PROFILE: last mood "${memProfile.lastMood||"-"}", dominant Jung "${memProfile.jungTop||"-"}", decision style "${memProfile.decideTop||"-"}", anchor "${memProfile.anchorTop||"-"}".`
        : `PROFILO UTENTE: ultimo umore "${memProfile.lastMood||"-"}", Jung prevalente "${memProfile.jungTop||"-"}", stile decisione "${memProfile.decideTop||"-"}", ancoraggio "${memProfile.anchorTop||"-"}".`)
    : "";
  let trendLine = "";
  if (qaRecent && qaRecent.length > 0) {
    const countBy = (k) => qaRecent.reduce((m, x) => { m[x[k]] = (m[x[k]]||0)+1; return m; }, {});
    const topOf = (o) => Object.entries(o).sort((a,b)=>b[1]-a[1])[0]?.[0];
    const favStyle = topOf(countBy("stile"));
    const favPeriod = topOf(countBy("periodo"));
    trendLine = en
      ? `HABITS: prefers style "${favStyle||"-"}", period "${favPeriod||"-"}" lately.`
      : `ABITUDINI: recentemente preferisce stile "${favStyle||"-"}", periodo "${favPeriod||"-"}".`;
  }
  const header = en ? "MEMORY CONTEXT:" : "CONTESTO MEMORIA:";
  return [header, microLine, trendLine].filter(Boolean).join(" ");
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    // IP richiedente
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // Admin bypass (rate+crediti)
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;

    // PRO header
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // Crediti
    let used = 0, dailyCap = isPro ? 10 : 3;
    if (!bypass) {
      const today = new Date().toISOString().slice(0, 10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 60 * 60 * 24);
      if (used > dailyCap) return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
    }

    // Body
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = "",
      periodo = "future",
      sex = "",
      micro = {},
      remember = true,
      whatif_tone = "real"
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Memoria (per personalizzare)
    const { qa: qaRecent, micro: microList } = await loadMemory(ip, 15, 30);
    const memProfile = synthesizeProfile(microList);
    const memoryPrompt = buildMemorySystemPrompt(memProfile, qaRecent, lang);

    // Persona + temporale
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, whatif_tone);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${whatif_tone}`), 36) % 1000000;

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona adapts to user sex="${resolvedSex||"unknown"}". WHATIF_TONE="${whatif_tone}". Keep persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". WHATIF_TONE="${whatif_tone}". Mantieni la voce. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(memoryPrompt ? [{ role: "system", content: memoryPrompt }] : []),
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `Hard rules: one paragraph only, no lists, no questions, no emojis.`
          : `Regole dure: un solo paragrafo, niente elenchi, niente domande, niente emoji.` },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (String(whatif_tone).toLowerCase()==="poetic" ? 0.9 : 0.82),
      top_p: 0.92,
      max_tokens: 380,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.05,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = normalizeOneParagraph(answer);

    if (stile === "wtf") {
      answer = enforceWTF(answer, lang, resolvedSex, seedNum);
      answer = tightenSentences(answer, 8);
      answer = clampWords(answer, 165);
    } else {
      const tone = String(whatif_tone || "real").toLowerCase();
      answer = enforceWHATIF(answer, tone);
      answer = tightenSentences(answer, tone === "poetic" ? 12 : 11);
      answer = clampWords(answer, tone === "poetic" ? 170 : 160);
    }

    // Log (privacy-safe)
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        sex: resolvedSex || null,
        domanda_len: String(domanda || "").length,
        domanda_hash: tinyHash(domanda || ""),
        answer_chars: (answer || "").length,
        admin: !!admin,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
        whatif_tone: stile === "whatif" ? String(whatif_tone||"real") : null
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      if (entry.whatif_tone) await redis.hincrby("stats:whatif_tone", entry.whatif_tone, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}:${entry.whatif_tone||"na"}`, 1);
      await redis.expire(dayKey, RETENTION_SECONDS);
    } catch(e){}

    // Memoria
    if (remember) {
      try {
        await saveQA(ip, { ts: Date.now(), domanda, answer, stile, periodo, lang, whatif_tone: (stile==="whatif"?whatif_tone:null) });
        await saveMicro(ip, micro);
      } catch(e){}
    }

    // counts
    let counts = { qa: 0, micro: 0 };
    try {
      const ks = keysFor(ip);
      const [qaLen, microLen] = await Promise.all([redis.llen(ks.qa), redis.llen(ks.micro)]);
      counts = { qa: qaLen || 0, micro: microLen || 0 };
    } catch {}

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      periodo,
      model: MODEL,
      admin,
      pro: isPro,
      credits: bypass ? null : { used, dailyCap },
      memory: { counts, profile: synthesizeProfile((await loadMemory(ip,1,30)).micro) || null },
      whatif_tone: (stile==="whatif" ? String(whatif_tone||"real") : null)
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    const msg = String(err?.message || err);
    const transient = /timeout|rate|overloaded|ECONNRESET|ENOTFOUND/i.test(msg);
    return res.status(transient ? 503 : 500).json({ error: transient ? "upstream_unavailable" : "server_error", detail: msg });
  }
}
