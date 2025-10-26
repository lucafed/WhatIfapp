// /api/ask.js — What?f Engine (LONG RESPONSES)
// IT/EN — paragrafo singolo, no liste/domande/emoji
// Rate: 10/min · Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis senza testo domanda (solo hash)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// ---------- OpenAI ----------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// ---------- Upstash ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
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
}

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const tinyHash = (s = "") => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
};
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
  const m = slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
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
// Fonde la bestemmia narrata dentro la frase (WTF)
function fuseWtfSwearInside(text) {
  let t = String(text || "");
  t = t.replace(/(?:^|\.\s+)(ti\s+scappa\s+una\s+bestemmia[^.?!]*)(?=\.\s+|$)/i, (m) => `, ${m.trim().replace(/^[Tt]/,'t')} `);
  t = t.replace(/(?:^|\.\s+)(you\s+let\s+out\s+a\s+blasphemy[^.?!]*)(?=\.\s+|$)/i, (m) => `, ${m.trim().replace(/^[Yy]/,'y')} `);
  return t.replace(/\s+,/g, ",").replace(/,\s+[.]/g, ". ").replace(/\s{2,}/g, " ").trim();
}

/* ---------- Admin check ---------- */
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const data = await redis.hgetall(`admin:token:${token}`);
    if (!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if (LOCK_IP) return data.ip && data.ip === requesterIp;
    return true;
  } catch { return false; }
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Write as if the choice had been made back then; use past/conditional; single paragraph. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ: PASSATO/CONTROFATTUALE. Scrivi come se la scelta fosse stata fatta allora; usa passato/condizionale; paragrafo unico. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Near-future unfolding; single paragraph. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ: FUTURO/PROSPETTICO. Descrivi un prossimo futuro plausibile; paragrafo unico. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas ---------- */
function personaSystem(style, lang, sex = "", tone = "real") {
  const SEX = String(sex || "").toLowerCase();
  const nickIT = (SEX === "f")
    ? ["fenomena","regina del casino","capitana del caos","asso di briscola","sirena urbana"]
    : (SEX === "m")
      ? ["fenomeno","campione","capitano del caos","asso","poeta da bar"]
      : ["leggenda","asso universale","cap* del caos","icon*"];

  // WTF
  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — loud, loving roast. SECOND PERSON. One paragraph, 7–10 sentences (~150–185 words).
Open ONLY with a nickname (no verbs). Alcohol beats and reacting objects only if relevant.
Include exactly one brief, narrated blasphemy tied to a concrete mishap *inside the sentence* (e.g., “you let out a theatrical blasphemy that rattles the glasses”) — never literal slurs.
No lists, no questions, no emojis. Warm, funny, streetwise.
`.trim()
      : `
Sei “What the F” — schietto, affettuoso, fa ridere. SECONDA PERSONA. Un paragrafo, 7–10 frasi (~150–185 parole).
Apri SOLO con un nomignolo (senza verbi). Alcol e “oggetti che reagiscono” solo se servono.
Inserisci esattamente una bestemmia narrata legata a un piccolo incidente *dentro la frase* (es. “ti scappa una bestemmia teatrale che fa tremare i bicchieri”); mai letterale.
Niente elenchi, niente domande, niente emoji. Caldo e brillante.
Nomignoli (IT): ${nickIT.join(", ")}.
`.trim());
    const FEWS = [
      { role:"system", content:
`ESEMPIO IT • Rientro in città
Capitano del caos, atterri con la valigia che picchia, il bar ti fa l’appello; parcheggi al millimetro, il sensore canta falso, lo zaino s’incastra e — ti scappa una bestemmia teatrale che fa tremare i bicchieri — il lampione fa finta di aggiustarsi, poi due facce ti chiamano per nome e capisci che qui non torni indietro: torni intero.`},
      { role:"system", content:
`EXAMPLE EN • New job
Champ, you walk in with a plan on a napkin; printer wheezes, coffee baptizes your badge and — you let out a theatrical blasphemy that rattles the glasses — the stapler decides to help, by lunch your name fits the hallway and the day stops asking for ID.`},
    ];
    return { sys: SYS, fewshots: FEWS };
  }

  // WHAT IF — POETIC / REAL / ANALYTICAL
  const baseGuard = isEn(lang)
    ? `SECOND PERSON. Single paragraph. No lists, no questions, no emojis. Vary cadence; avoid clichés.`
    : `SECONDA PERSONA. Paragrafo unico. Niente elenchi, niente domande, niente emoji. Varia ritmo; evita frasi fatte.`;

  if (tone === "poetic") {
    const SYS = (isEn(lang)
      ? `You are "What If" — poetic, light, intimate; fresh images. 9–13 sentences (~130–190 words). End with a soft reflective line. ${baseGuard}`
      : `Sei "What If" — poetico e leggero, immagini fresche. 9–13 frasi (~130–190 parole). Chiudi con una riga riflessiva. ${baseGuard}`);
    return { sys: SYS, fewshots: [] };
  }
  if (tone === "real") {
    const SYS = (isEn(lang)
      ? `You are "What If" — realistic and grounded. 9–13 sentences (~130–190 words). Cover economy/jobs, school/childcare & services, social/family proximity, cost of living & transport, quality of life (rhythm, safety, environment), and 1–2 lines of outlook. Narrative prose, concrete, no poetry. End with a brief synthesis. ${baseGuard}`
      : `Sei "What If" — realistico e concreto. 9–13 frasi (~130–190 parole). Tocca economia/lavoro, scuola/servizi e infanzia, rete sociale/famiglia vicina, costo della vita e trasporti, qualità della vita (ritmo, sicurezza, ambiente) e chiudi con 1–2 righe sulle prospettive. Prosa narrativa, concreta, non poetica. Sintesi finale breve. ${baseGuard}`);
    return { sys: SYS, fewshots: [] };
  }
  const SYS = (isEn(lang)
    ? `You are "What If" — analytical and dry. 9–13 sentences, one paragraph. Lay out criteria & trade-offs in clean prose, point to likely outcomes, close with a one-line takeaway. ${baseGuard}`
    : `Sei "What If" — analitico e asciutto. 9–13 frasi, un paragrafo. Esplicita criteri e trade-off in prosa pulita, indica gli esiti probabili, chiudi con una riga di takeaway. ${baseGuard}`);
  return { sys: SYS, fewshots: [] };
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

    // Admin/PRO/Rate
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }
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
      tone = "real"
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, tone);
    const temporal = temporalSystem(periodo, lang, stile);
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${tone}`), 36) % 1000000;

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". User sex="${resolvedSex||"unknown"}". TONE="${tone}". INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Sesso utente="${resolvedSex||"unknown"}". TONO="${tone}". SEED INTERNO: ${seedNum}.`;

    const wtfHard = isEn(lang)
      ? `WTF rule: the narrated blasphemy must be tied to a concrete mishap and fused inside the sentence (comma or em-dash), never as a separate sentence, never literal slurs.`
      : `Regola WTF: la bestemmia narrata va legata a un piccolo incidente e fusa dentro la frase (virgole o trattino), mai frase a sé, mai letterale.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "system", content: wtfHard },
      { role: "user", content: userPrompt },
    ];

    // OpenAI (PIÙ LUNGO)
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (tone === "poetic" ? 0.9 : tone === "analytical" ? 0.6 : 0.78),
      top_p: 0.92,
      max_tokens: 520, // <-- più alto
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
      messages,
    });

    // Post-process (CAP PIÙ ALTI)
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 10 : 13);      // <-- più frasi
    answer = clampWords(answer, stile === "wtf" ? 185 : 195);          // <-- più parole
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") answer = fuseWtfSwearInside(answer);
    else if (!/[.!?…]$/.test(answer)) answer += ".";

    // Logs (privacy-safe)
    try {
      const entry = {
        ts: Date.now(),
        ip, style: stile, lang, periodo, sex: resolvedSex || null, tone,
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
      await redis.hincrby("stats:tone", tone, 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}:${tone}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch (e) { console.warn("log failure", e); }

    return res.status(200).json({
      answer, style: stile, lang, periodo, tone,
      model: MODEL, admin, pro: isPro,
      credits: admin ? null : { used, dailyCap },
    });

  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
