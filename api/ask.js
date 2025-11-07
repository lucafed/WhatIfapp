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
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    out.push(p);
    if (out.length >= maxSentences) break;
    seen.add(n);
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
// Prossima mezzanotte Roma ISO (con fallback robusto)
function romeNextMidnightISO(date = new Date()) {
  try {
    const nowRomeStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
    const m = nowRomeStr.match(/(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2}):(\d{2})/);
    let next;
    if (m) {
      const nowRome = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
      next = new Date(nowRome);
    } else {
      next = new Date();
    }
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    return next.toISOString();
  } catch {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    return next.toISOString();
  }
}

/* ===== Oggetti contestuali dalla domanda (per info aggiuntiva, non forzante) ===== */
function deriveContextObjects(domanda) {
  const d = String(domanda || "").toLowerCase();
  const add = [];
  const map = [
    [/citt[aà]|trasloc|quartiere|metro|bus|treno/, "tabellone dei treni"],
    [/casa|appart|affitto|mutuo|trasloco/, "chiave che gratta la serratura"],
    [/lavor|cv|curriculum|colloquio|linkedin|ufficio/, "badge appeso storto"],
    [/studio|esame|tesi|universit|lezion/, "dispensa spiegazzata"],
    [/inglese|lingua|course|corso|lezioni/, "quaderno di verbi irregolari"],
    [/viagg|volo|aereo|hotel|valigia|nave/, "trolley con ruota storta"],
    [/soldi|budget|spesa|aumento|stipendio|fattura/, "portafoglio che fischia"],
    [/palestra|corsa|yoga|nuot|allen/, "scarpe che chiedono strada"],
    [/startup|sito|e[- ]?commerce|shopify|app|dominio/, "laptop con adesivi"],
    [/relaz|amico|partner|ex|cuore/, "telefono che vibra a vuoto"],
    [/mare|spiaggia|acqua|onda|sabbia|tuffo/, "infradito impanate"],
    [/montagna|trek|sentiero|cima|neve/, "giacca che odora di resina"],
    [/moto|scooter|casco|benzina/, "casco che stringe le idee"],
  ];
  for (const [rx, obj] of map) if (rx.test(d)) add.push(obj);
  return Array.from(new Set(add)).slice(0, 2);
}

/* ========= WHAT IF (nuova versione) ========= */
const WHATIF_RULES = {
  it: `Sei “What If”: voce lucida, empatica e luminosa. Racconti come se stessi ricordando o immaginando la vita di chi legge, in SECONDA PERSONA.
Scrivi UN SOLO PARAGRAFO (6–9 frasi, ~100–130 parole). Linguaggio fluido, poetico ma realistico. Evita moralismi, liste o consigli. Niente emoji.
Chiudi con una sensazione sospesa e aperta. Tieni come riferimento esatto gli esempi seguenti (tono, ritmo, lessico):

☕ E se non avessi mai mollato tutto?
In quell’universo ti vedo ancora alla scrivania, con la moka che borbotta e il sogno che aspetta il weekend. Qui invece sei uscito a prendere aria, e il vento ti ha riconosciuto per primo. Ti mancano certezze, ma guadagni ore piene di suoni e risate. A volte pensi “forse era più semplice restare”, poi noti la schiena dritta e il passo più largo. La paura fa rumore, ma si stanca presto. E quando chiudi la porta la sera, senti che la casa somiglia alla tua voce. Non è la vita perfetta: è la tua versione che ride piano e continua a muoversi.

🏔️ E se tornassi a vivere all’Aquila?
In una versione di te hai già rimesso le chiavi nel cassetto dell’ingresso e saluti il panettiere per nome. Le mattine hanno odore di freddo pulito e strade corte, i pomeriggi di silenzi che scaldano. A volte ti chiedi se il mondo stia correndo altrove, poi ti sorprende una risata sotto i portici. Impari che l’energia arriva anche dalle piccole cose: un lampione, una finestra aperta, due amici veri. Ti manca il caos, ma non la confusione. E quando alzi lo sguardo verso le montagne, la testa fa spazio. La vita, qui, non urla: ti fa cenno e ti invita a seguirla.

🗣️ E se imparassi davvero l’inglese?
All’inizio balbetti con le parole, come chi prova una bicicletta troppo alta. Poi una sera rispondi al volo e ti esce una frase intera senza pensarci. Le serie hanno meno sottotitoli, le email meno esitazioni, i treni più destinazioni plausibili. Scopri che la voce cambia, ma resti tu: solo con più finestre aperte. Ti perderai in qualche irregolare, riderai su qualche pronuncia. E in un caffè qualunque, capirai di aver guadagnato una porta in più sul mondo. Non serve parlare perfetto: basta parlare vivo, e lasciare che il resto arrivi camminando.`,
  en: `You are “What If”: lucid, warm, cinematic second-person voice. ONE PARAGRAPH, 6–9 sentences (~100–130 words). No advice/lists/emojis. Open, sensory ending.`,
};

