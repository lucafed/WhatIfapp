// /api/ask.js — What?f Engine (2025 FINAL++ WTF roast fix)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale affettuoso, alcol, oggetti, imprecazione narrata • verso la fine)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto domanda (solo metadati + hash)

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

// rate limit: 10 req/min per IP (bypass SOLO per admin)
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

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

/* ----- Varianti nomignoli & imprecazioni (mai letterali) ----- */
const NICKS_IT = [
  "astronauta del bar", "pilota dell’ansia", "cavaliere del forse", "sultano dei ripensamenti",
  "direttore del casino", "principe dei ‘ma anche no’", "capitano del rinvio", "sassofonista del silenzio",
  "mastro delle scuse", "cowboy dei tentennamenti", "sciamano del frigorifero", "poeta dei conti in tasca"
];
const OOPS_IT = [
  "ti parte un improperio che fa sobbalzare i cucchiaini",
  "ti scappa un turpiloquio narrato che mette in allerta i bicchieri",
  "ti esce una sacramentata che vibra fino alla maniglia",
  "ti scivola un’imprecazione teatrale che spolvera le mensole",
  "ti fugge una maledizione in dialetto che fa tacere il bancone",
  "ti esplode un accidente coreografico che rigira i tovaglioli",
  "ti vola un bestem… no, una rumorosa invocazione censurata che fa eco tra le tazzine"
];
const TRIGGERS_IT = [
  "il POS decide di stampare due scontrini e poi si pianta",
  "il campanello fa prova sirena e poi muore",
  "la moka sbuffa come un trattore e vomita mezza tazzina sul polsino",
  "il lampione davanti fa blackout proprio quando ti senti cinematografic*",
  "il cellulare si riavvia mentre stai pagando il parcheggio",
  "il sacchetto si rompe e le arance fuggono in discesa",
  "il vicino parcheggia di traverso e lascia la ruota sul tuo piede morale"
];

