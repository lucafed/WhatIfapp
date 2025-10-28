// /api/ask.js — What?f Engine (2025 FINAL+clean)
// Stili: whatif (analitico/poetico) · wtf (sarcasmo demenziale affettuoso)
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

/* —— HARD CLEANUP: elimina residui/intro vecchie + nomi propri tipo “Ehi, Marco” —— */
function hardCleanup(t, lang) {
  let out = String(t || "");

  // 1) elimina le intro note che a volte il modello ripete
  const introRX = [
    /^(Entri piano, il caos ti riconosce ma oggi ti lascia passare\.)\s*/i,
    /^(La stanza è la stessa, lo sguardo no: è già un inizio\.)\s*/i
  ];
  introRX.forEach(rx => { out = out.replace(rx, ""); });

  // 2) rimuovi eventuali ripetizioni della stessa frase all’inizio
  out = out.replace(/^(.{10,120})\s+\1/si, "$1 ");

  // 3) elimina invocazioni con nome proprio tipo “Ehi, Marco,” “Oh Luca,” ecc.
  out = out.replace(/^(?:Ehi|Oh|Ah|Ecco|Allora)[,!\s]+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ']{1,20}([,!\s]+)?/i, "");

  // 4) vieta @nomi e tag
  out = out.replace(/@[\w.]+/g, "");

  return out.trim();
}

function ensureSpicyButSafeWTF(t) {
  let out = String(t || "").trim();
  // una “bestemmia” narrata è concessa, ma MAI letterale: già nei few-shot
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe andata. Preferisci passato/condizionale. Niente elenchi o domande. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente elenchi o domande. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas + Few-shot (esempi VINCOLANTI) ---------- */
function personaSystem(style, lang, sex = "", substyle = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const genderNickIT = (SEX === "f")
    ? ["regina del casino","fenomena","asso di briscola","capitana del caos","sirena urbana","signora dei forse","rockstar con tacchi comodi"]
    : (SEX === "m")
      ? ["campione","fenomeno","asso","capitano del caos","poeta del bar","testa calda elegante","padrino del forse"]
      : ["leggenda","fenomen*","asso universale","cap* del caos","rockstar del forse","astronauta del dubbio"];
  const genderNickEN = ["champ","legend","ace","captain of chaos"];

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words).
OPEN only with a bare nickname (no verbs). Use a rotating nickname list.
Include exactly one brief, narrated blasphemy moment (never literal words); adult, cheeky tone; alcohol beats allowed; “reacting objects/people” only when relevant.
STRICT: no lists, no questions, no emojis, no moralizing; keep TEMPORAL MODE.
Nicknames (EN): ${genderNickEN.join(", ")}.
`.trim()
      : `
Sei “What the F” — l’amico rumoroso e affettuoso che prende in giro ma vuole bene.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole).
APRII solo con un nomignolo secco (senza verbi). Usa i nomignoli seguenti.
Una sola “bestemmia” narrata (mai scritta letteralmente). Tono adulto, sporco, giocoso; alcol ok; oggetti/persone che “reagiscono” solo quando servono.
RIGIDO: niente elenchi, niente domande, niente emoji; rispetta la MODALITÀ TEMPORALE.
Nomignoli (IT): ${genderNickIT.join(", ")}.
`.trim());

    // FEW-SHOT — incollati come da tuoi esempi (maschile/femminile e moto/bar)
    const FEWSHOTS = [
      { role: "system", content:
`WHAT THE F — tono definitivo (bar)
Ah, ma guarda un po’, il genio dell’espresso che si sveglia con la vocazione imprenditoriale. Ti vedo: grembiule nuovo, sorriso da spot pubblicitario, la moka che sibila come un vecchio nonno stanco di vivere. Arriva il primo cliente, chiede un cappuccino “senza schiuma, ma caldo, però freddo dentro” e già ti parte la pressione. Tentando l’impossibile, ti bruci un dito e ti scappa un “porca di quella schiuma sorda e bastarda!” che fa tremare le tazzine e il cucchiaino va in sciopero. Il frigo rantola, la macchina del caffè fa un ruttino di protesta, e una vecchietta ti guarda come se avessi bestemmiato in latino. Tu le sorridi, versi grappa nel caffè e pensi: “almeno oggi ho aperto un locale che fa ridere anche i mobili”. Quando chiudi la sera, il bancone ti dice “ce la rifacciamo domani, capo?” — e tu annuisci, col fegato in disarmo ma il morale alto.` },
      { role: "system", content:
`WHAT THE F — tono definitivo (moto)
Ah, eccoci, il nuovo Valentino del parcheggio condominiale. Ti presenti con la giacca di pelle lucida, casco nuovo e l’orgoglio che fa attrito. Accendi il motore, romba come un drago epilettico e già ti senti immortale. Poi un piccione ti taglia la strada e parte un “porca di quella frizione ubriaca e maledetta!” che rimbalza sui muri del quartiere. Un passante applaude, un cane ulula in do maggiore e il semaforo si gira dall’altra parte per la vergogna. Riparti come se nulla fosse, ma il cavalletto resta giù e ti fa un colpo basso. Ti fermi al bar, ordini un Negroni, e il barista ti versa due dita extra “per compassione”. Alla fine ridi e capisci che la moto non era un mezzo per scappare: era solo un modo elegante per cadere in grande stile.` },
      { role: "system", content:
`WHAT THE F — versione femminile (innamorarsi)
Ah, Luisa… di nuovo tu, eh? Giuro che ogni volta che dici “stavolta ci penso bene”, un prosecco stappa da solo da qualche parte. Ti vedo: vestita bene ma con l’occhio lucido, messaggi che cancelli e riscrivi come se stessi trattando un’adozione internazionale. Poi lui ti visualizza e non risponde — e ti parte un “porca di quella chat maledetta e dell’algoritmo suo zio!” così forte che Siri finge un malfunzionamento per non sentirti. La lampada vibra, il gatto si rifugia dietro la lavatrice, e il bicchiere di vino si riempie da solo per compassione. Tu sospiri, bestemmi piano con grazia da signora disperata, e dici “vabbè, almeno stavolta sapevo dove mi andavo a schiantare”. Alla fine, tra una risata e un rutto di rosé, capisci che innamorarsi è come un aperitivo: sai che finirà male, ma ci vai lo stesso perché almeno fino all’ultimo sorso è vita vera.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF (due sottostili: analitico/poetico) — esattamente come i tuoi esempi
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — lucid, kind, slightly ironic.
SECOND PERSON. One paragraph, 7–10 sentences (~110–150 words).
Everyday images; short reflective close. No lists, no questions, no emojis.
Keep substyle exactly: analytic or poetic.
`.trim()
    : `
Sei "What If" — lucido, affettuoso, con sorriso pratico.
SECONDA PERSONA. Un paragrafo, 7–10 frasi (~110–150 parole).
Immagini quotidiane; chiusura riflessiva breve. Niente elenchi o domande o emoji.
Rispetta il sottostile scelto: analitico o poetico.
`.trim());

  const FEWSHOTS_ANALITICO = [
    { role: "system", content:
`WHAT IF — Analitico (realistico/sociale)
Domanda: E se tornassi a vivere all’Aquila?
Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.` },
  ];
  const FEWSHOTS_POETICO = [
    { role: "system", content:
`WHAT IF — Poetico (emotivo/narrativo)
Domanda: E se tornassi a vivere all’Aquila?
Bella questa, Luca — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.` },
  ];

  const sub = String(substyle || "analitico").toLowerCase();
  const shots = sub === "poetico" ? FEWSHOTS_POETICO : FEWSHOTS_ANALITICO;

  return { sys: SYS_WHATIF, fewshots: shots };
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
      substyle = "analitico",   // <— NEW: sottostile What If
      sex = "",
      micro = {}
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, substyle);
    const temporal = temporalSystem(periodo, lang, stile);

    // seed
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${substyle}`), 36) % 1000000;

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona sex="${resolvedSex||"unknown"}". Substyle="${substyle||""}". Keep the exact persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Sesso utente="${resolvedSex||"unknown"}". Sottostile="${substyle||""}". Mantieni esattamente la voce. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `Hard rules: one paragraph, no lists/questions/emojis, no greetings with names; for WTF open ONLY with a bare nickname.`
          : `Regole dure: un solo paragrafo, niente elenchi/domande/emoji, niente saluti con nomi; per WTF apri SOLO con un nomignolo secco.` },
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

    answer = hardCleanup(answer, lang);
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 165 : 155);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") answer = ensureSpicyButSafeWTF(answer);
    else if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG (privacy-safe) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        substyle,
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
      await redis.hincrby("stats:substyle", String(substyle || "analitico"), 1);
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
      substyle,
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
