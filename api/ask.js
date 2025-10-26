// /api/ask.js — What?f Engine (2025 FINAL • tuned)
// Stili: whatif (realismo lucido) · wtf (amico saggio e sbronzo, “imprecazione narrata” tardiva)
// Modi WhatIf: real (analisi realistica: economia/scuola/vita sociale/QdV) · analytic · poetic
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto della domanda (solo metadati + hash non reversibile)

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
  let out = String(t || "").trim();
  // maschera eventuali parolacce letterali
  const taboo = [
    /\b(ca[zs]{1,2}o|mi[nm]{1,2}chia|vaf{1,2}a?)\b/gi,
    /\b(di[oc]\w+)\b/gi,
  ];
  taboo.forEach(rx => { out = out.replace(rx, (m) => m[0] + "—" + m.slice(1)); });
  out = out.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
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
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional, with quick present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "", whatifMode = "real", avoidNick = "", avoidImp = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  // (nomignoli non usati da WhatIf)
  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — a wise, tipsy friend: rough, affectionate, imagistic.
SECOND PERSON. ONE paragraph, 7–10 sentences (~140–180 words). Colloquial, cinematic.
OPEN with ONLY a nickname (no verbs) — invent a new, surreal/boozy nickname EVERY time (never reuse).
The curse moment is NARRATED (never literal) and must happen LATE (sentences 6–9) because of a natural, funny twist (missed bus, spilled coffee, door alarm, etc.). It may be direct (“you let out a baroque invocation”), ambient (“the lamp post curses and flickers”), or symbolic (“a choir of glasses curses in surround”).
Keep jabs affectionate; end warm and funny. STRICT: no lists, no questions, no emojis.
Never output actual profanities or religious slurs — only narrated/creative descriptions.
Avoid using EXACTLY these (if present): NICKNAME="${avoidNick}", IMPRECATION="${avoidImp}".
`.trim()
      : `
