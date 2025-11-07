// /api/ask.js — What?f Engine (What If “realismo brillante” + What the F “bar poetico”) — MULTILINGUA
// Quote giornaliere: FREE=3/giorno, PRO=10/giorno, ADMIN=illimitato (reset Europa/Roma)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit"; // (non usato per le quote giornaliere, pronto per antiflood)
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
// Aggiungi qui i tuoi domini (inclusi preview Vercel)
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
// Regex per preview tipo https://<branch>-what-ifapp-<hash>-vercel.app
const VERCEL_PREVIEW_RX = /^https:\/\/[a-z0-9-]+-what-ifapp-[a-z0-9-]+-vercel\.app$/i;

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const ok =
    ALLOWED_ORIGINS.includes(origin) || VERCEL_PREVIEW_RX.test(origin);
  if (ok) res.setHeader("Access-Control-Allow-Origin", origin);
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
    .replace(/[“”"’']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()[\]\-—]+$/g, "")
    .trim();

function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…])\s+/u)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [], seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    out.push(p);
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
  const d = String(domanda || "").replace(/[“”"’']/g, "").trim().toLowerCase();
  if (d.length >= 8) {
    const lead = t
      .slice(0, Math.min(t.length, d.length + 12))
      .toLowerCase()
      .replace(/[“”"’']/g, "")
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
  s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/giu, (m, p, c) => p + c.toUpperCase());
const finalPunct = (s = "") => (/[.!?…]$/.test(s) ? s : s + ".");

/* ===== Random helpers (safe in serverless) ===== */
function safeRandomSeed() {
  try { return randomBytes(4).readUInt32BE(0) >>> 0; }
  catch { return Math.floor(Math.random() * 2 ** 32) >>> 0; }
}
function hash32(s) { return createHash("sha1").update(s).digest().readUInt32BE(0); }
function makePRNG(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; }; }
function pick(prng, arr) { return arr[Math.floor(prng() * arr.length)]; }
function pickMany(prng, arr, k) {
  const a = [...arr]; const out = [];
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
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).reduce((a, p) => ((a[p.type] = p.value), a), {});
  return `${parts.year}${parts.month}${parts.day}`;
}
// Prossima mezzanotte Roma ISO
function romeNextMidnightISO(date = new Date()) {
  const nowRomeStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(date);
  const m = nowRomeStr.match(/(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2}):(\d{2})/);
  const nowRome = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  const next = new Date(nowRome); next.setDate(next.getDate() + 1); next.setHours(0, 0, 0, 0);
  return next.toISOString();
}

/* ===== Oggetti contestuali (per WTF) ===== */
function deriveContextObjects(domanda) {
  const d = String(domanda || "").toLowerCase();
  const add = [];
  const map = [
    [/citt[aà]|quartiere|trasfer|metro|autobus|piazza|portici/, ["mappa piegata","lampione","panchina","targa del citofono","biglietto stropicciato"]],
    [/trasloc|casa|appart|affitto|mutuo|condominio/, ["scatolone col pennarello","tapparella","citofono","ascensore che sospira"]],
    [/lavor|cv|curriculum|colloquio|linkedin|ufficio|contratto|strafare/, ["cartellina trasparente","sedia girevole","moka","post-it rancoroso","badge scolorito"]],
    [/studio|esame|tesi|universit|scuola|prof/, ["quaderno con orecchie","evidenziatore asciutto","zaino che pesa","orologio giudicante"]],
    [/inglese|lingua|course|corso|lezione/, ["post-it con verbi","cuffie stanche","dizionario che sbadiglia"]],
    [/viagg|treno|volo|aereo|hotel|mare|montagna|terra|strada/, ["valigia che borbotta","biglietto piegato","finestrino che riflette","cartello storto"]],
    [/soldi|budget|spesa|aumento|fattura|tasse|bollette/, ["calcolatrice stanca","portafoglio magro","scontrino infinito"]],
    [/palestra|corsa|yoga|nuot|bici|moto/, ["scarpe che chiedono strada","casco nervoso","asciugamano sarcastico"]],
    [/startup|sito|e[- ]?commerce|shopify|app|pdf|form|pec/, ["laptop con adesivi","router capriccioso","pdf riottoso","modulo in triplice copia"]],
    [/relaz|amore|amico|partner|ex|solitudine|cuore/, ["telefono che vuole sincerità","specchio onesto","playlist gelosa"]],
    [/bar|vino|birra|amaro|negroni|spritz/, ["bicchiere appiccicoso","bancone appiccicoso","tovagliolo macchiato"]],
  ];
  for (const [rx, objs] of map) if (rx.test(d)) add.push(...objs);
  return Array.from(new Set(add)).slice(0, 4);
}

/* ========= WHAT IF ========= */
const WHATIF_RULES = {
  it: `Sei “What If”: voce lucida, allegra e curiosa in SECONDA PERSONA.
UN SOLO PARAGRAFO, 6–9 frasi (~100–130 parole). Linguaggio concreto, quotidiano (treni, chiavi, finestre, risate, vento, caffè).
Niente liste, niente emoji, niente consigli o domande. Chiudi con una sensazione aperta, non conclusiva.`,
  en: `You are “What If”: lucid, warm, curious, second-person. ONE PARAGRAPH, 6–9 sentences (~100–130 words). Everyday imagery. No lists/emojis/advice. End open.`,
};

const WHATIF_EXAMPLES = {
  it: {
    past: [
      "In un’altra versione di te, quel badge è ancora appeso e il neon tremola, ma qui l’hai tolto e l’aria del mattino sembra un lusso. Ti spaventa non sapere cosa viene dopo, eppure il dubbio è già un segno di vita. Cammini più dritto, la testa è piena e il cuore leggero. È buffo: bastava una firma per far iniziare un mondo nuovo.",
      "Avresti ancora la stessa finestra e la routine che conosce a memoria il tuo respiro; qui invece ti perdi tra strade coi nomi strani e sorrisi improvvisati. Ogni via è un esperimento di coraggio. Le avventure non cambiano chi sei: ti ricordano che sei vivo.",
      "Forse in un’altra linea temporale hai tenuto i sogni nel cassetto; qui invece hai le mani sporche di vernice e un sorriso ostinato. I primi giorni inciampi nei conti, poi nei complimenti sinceri. La paura resta ma si siede educata, mentre tu racconti questa follia con le maniche arrotolate e luce negli occhi."
    ],
    future: [
      "All’inizio non ti sembrerà di appartenere a nulla: volti nuovi, regole nuove, la voce che cambia tono. Poi trovi un bar che ti ricorda chi sei e la città smette di sembrarti estranea. Ti perderai per ritrovarti, e la solitudine diventerà solo una stanza in attesa. Quando sentirai il tuo passo tra mille altri, capirai che il posto giusto è dove ti muovi.",
      "I primi giorni saranno un caos allegro: conti storti, clienti curiosi, idee che non dormono. La fatica pesa meno quando tutto porta il tuo nome. Ogni problema diventa una micro-lezione di libertà. Un pomeriggio qualunque, chiudendo la cassa, scoprirai che la libertà ha la forma delle tue mani.",
      "Succederà piano, come una finestra che si apre: la luce spaventa un attimo, poi fa sorridere. Gli altri diranno follia, tu sentirai leggerezza. Ogni passo suonerà come un applauso piccolo. E quando il vento porterà via la polvere, resterai tu: intero, curioso, pronto al prossimo “e se”."
    ]
  }
};

/* ========= WTF ========= */
const WTF_RULES = {
  it: `Sei “What the F”: barista affettuoso e sarcastico. SECONDA PERSONA. UN SOLO PARAGRAFO, 5–7 frasi (~100–115 parole).
Attacco confidenziale (tipo “Oh senti…”, “Sai che ti dico…”, “Guarda…”).
Inserisci oggetti/luoghi che commentano o giudicano (scelti in base al contesto).
Linguaggio vivo, anche un filo volgare se naturale. Niente morale esplicita, niente elenchi, niente emoji.
Tono: ironico, poetico-sporco, sbronza accidentale ma lucida. Rispondi davvero alla domanda e CHIUDI con:
1) un’immagine secca e visiva + 
2) una “morale demenziale” in 6–10 parole (breve, assurda, memorabile).`,
  en: `You are “What the F”: sarcastic but caring bartender. ONE PARAGRAPH, 5–7 sentences (~100–115 words). Conversational opener. Judging objects from context. Slight swearing ok. End with a sharp visual + a silly one-line moral.`,
};

/* ===== Banca (aperture, drink, ecc.) ===== */
const BANK = {
  it: {
    starters: ["Oh senti", "Sai che ti dico", "Guarda", "Oh, allora", "Ehi, parliamoci chiaro"],
    booze: ["negroni grande","birra media","genziana democratica","rum in plastica","spritz di troppo","amaro doppio"],
    sillyMorals: [
      "Morale scema: il destino beve più di te.",
      "Morale scema: il coraggio puzza ma apre porte.",
      "Morale scema: chiedi al vento, paga il bar.",
      "Morale scema: dignità in tasca, resto in monete false.",
      "Morale scema: se tremi, accelera ma saluta.",
      "Morale scema: meno piani, più passi storti.",
    ],
    visuals: [
      "il vento in faccia e il bicchiere che scalda la mano",
      "la notte seduta accanto che smette di giudicare",
      "le luci sulla pietra che ti tengono in piedi",
      "le tasche vuote ma il passo finalmente pieno",
      "il casco appeso e il cuore che ruggisce piano",
    ],
  }
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
      ? L === "en" ? "Write counterfactual: as if it had already happened."
      : L === "es" ? "Escribe contrafactual: como si ya hubiera pasado."
      : L === "fr" ? "Écris en contrefactuel : comme si c’était déjà arrivé."
      : L === "de" ? "Schreibe kontrafaktisch: als wäre es bereits geschehen."
      : "Scrivi controfattuale: come se fosse già successo."
      : L === "en" ? "Write predictive: near-future unfolding starting now."
      : L === "es" ? "Escribe predictivo: un futuro cercano que empieza ahora."
      : L === "fr" ? "Écris prédictif : futur proche qui commence maintenant."
      : L === "de" ? "Schreibe prädiktiv: nahe Zukunft ab jetzt."
      : "Scrivi predittivo: un prossimo futuro che inizia ora.";

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if (stile === "wtf") {
    // Contesto
    const prng = makePRNG(hash32(domanda) ^ safeRandomSeed());
    const ctxObjs = deriveContextObjects(domanda);
    const b = BANK[L] || BANK.it;
    const starter = pick(prng, b.starters);
    const booze = pickMany(prng, b.booze, 1 + (prng() < 0.5 ? 1 : 0));
    const visuals = pick(prng, b.visuals);
    const moral = pick(prng, b.sillyMorals);

    const wtfRule =
      L === "en"
        ? WTF_RULES.en
        : `${WTF_RULES.it}
Suggerimenti da intrecciare naturalmente (no elenchi visibili):
- Attacco: “${starter}…”.
- Oggetti dal contesto: ${ctxObjs.length ? ctxObjs.join(", ") : "sceglili tu in base alla scena"}.
- Sbronza accidentale: ${booze.join(" + ")}.
- Immagine finale: ${visuals}.
- Chiudi con una riga di “morale demenziale”: ${moral}`;

    msgs.push({ role: "system", content: wtfRule });
  } else {
    msgs.push({ role: "system", content: WHATIF_RULES[L] || WHATIF_RULES.it });
    const ex = WHATIF_EXAMPLES?.it;
    if (ex) {
      if (effectivePeriodo === "past" && ex.past)
        msgs.push({ role: "system", content: `ESEMPI (passato):\n- ${ex.past.join("\n- ")}` });
      if (effectivePeriodo === "future" && ex.future)
        msgs.push({ role: "system", content: `ESEMPI (futuro):\n- ${ex.future.join("\n- ")}` });
    }
  }

  const ask =
    stile === "wtf"
      ? L === "en"
        ? `Do NOT repeat the question. ONE PARAGRAPH (5–7 sentences, ~100–115 words). Conversational, gritty, slightly drunk. Use contextual judging objects. End with a sharp visual + one-line silly moral. "${domanda}"`
        : `Non ripetere la domanda. UN PARAGRAFO (5–7 frasi, ~100–115 parole). Tono confidenziale, continuo, ironico; usa oggetti dal contesto. Chiudi con immagine secca + “morale demenziale” (una riga). "${domanda}"`
      : L === "en"
      ? `Do not restate the question. ONE PARAGRAPH (6–9 sentences, ~100–130 words). Bright, warm, everyday imagery. No advice or questions. "${domanda}"`
      : `Non ripetere la domanda. UN PARAGRAFO (6–9 frasi, ~100–130 parole). Luminoso, concreto, senza consigli o domande. "${domanda}"`;
  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= Chiusure di sicurezza ========= */
function ensureWtfClosing(text, L) {
  const b = BANK[L] || BANK.it;
  const t = String(text || "").trim().replace(/\s+Morale scema:.*$/i, "").trim();
  const visual = pick(makePRNG(safeRandomSeed()), b.visuals);
  const moral = pick(makePRNG(safeRandomSeed() ^ 12345), b.sillyMorals);
  const withVisual = /[.!?…]$/.test(t) ? t : finalPunct(t);
  return `${withVisual} ${visual ? (/[.!?…]$/.test(withVisual) ? "" : ".")} ${visual}. ${moral}`;
}
function ensureWhatIfOpen(text, L) {
  const t = String(text || "").trim();
  if (
    /[.!?…]$/.test(t) &&
    /(continua|camminando|pronto|ancora|apre|aperta|aprirsi|sospesa|curios|vento|luce)$/i.test(t)
  ) return t;
  const add =
    L === "en" ? " And it doesn’t end there; it keeps moving, softly."
    : L === "es" ? " Y no termina ahí: sigue, despacio."
    : L === "fr" ? " Et ça ne s’arrête pas là : ça continue, doucement."
    : L === "de" ? " Und es endet nicht hier: es geht leise weiter."
    : " E non finisce lì: continua piano, mentre ti muovi.";
  return finalPunct(t.replace(/[.!?…]*$/, "")) + add;
}

/* ========= OpenAI retry + timeout ========= */
async function askOpenAI(payload) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 22000); // 22s hard timeout
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await client.chat.completions.create({ ...payload, signal: controller.signal });
      clearTimeout(to);
      return res;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  clearTimeout(to);
  throw lastErr;
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const errId = Math.random().toString(36).slice(2, 8);

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return res.status(500).json({ error: "missing_redis_env" });
    }

    // Piano & quota giornaliera
    const { isAdmin, isPro, plan } = getAuthPlan(req);
    const effectivePlanForQuota = isAdmin && isPro ? "pro" : plan;

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();
    const FREE_LIMIT = 3;
    const PRO_LIMIT = 10;
    const limit =
      effectivePlanForQuota === "admin" ? Infinity :
      effectivePlanForQuota === "pro" ? PRO_LIMIT : FREE_LIMIT;

    const day = romeYMD();
    const quotaKey = `ask:quota:${effectivePlanForQuota}:${ip}:${day}`;

    let used = 0;
    if (effectivePlanForQuota !== "admin") {
      try {
        used = await redis.incr(quotaKey);
        if (used === 1) await redis.expire(quotaKey, 36 * 60 * 60);
        if (used > limit) {
          return res.status(429).json({
            error: "quota_daily_exceeded",
            plan: effectivePlanForQuota,
            used, limit,
            reset_at_rome: romeNextMidnightISO(),
          });
        }
      } catch (e) {
        console.error("⚠️ Redis transient:", e?.message || e);
        used = -1; // soft-fail
      }
    }

    // Body & parametri
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    } catch {
      return res.status(400).json({ error: "bad_request", detail: "invalid_json" });
    }
    const { domanda = "", stile = "whatif", lang = "it", periodo = "" } = body;
    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const messages = buildMessages({ domanda, lang, periodo, stile });

    // Parametri modello
    const MAX_TOKENS = isPro ? 520 : 420;
    const TEMP_WTF = isPro ? 1.02 : 1.0;
    const TEMP_WI = isPro ? 0.7 : 0.68;

    const completion = await askOpenAI({
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

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    const maxSentences = stile === "wtf" ? (isPro ? 7 : 6) : 9;
    answer = tightenSentences(answer, maxSentences);
    const maxWords = stile === "wtf" ? (isPro ? 125 : 115) : (isPro ? 140 : 130);
    answer = clampWords(answer, maxWords);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    const L = normLang(lang);
    if (stile === "wtf") answer = ensureWtfClosing(answer, L);
    else answer = ensureWhatIfOpen(answer, L);

    if (L === "it") {
      const d = String(domanda || "");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/gu;
      const inQuestion = new Set(d.match(nameRx) || []);
      answer = answer.replace(nameRx, (m, _g1, offset, str) => {
        if (offset === 0) return m;
        const before = str.slice(0, offset);
        if (/[.!?…]["'”)\]]?\s*$/.test(before)) return m;
        return inQuestion.has(m) || ["Ah","Oh","Ehi","Sai","Guarda","Oh, allora"].includes(m) ? m : m.toLowerCase();
      });
      answer = answer.replace(/\ball’aquila\b/g, "all’Aquila");
    }
    answer = answer.replace(/^\s*([a-zà-ÿ])/u, (m, c) => c.toUpperCase());

    return res.status(200).json({
      answer,
      style: stile,
      lang: L,
      periodo: periodo || detectPeriod(domanda, lang),
      model: MODEL,
      plan,
      quota: effectivePlanForQuota === "admin" ? null : { used, limit, reset_at_rome: romeNextMidnightISO() }
    });

  } catch (err) {
    const msg = String(err?.message || err);
    const code =
      /aborted|AbortError/i.test(msg) ? 504 :
      /rate|quota|insufficient_quota|429/i.test(msg) ? 429 :
      /invalid_api_key|401/i.test(msg) ? 401 :
      500;
    console.error(`❌ [/api/ask] [${errId}]`, err);
    return res.status(code).json({
      error: "server_error",
      code,
      id: errId,
      detail: msg.slice(0, 400)
    });
  }
}

// (facoltativo in Next.js): limita il body e forza parsing
export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } }
};
