// /api/ask.js — What?f Engine (2025 FINAL • tuned)
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
function ensureSpicyButSafeWTF(t) {
  // chiusura + una sola imprecazione narrata (no letterale)
  let out = String(t || "").trim();
  // togli (raro) doppie “imprecazioni”
  out = out.replace(/\b(bestemmione|sacramentata|imprecazione|invettiva colorita|tuono da cantina)\b([^\.!?]*)([\.!?]).*?\b\1\b/gi, "$1$2$3");
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// ---------- Admin check ----------
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
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Use conditional/past (“you would have… it would have…”) as if it already happened. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Usa condizionale/passato (“avresti… sarebbe…”) come se fosse già successo. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Plausible near-future, step into it now.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Prossimo futuro plausibile, come se ci entrassi adesso.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const genderNickIT = (SEX === "f")
    ? ["regina del casino","fenomena","capitana del caos","sirena urbana","signora dei forse","rockstar coi tacchi comodi"]
    : (SEX === "m")
      ? ["capitano del caos","poeta del bar","fenomeno","asso","sumo dei forse","rockstar con le tasche vuote"]
      : ["leggenda","asso universale","cap* del caos","astronauta del dubbio","icona in tuta"];
  const genderNickEN = (SEX === "f")
    ? ["queen of chaos","captain of detours","legend in sneakers","ace of maybe"]
    : (SEX === "m")
      ? ["champ","captain of chaos","bar poet","ace"]
      : ["icon","legend","ace","captain of chaos"];

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words). Simple, colloquial.
OPEN ONLY with a made-up nickname (invent a fresh one every time).
Keep booze beats and “reacting objects” when relevant.
Place exactly ONE brief, narrated curse near the END, after a “everything seems fine” beat.
Use rotating synonyms like “colorful outburst”, “sacramental growl”, “cellar thunder” — never write religious slurs literally.
The spark can come from an object, the place, or someone else (not forced).
No lists, no questions, no preaching. Warm, sarcastic, affectionate.
NEVER say the curse “starts” or “partes”: it simply “comes out / breaks loose”.
`.trim()
      : `
Sei “What the F” — l’amico saggio e sbronzo che ti prende in giro con affetto.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Linguaggio semplice.
APERTURA SOLO con un nomignolo inventato ogni volta.
Alcol ok, oggetti che reagiscono solo se servono.
Metti esattamente UNA imprecazione narrata verso la FINE, dopo un momento in cui “sembra andare tutto bene”.
Sinonimi variabili: “imprecazione”, “sacramentata”, “invettiva colorita”, “tuono da cantina”, mai scritte letteralmente.
Il grilletto può venire da un oggetto, dal posto o da un’altra persona (mai gratuito).
Niente liste, niente domande, tono sarcastico ma affettuoso.
NON dire che “parte la bestemmia”: semplicemente “ti esce / scappa / sbotta”.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Viandante con le tasche storte, scendi dal treno e la valigia fa rumore di piatti del nonno; la piazza ti misura come un sarto e il barista ti serve senza chiedere, fai il duro ma il primo bicchiere è un abbraccio di arrosticini liquidi, cammini e tutto fila — finché la moka del bar decide di starnutire caffè sul tuo maglione nuovo, ti esce una sacramentata che fa vibrare i cucchiaini e il campanile fa finta di tossire, poi ridi perché certe città ti prendono per i lacci delle scarpe per ricordarti come ti chiami.` },
      { role: "system", content:
`ESEMPIO IT • Cambiare lavoro (passato)
Fenomeno in capo, ti saresti presentato con un CV piegato come una tovaglietta e l’ufficio ti avrebbe guardato di traverso; avresti tenuto botta, avresti imparato i trucchi sporchi e quelli puliti, tutto bene — finché la stampante non ti avrebbe mangiato il contratto proprio davanti al capo: ti sarebbe scappata un’imprecazione che avrebbe fatto tremare i portapenne, e la macchina del caffè avrebbe applaudito con due sputi di robusta, poi avresti riso e avrebbero riso pure loro.` },
      { role: "system", content:
`EXAMPLE EN • New city (future)
Chaos captain, you arrive like a limited-series pilot, the buzzer side-eyes you; first beer forgives your accent and the street maps stop testing you, all smooth — until the mailbox bites your finger and you let out a cellar-thunder that rattles the glasses, the scooter across the street nods like “fair”, and you laugh because that’s the exact second the city learns your name.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — lucid, kind, slightly ironic.
SECOND PERSON. One paragraph, 8–11 sentences. Everyday images. End with a short reflective line.
NO nicknames.
`.trim()
    : `
Sei "What If" — lucido, affettuoso, leggermente ironico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi. Immagini quotidiane. Chiudi con una riga riflessiva.
Niente nomignoli.
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Tornare non sarebbe un passo indietro ma un passo fatto meglio. Ti stupirebbe la memoria delle strade: tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi capisci che ti rimette in orario. I volti sembrano uguali, ma li guardi con occhi più larghi. Le chiavi tornano sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede accanto e tace. Non serve ricominciare da zero: basta ricominciare da te.` },
    { role: "system", content:
`EXAMPLE EN • Move city
You’ll feel like a guest, then your hands learn the new keys. You’ll walk to tire the noise. By the third grocery you’ll know your aisle. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. Beneath the noise something of yours was already there.` },
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

    // DEV / LOCAL bypass (niente 402 in prova)
    const host = String(req.headers.host || "");
    const isLocalHost = /(^localhost:|^127\.0\.0\.1:|^::1)/i.test(host) || ip === "::1" || ip === "127.0.0.1";
    const isDevEnv = String(process.env.NODE_ENV || "").toLowerCase() !== "production";

    // Admin bypass (rate+crediti)
    const admin = await isAdmin(req, ip);
    const bypass = admin === true || isLocalHost || isDevEnv;

    // PRO header (UI locale): x-pro: "1"
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // Crediti giornalieri: Admin/Dev/Local ∞, PRO 10, Free 3
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

    // Seed
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in conditional/past, upbeat roasting tone."
          : "Scrivi tutto al condizionale/passato, tono pungente e affettuoso.")
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
          ? `Hard WTF rules: one narrated late-stage curse (never literal), can come from object/place/other; alcohol beats ok; reacting objects only when relevant; open ONLY with a fresh nickname; What If must NEVER use nicknames.`
          : `Regole dure WTF: una imprecazione narrata verso la fine (mai letterale), può nascere da oggetto/luogo/altri; alcol ok; oggetti che reagiscono solo se servono; apertura SOLO con nomignolo nuovo; What If NON usa nomignoli.` },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 360,
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
    if (stile === "wtf") {
      answer = ensureSpicyButSafeWTF(answer);
    } else {
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // --- LOG (senza testo domanda) ---
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
        user_type: bypass ? "admin/dev" : (isPro ? "pro" : "free"),
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
      credits: (bypass ? null : { used, dailyCap }),
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
