// /api/ask.js — What?f Engine (2025 FINAL) + MEMORY + STYLES v2
// Stili: whatif (toni: real | poetic) · wtf (sarcasmo smodato, oggetti che reagiscono, “bestemmia” narrata non letterale)
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

// rate limit: 10 req/min per IP (bypass SOLO per admin)
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
  out = out.replace(/\b(beste[mn]{1,2}[a-z]*)\b/gi, "*"); // oscuramento extra
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
    const data = await redis.hgetall(`admin:token:${token}`); // { ip, ua }
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

/* ---------- STYLE GUARDIANS (formato e tono) ---------- */
const EMOJI_RX = /[\p{Extended_Pictographic}\uFE0F]/gu;
const LIST_RX  = /^[\-\•\–\—\*]\s+/gm;
function stripEmoji(s=""){ return String(s).replace(EMOJI_RX, ""); }
function stripLists(s=""){ return String(s).replace(LIST_RX, ""); }
function banQuestions(s=""){ return String(s).replace(/\?/g, "."); } // niente domande
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

// nomignoli (deterministici con seed)
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

// linee di “oggetti che reagiscono” (safe)
const OBJ_REACTIONS_IT = [
  "il lampione finge di tossire educato",
  "la tazzina vibra come un cellulare geloso",
  "le sedie del bar applaudono in legno",
  "il citofono sussurra “ma guarda te”",
  "il semaforo si prende una pausa per ridere",
];
const OBJ_REACTIONS_EN = [
  "the mailbox pretends to clear its throat",
  "the coffee cup buzzes like a jealous phone",
  "the chairs clap in wood",
  "the buzzer whispers “well, well”",
  "the traffic light takes a break to laugh",
];

function ensureWTFBeats(sentences, lang="it"){
  // Garantisce: 1 “bestemmia narrata” + 1 reazione oggetti
  let hasBlasp = sentences.some(s => /bestemmi/i.test(s));
  let hasObj   = sentences.some(s => /(lampione|tazzina|sedia|citofono|semaforo|mailbox|coffee cup|traffic light|buzzer)/i.test(s));
  if (!hasBlasp){
    const line = isEn(lang)
      ? "you let out a blasphemy that rattles the glasses"
      : "ti esce una bestemmia che fa tremare i bicchieri";
    sentences.splice(Math.min(3, sentences.length), 0, line + ".");
  }
  if (!hasObj){
    const pool = isEn(lang) ? OBJ_REACTIONS_EN : OBJ_REACTIONS_IT;
    const line = pool[(Date.now() / 1000 | 0) % pool.length];
    sentences.splice(Math.min(4, sentences.length), 0, line + ".");
  }
  return sentences;
}

function enforceWTF(answer, lang="it", sex="", seed=0){
  let t = oneParagraph(stripEmoji(stripLists(banQuestions(answer))));
  let S = sentenceSplit(t);
  // forza 6–8 frasi
  if (S.length < 6){
    const stub = isEn(lang) ? "you hold the scene together" : "tieni in piedi la scena";
    while (S.length < 6) S.push(stub + ".");
  }
  if (S.length > 8) S = S.slice(0,8);

  // apertura SOLO nomignolo
  const nick = pickNick(seed, lang, sex);
  S[0] = ""; // svuota prima frase
  S.unshift(nick + ".");

  // garantisci i beats richiesti
  S = ensureWTFBeats(S, lang);

  t = joinSentences(S);
  t = t.replace(/\b(beste[mn]{1,2}[a-z]*)\b/gi, "*");
  return ensureSpicyButSafeWTF(t);
}

