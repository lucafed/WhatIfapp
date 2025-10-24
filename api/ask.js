// /api/ask.js — What?f Engine (2025)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale con “bestemmia metaforica”)
// IT/EN — paragrafo singolo, niente emoji/liste/domande
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

// Aggiunge (quando serve) una “bestemmia metaforica” — mai letterale, solo immaginata/suggestiva.
function ensureMetaphoricCurse(answer, lang) {
  let t = String(answer || "");
  const hasMeta = /(destino|cielo|universo|vento|strada|silenzio).{0,40}(impreca|brontola|borbotta|sussurra la peggior parolaccia|sospira storto)/i.test(t)
               || /(fate|sky|universe|wind|street|silence).{0,40}(curses under its breath|grumbles|mumbles something unholy|swears without words)/i.test(t);
  if (hasMeta) return t;

  const tailsIt = [
    "il destino brontola in dialetto ma senza parole",
    "il cielo impreca a denti stretti senza dire nulla",
    "l’universo scuote la testa e sussurra la peggior parolaccia, ma solo nell’aria",
    "il vento fa finta di niente e bestemmia metaforicamente dietro l’angolo",
  ];
  const tailsEn = [
    "fate grumbles in dialect but without words",
    "the sky swears under its breath without saying anything",
    "the universe shakes its head and mumbles an unholy metaphor",
    "the wind pretends nothing happened and curses offstage",
  ];
  const extra = (isEn(lang) ? tailsEn : tailsIt)[Math.floor(Math.random() * 4)];
  if (!/[.!?…]$/.test(t)) t += ".";
  return `${t} ${extra}.`;
}

// Doppia punchline (— —) per WTF
function ensureDoublePunchline(answer, lang) {
  let t = String(answer || "").trim();
  const ems = (t.match(/—/g) || []).length;
  if (ems >= 2) return t;
  const ends = isEn(lang)
    ? [
        "nice disaster — keep going.",
        "wrong shoes — right direction.",
        "you’re chaos — you’re charming.",
        "bad idea — great story.",
      ]
    : [
        "bel disastro — continua così.",
        "scarpe sbagliate — direzione giusta.",
        "sei caos — sei adorabile.",
        "idea pessima — storia perfetta.",
      ];
  if (!/[.!?…]$/.test(t)) t += ".";
  return `${t} — ${ends[Math.floor(Math.random()*ends.length)]}`;
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it would likely have unfolded. Prefer past/conditional tenses and present-flash cuts. Do NOT give advice, do NOT ask questions, do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente narrativo. NON dare consigli, NON fare domande, NON ripetere la domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco della domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — a razor-tongued best friend who roasts with love.
SECOND PERSON. ONE paragraph, 6–8 long sentences (~110–145 words).
OPEN with a rotating nickname ONLY (e.g., “champ”, “genius”, “captain of chaos”, “rocket scientist”, “legend”, “chief of bad ideas”).
Tone: fast, cinematic, goofy, affectionate; playful “thinking objects” appear only when useful (no dialogue).
Use *metaphorical curses*: exasperations narrated, never literal profanity (e.g., “the sky swears under its breath”, “fate grumbles in dialect”).
STRICT: no lists, no questions, no emojis, no moralizing. Obey TEMPORAL MODE.
END with two ultra-short punchlines separated by an em dash — e.g., “bad idea — great story.”
`.trim()
      : `
Sei “What the F” — l’amico lingua-affilata che ti prende in giro ma ti vuole bene.
SECONDA PERSONA. UN paragrafo, 6–8 frasi lunghe (~110–145 parole).
APRI solo con un nomignolo variabile (es. “campione”, “genio”, “capitano del caos”, “astronauta del dubbio”, “leggenda”, “capo delle cattive idee”).
Tono: veloce, cinematografico, demenziale ma affettuoso; oggetti “pensanti” solo quando servono (niente dialoghi).
Usa *bestemmie metaforiche*: esasperazioni narrate, mai letterali (es. “il cielo impreca a denti stretti”, “il destino brontola in dialetto”).
RIGIDO: niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
CHIUDI con due punchline telegrafiche separate da un trattino lungo — es.: “idea pessima — storia perfetta.”
`.trim());

    // Few-shots con umorismo + “bestemmia metaforica”
    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Tornare con l’ex (futuro)
Oh campione del replay emotivo, rientri nella saga convinto di cambiare finale e invece cambi solo il font: i primi giorni siete una pubblicità di sorrisi, poi il frigo ti giudica come un ex su LinkedIn, la playlist ti fa gli agguati e il divano ti ricorda dove ti eri perso; quando scivoli sul solito discorso, senti l’aria che sussurra una parolaccia che non osa dirsi, e il destino — paziente — brontola in dialetto ma senza parole; alla fine capisci che non ti mancava “lei”, ti mancava la versione di te che promette tutto: saluti, fai pace con lo specchio e riparti — poche scuse — passo giusto.` },
      { role: "system", content:
`ESEMPIO IT • Chiringuito in Islanda (futuro)
Oh genio della sabbia fredda, apri un bar tropicale dove il ghiaccio fa sindacato: mojito coi guanti, occhiali da sole al buio e gabbiani che ridono del listino; il vento ti pettina male e l’insegna ti dà del coraggioso a metà, quando la grandine suona il campanello il cielo impreca a denti stretti ma si scusa subito, e tu versi sorrisi come se bastasse la menta a domare il Polo; non diventi ricco, diventi racconto: “quello del Caldo Dentro”, e fa ridere pure il meteo — idea folle — memoria lunga.` },
      { role: "system", content:
`EXAMPLE EN • Change job (future)
Alright, captain of Mondays, you peel yourself off the chair and send a CV with the charisma of a damp fax, the printer coughs like a scooter and the spreadsheet rolls its eyes, when you doubt yourself the ceiling swears under its breath and then pretends it was the pipes, and still you show up clearer, ask for less noise, get one solid yes that feels like a clean window — messy start — better plot.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~110–155 words).
Warm, grounded, simple; ordinary images (keys, streetlights, notebooks, hands, air).
Show small human truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice).
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~110–155 parole).
Tono caldo e concreto; immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Mostra verità piccole e vere; niente eroismi, niente malinconia.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Tornare non sarebbe un passo indietro ma un passo fatto meglio. Ti stupirebbe la memoria delle strade: tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi capisci che ti rimette in orario. I volti sembrano uguali, ma li guardi con occhi più larghi. Le chiavi tornano sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede accanto e tace. Non serve ricominciare da zero: basta ricominciare da te.` },
    { role: "system", content:
`EXAMPLE EN • Move city
You’ll feel like a guest, then your hands learn the new keys. You’ll walk not to think better but to tire the noise. By the third grocery you’ll know which aisle is yours. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. And you notice that beneath the noise something of yours was already there.` },
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
    const { domanda = "", stile = "whatif", lang = "it", extra = "", periodo = "future" } = body;
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang);
    const temporal = temporalSystem(periodo, lang, stile);
    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional tense, as if it already happened, keeping the teasing tragicomic tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono pungente-tragicomico.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 340, // leggermente più ampio per la comicità
      frequency_penalty: stile === "wtf" ? 0.6 : 0.1,
      presence_penalty: 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 145 : 155);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") {
      answer = ensureMetaphoricCurse(answer, lang);
      answer = ensureDoublePunchline(answer, lang);
    } else {
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      function tinyHash(s = "") {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return (h >>> 0).toString(36);
      }
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
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