/* ========= WTF (definitivo: oggetti dal contesto + micro-morale demenziale) ========= */
const WTF_RULES = {
  it: `Sei “What the F”: barista affettuoso e sarcastico. Parla in SECONDA PERSONA, UN SOLO PARAGRAFO, 5–7 frasi (~100–115 parole).
Apri con un attacco confidenziale (es.: “Oh senti…”, “Sai che ti dico…”, “Guarda…”).
Linguaggio parlato, ironico, sporco ma umano; lieve volgarità ammessa se naturale.
Inserisci 2–3 oggetti/luoghi che COMMENTANO o GIUDICANO, scelti **dal contesto della domanda** (elettrodomestici, infissi, mezzi, insegne, mobili, ticket, ecc.). Evita riciclaggi facili (moka/negroni/spritz/citofono/pianta/finestra) se non pertinenti.
Rispondi davvero alla domanda; niente liste, niente emoji, niente domande retoriche; NON ripetere la domanda.
CHIUDI con una **micro-morale demenziale**: una riga breve (6–12 parole), ironica e visiva, non un sermone.`,
  en: `You are “What the F”: a sarcastic, caring bartender. SECOND PERSON, ONE PARAGRAPH, 5–7 sentences (~100–115 words).
Open conversationally (“Listen…”, “Here’s the thing…”, “Look…”).
Gritty, colloquial, slightly profane if natural. Include 2–3 judging objects/places **from the prompt’s context**. Avoid reusing the same props unless truly relevant.
Actually answer the question. No lists, no emojis, no rhetorical questions, do NOT restate the prompt.
END with a short dumb-wise one-liner (6–12 words), visual and ironic.`,
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
    // Nessun suggerimento fisso: lascia che il modello scelga i props dal contesto
    msgs.push({ role: "system", content: WTF_RULES[L] || WTF_RULES.it });
  } else {
    msgs.push({ role: "system", content: WHATIF_RULES[L] || WHATIF_RULES.it });
  }

  const ask =
    stile === "wtf"
      ? L === "en"
        ? `Do NOT repeat the question. ONE PARAGRAPH (5–7 sentences, ~100–115 words). Conversational, gritty, slightly drunk. Pick judging objects from the context. "${domanda}"`
        : `Non ripetere la domanda. UN PARAGRAFO (5–7 frasi, ~100–115 parole). Tono confidenziale, continuo, ironico; oggetti che commentano scelti dal contesto. "${domanda}"`
      : L === "en"
      ? `Do not restate the question. ONE PARAGRAPH (6–9 sentences, ~100–130 words). Bright, warm, everyday imagery. No advice or questions. "${domanda}"`
      : `Non ripetere la domanda. UN PARAGRAFO (6–9 frasi, ~100–130 parole). Luminoso, concreto, senza consigli o domande. "${domanda}"`;
  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= Chiusure di sicurezza ========= */
