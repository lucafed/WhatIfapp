// /api/ask.js — What?f Engine (2025 FINAL — coherent WTF, strict counterfactual, polished UI rules)
// Stili: whatif (realismo lucido, NO nomignoli) · wtf (sarcasmo affettuoso, nomignolo iniziale + 1 imprecazione narrata coerente, verso la fine)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Controfattuale IT: condizionale passato/trapassato (“avresti fatto…”, “sarebbe successo…”)
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log: Redis, SOLO metadati (mai il testo della domanda)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Upstash ---------- */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ---------- CORS ---------- */
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

function normLine(s = "") {
  return String(s).toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "").trim();
}
function tightenSentences(text, maxSentences) {
  const parts = String(text || "").replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
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
  return String(s).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1").trim();
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
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ---------- WTF extras ---------- */
// nomignoli (generati randomicamente a rotazione)
const NICKS_IT = [
  "astronauta del bar","poeta del caffè freddo","capitano dei forse","macchinista dei drammi minori",
  "re delle chiavi perse","sirena del carrello","campione del rinvio creativo","pilota di rotonde",
  "ministro degli snack","cowboy del lunedì", "sciamano del ‘poi vediamo’"
];
const NICKS_EN = [
  "bar philosopher","captain of almost","duke of detours","legend in slippers","pilot of roundabouts",
  "ace of maybe","minister of snacks","cowboy of Mondays","wizard of ‘we’ll see’"
];
const IMPRECATION_IT = [
  "ti esce un’imprecazione che fa tremare i bicchieri",
  "ti scappa un moccolo che sposta le sedie da solo",
  "ti parte un borbottio sacrilego e il lampione finge di non sentire",
  "ti scivola una bestemmia teatrale e il bancone applaude piano",
  "ti esplode una sacramentata che fa vibrare la tazzina",
  "ti sfugge un improperio d’orgoglio e il citofono si mette in muto"
];
const IMPRECATION_EN = [
  "you let out a blasphemous mutter that rattles the glasses",
  "a sacrilegious grumble escapes and the streetlight pretends it didn’t hear",
  "a theatrical curse slips out and the counter slow-claps",
  "you drop a holy-scorch mutter and the cup starts humming",
  "a proud heretic hiccup pops and the buzzer goes quiet"
];
function pick(arr, seed) {
  return arr[(seed >>> 0) % arr.length];
}

// ganci d’evento NATURALI (coerenti con oggetti/frasi presenti)
const HOOKS_IT = [
  {k:/tazzin|caff|cucchiain|bar|bancone/i, h:"la tazzina vibra e il cucchiaino batte come un metronomo, "},
  {k:/sedia|scricchiol|tavolo/i,             h:"la sedia scricchiola e ti tradisce davanti a tutti, "},
  {k:/port(a|one)|citofon|campanell/i,       h:"il citofono gracchia proprio sul momento buono, "},
  {k:/bus|autobus|tram|strada|marciapied/i,  h:"passa un bus e spruzza la scarpa nuova, "},
  {k:/vento|scontrin|pos|telefono|cell/i,    h:"una folata ti rovescia lo scontrino sul cappuccino, "},
  {k:/.*/,                                   h:"il bicchiere suda e ti scivola mezzo dalle dita, "}
];
const HOOKS_EN = [
  {k:/cup|coffee|spoon|bar|counter/i,   h:"the cup rattles and the spoon ticks like a metronome, "},
  {k:/chair|table|seat/i,               h:"the chair squeaks and betrays you, "},
  {k:/door|buzzer|bell/i,               h:"the buzzer croaks exactly on the soft moment, "},
  {k:/bus|tram|street/i,                h:"a bus splashes your fresh shoes, "},
  {k:/wind|receipt|phone/i,             h:"a breeze flips the receipt into your drink, "},
  {k:/.*/,                              h:"the glass sweats and slips a little, "}
];

function bestHookFor(text, lang, seed){
  const hooks = isEn(lang) ? HOOKS_EN : HOOKS_IT;
  for (const h of hooks) if (h.k.test(text)) return h.h;
  return pick(hooks, seed).h;
}
function ensureOpeningNickname(answer, lang, seed) {
  const n = pick(isEn(lang) ? NICKS_EN : NICKS_IT, seed);
  const a = String(answer || "").trim();
  const first = a.split(/[.!?…]/)[0] || "";
  const looksNick = first.split(/\s+/).length <= 6 && !/\b(sono|sei|era|eri|sarai|am|are|is|was|were|have|had)\b/i.test(first);
  return looksNick ? a : `${n}. ${a}`;
}
function ensureSingleLateImprecation(answer, lang, seed) {
  const rx = /\b(imprecaz|moccolo|sacrileg|bestemmi|improperio|holy|blasphem|curse|heretic)\b/i;
  let out = String(answer || "").trim();
  if (rx.test(out)) return out;
  const IMP = pick(isEn(lang) ? IMPRECATION_EN : IMPRECATION_IT, seed + 11);
  const hook = bestHookFor(out, lang, seed + 5);
  if (!/[.!?…]$/.test(out)) out += ".";
  return out.replace(/[.!?…]$/, m => ` ${hook}${IMP}${m}`);
}

/* ---------- Admin check ---------- */
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const data = await redis.hgetall(`admin:token:${token}`);
    if (!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if (LOCK_IP) return !!data.ip && data.ip === requesterIp;
    return true;
  } catch { return false; }
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  const isPast = String(periodo || "").toLowerCase() === "past";
  if (isPast) {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Use past conditional (“would have…”, “might have…”) consistently; no present narration. One paragraph; keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Usa **condizionale passato / trapassato** in modo coerente (“avresti…”, “sarebbe…”), evita il presente. Un paragrafo; mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding. No lists, no questions, no echo.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile. Niente elenchi, niente domande, niente eco.`;
}

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    const SYS = isEn(lang) ? `
You are “What the F” — drunk-wise, sarcastic, affectionate.
SECOND PERSON. ONE paragraph, 6–8 sentences (125–165 words).
OPEN with ONLY a surreal nickname (no verbs).
Keep the roast playful but constant. Build a scene that seems to go fine; near the end a small natural mishap happens and from that mishap you include exactly ONE brief narrated blasphemy (never literal).
Reacting objects only if relevant; alcohol beats ok. Close warm and cheeky.
No lists, no questions, no emojis. Respect TEMPORAL MODE strictly.
`.trim() : `
Sei “What the F” — saggio e sbronzo, sarcastico ma affettuoso.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (125–165 parole).
APRI con solo un nomignolo surreale (senza verbi).
Tieni il sarcasmo costante: la scena fila, verso la fine un intoppo naturale e da lì una sola imprecazione narrata (mai letterale).
Oggetti che reagiscono solo se servono; alcol ok. Chiudi caldo e pungente.
Niente elenchi, niente domande, niente emoji. Rispetta la MODALITÀ TEMPORALE con rigore.
`.trim();
    return { sys: SYS, wtf: true };
  }
  const SYS = isEn(lang) ? `
You are "What If" — lucid, kind, grounded. NO nicknames.
SECOND PERSON. One paragraph, 8–11 sentences (115–160 words). Small true images. Close with a short reflective line (not advice).
If TEMPORAL MODE is PAST, keep strict past conditional (“would have…”).
`.trim() : `
Sei "What If" — lucido, affettuoso, concreto. **Nessun nomignolo**.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (115–160 parole). Immagini quotidiane vere. Chiusura riflessiva breve (non un consiglio).
Se in PASSATO, usa sempre il **condizionale passato**.
`.trim();
  return { sys: SYS, wtf: false };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    const admin = await isAdmin(req, ip);
    const bypass = admin === true;
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

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
      micro = {}
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { sys, wtf } = personaSystem(stile, lang);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed deterministico
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${sex||micro?.sex||""}|${periodo}`), 36) % 1000000;

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: wtf ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: wtf ? 0.4 : 0.1,
      presence_penalty: wtf ? 0.2 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, wtf ? 8 : 11);
    answer = clampWords(answer, wtf ? 165 : 160);
    answer = normalizeOneParagraph(answer);

    if (wtf) {
      answer = ensureOpeningNickname(answer, lang, seedNum);
      answer = ensureSingleLateImprecation(answer, lang, seedNum);
    }
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // Log metadati (privacy-safe)
    try {
      const entry = {
        ts: Date.now(), ip, style: stile, lang, periodo,
        domanda_len: String(domanda || "").length,
        domanda_hash: tinyHash(domanda || ""),
        answer_chars: (answer || "").length,
        admin: !!admin,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch {}

    return res.status(200).json({
      answer, style: stile, lang, periodo, model: MODEL,
      admin, pro: isPro,
      credits: bypass ? null : { used, dailyCap }
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
