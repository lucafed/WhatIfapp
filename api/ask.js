// /api/ask.js — What?f Engine (robust 2025)
// Stili: whatif (realismo/poetico) · wtf (sarcasmo con “bestemmia narrata” variabile)
// Log privacy-safe (senza testo domanda) + memoria light per IP

import OpenAI from "openai";
import { Redis as UpstashRedis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ---------- OpenAI ---------- */
if (!process.env.OPENAI_API_KEY) console.warn("[ask] OPENAI_API_KEY assente");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Redis (robusto) ---------- */
const useUpstash = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = useUpstash
  ? new UpstashRedis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : {
      // Shim minimo in-memory per DEV (no persistenza, no TTL reali)
      _m: new Map(),
      async lpush(k, v){ const a=this._m.get(k)||[]; a.unshift(v); this._m.set(k,a); },
      async ltrim(k, s, e){ const a=this._m.get(k)||[]; this._m.set(k, a.slice(s, e+1)); },
      async incr(k){ const v=Number(this._m.get(k)||0)+1; this._m.set(k,String(v)); return v; },
      async expire(){},
      async hgetall(){ return null; },
      async hincrby(k,f,i){ const o=JSON.parse(this._m.get(k)||"{}"); o[f]=(o[f]||0)+i; this._m.set(k,JSON.stringify(o)); },
    };

// Rate limit: se Redis non c’è, usa un limiter in-memory
const rl = useUpstash
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") })
  : null;
const memRL = new Map();

/* ---------- CORS ---------- */
const ALLOWED_ORIGINS =
  process.env.NODE_ENV === "production"
    ? ["https://what-ifapp.vercel.app"]
    : ["*"]; // in dev consenti tutto

function cors(req, res) {
  const origin = String(req.headers.origin || "*");
  const allow =
    ALLOWED_ORIGINS.includes("*") ? origin :
    (ALLOWED_ORIGINS.includes(origin) ? origin : "https://what-ifapp.vercel.app");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/* ---------- Utils ---------- */
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

/* ---------- “Bestemmia narrata” variabile ---------- */
function wtfBlasphemyCue(seed, lang) {
  const it = [
    "ti scappa una bestemmia narrata che fa tintinnare i bicchieri",
    "ti parte una bestemmia in voice-over e il lampione finge di tossire",
    "ti esce una bestemmia teatrale e la moka applaude piano",
    "butti lì una bestemmia di cartone animato e il cestino si tappa le orecchie",
    "lanci una bestemmia in slow-motion e il semaforo cambia colore per imbarazzo",
    "sussurri una bestemmia in confidenza e il bancone fa finta di non averti sentito",
    "ti esplode una bestemmia con coriandoli e la tazzina vibra solidale",
  ];
  const en = [
    "you let out a narrated blasphemy that rattles the glasses",
    "a stage-blasphemy slips out and the streetlight clears its throat",
    "you drop a cartoon blasphemy and the trash bin covers its ears",
    "a slow-mo blasphemy detonates and the traffic light blushes",
    "you whisper a confessional blasphemy and the counter pretends not to hear",
    "a confetti blasphemy pops and the cup vibrates in sympathy",
  ];
  const pool = lang?.toLowerCase().startsWith("en") ? en : it;
  return pool[seed % pool.length];
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional, with quick present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "", opts = {}) {
  const { seed = 1, whatif_tone = "real" } = opts;
  const SEX = String(sex || "").toLowerCase();
  const genderNickIT = (SEX === "f")
    ? ["regina del casino","fenomena","asso di briscola","capitana del caos","sirena urbana","signora dei forse","rockstar con tacchi comodi"]
    : (SEX === "m")
      ? ["campione","fenomeno","asso","capitano del caos","sumo dei forse","rockstar con le tasche vuote","poeta del bar"]
      : ["leggenda","fenomen*","asso universale","cap* del caos","rockstar del forse","astronauta del dubbio"];
  const genderNickEN = (SEX === "f")
    ? ["queen of chaos","ace of ‘maybe’","legend in sneakers","captain of detours"]
    : (SEX === "m")
      ? ["champ","legend","captain of chaos","rocket scientist of ‘maybe’"]
      : ["icon","legend","ace","captain of chaos"];

  if (style === "wtf") {
    const cue = wtfBlasphemyCue(seed, lang);
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words). Simple, colloquial language.
OPEN with ONLY a rotating nickname (no verbs around it).
Alcohol beats OK. Use “reacting objects” when relevant.
Include exactly one brief, narrated blasphemy; vary its wording every time, e.g. “${cue}”. Never write religious slurs literally.
Affectionate roasting, upbeat tone, no moralizing. No lists, no questions, no emojis. Respect TEMPORAL MODE.
End warm and funny, like a shoulder-laugh.
Nicknames (EN): ${genderNickEN.join(", ")}.
SEED: ${seed}.
`.trim()
      : `
Sei “What the F” — l’amico rumoroso che punzecchia con affetto.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Lingua semplice e colloquiale.
APERTURA: solo un nomignolo (senza verbi).
Alcol ok. “Oggetti che reagiscono” quando ha senso.
Inserisci esattamente una “bestemmia narrata” con formula variabile, tipo: “${cue}”. Mai bestemmie letterali.
Presa in giro affettuosa, tono alto, zero prediche. Niente liste, niente domande, niente emoji. Rispetta la MODALITÀ TEMPORALE.
Chiudi caldo e comico.
Nomignoli (IT): ${genderNickIT.join(", ")}.
SEED: ${seed}.
`.trim());
    return { sys: SYS, fewshots: [] };
  }

  // WHATIF — 2 toni: real | poet
  const SYS_WHATIF = (isEn(lang)
    ? (whatif_tone === "poet"
        ? `You are "What If" — lucid and tender, with a lightly poetic voice (everyday images, soft rhythm). SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words). Grounded but lyrical. No lists, no questions, no emojis. End with a short reflective line (not advice).`
        : `You are "What If" — a lucid, kind, slightly ironic friend. SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words). Warm, concrete, everyday images. No lists, no questions, no emojis. End with a short reflective line (not advice).`)
    : (whatif_tone === "poet"
        ? `Sei "What If" — lucido e affettuoso, con una voce lievemente poetica (immagini quotidiane, ritmo morbido). SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole). Concreto ma lirico. Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).`
        : `Sei "What If" — un amico lucido e affettuoso, col sorriso pratico. SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole). Immagini quotidiane. Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).`));
  return { sys: SYS_WHATIF, fewshots: [] };
}

/* ---------- Admin check ---------- */
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const data = await redis.hgetall?.(`admin:token:${token}`);
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

/* ---------- Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // Admin / PRO
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit (Upstash o in-memory)
    if (!bypass) {
      if (rl) {
        const { success } = await rl.limit(`ask:${ip}`);
        if (!success) return res.status(429).json({ error: "rate_limited_minute" });
      } else {
        const key = `memrl:${ip}:${Math.floor(Date.now()/60000)}`;
        const n = (memRL.get(key) || 0) + 1;
        memRL.set(key, n);
        if (n > 10) return res.status(429).json({ error: "rate_limited_minute_dev" });
      }
    }

    // Crediti giornalieri
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
      sex = "",
      micro = {},
      whatif_tone = "real", // "real" | "poet"
      remember = true,       // salva memoria light per IP
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    // Personas + temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, { seed: seedNum, whatif_tone });
    const temporal = temporalSystem(periodo, lang, stile);

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional, as if it already happened, with upbeat roasting."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, tono allegro.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}". Keep the exact persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". Mantieni esattamente la voce della persona. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `Hard rules for WTF: one narrated blasphemy (varied wording), alcohol beats ok, reacting objects when relevant, opening is ONLY a nickname.`
          : `Regole dure per WTF: una sola “bestemmia narrata” (formula variabile), alcol ok, oggetti che reagiscono quando serve, apertura SOLO con nomignolo.` },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (whatif_tone === "poet" ? 0.9 : 0.82),
      top_p: 0.92,
      max_tokens: 380,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // Memoria light per IP (senza testo domanda)
    if (remember) {
      try {
        const memKey = `mem:ask:${ip}`;
        const memEntry = {
          ts: Date.now(),
          domanda_hash: tinyHash(domanda),
          domanda_len: String(domanda||"").length,
          style: stile, lang, periodo,
          sex: resolvedSex || null,
          micro: micro && typeof micro === "object" ? Object.keys(micro).slice(0,6) : [],
          answer_chars: (answer||"").length,
        };
        await redis.lpush(memKey, JSON.stringify(memEntry));
        await redis.ltrim(memKey, 0, 49); // ultime 50
      } catch {}
    }

    // Log aggregati
    try {
      await redis.lpush("logs:ask", JSON.stringify({
        ts: Date.now(), ip, style: stile, lang, periodo, sex: resolvedSex || null,
        domanda_len: String(domanda||"").length, domanda_hash: tinyHash(domanda||""),
        answer_chars: (answer||"").length, admin: !!admin,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
      }));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo||"future"), 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
    } catch {}

    return res.status(200).json({
      answer, style: stile, lang, periodo, model: MODEL,
      admin, pro: isPro, whatif_tone,
      credits: bypass ? null : { used, dailyCap },
      dev: useUpstash ? undefined : "dev_redis_shim",
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    const msg = String(err?.message || err);
    const transient = /timeout|overloaded|ECONNRESET|ENOTFOUND|fetch failed/i.test(msg);
    const detail =
      (!process.env.OPENAI_API_KEY) ? "missing_api_key" :
      (!useUpstash ? "dev_redis_shim" : msg);
    return res.status(transient ? 503 : 500).json({
      error: transient ? "upstream_unavailable" : "server_error",
      detail,
    });
  }
}
