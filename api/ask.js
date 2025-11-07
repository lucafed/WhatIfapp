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
    ALLOWED_ORIGINS.some((o) => origin.startsWith(o)) ||
    VERCEL_PREVIEW_RX.test(origin);
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

/* ===== Variability utils (per anti-cliché random) ===== */
function hash32(s) { return createHash("sha1").update(s).digest().readUInt32BE(0); }
function makePRNG(seed) { let x = seed >>> 0; return () => (x = (x*1664525+1013904223)>>>0, x/2**32); }
function pickRand(arr, prng) { return arr[Math.floor(prng()*arr.length)]; }

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
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).reduce((a, p) => ((a[p.type] = p.value), a), {});
  return `${parts.year}${parts.month}${parts.day}`;
}
// Prossima mezzanotte Roma ISO
function romeNextMidnightISO(date = new Date()) {
  const nowRomeStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
  const m = nowRomeStr.match(/(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2}):(\d{2})/);
  const nowRome = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  const next = new Date(nowRome); next.setDate(next.getDate() + 1); next.setHours(0,0,0,0);
  return next.toISOString();
}

/* ========= WHAT IF (identico agli esempi) ========= */
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

/* ========= WTF (bar poetico, senza banca fissa) ========= */
const WTF_RULES = {
  it: `Sei “What the F”: barista affettuoso e sarcastico. SECONDA PERSONA. UN SOLO PARAGRAFO, 5–7 frasi (~100–115 parole).
Attacco confidenziale (“Oh senti…”, “Sai che ti dico…”, “Guarda…”).
SCEGLI TU 2–4 DETTAGLI CONCRETI (oggetti/luoghi/suoni/bevande) COERENTI con ciò che vuoi dire: devono nascere dal senso della risposta, non da liste fisse.
Varia SEMPRE ed evita cliché ripetuti (moka, spritz, negroni, citofono, tapparella, frigo, sedia girevole, finestra). Se proprio ne usi uno, usane UNO solo.
Linguaggio vivo, anche un filo volgare se naturale. Niente morale, niente liste, niente emoji.
Tono: ironico, poetico-sporco, sbronza accidentale ma lucida. Rispondi davvero alla domanda e CHIUDI con un’immagine secca e visiva (risata amara, vento in faccia, bicchiere che scalda).`,
  en: `You are “What the F”: sarcastic but caring bartender. One paragraph, 5–7 sentences (~100–115 words). Conversational opener. Pick your own concrete details from the meaning you want to convey. Vary them and avoid clichés. No lists/emojis/morals. End on a sharp visual image.`,
};

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
    msgs.push({ role: "system", content: WTF_RULES[L] || WTF_RULES.it });
  } else {
    msgs.push({ role: "system", content: WHATIF_RULES[L] || WHATIF_RULES.it });
  }

  const ask =
    stile === "wtf"
      ? L === "en"
        ? `Do NOT repeat the question. ONE PARAGRAPH (5–7 sentences, ~100–115 words). Conversational, gritty, slightly drunk. Choose your own specific details from the meaning you want to convey. "${domanda}"`
        : `Non ripetere la domanda. UN PARAGRAFO (5–7 frasi, ~100–115 parole). Tono confidenziale, continuo, ironico. I dettagli (oggetti/luoghi/suoni/bicchieri) scegli TU in base a ciò che vuoi dire. "${domanda}"`
      : L === "en"
      ? `Do not restate the question. ONE PARAGRAPH (6–9 sentences, ~100–130 words). Bright, warm, everyday imagery. No advice or questions. "${domanda}"`
      : `Non ripetere la domanda. UN PARAGRAFO (6–9 frasi, ~100–130 parole). Luminoso, concreto, senza consigli o domande. "${domanda}"`;
  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= Chiusure di sicurezza ========= */
