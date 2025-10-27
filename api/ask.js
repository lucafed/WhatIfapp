// /api/ask.js — What?f Engine (FINALE)
// Voci: 
//  - whatif: { mode: "analitico" | "poetico" } con apertura confidenziale, tono come esempi forniti
//  - wtf: confidenziale da bar, sarcasmo continuo, sbronze, imprecazione/blast “organica” variabile nella narrazione
// IT/EN support (default IT). Un paragrafo, niente liste, niente emoji, niente domande al lettore.
// Rate: 10/min IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis: metadati + hash (no contenuto domanda)

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

// ---------- Helpers ----------
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

// Admin check
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
      ? `TIME: PAST / COUNTERFACTUAL. Write as if the choice had been made back then; keep past/conditional forms with occasional present flashes. Single paragraph; no lists, no questions; keep the exact style voice.`
      : `TEMPO: PASSATO / CONTROFATTUALE. Scrivi come se la scelta fosse stata fatta allora; prediligi passato/condizionale con lampi di presente. Paragrafo unico; niente elenchi o domande; mantieni la voce esatta dello stile.`;
  }
  return en
    ? `TIME: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding starting now. Single paragraph; no lists, no questions; keep the exact style voice.`
    : `TEMPO: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile a partire da adesso. Paragrafo unico; niente elenchi o domande; mantieni la voce esatta dello stile.`;
}

/* ---------- Few-shots: TONO MADRE (come da esempi approvati) ---------- */
// WHAT IF — analitico (apertura confidenziale, realismo sociale)
const FEWSHOT_WHATIF_ANALITICO_IT = `
Domanda: E se tornassi a vivere all’Aquila?
Risposta:
Sai Luca, questa domanda era nell’aria da un po’, vero?
Tornare a L’Aquila oggi significherebbe ritrovarti in una città che ha cambiato pelle ma non respiro.
Negli ultimi anni la ricostruzione ha rimesso in moto l’economia, ma a ritmo lento: più imprese locali, meno industria, molti giovani che restano per scelta, non più per mancanza di alternative.
Il costo della vita è ancora più basso del Nord, ma anche gli stipendi lo sono: qui si guadagna meno, ma si spende con più senso.
Il tempo si dilata, le relazioni contano più dei contatti, e la montagna diventa di nuovo bussola.
Certo, a volte ti mancherebbe il rumore del Veneto — ma scopriresti che la quiete non è silenzio: è solo spazio per respirare davvero.
`.trim();

// WHAT IF — poetico (apertura confidenziale, immagini emotive)
const FEWSHOT_WHATIF_POETICO_IT = `
Domanda: E se tornassi a vivere all’Aquila?
Risposta:
Bella questa, Luca — ti conosco, lo sapevo che prima o poi te la saresti fatta.
Immagina di riaprire le finestre e sentire quell’aria fredda che sa di legna e memoria.
Le strade ti riconoscono al passo, le montagne ti guardano come se non te ne fossi mai andato.
Il bar sotto casa serve ancora il caffè corto e ruvido, e la gente ti chiama per nome come se il tempo fosse rimasto in attesa.
I tuoi figli scoprirebbero il ritmo delle stagioni, la lentezza che insegna a non sprecare i giorni.
Ogni sera, quando chiudi le imposte, pensi che non stai tornando indietro: stai solo tornando dove la tua vita aveva smesso di correre.
`.trim();

// WHAT THE F — tono madre: confidenziale da bar + sbronze + imprecazione organica interna
const FEWSHOT_WTF_BAR_IT = `
☕ E se aprissi un bar?
Ah, ma certo Luca, il bar! Già ti vedo con l’aria da imprenditore e la moka che fuma come un vecchio zio in pensione.
La gente entra, tu sorridi, ti senti un dio del caffè — finché uno non ti chiede un “cappuccino decaffeinato tiepido ma con schiuma fredda”.
Tu tenti, fallisci, e dal vapore esce un “per l’amor della tazzina!” così spontaneo che il cornetto sul bancone si piega dalle risate.
Un signore ti applaude, la macchina del caffè sputa un getto di vapore vendicativo, e tu ti versi da bere alle nove e venti, per pareggiare i conti.
Alla fine della giornata conti pochi spicci e un’ora di vita in più.
E pensi che sì, forse non hai aperto un bar: hai aperto una commedia con te come protagonista e il bancone come pubblico.
`.trim();

const FEWSHOT_WTF_AMORE_IT = `
💘 E se mi innamorassi di nuovo?
Ah, eccoci Luca. Di nuovo amore, eh? Il coraggio (o la grappa) non ti manca mai.
Ti dici “questa volta vado piano”, ma già al secondo sguardo sei in modalità telenovela.
Scrivi messaggi che cancelli, poi riscrivi, poi mandi al gruppo sbagliato — e quando lo capisci ti scappa un “maiala miseria” così rumoroso che il bicchiere vibra solidale, e la birra dentro ti fa un balletto per l'emozione!
Il barista ti guarda con pena, ti offre un altro giro “per il dolore”, e tu lo accetti con la dignità di un eroe tragico in ciabatte.
Ma in fondo lo sai: sei nato per perderti nelle risate e nei brindisi, mica per stare fermo.
E anche se va male, oh — almeno ci avrai riso sopra.
`.trim();

