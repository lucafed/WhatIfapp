// /api/ask.js — What?f Engine (2025 FINAL • FEWSHOT VERBATIM DI LUCA)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale affettuoso)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞

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
  // chiudi e normalizza (la forza sta nei few-shot)
  let out = String(t || "").trim();
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional. Keep EXACT ${style.toUpperCase()} voice. One paragraph. No questions, no lists, no echo.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe andata. Preferisci passato/condizionale. Mantieni ESATTAMENTE la voce ${style.toUpperCase()}. Un paragrafo. Niente domande, niente elenchi, niente eco.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near future as if stepping in now. Keep EXACT ${style.toUpperCase()} voice. One paragraph. No questions/lists/echo.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Mantieni ESATTAMENTE la voce ${style.toUpperCase()}. Un paragrafo. Niente domande/elenco/eco.`;
}

/* ---------- Personas (voci) + FEWSHOT VERBATIM ---------- */
function personaSystem(style, lang, sex = "") {
  if (style === "wtf") {
    const SYS = `
Sei “What the F” — amico rumoroso, rude ma affettuoso.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Italiano naturale.
APERTURA con un nomignolo se lo senti, ma niente eco della domanda.
Usa alcol e “oggetti/persone che reagiscono” quando serve.
Consenti “bestemmia” e derivati come concetto narrativo (“bestemmione”, “bestemmiata”, “bestemmia santa”, “mannaggia al porco volante…”) — evita riferimenti religiosi espliciti letterali.
Niente liste, niente domande, niente emoji, niente prediche. Tono adulto, grezzo, ironico. Chiudi caldo e divertente.
`.trim();

    const FEWSHOTS = [
      { role: "system", content:
`WHAT THE F — E se aprissi un bar?

Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo.
Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”.
Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale.
La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora: “questo al confessionale lo tengono in riserva”.
Ti versi un goccio di liquore per calmare i santi e giuri che domani apri un bar solo per matti.
Alla chiusura, il bancone ti guarda e tu, esausto, sussurri: “oggi ho bestemmiato più del prete quando finisce il vino — ma almeno ho servito verità calde”.` },
      { role: "system", content:
`WHAT THE F — E se comprassi una moto?

Oh, eccoci, centauro dell’inferno! Casco lucido, cuore impavido, orgoglio pronto all’incidente.
Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino.
Ti scappa un “bestemmione che spacca l’aria!” talmente sonoro che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo.
Ti fermi, respiri, bestemmi di nuovo, ma stavolta con affetto, tipo rito purificatore.
Un vecchio ti dice “bella linea” e tu pensi che parlasse del nervo saltato.
Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio, con un sorrisetto da complice.
Quando torni a casa senti ancora l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie bene calibrate.` },
      { role: "system", content:
`WHAT THE F — E se mi innamorassi di nuovo?

Ah, Luisa… ci risiamo, eh? Ti butti nel cuore come in un pozzo vuoto, e poi ti lamenti dell’eco.
Lui ti visualizza, poi sparisce, e tu senti salire la pressione sanguigna come se ti stesse caricando un peccato.
Ti parte un “madonna della miseria impestata!” così sincero che la lampada sfarfalla e il bicchiere applaude da solo.
Il gatto scappa, Alexa finge un aggiornamento di sistema, e tu bestemmi a mezza voce come se fosse una preghiera sbagliata.
Poi sorridi, bevi un sorso di rosso e dici: “ogni mia storia finisce con una bestemmia e un brindisi — ma almeno bevo meglio di come amo.”
La luna fuori ti guarda e, giuro, sembra che annuisca pure lei.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — esattamente come i tuoi due esempi
  const SYS_WHATIF = `
Sei "What If" — amico lucido e affettuoso.
SECONDA PERSONA. Un paragrafo, 7–9 frasi (~105–150 parole).
Immagini quotidiane; chiusura riflessiva breve. Niente elenchi, niente domande, niente emoji.
NON cambiare il tono: copia esattamente quello dei few-shot qui sotto.
`.trim();

  const FEWSHOTS = [
    { role: "system", content:
`WHAT IF — Analitico (realistico / sociale)
Domanda: E se tornassi a vivere all’Aquila?

Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.` },
    { role: "system", content:
`WHAT IF — Poetico (emotivo / narrativo)
Domanda: E se tornassi a vivere all’Aquila?

Bella questa, Luca — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.` },
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
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the EXACT persona voice shown in the few-shots. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni ESATTAMENTE la voce mostrata nei few-shot. SEED INTERNO: ${seedNum}.`;

    const hardRules = isEn(lang)
      ? `Hard lock: one paragraph; no questions; no lists; no emojis; no moralizing; no echo of the question; keep tempo and diction IDENTICAL to the few-shot voice.`
      : `Blocco duro: un paragrafo; niente domande; niente elenchi; niente emoji; niente prediche; niente eco della domanda; mantieni ritmo e lessico IDENTICI alla voce dei few-shot.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      { role: "system", content: hardRules },
      ...(fewshots || []),
      { role: "user", content: userPrompt },
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 9);
    answer = clampWords(answer, stile === "wtf" ? 170 : 155);
    answer = normalizeOneParagraph(answer);
    answer = (stile === "wtf") ? ensureSpicyButSafeWTF(answer) : answer;
    if (!/[.!?…]$/.test(answer)) answer += ".";

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