Sei “What the F” — amico saggio e sbronzo: ruvido, affettuoso, visivo.
SECONDA PERSONA. UN paragrafo, 7–10 frasi (~140–180 parole). Colloquiale, cinematografico.
APERTURA: SOLO un nomignolo (senza verbi) — inventane UNO NUOVO e surreale ogni volta (non riusare).
La “bestemmia” è sempre NARRATA (mai letterale) e SCOPPIA tardi (frasi 6–9) per un evento naturale e comico (coda in posta, caffè rovesciato, citofono isterico, ecc.). Può essere diretta (“ti scappa un’invocazione barocca”), ambientale (“il lampione impreca e sfarfalla”), o simbolica (“un coro di bicchieri impreca in surround”).
Stoccate fino alla fine ma con affetto; chiudi caldo e divertente. RIGIDO: niente elenchi/domande/emoji.
Mai scrivere parolacce/bestemmie letterali: solo descrizioni creative.
Evita di usare ESATTAMENTE questi (se presenti): NOMIGNOLO="${avoidNick}", IMPRECAZIONE="${avoidImp}".
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Rientro in città
Astronauta del bancone, rientri e la città ti prova le tasche: il barista alza un sopracciglio, la panchina ti misura. Le prime ore filano dritte, quasi quasi ti commuovi. Poi il parchimetro ti sputa la moneta, il ticket esce con geroglifici, il motorino sfiora la caviglia: la lattina vibra, ti scappa un’invocazione barocca che fa ridere pure il semaforo. Ti allungano lo scontrino come un fazzoletto: “bentornato, fenomeno”.` },
      { role: "system", content:
`EXAMPLE EN • New job
Patron saint of spreadsheets, you walk in like a poster, chair squeaks applause, coffee believes in you. First hour golden, second okay, third you reply-all with your grocery list; the printer coughs in Latin, the door sensor lawyering; the lamp curses in solidarity and you let out a baroque invocation that rattles the mugs. Someone snorts, someone smiles: hired by reality.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — tre modalità
  const mode = String(whatifMode || "real").toLowerCase();
  let SYS_WHATIF;
  if (isEn(lang)) {
    if (mode === "real") {
      SYS_WHATIF = `
You are "What If" — lucid and kind, no nicknames.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Grounded, simple. Deliver a realistic analysis anchored in FOUR lenses: economy/work, school/education, social life/community, quality of life/rhythm.
No lists or bullets: weave these lenses seamlessly into a single narrative paragraph. No emojis. End with a short reflective line (not advice).
`.trim();
    } else if (mode === "analytic") {
      SYS_WHATIF = `
You are "What If" — concise, clinical, still humane.
SECOND PERSON. One paragraph, 7–10 sentences.
Structure implicitly by ideas (not bullets), quantify where plausible, mention tradeoffs and uncertainty, end with a neutral synthesis (not advice).
`.trim();
    } else {
      SYS_WHATIF = `
You are "What If" — warm narrative voice, quietly lyrical but realistic.
SECOND PERSON. One paragraph, 8–11 sentences. Everyday images allowed but do not force specific props; vary naturally. End with a brief reflective line.
`.trim();
    }
  } else {
    if (mode === "real") {
      SYS_WHATIF = `
Sei "What If" — lucido e affettuoso, senza nomignoli.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Analisi realistica intrecciando QUATTRO lenti: economia/lavoro, scuola/istruzione, vita sociale/comunità, qualità della vita/ritmo.
Niente elenchi o punti: integra le lenti in un’unica narrazione. Niente emoji. Chiudi con una riga riflessiva breve (non un consiglio).
`.trim();
    } else if (mode === "analytic") {
      SYS_WHATIF = `
Sei "What If" — asciutto, clinico ma umano.
SECONDA PERSONA. Un paragrafo, 7–10 frasi.
Struttura per idee (senza elenchi), quantifica quando plausibile, cita compromessi e incertezza, chiudi con sintesi neutra (non un consiglio).
`.trim();
    } else {
      SYS_WHATIF = `
Sei "What If" — voce calda, sobria, un filo lirica ma realistica.
SECONDA PERSONA. Un paragrafo, 8–11 frasi. Immagini quotidiane solo se nascono naturali, niente forzature. Chiusura riflessiva breve.
`.trim();
    }
  }

  const FEWSHOTS = [
    { role: "system", content:
isEn(lang)
? `IT EXAMPLE • Return
Tornare non sarebbe un passo indietro ma un passo fatto meglio. All’inizio la lentezza graffia, poi ti rimette in orario. Le facce sembrano uguali, gli occhi sono i tuoi che cambiano. La nostalgia, se non la insegui, si siede e tace. Non ricominci da zero: ricominci da te.`
: `ESEMPIO IT • Rientro scarno
Tornare non è indietro: è far pace col ritmo. La lentezza all’inizio punge, poi allinea. Le persone restano, tu ti allarghi. La nostalgia, se non la insegui, smette di tirare. Non ricominci da zero: ricominci da te.` },
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

    // PRO header (UI locale): x-pro: "1"
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // Crediti giornalieri: Admin ∞, PRO 10, Free 3
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
      sex = "",                // "m" | "f" | "nb"
      micro = {},              // micro-profile
      whatif_mode = "real"     // "real" | "analytic" | "poetic"
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase(); // prefer top-level

    // —— Varietà anti-ripetizione (solo WTF): leggi ultimo nickname/imprecazione
    let LAST_NICK = "", LAST_IMP = "";
    if (stile === "wtf") {
      try {
        const prev = await redis.hgetall(`wtf:last:${ip}`); // { nick_it, imp_it, nick_en, imp_en }
        if (isEn(lang)) {
          LAST_NICK = String(prev?.nick_en || "");
          LAST_IMP  = String(prev?.imp_en  || "");
        } else {
          LAST_NICK = String(prev?.nick_it || "");
          LAST_IMP  = String(prev?.imp_it  || "");
        }
      } catch {}
    }

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, whatif_mode, LAST_NICK, LAST_IMP);
    const temporal = temporalSystem(periodo, lang, stile);

    // A tiny deterministic seed (helps variety while keeping brand tone)
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${whatif_mode}`), 36) % 1_000_000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional, as if it already happened, keeping the upbeat roasting tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono allegro e pungente.")
        : "";

    // Long memory: ultime 5 domande hashate (solo per tono/coerenza; niente contenuti)
    let histMeta = "";
    try {
      const key = `mem:qhash:${ip}`;
      const arr = await redis.lrange(key, 0, 4);
      histMeta = (arr || []).join(",");
    } catch {}

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona adapts to sex="${resolvedSex||"unknown"}". Keep exact voice. INTERNAL SEED: ${seedNum}. WHATIF_MODE="${whatif_mode}". USER_HISTORY_HASHES="${histMeta}". MICRO="${JSON.stringify(micro||{})}".`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso="${resolvedSex||"unknown"}". Mantieni la voce esatta. SEED INTERNO: ${seedNum}. WHATIF_MODE="${whatif_mode}". USER_HISTORY_HASHES="${histMeta}". MICRO="${JSON.stringify(micro||{})}".`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `WTF hard rules: one narrated curse moment, late in the paragraph, triggered by a natural event; no literal slurs; opening is ONLY a nickname; affectionate roast.`
          : `Regole dure per WTF: una sola imprecazione narrata, tardiva e causata da evento naturale; mai letterale; apertura SOLO con nomignolo; presa in giro affettuosa.` },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (whatif_mode === "analytic" ? 0.6 : 0.82),
      top_p: 0.92,
      max_tokens: 420,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 10 : 11);
    answer = clampWords(answer, stile === "wtf" ? 180 : 170);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") {
      answer = ensureSpicyButSafeWTF(answer);
    } else {
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // --- LOG persistente (privacy-safe) + memoria leggera ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        sex: resolvedSex || null,
        mode: stile === "whatif" ? whatif_mode : null,
        domanda_len: String(domanda || "").length,
        domanda_hash: tinyHash(domanda || ""),
        answer_chars: (answer || "").length,
        admin: !!admin,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);

      // breve memoria di coerenza: hash ultime domande
      const qkey = `mem:qhash:${ip}`;
      await redis.lpush(qkey, entry.domanda_hash);
      await redis.ltrim(qkey, 0, 4);
      await redis.expire(qkey, 60 * 60 * 24 * 30);

      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      if (stile === "whatif") await redis.hincrby("stats:mode", whatif_mode, 1);

      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}:${whatif_mode}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch (e) {
      console.warn("log/mem failure (non-bloccante)", e);
    }

    // —— Salva ultimo nickname + “imprecazione narrata” per varietà (WTF)
    try {
      if (stile === "wtf" && answer) {
        const nick = (answer.split(",")[0] || "").trim().slice(0, 80);
        const sent = (answer.match(/[^.!?]*?(imprec|invocaz|malediz|anatema|coro di bicchieri|lampion|moka|frigorifer|blasph|curse)[^.!?]*[.!?]/i) || [""])[0].trim().slice(0, 220);
        if (isEn(lang)) {
          await redis.hset(`wtf:last:${ip}`, { nick_en: nick, imp_en: sent });
        } else {
          await redis.hset(`wtf:last:${ip}`, { nick_it: nick, imp_it: sent });
        }
        await redis.expire(`wtf:last:${ip}`, 60 * 60 * 24 * 7);
      }
    } catch {}

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      periodo,
      mode: whatif_mode,
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