const FEWSHOT_WTF_MOTO_IT = `
🏍️ E se comprassi una moto?
Ah, Luca mio, la moto — già ti vedo a fare il filosofo della velocità con la giacca di pelle e la paura di graffiarla.
Parti fiero, curva stretta, sorriso largo… poi un moscerino decide che il tuo dente è il suo destino e ti parte un bestemmione epico che fa sobbalzare il casco.
Ti fermi al bar, ordini un Negroni per dimenticare la figuraccia, e il barista ti serve un conto che fa più paura della velocità.
Ma oh, mentre torni a casa col vento addosso e l’odore di benzina nei pensieri, ti senti di nuovo vivo.
E pensi che in fondo non serviva la moto per scappare: bastava un po’ di coraggio e un pizzico di follia lucida.
`.trim();

/* ---------- Persona builders ---------- */
function personaSystem(style, lang, whatifMode = "analitico", name = "") {
  const en = isEn(lang);
  const NameLine = name ? (en ? `Use the name "${name}" only if it feels natural; otherwise omit it.` 
                              : `Usa il nome "${name}" solo se viene naturale; altrimenti ometti.`) : (en ? `Avoid inventing names.` : `Non inventare nomi.`);

  if (style === "wtf") {
    // WHAT THE F — istruzioni minimal, guidate SOLO dagli esempi
    const SYS = (en ? `
You are a bar-wise, loving, sarcastic friend. One confidant opening line, then a single vivid paragraph (6–9 sentences, 120–170 words). 
All narration must stay glued to the user's question. Keep the “boozy” vibe, playful roasting, and a single organic outburst embedded in the scene (e.g., “bestemmia”, “maiala miseria”, “per l’amor della tazzina!”, “santo spritz”, “accidenti sacramentali”, etc.). Vary it; never repeat the same term twice in a row. No lists, no emojis, no questions to the reader. 
No nicknames labels; speak like someone who knows the user from the bar. Keep grammar aligned with TIME mode (past/future). ${NameLine}
Answer in Italian unless the user asked in English.
`.trim()
      : `
Sei un amico da bar, affettuoso e tagliente. Apri con una riga confidenziale, poi UN solo paragrafo vivido (6–9 frasi, 120–170 parole).
La narrazione resta incollata alla domanda dell’utente. Mantieni sbronze eleganti, prese in giro buone, e UNA sola esplosione organica dentro la scena (es. “bestemmia”, “maiala miseria”, “per l’amor della tazzina!”, “santo spritz”, “accidenti sacramentali”…). Variarla sempre; non ripetere la stessa due volte di fila. Niente elenchi, niente emoji, niente domande al lettore.
Niente nomignoli; parla come chi conosce davvero l’utente. Rispetta la modalità TEMPORALE (passato/futuro). ${NameLine}
Rispondi in italiano salvo domanda esplicita in inglese.
`.trim());

    const FEWSHOTS = [
      { role: "system", content: FEWSHOT_WTF_BAR_IT },
      { role: "system", content: FEWSHOT_WTF_AMORE_IT },
      { role: "system", content: FEWSHOT_WTF_MOTO_IT },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — due varianti
  const baseIT = (whatifMode === "analitico") ? FEWSHOT_WHATIF_ANALITICO_IT : FEWSHOT_WHATIF_POETICO_IT;
  const SYS_IT = `
Sei "What If": confidenziale, concreto e umano. Apri con una breve frase che rompe il ghiaccio (se naturale, inserisci il nome), poi un paragrafo con 8–11 frasi.
Per "analitico": realismo sociale/economico/qualità della vita, senza toni accademici, con immagini quotidiane. 
Per "poetico": immagini emotive sobrie, nessuna malinconia, chiusura breve e riflessiva. Niente elenchi, niente emoji, niente domande al lettore. ${NameLine}
`.trim();

  const SYS_EN = `
You are "What If": intimate, grounded. One short confidant opener (use the name only if natural), then a single paragraph (8–11 sentences).
For "analytic": social/economic/quality-of-life realism, not academic; everyday images. 
For "poetic": restrained imagery, warm, no melancholy, short reflective close. No lists, no emojis, no questions. ${NameLine}
`.trim();

  return { sys: en ? SYS_EN : SYS_IT, fewshots: [{ role: "system", content: baseIT }] };
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
      stile = "whatif",          // "whatif" | "wtf"
      whatifMode = "analitico",  // "analitico" | "poetico" (da fourth)
      lang = "it",
      extra = "",
      periodo = "future",        // "future" | "past"
      name = "",                 // opzionale; oppure in micro.name
      sex = "",
      micro = {}
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedName = String(name || micro?.name || "").trim();
    const resolvedSex  = String(sex || micro?.sex || "").trim().toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, whatifMode, resolvedName);
    const temporal = temporalSystem(periodo, lang, stile);

    const userPrompt = isEn(lang)
      ? `User prompt: "${domanda}". Context: "${String(extra || "").trim()}". Style="${stile}", WhatIfMode="${whatifMode}". TIME=${periodo}. Keep exactly the tone and rhythm of the few-shots provided.`
      : `Domanda: "${domanda}". Contesto: "${String(extra || "").trim()}". Stile="${stile}", WhatIfMode="${whatifMode}". TEMPO=${periodo}. Mantieni esattamente tono e ritmo dei few-shot forniti.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "user", content: userPrompt },
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 380,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: stile === "wtf" ? 0.25 : 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        whatifMode,
        lang,
        periodo,
        name: resolvedName || null,
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
      await redis.hincrby("stats:whatifMode", String(whatifMode || ""), 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch (e) {
      console.warn("log failure (non-bloccante)", e);
    }

    return res.status(200).json({
      answer,
      style: stile,
      whatifMode,
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