function enforceWHATIF(answer, tone="real"){
  let t = oneParagraph(stripEmoji(stripLists(banQuestions(answer))));
  let S = sentenceSplit(t);

  const min = tone==="poetic" ? 9 : 8;
  const max = tone==="poetic" ? 12 : 11;

  if (S.length < min){
    const stub = tone==="poetic" ? "E l’aria fa spazio a quello che resta" : "E le cose trovano posto";
    while (S.length < min) S.push(stub + ".");
  }
  if (S.length > max) S = S.slice(0, max);

  // chiusura breve riflessiva (<= 9 parole)
  let last = S[S.length-1] || "";
  const wc = (last.match(/\S+/g)||[]).length;
  if (wc > 9){
    const cut = last.split(/\s+/).slice(0,9).join(" ");
    S[S.length-1] = /[.!?…]$/.test(cut) ? cut : (cut + ".");
  }
  t = joinSentences(S);
  if (!/[.!?…]$/.test(t)) t+=".";
  return t;
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional, quick present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) con toni ---------- */
function personaSystem(style, lang, sex = "", whatif_tone = "real") {
  const en = isEn(lang);
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""

  if (style === "wtf") {
    const SYS = (en ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences.
Open with ONLY a nickname (no verbs). Keep joke density high till the end.
Exactly one brief, narrated blasphemy (never literal); make NEARBY OBJECTS react absurdly.
No lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE.
` : `
Sei “What the F” — l’amico rumoroso e affettuoso che ti prende in giro.
SECONDA PERSONA. UN paragrafo, 6–8 frasi.
Apri SOLO con un nomignolo (senza verbi). Densità di battute alta fino alla fine.
Una sola breve bestemmia narrata (mai letterale); fai reagire gli OGGETTI attorno in modo assurdo.
Niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
`).trim();

    const FEWSHOTS = [
      { role: "system", content:
(en ? `EXAMPLE EN • Moving city (future)
Champ. You land with a plan written on a napkin and the buzzer rolls its eyes; the fridge hums “good luck” while the streetlights rehearse costumes; you walk too far just to tire the noise, you let out a blasphemy that rattles the glasses and the mailbox pretends it didn’t hear, the coffee cup buzzes like a jealous phone, and somehow the map stops asking for proof — you’re not conquering a city, you’re landing your life.` :
`ESEMPIO IT • Mettersi in proprio (futuro)
Campione. Arrivi col piano sul tovagliolo e l’Excel ti guarda come un cameriere stanco; il registratore di cassa tossisce come scooter in salita, ti esce una bestemmia che fa tremare i bicchieri e il lampione finge di tossire educato, poi due facce tornano e la vetrina si raddrizza da sola: non stai vincendo il mondo, stai vincendo tu.`)} ) ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — due toni: real | poetic
  const SYS_REAL = (en ? `
You are "What If" — lucid, kind, grounded.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Plain images (keys, streetlights, notebooks, hands, air). Small truths, no heroics.
No lists, no questions, no emojis. End with one short reflective line (not advice).
` : `
Sei "What If" — lucido, affettuoso, concreto.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria). Verità piccole.
Niente elenchi, niente domande, niente emoji. Chiudi con una riga breve riflessiva (non un consiglio).
`).trim();

  const SYS_POETIC = (en ? `
You are "What If" — narrative-poetic, intimate and clear.
SECOND PERSON. One paragraph, 9–12 sentences (~120–170 words).
Warm imagery, gentle cadence, present-tense drift; no purple excess.
No lists, no questions, no emojis. End with a short reflective line (≤ 9 words).
` : `
Sei "What If" — narrativo-poetico, intimo ma limpido.
SECONDA PERSONA. Un paragrafo, 9–12 frasi (~120–170 parole).
Immagini calde, cadenza dolce, presente che scivola; poesia sobria.
Niente elenchi, niente domande, niente emoji. Chiudi con una riga riflessiva breve (≤ 9 parole).
`).trim();

  const FEWSHOTS_REAL = [
    { role: "system", content:
(en ? `EXAMPLE EN • Move city (real)
You feel like a guest, then your hands learn the new keys. You walk to tire the noise. By the third grocery you know your aisle. Evenings ask less proof. You miss some things, not all at once. The rest finds its place. Beneath the noise, something of yours was already there. And you keep that line.` :
`ESEMPIO IT • Tornare (real)
Tornare non è indietro, è un passo fatto meglio. Le strade tengono il ritmo anche quando lo perdi. All’inizio la lentezza graffia, poi rimette in orario. Le chiavi tornano sul piattino giusto. La nostalgia, se non la insegui, smette di parlare. Ti accorgi che sotto il rumore c’era già qualcosa di tuo. E te lo tieni.`)} ],
  ];

  const FEWSHOTS_POETIC = [
    { role: "system", content:
(en ? `EXAMPLE EN • Staying home (poetic)
You wake to a blue light that rinses the walls. The street knows your step and gives you a small discount on doubt. Friends survive like old trees, saying your name the way a key remembers a lock. The day moves in ordinary miracles: a receipt folded like a sail, a window that learns your breath. Nights close softly and don’t ask for proof. You didn’t go back; you arrived. And that’s enough for now.` :
`ESEMPIO IT • Restare all’Aquila (poetico)
Ti svegli in una luce azzurra che scende dalle montagne. Le strade conoscono il tuo passo e ti fanno lo sconto sul dubbio. Due amici tengono il tuo nome come alberi in un vento lieve. Le mani imparano di nuovo le chiavi, la spesa trova l’angolo buono, un bar ti chiama come una volta. La città non è la stessa, e nemmeno tu: è così che si somiglia. La sera chiude piano, senza chiedere prove. Non sei tornata indietro: sei arrivata. E per oggi basta così.`)} ],
  ];

  const tone = String(whatif_tone || "real").toLowerCase() === "poetic" ? "poetic" : "real";
  return (tone === "poetic")
    ? { sys: SYS_POETIC, fewshots: FEWSHOTS_POETIC }
    : { sys: SYS_REAL,   fewshots: FEWSHOTS_REAL };
}

/* ---------- MEMORIA (per IP) ---------- */
const QA_MAX = 200;
const MICRO_MAX = 90;
const RETENTION_SECONDS = 90 * 24 * 60 * 60; // 90 giorni
function keysFor(ip) {
  const base = `mem:${ip}`;
  return {
    qa: `${base}:qa`,            // list JSON {ts, domanda, answer, stile, periodo, lang}
    micro: `${base}:micro`,      // list JSON {date, mood, decide, anchor, jung}
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
  const freq = (arr, key) => arr.reduce((m, x) => {
    const v = (x && x[key]) ? String(x[key]) : "";
    if (!v) return m;
    m[v] = (m[v] || 0) + 1;
    return m;
  }, {});
  const pickTop = (obj) => {
    let bestKey = "", bestVal = 0;
    for (const [k, v] of Object.entries(obj)) if (v > bestVal) { bestKey = k; bestVal = v; }
    return bestKey || "";
  };
  const last = microList[0]; // più recente
  const moodTop = pickTop(freq(microList, "mood"));
  const decideTop = pickTop(freq(microList, "decide"));
  const anchorTop = pickTop(freq(microList, "anchor"));
  const jungTop = pickTop(freq(microList, "jung"));
  return { lastDate: last?.date || null, lastMood: last?.mood || null, moodTop, decideTop, anchorTop, jungTop };
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

    // PRO header (UI locale): x-pro: "1"
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // Crediti giornalieri: Admin ∞, PRO 10, Free 3
    let used = 0, dailyCap = isPro ? 10 : 3;
    if (!bypass) {
      const today = new Date().toISOString().slice(0, 10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 60 * 60 * 24);
      if (used > dailyCap) {
        return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
      }
    }

    // Body
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = "",
      periodo = "future",
      sex = "",             // "m" | "f" | "nb" | ""
      micro = {},           // { date, mood, decide, anchor, jung }
      remember = true,      // salva memoria
      whatif_tone = "real"  // "real" | "poetic"   <-- NUOVO
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // ---- Carica memoria (personalizzazione) ----
    const { qa: qaRecent, micro: microList } = await loadMemory(ip, 15, 30);
    const memProfile = synthesizeProfile(microList);
    const memoryPrompt = buildMemorySystemPrompt(memProfile, qaRecent, lang);

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, whatif_tone);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed deterministico
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${whatif_tone}`), 36) % 1000000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional, as if it already happened, keeping the upbeat roasting tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono allegro e pungente.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}". WHATIF_TONE="${whatif_tone}". Keep the persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". WHATIF_TONE="${whatif_tone}". Mantieni esattamente la voce. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(memoryPrompt ? [{ role: "system", content: memoryPrompt }] : []),
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `Hard rules: one paragraph only, no lists, no questions, no emojis.`
          : `Regole dure: un solo paragrafo, niente elenchi, niente domande, niente emoji.` },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (whatif_tone === "poetic" ? 0.9 : 0.82),
      top_p: 0.92,
      max_tokens: 380,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.05,
      messages,
    });

    // --- POST-PROCESS ---
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

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
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
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch (e) {
      console.warn("log failure (non-bloccante)", e);
    }

    // --- MEMORIA: salvataggio Q/A e micro (se richiesto) ---
    let memSaved = { qa: 0, micro: 0 };
    if (remember) {
      try {
        await saveQA(ip, { ts: Date.now(), domanda, answer, stile, periodo, lang, whatif_tone: (stile==="whatif"?whatif_tone:null) });
        memSaved.qa = 1;
        await saveMicro(ip, micro);
        memSaved.micro = (micro && (micro.date || micro.mood || micro.decide || micro.anchor || micro.jung)) ? 1 : 0;
      } catch (e) {
        console.warn("memory save failure (non-bloccante)", e);
      }
    }

    // Conta attuale in memoria
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
      memory: { saved: remember === true, savedNow: memSaved, counts, profile: memProfile || null },
      whatif_tone: (stile==="whatif" ? String(whatif_tone||"real") : null)
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    const msg = String(err?.message || err);
    const transient = /timeout|rate|overloaded|ECONNRESET|ENOTFOUND/i.test(msg);
    return res.status(transient ? 503 : 500).json({ error: transient ? "upstream_unavailable" : "server_error", detail: msg });
  }
      }
