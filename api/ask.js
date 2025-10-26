// /api/ask.js — What?f Engine (2025 FINAL—rev Sarcasmo + Controfattuale + Nicknames)
// Stili: whatif (realismo lucido, NO nomignoli) · wtf (sarcasmo demenziale affettuoso, nomignolo sì, 1 imprecazione narrata finale)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Controfattuale IT: condizionale passato / trapassato (“avresti fatto”, “sarebbe successo”)
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto della domanda (solo metadati + hash non reversibile)

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

/* ---------- WTF helpers (nickname + imprecazione narrata finale) ---------- */
const NICKS_IT = [
  "astronauta del bar", "sciamano del lunedì", "fenomeno in tuta", "poeta del caffè freddo",
  "capitano dei forse", "macchinista dei drammi minori", "re delle chiavi perse",
  "sirena del carrello della spesa", "campione del rinvio creativo", "pilota di rotonde"
];
const NICKS_EN = [
  "duke of detours","queen of late plans","captain of almost","bar philosopher",
  "legend in slippers","pilot of roundabouts","ace of maybe","minister of snacks"
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
  "you drop a holy-scorch mutter and the mailbox goes silent",
  "a proud heretic hiccup pops and the coffee cup vibrates"
];

function pick(arr, seed) {
  if (!arr?.length) return "";
  return arr[seed % arr.length];
}
function ensureOpeningNickname(answer, lang, seed) {
  // Only for WTF: enforce that the text **starts** with a nickname alone.
  const n = pick(isEn(lang) ? NICKS_EN : NICKS_IT, seed);
  const a = String(answer || "").trim();
  // Se inizia già con una singola breve frase senza verbo, lasciala; altrimenti prepend
  const first = a.split(/[.!?…]/)[0] || "";
  const looksLikeNick = first.split(/\s+/).length <= 5 && !/\b(sono|sei|era|eri|sarai|avresti|fossi|andavi|vai|sto|stai|was|were|are|am|be|have|would)\b/i.test(first);
  return looksLikeNick ? a : `${n}. ${a}`;
}
function ensureSingleLateImprecation(answer, lang, seed) {
  // If no narrated-imprecation is present, append one LAST, tied to a mini-event hook.
  const rx = /\b(imprecaz|moccolo|sacrileg|bestemmi|improperio|holy|blasphem|curse|heretic)\b/i;
  let out = String(answer || "").trim();
  if (rx.test(out)) return out; // già presente
  const IMP = pick(isEn(lang) ? IMPRECATION_EN : IMPRECATION_IT, seed + 7);
  // Inserisco un gancio d’evento plausibile prima della chiusura
  const hook = isEn(lang)
    ? " then the receipt printer jams with a victory beep, "
    : " poi il POS decide di suonare vittoria e si blocca, ";
  if (!/[.!?…]$/.test(out)) out += ".";
  return out.replace(/[.!?…]$/, m => `${hook}${IMP}${m}`);
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
    // **Controfattuale**: IT -> condizionale passato / trapassato; EN -> past conditional
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Use past conditional forms (“would have …”, “might have …”) consistently; no present narration. Speak as if the choice had been made and unfolded. One paragraph, no lists, no questions. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Usa **condizionale passato / trapassato** con coerenza (“avresti fatto…”, “sarebbe successo…”). Evita il presente. Racconta come se la scelta fosse stata fatta e si fosse svolta. Un solo paragrafo, niente elenchi o domande. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente elenchi, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas ---------- */
function personaSystem(style, lang, sex = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  if (style === "wtf") {
    // What the F — sarcasmo + nomignolo + imprecazione narrata (evento naturale)
    const SYS = isEn(lang) ? `
You are “What the F” — the loud, loving drunk-wise friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words). Colloquial.
OPEN with ONLY a surreal nickname (no verbs). Keep sarcasm flowing throughout.
Build a scene that seems to go fine, then a small, natural mishap happens near the end; from that mishap, include exactly ONE brief narrated blasphemy (never literal).
Examples of narrated forms: “you let out a blasphemous mutter that rattles the glasses”, “a sacrilegious grumble escapes…”. Never write literal religious slurs.
Reacting objects are allowed but only when relevant. Alcohol beats ok. Close warm and cheeky.
No lists, no questions, no emojis. Respect TEMPORAL MODE strictly.
`.trim() : `
Sei “What the F” — l’amico saggio e sbronzo che ti prende in giro con affetto.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Linguaggio colloquiale.
APRI con **solo un nomignolo surreale** (senza verbi). Sarcasmo costante lungo tutto il pezzo.
Costruisci una scena che sembra andare bene; verso la fine succede un piccolo intoppo naturale e da lì nasce **una sola** imprecazione narrata (mai letterale).
Esempi di forma narrata: “ti esce un’imprecazione che fa tremare i bicchieri”, “ti parte un borbottio sacrilego…”. Mai scrivere bestemmie letterali.
Oggetti che reagiscono solo se servono; alcol va bene. Chiudi caldo e pungente.
Niente elenchi, niente domande, niente emoji. Rispetta con rigore la MODALITÀ TEMPORALE.
`.trim();
    const FEWSHOTS = []; // il tono è tutto nel system
    return { sys: SYS, fewshots: FEWSHOTS, wtf: true };
  }

  // What If — reale/poetico lucido, **senza nomignoli**
  const SYS = isEn(lang) ? `
You are "What If" — lucid, kind, grounded. NO nicknames.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words). Warm, simple, grounded.
Use ordinary images (keys, streetlights, hands, notebooks, air). Small truths; no heroics, no melancholy.
Close with a short reflective line (not advice). No lists, no questions, no emojis.
If TEMPORAL MODE is PAST (counterfactual), keep strict past-conditional (“would have…”). 
`.trim() : `
Sei "What If" — lucido, affettuoso, concreto. **Nessun nomignolo**.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole). Tono caldo, semplice e reale.
Immagini quotidiane (chiavi, lampioni, mani, taccuini, aria). Verità piccole; niente eroismi o malinconia.
Chiudi con una riga riflessiva breve (non un consiglio). Niente elenchi, niente domande, niente emoji.
Se la MODALITÀ è PASSATO (controfattuale), usa sempre il **condizionale passato**.
`.trim();
  return { sys: SYS, fewshots: [], wtf: false };
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

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots, wtf } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed deterministico
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${periodo}`), 36) % 1000000;

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep exact persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce scelta. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...fewshots,
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

    // No echo; one paragraph polish
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, wtf ? 8 : 11);
    answer = clampWords(answer, wtf ? 165 : 160);
    answer = normalizeOneParagraph(answer);

    // WTF: forza apertura con nomignolo e imprecazione narrata finale (se assente)
    if (wtf) {
      answer = ensureOpeningNickname(answer, lang, seedNum);
      answer = ensureSingleLateImprecation(answer, lang, seedNum);
      if (!/[.!?…]$/.test(answer)) answer += ".";
    } else {
      // What If: mai nomignoli artificiali
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // Log metadati (no testo domanda)
    try {
      const entry = {
        ts: Date.now(), ip, style: stile, lang, periodo,
        sex: resolvedSex || null,
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
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch (e) {
      console.warn("log failure (non-bloccante)", e);
    }

    return res.status(200).json({
      answer, style: stile, lang, periodo, model: MODEL, admin, pro: isPro,
      credits: bypass ? null : { used, dailyCap }
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