function ensureWtfClosing(text, L) {
  const t = String(text || "").trim();
  if (/[.!?…]$/.test(t) && /vento|bicchiere|faccia|sorriso|risata|notte|bar|strada|cuore/i.test(t))
    return t;
  const add =
    L === "en"
      ? " And you end up laughing alone, wind in your face and the glass warming your hand."
      : L === "es"
      ? " Y te sale una risa torcida, con el viento en la cara y el vaso calentando la mano."
      : L === "fr"
      ? " Et tu te surprends à sourire, le vent sur le visage et le verre qui réchauffe la paume."
      : L === "de"
      ? " Und du grinst allein, Wind im Gesicht, das Glas wärmt die Hand."
      : " E ti scappa una risata storta, col vento in faccia e il bicchiere che ti scalda la mano.";
  return finalPunct(t.replace(/[.!?…]*$/, "")) + add;
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

/* ========= Anti-cliché post-processing (soft) ========= */
const CLICHES = [
  "moka","spritz","negroni","citofono","tapparella","frigorifero","sedia girevole","finestra"
];
const SYNONYMS = {
  moka: ["caffettiera","pentolino del caffè","brontolio del caffè"],
  spritz: ["bicchiere arancione","aperitivo freddo","bollicine storte"],
  negroni: ["rosso amaro","cocktail scuro","amaro con ghiaccio"],
  citofono: ["campanello","suoneria del portone","buzzer del palazzo"],
  tapparella: ["persiana","avvolgibile","lamelle abbassate"],
  frigorifero: ["frigo","anta fredda","scatola del freddo"],
  "sedia girevole": ["sedia che scricchiola","sgabello storto","sedia che ti aspetta"],
  finestra: ["vetri aperti","infisso socchiuso","cornice sul fuori"]
};
function deCliche(text, seed=0) {
  let out = text;
  const prng = makePRNG(seed);
  let hits = 0;
  for (const w of CLICHES) {
    const rx = new RegExp(`\\b${w}\\b`, "gi");
    const found = out.match(rx)?.length || 0;
    if (found) {
      hits += found;
      // sostituisci dal secondo in poi
      let replaced = 0;
      out = out.replace(rx, (m) => {
        replaced++;
        if (replaced === 1) return m; // la prima può restare
        const pool = SYNONYMS[w] || [m];
        return pickRand(pool, prng);
      });
    }
  }
  return out;
}

/* ========= OpenAI retry helper ========= */
async function askOpenAI(payload) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try { return await client.chat.completions.create(payload); }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 400*(i+1))); }
  }
  throw lastErr;
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return res.status(500).json({ error: "missing_redis_env" });
    }

    // Piano & quota giornaliera
    const { isAdmin, isPro, plan } = getAuthPlan(req);
    // Se sei admin MA stai testando anche pro, usa quota pro=10
    const effectivePlanForQuota = isAdmin && isPro ? "pro" : plan;

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();
    const FREE_LIMIT = 3;
    const PRO_LIMIT  = 10;
    const limit =
      effectivePlanForQuota === "admin" ? Infinity :
      effectivePlanForQuota === "pro"   ? PRO_LIMIT : FREE_LIMIT;

    const day = romeYMD();
    const quotaKey = `ask:quota:${effectivePlanForQuota}:${ip}:${day}`;

    let used = 0;
    if (effectivePlanForQuota !== "admin") {
      try {
        used = await redis.incr(quotaKey);
        if (used === 1) await redis.expire(quotaKey, 36*60*60);
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
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", periodo = "", micro = {} } = body;
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, micro });

    // Parametri generazione
    const MAX_TOKENS = isPro ? 520 : 420;
    const TEMP_WTF  = isPro ? 1.02 : 1.00;
    const TEMP_WI   = isPro ? 0.70 : 0.68;

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
    const maxWords = stile === "wtf" ? (isPro ? 125 : 115) : (isPro ? 140 : 130);
    answer = clampWords(answer, maxWords);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Rinforzo chiusura nello stile richiesto
    const L = normLang(lang);
    if (stile === "wtf") answer = ensureWtfClosing(answer, L);
    else answer = ensureWhatIfOpen(answer, L);

    // Anti-cliché soft (solo se WTF)
    if (stile === "wtf") {
      const seed = hash32(domanda + ip + day);
      answer = deCliche(answer, seed);
    }

    // IT normalizzazioni
    if (L === "it") {
      const d = String(domanda || "");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/gu;
      const inQuestion = new Set(d.match(nameRx) || []);
      answer = answer.replace(nameRx, (m, _g1, offset, str) => {
        if (offset === 0) return m;
        const before = str.slice(0, offset);
        if (/[.!?…]["'”)\]]?\s*$/.test(before)) return m; // inizio frase
        return inQuestion.has(m) || ["Ah","Oh","Ehi","Sai","Guarda","Oh, allora"].includes(m) ? m : m.toLowerCase();
      });
      answer = answer.replace(/\ball’aquila\b/g, "all’Aquila");
    }

    // Maiuscola iniziale
    answer = answer.replace(/^\s*([a-zà-ÿ])/u, (m,c)=>c.toUpperCase());

    return res.status(200).json({
      answer,
      style: stile,
      lang: normLang(lang),
      periodo: periodo || detectPeriod(domanda, lang),
      model: MODEL,
      plan,
      quota: effectivePlanForQuota === "admin" ? null : { used, limit, reset_at_rome: romeNextMidnightISO() }
    });

  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
