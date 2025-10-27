// /api/ask.js — What?f Engine (FINAL: no-nickname WTF · confessional What If)
// What If: confidenziale (usa il nome se presente), realistico/analitico O poetico.
// What the F: apertura confidenziale, sarcasmo da bar, zero nomignoli, sbronze, oggetti che reagiscono,
// imprecazione eufemistica dentro la narrazione (mai la parola “bestemmia”).

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

// pool eufemismi (mai “bestemmia” letterale)
const EUPH_IT = [
  "ti scappa un «santi bulloni» che fa vibrare i bicchieri",
  "lasci andare un «per la marmitta benedetta» e la tazzina tossisce d’imbarazzo",
  "mormori «sante rondelle» e il lampione si raddrizza per finta",
  "ti parte un «per tutte le gomme sgonfie» e il bancone applaude piano",
  "sbotti in un «carburatore santo» e i cucchiaini fanno casta di metallo",
  "ti sfugge un «o cielo dei copertoni» che mette in riga il registratore di cassa",
];
const EUPH_EN = [
  "you let slip a “holy spark plugs” that rattles the glasses",
  "a “sainted carburetor” escapes and the counter salutes",
  "you mutter “blessed brake pads” and the streetlight straightens",
  "a crisp “holy gasket” pops and the spoons stand at attention",
];
function euphemize(text, lang) {
  let t = String(text || "");
  const rx = /\b(bestemmia|blasfem\w*|imprecazione\b(?:\s+\w+){0,2})\b/gi;
  if (rx.test(t)) {
    const pool = isEn(lang) ? EUPH_EN : EUPH_IT;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    t = t.replace(rx, pick);
  }
  return t;
}
function ensureSpicyButSafeWTF(t, lang) {
  let out = euphemize(String(t || "").trim(), lang);
  if (!/[.!?…]$/.test(out)) out += ".";
  // Se il modello mette un nomignolo in apertura tipo "Campione," lo tagliamo.
  out = out.replace(/^[A-ZÁÉÍÓÚÀÈÌÒÙÄËÏÖÜ][\p{L}\p{M}\s'’\-]+,\s*/iu, "");
  return out;
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made then and show how it unfolded. Prefer past/conditional. No lists, no questions. Keep ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe andata. Preferisci passato/condizionale. Niente elenchi o domande. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near future. No lists, no questions. Keep ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile. Niente elenchi o domande. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas ---------- */
function personaSystem(style, lang, sex = "") {
  if (style === "wtf") {
    // What the F — confidenziale, zero nomignoli.
    const SYS = (isEn(lang)
      ? `
You are “What the F” — a bar-sarcastic but loving friend who knows the user.
SECOND PERSON. ONE paragraph, 6–9 sentences (~125–165 words).
OPEN with a short confidential hook like “Hey, listen— / Look, today you’re not kidding—” possibly with a gentle drink jab. NO nicknames at the start or elsewhere.
Keep alcohol beats and “reacting objects” only when relevant. Fold exactly one brief euphemistic blasphemy INSIDE the narration (never literal, never the word “blasphemy”; it may come from you, a passerby, or an object).
Sarcasm must be affectionate and tied to the user’s question. No lists, no questions, no emojis, no moralizing. Close warm and funny.
`.trim()
      : `
Sei “What the F” — amico da bancone: sarcastico ma affettuoso, ti conosce.
SECONDA PERSONA. UN paragrafo, 6–9 frasi (~125–165 parole).
APR I con un gancio confidenziale (“Ehi, senti—”, “Guarda che oggi—”) anche con una battuta sull’alcol. Vietati i nomignoli, sempre.
Sì a sbronze e oggetti che reagiscono quando servono. Inserisci UNA sola imprecazione eufemistica dentro la scena (mai scrivere la parola “bestemmia”; può partire da te, da un oggetto o da un passante).
Sarcasmo affettuoso, sempre legato alla domanda. Niente elenchi, domande, emoji, prediche. Chiudi caldo e divertente.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Aprire un bar (futuro)
Ehi, senti — già ti presenti con il coraggio nel bicchiere e la moka che fuma giudizi: ti immagini maestro del cappuccino, poi arriva la richiesta “decaffeinato tiepido con schiuma fredda” e dal vapore parte un «santi bulloni» che fa ridere i cornetti; il registratore di cassa tossisce come scooter in salita, i cucchiaini si mettono sull’attenti, tu versi un goccetto “per bilanciare” alle nove e venti e ti inventi il sorriso da imprenditore di quartiere; a fine giornata conti spicci e complimenti, non hai conquistato la città ma hai imparato a versarla — il bancone fa da pubblico e tu da commedia principale.` },
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (passato/controfattuale)
Guarda che oggi non scherzi — sei rientrato con l’odore di grappino buono e la città ti ha riconosciuto al passo; i lampioni hanno allungato l’ombra per tenerti il ritmo e alla prima buca ti è scappato un «per la marmitta benedetta» che ha fatto tintinnare i bicchieri; al mercato ti hanno chiamato per nome senza bisogno di ricordini, e nel pomeriggio le finestre hanno avuto pazienza per te; la sera hai chiuso le imposte come si chiude un cerchio e ti sei accorto che non tornavi indietro: tornavi a te, e il muro sotto casa l’ha capito prima di tutti.` },
      { role: "system", content:
`EXAMPLE EN • Buy a motorbike (future)
Look, today you’re brave — you hop on that beast with last night’s Negroni still negotiating; halfway down the boulevard the wind tries stand-up comedy in your helmet, the light stays red on purpose and a “holy spark plugs” shakes the spoons; the street nods, the pump forgives the wobble, and by the time you park slightly diagonal you’ve got more stories than miles and a promise to treat the tank like royalty, maybe.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — confidenziale, senza nomignoli, due registri possibili (analitico/poetico) scelti dal modello
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind confidant.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
OPEN with a brief friendly comment that feels personal (“Nice one…”, or use the user's first name if it's clearly present). No nicknames or emojis.
Write naturally either in a realistic/analytic social-economic register OR in a warm poetic register — pick what best fits the question. End with a short reflective line.
`.trim()
    : `
Sei "What If" — un confidente lucido e gentile.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
APR I con un commento amichevole e personale (“Bella domanda…”, o usa il nome se è chiaramente presente). Niente nomignoli né emoji.
Scegli in modo naturale tra registro realistico/analitico (economia, servizi, qualità di vita) oppure registro poetico/emotivo, secondo la domanda. Chiudi con una riga riflessiva breve.
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Registro analitico (tornare all’Aquila)
Sai, questa domanda era nell’aria: tornare significherebbe una città che ha cambiato pelle ma non respiro; la ricostruzione ha riacceso lavoro e servizi a ritmo lento, il costo della vita resta più basso del Nord ma anche gli stipendi, la routine si fa più vicina e le relazioni contano più dell’agenda; potresti perdere un po’ di rumore e guadagnare aria, e scoprire che la quiete non è vuoto ma spazio per scegliere.` },
    { role: "system", content:
`ESEMPIO IT • Registro poetico (tornare all’Aquila)
Bella questa — riapri le finestre e l’aria di legna rimette in ordine i pensieri; le strade ti tengono il passo, i lampioni sanno il tuo nome, al bar torna un caffè corto e onesto; i figli imparano il ritmo delle stagioni e la nostalgia, se non la insegui, si siede accanto e tace; non torni indietro: torni dove la vita smette di correre.` },
    { role: "system", content:
`EXAMPLE EN • Analytic move city
Good one — moving back would trade speed for margin: lower costs, smaller salaries, denser ties, slower noise; weekends widen, errands shrink, and the air gives you room to aim; not back, but back to yourself.` },
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

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    const admin = await isAdmin(req, ip);
    const bypass = admin === true;

    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // Crediti
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

    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past/conditional, as if it already happened, keeping the upbeat roasting tone."
          : "Scrivi tutto al passato/condizionale, come se fosse già successo, mantenendo il tono pungente.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep persona voice exactly. If a clear first name is present, you may address it once in the opening line; otherwise use a friendly generic opener. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni la voce della persona. Se nel testo c'è un nome chiaro puoi usarlo una volta all'inizio, altrimenti usa un'apertura confidenziale generica. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `WTF hard rules: no nicknames anywhere; one euphemistic internal expletive; reacting objects okay; one paragraph; no lists/questions/emojis.`
          : `Regole dure WTF: nessun nomignolo in nessun punto; una sola imprecazione eufemistica interna; oggetti reattivi ok; paragrafo unico; niente elenchi/domande/emoji.` },
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
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") {
      answer = ensureSpicyButSafeWTF(answer, lang);
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
