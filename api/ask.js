// /api/ask.js — What?f Engine (CLEAN • FEW-SHOT ONLY)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale affettuoso, alcol, oggetti, imprecazioni creative non religiose)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto della domanda (solo metadati + hash non reversibile)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ---------- OpenAI ---------- */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Upstash ---------- */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// rate limit: 10 req/min per IP (bypass SOLO per admin)
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

/* ---------- CORS ---------- */
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

/* ---------- Modalità temporale (concisa, no regole extra) ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if it already happened. Keep exactly the voice from the examples for ${style.toUpperCase()}.`
      : `MODALITÀ: PASSATO / CONTROFATTUALE. Parla come se fosse già successo. Mantieni esattamente la voce degli esempi per ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future. Keep exactly the voice from the examples for ${style.toUpperCase()}.`
    : `MODALITÀ: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile. Mantieni esattamente la voce degli esempi per ${style.toUpperCase()}.`;
}

/* ---------- Personas (solo frase magica + FEW-SHOT) ---------- */
function personaSystem(style, lang) {
  const en = isEn(lang);

  const MAGIC = en
    ? `Speak and keep speaking EXACTLY like the following examples. Same tone, rhythm, register, imagery, openings and closings. Do not explain rules. One tight paragraph. No lists. No questions. No emojis.`
    : `Parla e continua a parlare ESATTAMENTE come gli esempi seguenti. Stesso tono, ritmo, registro, immagini, aperture e chiusure. Non spiegare regole. Un paragrafo compatto. Niente elenchi. Niente domande. Niente emoji.`;

  if (style === "wtf") {
    // --- WHAT THE F — ESEMPI UFFICIALI ---
    const FEWSHOTS = [
      { role: "system", content: MAGIC },

      { role: "system", content:
`WHAT THE F • E se aprissi un bar?
Ah, ma guarda un po’, Luca… il genio dell’espresso che si sveglia con la vocazione imprenditoriale. Ti vedo: grembiule nuovo, sorriso da spot pubblicitario, la moka che sibila come un vecchio nonno stanco di vivere. Arriva il primo cliente, ti chiede un cappuccino “senza schiuma, ma caldo, però freddo dentro” e già ti parte la pressione. Tentando l’impossibile, ti bruci un dito, ti scappa un “porca di quella schiuma sorda e bastarda!” che fa tremare le tazzine e il cucchiaino cade in sciopero. Il frigo rantola, la macchina del caffè fa un ruttino di protesta, e una vecchietta ti guarda come se avessi bestemmiato in latino. Tu le sorridi, versi grappa nel caffè e pensi: “almeno oggi ho aperto un locale che fa ridere anche i mobili”. Quando chiudi la sera, il bancone ti dice “ce la rifacciamo domani, capo?” — e tu annuisci, col fegato in disarmo ma il morale alto.` },

      { role: "system", content:
`WHAT THE F • E se comprassi una moto?
Ah, eccoci, Luca mio, il nuovo Valentino del parcheggio condominiale. Ti presenti con la giacca di pelle lucida, casco nuovo e l’orgoglio che fa attrito. Accendi il motore, romba come un drago epilettico e già ti senti immortale. Poi un piccione ti taglia la strada e parte un “porca di quella frizione ubriaca e maledetta!” che rimbalza sui muri del quartiere. Un passante applaude, un cane ulula in do maggiore e il semaforo si gira dall’altra parte per la vergogna. Riparti come se nulla fosse, ma il cavalletto resta giù e ti fa un colpo basso: “mannaggia al ferro storto che ti ha creato!”. Ti fermi al bar, ordini un Negroni, e il barista ti versa due dita extra “per compassione”. Alla fine ridi, bestemmi piano un’altra volta, e capisci che la moto non era un mezzo per scappare — era solo un modo elegante per cadere in grande stile.` },

      { role: "system", content:
`WHAT THE F • E se mi innamorassi di nuovo? (versione femminile)
Ah, Luisa… di nuovo tu, eh? Giuro che ogni volta che dici “stavolta ci penso bene”, un prosecco stappa da solo da qualche parte. Ti vedo: vestita bene ma con l’occhio lucido, messaggi che cancelli e riscrivi come se stessi trattando un’adozione internazionale. Poi lui ti visualizza e non risponde — e ti scappa un “porca di quella chat maledetta e dell’algoritmo suo zio!” così forte che Siri finge un malfunzionamento per non sentirti. La lampada vibra, il gatto si rifugia dietro la lavatrice, e il bicchiere di vino si riempie da solo per compassione. Tu sospiri, bestemmi piano con grazia da signora disperata, e dici “vabbè, almeno stavolta sapevo dove mi andavo a schiantare”. Alla fine, tra una risata e un rutto di rosé, capisci che innamorarsi è come un aperitivo: sai che finirà male, ma ci vai lo stesso perché almeno fino all’ultimo sorso è vita vera.` },

      { role: "system", content:
`WHAT THE F • Moto (versione compatta, doppia reazione)
Oh, oggi domanda con il bicchiere pieno, eh? Parti lucido come il casco nuovo e al primo semaforo il mondo decide che sei un cartone animato; un moscerino prende il dente per pista e ti scappa un “porca di quella grappa fulminata” che fa vibrare la visiera. Il vento, offeso, si ricompone in pettinatura da foto tessera. Al bar ordini un Negroni per rimettere insieme la dignità e il bancone risponde col conto, “per la luna sbeccata”. Riparti, la città ti fischia come un vecchio arbitro, ma la curva ti perdona e ti restituisce la pelle d’oca buona. Torni a casa con più storie che chilometri nel serbatoio — e capisci che la libertà era a portata di polso. — E di casco. — E di autoironia.` },
    ];
    return { sys: MAGIC, fewshots: FEWSHOTS };
  }

  // --- WHAT IF — ESEMPI UFFICIALI ---
  const FEWSHOTS = [
    { role: "system", content: MAGIC },

    { role: "system", content:
`WHAT IF • Analitico (Aquila)
Sai Luca, questa domanda era nell’aria da un po’, vero? Tornare all’Aquila oggi vorrebbe dire rientrare in una città che ha cambiato pelle ma non respiro. La ricostruzione ha rimesso in moto artigiani e servizi, a ritmo lento ma costante; meno industria, più impresa locale e università che trattiene giovani per scelta. Il costo della vita resta sotto il Nord, e anche gli stipendi: qui si guadagna meno ma si spende con più senso. La qualità dell’aria, i tempi corti degli spostamenti e le reti di vicinato alleggeriscono le giornate. La scuola è diffusa, le attività sportive ruotano attorno alla montagna, la sanità è vicina ma con liste d’attesa variabili. Il Veneto ti mancherebbe per velocità e mercato, certo, ma qui ritroveresti una pressione più bassa e relazioni più dense. In pratica: meno rumore, più continuità. E quando chiudi casa la sera, senti che il silenzio non è vuoto — è spazio per respirare davvero.` },

    { role: "system", content:
`WHAT IF • Poetico (Aquila)
Bella questa, Luca — te la saresti fatta prima o poi. Riapri le finestre e l’aria fredda sa di legna e memoria. I vicoli ti riconoscono dal passo, le montagne ti guardano come se non te ne fossi mai andato. Il bar sotto casa serve ancora il caffè corto e ruvido, e qualcuno ti chiama per nome come se il tempo avesse aspettato. I bambini imparano il calendario dalle stagioni, non dall’orologio. Le serate hanno il suono dei portoni che si chiudono e delle chiacchiere che restano sulla soglia. Ogni mattino è un inizio semplice; ogni sera è un pezzo di pace cucito al giorno. Non stai tornando indietro: stai solo tornando dove la corsa smette di comandare.` },
  ];
  return { sys: MAGIC, fewshots: FEWSHOTS };
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
      sex = "",
      micro = {}
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang);
    const temporal = temporalSystem(periodo, lang, stile);

    // Prompt utente minimo (niente eco, niente regole extra)
    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Micro: ${JSON.stringify(micro||{})}. Keep EXACTLY the examples' voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Micro: ${JSON.stringify(micro||{})}. Mantieni ESATTAMENTE la voce degli esempi.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 380,
      frequency_penalty: 0.2,
      presence_penalty: 0.1,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 175 : 165);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        sex: String(sex || micro?.sex || "").toLowerCase() || null,
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
      if (entry.sex) await redis.hincrby("stats:sex", entry.sex, 1);
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
