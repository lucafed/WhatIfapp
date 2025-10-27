// /api/ask.js — What?f Engine (2025 FINAL • sarcasto-patch)
// Stili: whatif (realismo/poetico, nessun nomignolo) · wtf (bar-sarcasmo affettuoso, sbronze, oggetti, “scoppio” comico narrato)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA testo della domanda (solo metadati + hash non reversibile)

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
  // blind-swap eventuali occorrenze indesiderate (ulteriore safety)
  out = out.replace(/\bbestemmia\b/gi, "imprecazione colorita");
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function toClause(domanda = "", lang = "it") {
  const d = String(domanda).trim()
    .replace(/[“”"']/g, "")
    .replace(/^\s*e\s+se\s+/i, "se ")
    .replace(/^\s*what\s*if\s+/i, "if ")
    .replace(/[?!.…\s]+$/,"")
    .trim();
  return d || (isEn(lang) ? "if it really happened" : "se succedesse davvero");
}

/* ---------- Openers ---------- */
const SOFT_OPEN_IT = [
  "Calma e coraggio, entri piano e la scena si apre da sola:",
  "Niente fretta: lasci che sia l’aria a fare il primo passo:",
  "Metti giù le chiavi e il racconto scivola, senza rumore:",
  "Un respiro, le luci si sistemano, la storia viene incontro:",
];
const SOFT_OPEN_EN = [
  "Easy does it: you step in and the scene opens by itself:",
  "Set the keys down; the story slides in on its own:",
  "Breathe once, the lights arrange, and the page comes to you:",
];

const BAR_OPEN_IT = [
  // accenni di sbronza + confidenza
  "Oh, senti ancora la grappa di ieri? Bene così:",
  "Oggi profumi di coraggio… e di amaro alle undici:",
  "Dalla regia dicono che il tuo caffè era mezzo rum: perfetto, si parte:",
  "Ti vedo brillante come un bicchiere appena sciacquato: accomodati:",
];
const BAR_OPEN_EN = [
  "Smell of espresso and something stronger? Good, let’s roll:",
  "You brought courage… and a splash of rum: perfect:",
  "Bar-stool honesty activated; lean in:",
];

/* ---------- Nicknames (solo WTF, più carini/simpatici) ---------- */
const NICKS_IT = {
  f: ["poetessa del parcheggio", "regina del carrello storto", "barista dei ripensamenti", "capitana dei piani B", "duchessa del ‘ma dai’", "eroina del tappo a vite"],
  m: ["poeta del parcheggio", "re del carrello storto", "sommelier del disastro buono", "capitano dei piani B", "barone del ‘ma dai’", "eroe del tappo a vite"],
  nb:["leggenda del parcheggio creativo", "maestro del carrello storto", "astronauta del piano B", "sindaco del ‘ma dai’", "icona del tappo a vite"]
};
const NICKS_EN = {
  f: ["queen of crooked carts","bar poet of second thoughts","captain of plan B","duchess of ‘come on’","heroine of screw caps"],
  m: ["poet of parking","king of crooked carts","sommelier of good chaos","captain of plan B","baron of ‘come on’"],
  nb:["legend of creative parking","icon of sideways plans","mayor of ‘come on’","astronaut of plan B"]
};
function pickNick(lang, sex, seed){
  const bank = isEn(lang) ? (NICKS_EN[String(sex)||"nb"] || NICKS_EN.nb) : (NICKS_IT[String(sex)||"nb"] || NICKS_IT.nb);
  return bank[((seed||0) % bank.length + bank.length) % bank.length];
}

/* ---------- Admin check ---------- */
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const data = await redis.hgetall(`admin:token:${token}`);
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Write as if the choice had been made back then; keep past/conditional with brief present flashes. One paragraph, no lists/questions/emojis. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Scrivi come se la scelta fosse stata fatta allora; prediligi passato/condizionale con brevi lampi di presente. Un paragrafo, niente elenchi/domande/emoji. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding now. One paragraph, no lists/questions/emojis. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile da adesso. Un paragrafo, niente elenchi/domande/emoji. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas ---------- */
function personaSystem(style, lang, sex = "nb") {
  const SEX = String(sex || "nb").toLowerCase();

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — a bar-sarcastic but loving friend. Tipsy-smart, visual, simple.
SECOND PERSON. ONE paragraph, 7–9 sentences (125–170 words).
OPEN: use a soft bar opener (provided) + a friendly nickname, then IMMEDIATELY weave the user's clause into the scene.
Include drinks beats and, when relevant, “reacting objects”.
Exactly ONE comic outburst (never literal religious content). Use synonyms like “bar-counter oath”, “saint-free squawk”, “under-breath curse”, “garage-grade yelp”, “kitchen-sink yowl”. It must erupt INSIDE the narrative because of a mishap; nearby people/objects react absurdly. Never write the word ‘blasphemy’.
Close warm and funny.`
      : `
Sei “What the F” — voce da bancone affettuosa e caustica. Brillo il giusto, sveglio parecchio.
SECONDA PERSONA. UN paragrafo, 7–9 frasi (125–170 parole).
APERTURA: usa un’apertura da bar (fornita) + un nomignolo simpatico, poi INTRECCIA SUBITO la clausola della domanda nella scena.
Metti sbronze e, quando serve, “oggetti che reagiscono”.
Un solo scoppio comico (mai contenuti religiosi letterali). Usa sinonimi tipo “giuramento da bancone”, “squittio senza santi”, “maledizione sotto voce”, “urletto da officina”, “strillo da vecchia moka”. Deve esplodere DENTRO la scena per un imprevisto; attorno oggetti/persone reagiscono assurdi. Non scrivere mai la parola “bestemmia”.
Chiudi caldo e divertente.`).trim();

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Oh, senti ancora la grappa di ieri? Bene così: poeta del parcheggio — se tornassi a vivere all’Aquila, scenderesti con il coraggio in tasca e i vicoli farebbero finta di niente mentre rallentano per venirti incontro; il bar ti regala un fondo di caffè come benvenuto e tu ti atteggi duro finché la macchina, al primo marciapiede, ti umilia con un bacio di gomma: parte un giuramento da bancone così onesto che il semaforo arrossisce e il cestino fischia, poi due facce ti chiamano per nome e la città smette di recitare e ti prende davvero, e a fine giornata brindi col bicchiere giusto, perché non stai tornando indietro: stai rientrando in te.` },
      { role: "system", content:
`ESEMPIO IT • Aprire un bar (futuro)
Dalla regia dicono che il tuo caffè era mezzo rum: perfetto, maestra del carrello storto — se aprissi il bar, il registratore tossirebbe come uno scooter in salita, tre clienti tornerebbero, stappi la “buona” ed è aceto: brucia sincero, battezzi l’errore, ti sfugge un urletto da officina e il bancone applaude coi bicchieri; a sera conti pochi spicci ma troppe risate e capisci che la tua cassa è il pavimento pieno di orme.` },
      { role: "system", content:
`EXAMPLE EN • Moving city (future)
Smell of espresso and something stronger? Good: queen of crooked carts — if you moved, the buzzer rolls its eyes, the fridge hums “good luck”, and when a parking sensor screams, a saint-free squawk slips out so loud the streetlight applauds; after the circus, your pace matches the map and the city keeps your name on file.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF (niente nomignoli)
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — lucid, kind, lightly poetic like the sample provided by the user.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
SOFT slide-in opener (provided). Everyday images (keys, streetlights, notebooks, hands, air). Small, true lines; no heroics, no melancholy. End with a short reflective line (not advice). No nicknames.`
    : `
Sei "What If" — lucido, affettuoso, lievemente poetico (come l’esempio utente).
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Apertura morbida (fornita). Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria). Verità piccole e vere; niente eroismi, niente malinconia. Chiudi con una riga riflessiva breve (non un consiglio). Niente nomignoli.`).trim();

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Calma e coraggio, entri piano e la scena si apre da sola: se tornassi a vivere all’Aquila, ti stupirebbe la memoria delle strade; tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi ti rimette in orario. Le chiavi tornano sul piattino giusto e la spesa nel negozio che sa il tuo nome. I volti sembrano uguali, ma li guardi con occhi più larghi. La nostalgia, se non la insegui, si siede accanto e tace. Non ricominci da zero: ricominci da te.` },
    { role: "system", content:
`EXAMPLE EN • Move city
Easy does it: if you moved, you’d feel like a guest, then your hands learn the new keys. You walk to tire the noise. By the third grocery you know your aisle. Evenings soften and ask less proof. You miss some things, not all at once. The rest finds its place. Beneath the noise, something of yours was already there.` },
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
      sex = "",          // "m" | "f" | "nb"
      micro = {}         // optional micro-profile
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "nb").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed & openers
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;
    const softOpen = (isEn(lang) ? SOFT_OPEN_EN : SOFT_OPEN_IT)[seedNum % (isEn(lang)?SOFT_OPEN_EN:SOFT_OPEN_IT).length];
    const barOpen  = (isEn(lang) ? BAR_OPEN_EN  : BAR_OPEN_IT )[seedNum % (isEn(lang)?BAR_OPEN_EN:BAR_OPEN_IT ).length];
    const nick     = stile==="wtf" ? pickNick(lang, resolvedSex, seedNum) : "";

    const clause = toClause(domanda, lang);
    const opener = (stile==="wtf")
      ? (isEn(lang)
          ? `${barOpen} ${nick} — ${clause}, it would roll like this:`
          : `${barOpen} ${nick} — ${clause}, andrebbe così:`)
      : (isEn(lang)
          ? `${softOpen} ${clause}, here is how it might truly feel.`
          : `${softOpen} ${clause}, ecco come potrebbe davvero scorrere.`);

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional, as if it already happened, keeping the upbeat roasting tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono allegro e pungente.")
        : "";

    const userPrompt = isEn(lang)
      ? `Question: "${domanda}". Context: "${String(extra||"").trim()}". Micro: ${JSON.stringify(micro||{})}.
Use THIS opener exactly once, then continue naturally in the same sentence flow (no “it would sound like” phrasing): "${opener}"
Requirements:
- Style="${stile}" with TEMPORAL MODE respected.
- WTF only: weave drinks, friendly jabs, one narrative outburst (synonym, never literal), reacting objects/people.
- What if only: no nicknames; soft, everyday imagery; short reflective ending.`
      : `Domanda: "${domanda}". Contesto: "${String(extra||"").trim()}". Micro: ${JSON.stringify(micro||{})}.
Usa QUESTO incipit una sola volta, poi prosegui nella stessa scia (niente “suonerebbe così”): "${opener}"
Requisiti:
- Stile="${stile}" con MODALITÀ TEMPORALE rispettata.
- Solo WTF: inserisci sbronze, prese in giro affettuose, UN solo scoppio narrativo (sinonimo, mai letterale), oggetti/persone che reagiscono.
- Solo What if: nessun nomignolo; morbido, immagini quotidiane; chiusura riflessiva breve.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `After writing, revise tenses for TEMPORAL MODE; fix grammar and commas; keep tone and length.`
          : `Dopo la stesura, rivedi i tempi per la MODALITÀ TEMPORALE; sistema grammatica e virgole; mantieni tono e lunghezza.` },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,
      presence_penalty: stile === "wtf" ? 0.25 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 170 : 160);
    answer = normalizeOneParagraph(answer);

    // Safety & closer
    if (stile === "wtf") answer = ensureSpicyButSafeWTF(answer);
    else if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente (privacy-safe) ---
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