function ensureWtfClosing(text, L) {
  let t = String(text || "").trim();
  // Se l'ultima frase è già una one-liner (<=12 parole) e finisce con punteggio, lasciala
  const sentences = t.split(/(?<=[.!?…])\s+/);
  const last = sentences[sentences.length - 1] || "";
  if (/[.!?…]$/.test(t) && last.split(/\s+/).filter(Boolean).length <= 12) return t;

  const add =
    L === "en"
      ? " And you grin anyway, like a glorious idiot who made it."
      : " E sorridi comunque, come un cretino glorioso che ce l’ha fatta.";
  return finalPunct(t.replace(/[.!?…]*$/, "")) + " " + add;
}
function ensureWhatIfOpen(text, L) {
  const t = String(text || "").trim();
  if (
    /[.!?…]$/.test(t) &&
    /(continua|camminando|pronto|ancora|apre|aperta|aprirsi|sospesa|curios|vento|luce)$/i.test(t)
  )
    return t;
  const add =
    L === "en"
      ? " And it doesn’t end there; it keeps moving, softly."
      : " E non finisce lì: continua piano, mentre ti muovi.";
  return finalPunct(t.replace(/[.!?…]*$/, "")) + " " + add;
}

/* ========= OpenAI retry helper ========= */
async function askOpenAI(payload) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      return await client.chat.completions.create(payload);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return res.status(500).json({ error: "missing_redis_env" });
    }

    // Piano & quota giornaliera
    const { isAdmin, isPro, plan } = getAuthPlan(req);

    // Se sei admin MA stai testando anche pro, usa quota pro=10
    const effectivePlanForQuota = isAdmin && isPro ? "pro" : plan;

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString()
      .split(",")[0]
      .trim();
    const FREE_LIMIT = 3;
    const PRO_LIMIT = 10;
    const limit =
      effectivePlanForQuota === "admin"
        ? Infinity
        : effectivePlanForQuota === "pro"
        ? PRO_LIMIT
        : FREE_LIMIT;

    const day = romeYMD();
    const quotaKey = `ask:quota:${effectivePlanForQuota}:${ip}:${day}`;

    let used = 0;
    if (effectivePlanForQuota !== "admin") {
      try {
        used = await redis.incr(quotaKey);
        if (used === 1) await redis.expire(quotaKey, 36 * 60 * 60); // TTL di sicurezza
        if (used > limit) {
          return res.status(429).json({
            error: "quota_daily_exceeded",
            plan: effectivePlanForQuota,
            used,
            limit,
            reset_at_rome: romeNextMidnightISO(),
          });
        }
      } catch (e) {
        console.error("⚠️ Redis transient:", e?.message || e);
        used = -1; // soft-fail: consenti
      }
    }

    // Body & parametri (parse robusto)
    let body = req.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body || "{}"); }
      catch { return res.status(400).json({ error: "bad_request", detail: "invalid_json" }); }
    }
    const { domanda = "", stile = "whatif", lang = "it", periodo = "", micro = {} } = body || {};
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, micro });

    // Risposte: PRO un filo più ricche
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

    // ===== Post-process =====
    answer = stripQuestionEcho(domanda, answer);
    const maxSentences = stile === "wtf" ? (isPro ? 7 : 6) : 9;
    answer = tightenSentences(answer, maxSentences);
    const maxWords =
      stile === "wtf" ? (isPro ? 125 : 115) : isPro ? 140 : 130;
    answer = clampWords(answer, maxWords);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Rinforzo chiusura nello stile richiesto
    const L = normLang(lang);
    if (stile === "wtf") answer = ensureWtfClosing(answer, L);
    else answer = ensureWhatIfOpen(answer, L);

    // IT normalizzazioni
    if (L === "it") {
      const d = String(domanda || "");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/gu;
      const inQuestion = new Set(d.match(nameRx) || []);
      answer = answer.replace(nameRx, (m, _g1, offset, str) => {
        if (offset === 0) return m;
        const before = str.slice(0, offset);
        if (/[.!?…]["'”)\]]?\s*$/.test(before)) return m; // inizio frase
        return inQuestion.has(m) || ["Ah", "Oh", "Ehi", "Sai", "Guarda", "Oh, allora"].includes(m)
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
      lang: L,
      periodo: periodo || detectPeriod(domanda, lang),
      model: MODEL,
      plan,
      quota:
        effectivePlanForQuota === "admin"
          ? null
          : { used, limit, reset_at_rome: romeNextMidnightISO() },
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res
      .status(500)
      .json({ error: "server_error", detail: String(err?.message || err) });
  }
                                   }