/* ---------- Post-process WTF: imprecazione verso la fine ---------- */
function enforceLateWtfCrescendo(text, lang = "it", seed = 0) {
  if (!text) return text;
  if (!/imprec|sacram|improper|turpiloq|invocazione/i.test(text)) {
    // inserisci penultima frase
    const parts = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
    const nickFix = parts[0] || "";
    const rnd = seed % 997;
    const trig = TRIGGERS_IT[rnd % TRIGGERS_IT.length];
    const bang = OOPS_IT[(rnd*7) % OOPS_IT.length];
    const add = `Proprio quando pareva filare tutto, ${trig} e ${bang}.`;
    if (parts.length >= 3) parts.splice(parts.length - 1, 0, add);
    else parts.push(add);
    return parts.join(" ");
  }
  // se è troppo presto, spostala verso la fine
  const parts = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const earlyIdx = parts.findIndex(s => /imprec|sacram|improper|turpiloq|invocazione/i.test(s));
  if (earlyIdx > -1 && earlyIdx < parts.length - 3) {
    const frag = parts.splice(earlyIdx, 1)[0];
    parts.splice(Math.max(parts.length - 1, 1), 0, frag);
    return parts.join(" ");
  }
  return text;
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

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    if (en) {
      return `TEMPORAL MODE: PAST / COUNTERFACTUAL. Use past/conditional ("you would have…", "it would have…"), no present-tense summaries. Keep ${style.toUpperCase()} voice.`;
    }
    // ITA controfattuale: forza condizionale passato/imperfetto
    return `MODALITÀ: PASSATO CONTROFATTUALE. Usa condizionale passato/imperfetto: "saresti", "avresti", "sarebbe", "avrebbe"; evita presente. Mantieni voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding now.`
    : `MODALITÀ: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se iniziassi ora.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the drunk-wise friend who roasts with love.
SECOND PERSON. ONE paragraph, 6–8 sentences (≈125–165 words). Colloquial, vivid, cinematic.
OPEN with ONLY a surreal nickname (no verbs). Keep playful-mean but affectionate.
Run a constant roast of the user’s habits and the scene; let objects “react” when relevant (not random).
Include exactly ONE brief, narrated blasphemy/imprecation (never literal) triggered by a mundane mishap NEAR THE END.
No lists, no questions, no emojis, no moralizing. Close warm and funny.
Pick nickname from: ${NICKS_IT.join(", ")} (translate if EN).
`.trim()
      : `
Sei “What the F” — l’amico saggio ma sbronzo che ti prende in giro con affetto.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (≈125–165 parole). Linguaggio colloquiale, immagini vive.
APRl con SOLO un nomignolo surreale (senza verbi).
Tieni il roast acceso per tutto il pezzo, con oggetti che “reagiscono” solo quando servono.
Inserisci ESATTAMENTE una imprecazione narrata (mai letterale) SCATENATA da un piccolo evento plausibile e METTILA VERSO LA FINE.
RIGIDO: niente elenchi, niente domande, niente emoji, niente prediche. Chiudi con risata calda.
Usa nomignoli tipo: ${NICKS_IT.join(", ")}.
Esempi di chiusura-imprecazione (scegline UNA e varia): ${OOPS_IT.slice(0,4).join(" | ")}…
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Rientrare in città (futuro)
Sultano dei ripensamenti, rientrerai come chi finge di sapere dove va e il citofono ti giudicherà al primo squillo; ti farai grande parlando di “piani” mentre la moka, scocciata, sbufferà curriculum; camminerai lungo le vetrine contando i “domani” come tappi e la strada, annoiata, te ne farà saltare due; farai pace con tre facce e litigio lampo con un marciapiede; proprio quando sembrerà filare tutto, il campanello farà la prova d’allarme e si zittirà e ti scapperà una sacramentata scenica che farà vibrare i bicchieri, poi tirerai su le spalle e capirai che no, non stai tornando indietro: stai tornando a casa con i tuoi difetti in alta definizione.` },
      { role: "system", content:
`ESEMPIO IT • Restare invece di partire (passato controfattuale)
Direttore del casino, saresti rimasto a bullarti della tua prudenza mentre lo sgabello del bar ti promuoveva a cliente arredo; avresti parlato di opportunità “a chilometro zero” e il frigorifero ti avrebbe risposto con il ronzio di chi la sa lunga; i vicini ti avrebbero schedato come “quello che sistema tutto domani”, e tu ci avresti messo la firma; quando la giornata sarebbe finalmente girata giusta, il POS avrebbe stampato due scontrini e si sarebbe piantato e ti sarebbe volato un improperio che avrebbe fatto sobbalzare le tazzine, e avresti riso anche tu, perché la vita ti avrebbe preso in giro esattamente come fai tu con lei.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF (reale/poetico) — niente nomignoli
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — lucid, kind, grounded. No nicknames.
SECOND PERSON. One paragraph, 8–11 sentences (115–160 words). Ordinary images; small, true lines.
No lists, no questions, no emojis. End with a short reflective line (not advice).
`.trim()
    : `
Sei "What If": lucido, affettuoso, concreto. Nessun nomignolo.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (115–160 parole). Immagini quotidiane, verità piccole.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (reale)
Ti saresti ricordato i passi prima dei motivi. Le strade ti avrebbero riconosciuto con una pazienza che al Nord si paga cara. La lentezza all’inizio ti avrebbe graffiato, poi si sarebbe messa al tuo passo. Il lavoro non sarebbe stato un premio, ma un incastro: sufficiente, vicino, meno brillante e più utile. I bambini avrebbero avuto nonni raggiungibili in dieci minuti e montagne a distanza di merenda. La sera, le luci del centro ti avrebbero fatto sentire meno in difetto e più di nuovo nei tuoi. Non sarebbe stato un ritorno in grande: sarebbe stato un ritorno a misura tua.` },
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    // IP richiedente
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // Admin bypass (rate+crediti)
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;

    // PRO header: x-pro: "1"
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
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
      micro = {}
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // seed deterministico
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Sex="${resolvedSex||"unknown"}". INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Sesso="${resolvedSex||"unknown"}". SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `WTF hard rules: constant roast; place the narrated imprecation near the end due to a plausible mishap; never literal; open with a surreal nickname; one paragraph only.`
          : `Regole dure WTF: roast continuo; imprecazione narrata verso la fine e causata da un piccolo imprevisto; mai letterale; apertura con nomignolo surreale; un solo paragrafo.` },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.45 : 0.1,
      presence_penalty: stile === "wtf" ? 0.25 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") {
      answer = enforceLateWtfCrescendo(answer, lang, seedNum);
      if (!/[.!?…]$/.test(answer)) answer += ".";
    } else {
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // --- LOG (privacy-safe) ---
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
      answer,
      style: stile,
      lang,
      periodo,
      model: MODEL,
      admin,
      pro: isPro,
      credits: bypass ? null : { used, dailyCap },
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
