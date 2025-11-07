// /api/ask.js — What?f Engine (What If “realismo brillante” + What the F “bar poetico”) — MULTILINGUA
// Quote giornaliere: FREE=3/giorno, PRO=10/giorno, ADMIN=illimitato (reset Europa/Roma)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit"; // non usato per le quote giornaliere, lasciato per eventuale antiflood
import { randomBytes, createHash } from "node:crypto";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro, x-pro-sign"
  );
}

/* ========= Helpers comuni ========= */
const SUP_LANGS = ["it", "en", "es", "fr", "de"];
const normLang = (l = "it") =>
  SUP_LANGS.includes(String(l || "it").toLowerCase().slice(0, 2))
    ? String(l).toLowerCase().slice(0, 2)
    : "it";

const normLine = (s = "") =>
  String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()[\]\-—]+$/g, "")
    .trim();

function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    out.push(p);
    seen.add(n);
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
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\.\.+/g, "…")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}
function stripQuestionEcho(domanda, text) {
  let t = String(text || "");
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  if (d.length >= 8) {
    const lead = t
      .slice(0, Math.min(t.length, d.length + 12))
      .toLowerCase()
      .replace(/[“”"']/g, "")
      .trim();
    if (lead.startsWith(d)) {
      const cut = t.indexOf(".");
      if (cut > -1) t = t.slice(cut + 1).trim();
    }
  }
  const rx = /^(?:\s*(?:e\s*se|what\s*if|domanda:|q:)\s*[^.!?…]*[.!?…]\s+)/i;
  return t.replace(rx, "").trim();
}
const sentenceCaseAll = (s = "") =>
  s.replace(
    /(^|[.!?…]\s+)([a-zà-ÿ])/gu,
    (m, p, c) => p + c.toUpperCase()
  );
const finalPunct = (s = "") => (/[.!?…]$/.test(s) ? s : s + ".");

/* ===== Variability utils ===== */
function hash32(s) {
  return createHash("sha1").update(s).digest().readUInt32BE(0);
}
function makePRNG(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
function pick(prng, arr) {
  return arr[Math.floor(prng() * arr.length)];
}
function pickMany(prng, arr, k) {
  const a = [...arr];
  const out = [];
  for (let i = 0; i < Math.max(0, Math.min(k, a.length)); i++) {
    const idx = Math.floor(prng() * a.length);
    out.push(a.splice(idx, 1)[0]);
  }
  return out;
}

/* ===== Autenticazione piani / Quote giornaliere ===== */
function boolHeader(v) {
  return String(v || "").trim() === "1" || String(v || "").toLowerCase() === "true";
}
function getAuthPlan(req) {
  const admin = String(req.headers["x-admin-token"] || "");
  const proHdr = boolHeader(req.headers["x-pro"]);
  const proSig = String(req.headers["x-pro-sign"] || "");

  const isAdmin = !!process.env.ADMIN_TOKEN && admin === process.env.ADMIN_TOKEN;

  // Firma opzionale per PRO (leggera)
  const isSignedPro =
    !!process.env.PRO_SHARED_SECRET &&
    proSig ===
      createHash("sha256")
        .update(process.env.PRO_SHARED_SECRET + "|" + (req.headers["origin"] || ""))
        .digest("hex");

  const isPro = proHdr || isSignedPro || isAdmin;
  const plan = isAdmin ? "admin" : isPro ? "pro" : "free";
  return { isAdmin, isPro, plan };
}

// Data “oggi” in Europa/Roma come yyyymmdd
function romeYMD(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce((a, p) => ((a[p.type] = p.value), a), {});
  return `${parts.year}${parts.month}${parts.day}`;
}
// Prossima mezzanotte Roma ISO
function romeNextMidnightISO(date = new Date()) {
  const nowRomeStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date); // es. 2025-11-07, 21:03:04
  const m = nowRomeStr.match(
    /(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2}):(\d{2})/
  );
  const nowRome = new Date(
    `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
  );
  const next = new Date(nowRome);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
}

/* ===== Oggetti contestuali dalla domanda (per WTF) ===== */
function deriveContextObjects(domanda) {
  const d = String(domanda || "").toLowerCase();
  const add = [];
  const map = [
    [/citt[aà]/, "mappa piegata"],
    [/trasloc|casa|appart|affitto/, "scatolone col pennarello"],
    [/lavor|cv|curriculum|colloquio|linkedin/, "cartellina trasparente"],
    [/studio|esame|tesi|universit/, "quaderno con orecchie"],
    [/inglese|lingua|course|corso/, "post-it con verbi irregolari"],
    [/viagg|treno|volo|aereo|hotel/, "valigia che borbotta"],
    [/soldi|budget|spesa|aumento/, "calcolatrice stanca"],
    [/palestra|corsa|yoga|nuot/, "scarpe che chiedono strada"],
    [/startup|sito|e[- ]?commerce|shopify|app/, "laptop con adesivi motivazionali"],
    [/relaz|amico|partner/, "telefono che vuole essere sincero"],
  ];
  for (const [rx, obj] of map) {
    if (rx.test(d)) add.push(obj);
  }
  return Array.from(new Set(add)).slice(0, 2);
}

/* ========= WHAT IF (nuova versione) ========= */
const WHATIF_RULES = {
  it: `Sei “What If” — voce lucida, allegra e curiosa, che immagina come potrebbero andare o essere andate le cose.
Parla in SECONDA PERSONA, in un paragrafo unico di 6–9 frasi (~100–130 parole).
Tono: spensierato, riflessivo e luminoso, mai malinconico.
Parla come una versione parallela, un “e se…”, realistica ma un po’ più viva.
Usa immagini quotidiane (treni, chiavi, finestre, risate, vento, tazze di caffè).
Evita moralismi/consigli/domande; niente liste/emoji.
Chiudi con una sensazione di apertura o curiosità.`,
  en: `You are “What If”: lucid, upbeat, curious. Second person, one paragraph, 6–9 sentences (~100–130 words). Everyday imagery. No advice/questions. Open ending.`,
  es: `Eres “What If”: voz lúcida y alegre. Segunda persona, un párrafo, 6–9 frases. Imágenes cotidianas. Sin consejos/preguntas. Cierre abierto.`,
  fr: `Tu es “What If” : voix lucide et vive. Deuxième personne, un paragraphe, 6–9 phrases. Pas de conseils/questions. Fin ouverte.`,
  de: `Du bist “What If”: klar & neugierig. Zweite Person, ein Absatz, 6–9 Sätze. Alltagsbilder. Keine Ratschläge/Fragen. Offenes Ende.`,
};

const WHATIF_EXAMPLES = {
  it: {
    past: [
      "In un’altra versione di te, quel badge è ancora appeso e il neon tremola, ma qui l’hai tolto e l’aria del mattino sembra un lusso. Ti spaventa non sapere cosa viene dopo, eppure il dubbio è già un segno di vita. Cammini più dritto, la testa è piena e il cuore leggero. È buffo: bastava una firma per far iniziare un mondo nuovo.",
      "Avresti ancora la stessa finestra e la routine che conosce a memoria il tuo respiro; qui invece ti perdi tra strade coi nomi strani e sorrisi improvvisati. Ogni via è un esperimento di coraggio. Le avventure non cambiano chi sei: ti ricordano che sei vivo.",
      "Forse in un’altra linea temporale hai tenuto i sogni nel cassetto; qui invece hai le mani sporche di vernice e un sorriso ostinato. I primi giorni inciampi nei conti, poi nei complimenti sinceri. La paura resta ma si siede educata, mentre tu racconti questa follia con le maniche arrotolate e luce negli occhi.",
    ],
    future: [
      "All’inizio non ti sembrerà di appartenere a nulla: volti nuovi, regole nuove, la voce che cambia tono. Poi trovi un bar che ti ricorda chi sei e la città smette di sembrarti estranea. Ti perderai per ritrovarti, e la solitudine diventerà solo una stanza in attesa. Quando sentirai il tuo passo tra mille altri, capirai che il posto giusto è dove ti muovi.",
      "I primi giorni saranno un caos allegro: conti storti, clienti curiosi, idee che non dormono. La fatica pesa meno quando tutto porta il tuo nome. Ogni problema diventa una micro-lezione di libertà. Un pomeriggio qualunque, chiudendo la cassa, scoprirai che la libertà ha la forma delle tue mani.",
      "Succederà piano, come una finestra che si apre: la luce spaventa un attimo, poi fa sorridere. Gli altri diranno follia, tu sentirai leggerezza. Ogni passo suonerà come un applauso piccolo. E quando il vento porterà via la polvere, resterai tu: intero, curioso, pronto al prossimo “e se”.",
    ],
  },
};

/* ========= WTF (nuova versione) ========= */
// Monologo continuo da bar: ironia, sarcasmo, oggetti giudicanti, sbronza accidentale, leggero turpiloquio ammesso.
const WTF_RULES = {
  it: `Sei “What the F”: barista affettuoso e sarcastico. Seconda persona, UN SOLO PARAGRAFO, 5–7 frasi.
Inizia confidenziale (“Oh senti…”, “Sai che ti dico…”, “Guarda…”).
Inserisci oggetti/luoghi che commentano o giudicano (moka, tapparella, citofono, frigo, sedia, lampione, playlist).
Linguaggio vivo, anche un filo volgare se naturale. Niente morale, niente consigli, niente elenchi, niente emoji.
Tono: ironico, poetico-sporco, sbronza accidentale ma lucida. Rispondi davvero alla domanda (concreto).`,
  en: `You are “What the F”: sarcastic but caring bartender. One paragraph, 5–7 sentences. Conversational opener. Judging objects. Slight swearing ok. No labels/lists/emojis. Gritty, humane, actually answer the question.`,
};

/* ===== Banca minima per variare aperture/oggetti (WTF) ===== */
const BANK = {
  it: {
    starters: [
      "Oh senti",
      "Sai che ti dico",
      "Guarda",
      "Oh, allora",
      "Ehi, parliamoci chiaro",
    ],
    objects: [
      "moka",
      "tapparella",
      "citofono",
      "frigorifero",
      "sedia girevole",
      "lampione",
      "stampante",
      "ventilatore",
      "telecomando",
      "pianta",
    ],
    moods: [
      "ti guarda storto",
      "ti mette in muto",
      "applaude per rispetto",
      "fa ghosting",
      "finge un aggiornamento",
      "ti giudica in silenzio",
    ],
    booze: ["negroni grande", "birra media", "rum in plastica", "spritz di troppo", "amaro doppio"],
  },
};

/* ===== Periodo auto-detect ===== */
function detectPeriod(domanda, lang) {
  const L = normLang(lang);
  const d = String(domanda || "").toLowerCase();
  const itPastRx = /\b(se\s+(?:avessi|fossi)|avrei|sarei|non\s+avessi|non\s+fossi)\b/;
  const enPastRx = /\b(what\s+if\s+i\s+had|if\s+i\s+had|i\s+would\s+have|i'd\s+have)\b/;
  const esPastRx = /\b(si\s+hubiera|habría|hubiese)\b/;
  const frPastRx = /\b(si\s+j(?:'|e)\s+avais|j'aurais)\b/;
  const dePastRx = /\b(hätte\s+ich|ich\s+hätte)\b/;
  const map = { it: itPastRx, en: enPastRx, es: esPastRx, fr: frPastRx, de: dePastRx };
  const rx = map[L] || itPastRx;
  return rx.test(d) ? "past" : "future";
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }) {
  const L = normLang(lang);

  const baseRules =
    L === "en"
      ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
      : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;

  const effectivePeriodo =
    periodo === "past" || periodo === "future" ? periodo : detectPeriod(domanda, L);

  const temporal =
    effectivePeriodo === "past"
      ? L === "en"
        ? "Write counterfactual: as if it had already happened."
        : L === "es"
        ? "Escribe contrafactual: como si ya hubiera pasado."
        : L === "fr"
        ? "Écris en contrefactuel : comme si c’était déjà arrivé."
        : L === "de"
        ? "Schreibe kontrafaktisch: als wäre es bereits geschehen."
        : "Scrivi controfattuale: come se fosse già successo."
      : L === "en"
      ? "Write predictive: near-future unfolding starting now."
      : L === "es"
      ? "Escribe predictivo: un futuro cercano que empieza ahora."
      : L === "fr"
      ? "Écris prédictif : futur proche qui commence maintenant."
      : L === "de"
      ? "Schreibe prädiktiv: nahe Zukunft ab jetzt."
      : "Scrivi predittivo: un prossimo futuro che inizia ora.";

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if (stile === "wtf") {
    // ===== WTF: monologo continuo da bar
    const b = BANK[L] || BANK.it;
    const prng = makePRNG(hash32(domanda) ^ randomBytes(4).readUInt32BE(0));
    const starter =
      (b.starters || ["Oh senti"])[
        Math.floor(prng() * (b.starters || ["Oh senti"]).length)
      ];
    const objs = pickMany(
      prng,
      (b.objects || []).concat(deriveContextObjects(domanda)),
      2 + Math.floor(prng() * 2) // 2–3
    );
    const moods = pickMany(prng, b.moods || [], Math.min(3, objs.length));
    const booze = pickMany(prng, b.booze || [], 1 + (prng() < 0.5 ? 1 : 0));

    const wtfRule =
      L === "en"
        ? WTF_RULES.en
        : `${WTF_RULES.it}
Suggerimenti da intrecciare naturalmente (no elenchi, niente etichette):
- Attacco confidenziale tipo: “${starter}…”.
- Oggetti di scena possibili: ${objs.join(", ")}${
            moods.length ? ` (es. “${objs[0]} ${moods[0]}”)` : ""
          }.
- Sbronza accidentale: ${booze.join(" + ")}.`;

    msgs.push({ role: "system", content: wtfRule });
  } else {
    // ===== WHAT IF
    msgs.push({ role: "system", content: WHATIF_RULES[L] || WHATIF_RULES.it });
    const ex = WHATIF_EXAMPLES?.it;
    if (ex) {
      if (effectivePeriodo === "past" && ex.past)
        msgs.push({
          role: "system",
          content: `ESEMPI (passato):\n- ${ex.past.join("\n- ")}`,
        });
      if (effectivePeriodo === "future" && ex.future)
        msgs.push({
          role: "system",
          content: `ESEMPI (futuro):\n- ${ex.future.join("\n- ")}`,
        });
    }
  }

  const ask =
    stile === "wtf"
      ? L === "en"
        ? `Do NOT repeat the question. ONE PARAGRAPH (5–7 sentences, ~100–115 words). Conversational, gritty, slightly drunk. Include judging objects naturally. "${domanda}"`
        : `Non ripetere la domanda. UN PARAGRAFO (5–7 frasi, ~100–115 parole). Tono confidenziale, continuo, ironico, con oggetti che commentano. Linguaggio vivo, anche un filo volgare se serve. "${domanda}"`
      : L === "en"
      ? `Do not restate the question. ONE PARAGRAPH (6–9 sentences, ~100–130 words). Bright, warm, everyday imagery. No advice or questions. "${domanda}"`
      : `Non ripetere la domanda. UN PARAGRAFO (6–9 frasi, ~100–130 parole). Luminoso, concreto, senza consigli o domande. "${domanda}"`;

  msgs.push({ role: "user", content: ask });
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return res.status(500).json({ error: "missing_redis_env" });
    }

    // Piano & quota giornaliera
    const { isAdmin, isPro, plan } = getAuthPlan(req);
    const ip = (req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      "unknown")
      .toString()
      .split(",")[0]
      .trim();

    const FREE_LIMIT = 3;
    const PRO_LIMIT = 10;
    const limit = isAdmin ? Infinity : isPro ? PRO_LIMIT : FREE_LIMIT;

    const day = romeYMD();
    const quotaKey = `ask:quota:${plan}:${ip}:${day}`;

    let used = 0;
    if (!isAdmin) {
      used = await redis.incr(quotaKey);
      if (used === 1) {
        await redis.expire(quotaKey, 36 * 60 * 60); // TTL di sicurezza
      }
      if (used > limit) {
        return res.status(429).json({
          error: "quota_daily_exceeded",
          plan,
          used,
          limit,
          reset_at_rome: romeNextMidnightISO(),
        });
      }
    }

    // Body & parametri
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { domanda = "", stile = "whatif", lang = "it", periodo = "", micro = {} } =
      body;
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, micro });

    // Risposte: PRO un filo più ricche
    const MAX_TOKENS = isPro ? 520 : 420;
    const TEMP_WTF = isPro ? 1.02 : 1.0;
    const TEMP_WI = isPro ? 0.70 : 0.68;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? TEMP_WTF : TEMP_WI,
      top_p: 0.92,
      max_tokens: MAX_TOKENS,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // ===== Post-process =====
    answer = stripQuestionEcho(domanda, answer);
    const maxSentences = stile === "wtf" ? (isPro ? 7 : 6) : 9;
    answer = tightenSentences(answer, maxSentences);
    const maxWords = stile === "wtf" ? (isPro ? 125 : 115) : (isPro ? 140 : 130);
    answer = clampWords(answer, maxWords);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // IT normalizzazioni
    if (normLang(lang) === "it") {
      const d = String(domanda || "");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion = new Set(d.match(nameRx) || []);
      answer = answer.replace(nameRx, (m, _g1, offset, str) => {
        if (offset === 0) return m;
        const before = str.slice(0, offset);
        if (/[.!?…]["'”)\]]?\s*$/.test(before)) return m;
        return inQuestion.has(m) ||
          ["Ah", "Oh", "Ehi", "Sai", "Guarda", "Oh, allora"].includes(m)
          ? m
          : m.toLowerCase();
      });
      answer = answer.replace(/\ball’aquila\b/g, "all’Aquila");
    }

    // Maiuscola iniziale
    answer = answer.replace(/^\s*([a-zà-ÿ])/u, (m, c) => c.toUpperCase());

    return res.status(200).json({
      answer,
      style: stile,
      lang: normLang(lang),
      periodo: periodo || detectPeriod(domanda, lang),
      model: MODEL,
      plan,
      quota: isAdmin ? null : { used, limit, reset_at_rome: romeNextMidnightISO() },
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
