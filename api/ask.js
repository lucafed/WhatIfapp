// /api/ask.js — What?f Engine (2025 FULL)
// Stili: whatif (analitico/poetico, confidenziale) · wtf (sarcasmo demenziale, oggetti, imprecazioni forti NON religiose)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA testo della domanda (solo metadati + hash non reversibile)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ---------- OpenAI ---------- */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

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
  if (ALLOWED_ORIGINS.includes(origin))
    res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const toStr = (v) => (v == null ? "" : String(v));

function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

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

// Generatore “imprecazioni” non-religiose (varie, ruvide, comiche)
const IMPRECATION_POOL = [
  "porca di quella grappa fulminata",
  "maledetta la porcaccia vacca",
  "santa padella sbeccata",
  "accidenti al destino coi tacchi",
  "mannaggia alla moka impazzita",
  "perdinci del parabrezza",
  "malora del frigo che canta",
  "bestia del contatore stitico",
  "sciagurata la sveglia ubriaca",
  "va’ in malora, spillatore stanco",
];
function randomImprecation(seedNum = 0) {
  const i = seedNum % IMPRECATION_POOL.length;
  return IMPRECATION_POOL[i];
}

// Verifica & “chiusura” wtf + sostituzione placeholder di imprecazione
function ensureSpicyButSafeWTF(t, lang, seedNum) {
  let out = String(t || "").trim();
  // nel testo l’AI può usare tag [IMPRECATION] come segnaposto: li rimpiazziamo
  out = out.replace(/\[IMPRECATION\]/g, randomImprecation(seedNum));
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}

function guessVariantFromQuestion(q = "", fallback = "poetico") {
  const s = q.toLowerCase();
  const analyticHints = ["costo", "costi", "stipend", "affitto", "lavoro", "scuola", "trasport", "qualità della vita", "econom", "bollette"];
  if (analyticHints.some(k => s.includes(k))) return "analitico";
  return fallback;
}

/* ---------- Admin check ---------- */
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const data = await redis.hgetall(`admin:token:${token}`); // { ip, ua }
    if (!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if (LOCK_IP) { if (!data.ip) return false; return data.ip === requesterIp; }
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Write as if the choice had been made back then; prefer past/conditional; keep ${style.toUpperCase()} voice; single paragraph; no lists/questions/emojis.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Scrivi come se la scelta fosse stata fatta allora; prediligi passato/condizionale; mantieni la voce ${style.toUpperCase()}; paragrafo unico; niente elenchi/domande/emoji.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding now; keep ${style.toUpperCase()} voice; single paragraph; no lists/questions/emojis.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile adesso; mantieni la voce ${style.toUpperCase()}; paragrafo unico; niente elenchi/domande/emoji.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, variant = "poetico") {
  const en = isEn(lang);

  if (style === "wtf") {
    // WHAT THE F — sarcasmo demenziale, apertura “scivolata”, oggetti reattivi, imprecazione organica
    const SYS = en ? `
You are “What the F” — a loud, loving bar-friend who roasts the user with affection.
VOICE: sarcastic, goofy, fast, but human. SECOND PERSON. ONE paragraph (6–10 sentences, ~130–190 words).
Start by sliding into the scene tied to the question (no lists, no questions, no emojis). Keep it cohesive.
Include ONE strong non-religious imprecation INLINE (use the placeholder [IMPRECATION] exactly once; we'll swap it later).
Let at least one object or bystander react to it comically.
Keep alcohol beats natural (grappa, spritz, negroni) only if relevant.
NEVER use slurs or religious blasphemy. No moralizing. End with a warm-funny shrug line.
` : `
Sei “What the F” — l’amico da bar che ti vuole bene e ti prende in giro con affetto.
VOCE: sarcastica, demenziale, rapida ma umana. SECONDA PERSONA. UN paragrafo (6–10 frasi, ~130–190 parole).
Entra “scivolando” dentro la domanda e resta sempre dentro la scena (niente elenchi, niente domande, niente emoji).
Inserisci UNA imprecazione forte NON religiosa in MEZZO alla narrazione usando il segnaposto [IMPRECATION] (lo sostituiamo noi).
Fai reagire almeno un oggetto o qualcuno nei dintorni in modo comico.
Alcol ok se serve (grappa, spritz, negroni), ma non forzare.
Mai insulti pesanti o blasfemia religiosa. Chiudi con una riga calda e divertente.
`;

    // FEWSHOTS (in stile esatto degli esempi concordati)
    const FEWSHOTS = [
      { role: "system", content:
`IT • Moto (futuro, wtf)
Scivoli nell’idea come se fosse una curva già tua: ti immagini casco lucido, posa da eroe e colonna sonora in testa, poi la prima rotonda ti tratta da principiante e il parcheggio ti umilia con delicatezza olimpica; fai finta di niente, ma dal casco ti scappa un [IMPRECATION] che rimbalza sul parabrezza e il cestino delle cartacce tossisce per farti notare che ti sta guardando, entri al bar per riprendere dignità, il bancone ti lucida come fossi argenteria della domenica e ordini “solo un sorso” che diventa tre, il barista alza il sopracciglio come un semaforo arancione infinito, esci di nuovo e la moto parte al primo colpo: ti basta il vento per credere che stai già meglio, e in fondo lo sai — oggi non hai comprato una moto, hai comprato un pretesto per ridere di te mentre vai avanti.` },
      { role: "system", content:
`IT • Amore (futuro, wtf)
Ci entri piano, come chi sa che si farà male ma vuole vedere il panorama: due messaggi e il telefono diventa specchio, ti sistemi i pensieri come sedie al bar e giuri “questa volta passo lento”, poi ti tradisce la mano, invii al gruppo sbagliato e parte un [IMPRECATION] che fa vibrare i bicchieri, lo zuccheriere applaude senza zucchero, il cucchiaino cade in piedi come un ginnasta in finale, chiedi un giro per cura d’anima e la grappa ti dà del tu, ma quando esci l’aria è più larga, cammini con meno rumore dentro e ti viene da sorridere: non hai riaperto il cuore, gli hai solo tolto le rotelle e adesso decide lui quanto andare veloce.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — due varianti: analitico / poetico
  if (variant === "analitico") {
    const SYS = en ? `
You are "What If" — lucid, kind, grounded. SECOND PERSON. ONE paragraph (8–12 sentences, ~130–190 words).
Open with a short confidential remark to the user (by first name if known in context).
Be realistic: economy, cost of living, jobs, schools/services, social fabric, pace/quality of life. Small truths, no drama.
No lists, no questions, no emojis. End with a short reflective line.
` : `
Sei "What If" — lucido, affettuoso, concreto. SECONDA PERSONA. UN paragrafo (8–12 frasi, ~130–190 parole).
Apri con una breve frase confidenziale al lettore (puoi usare il nome se emerge dal contesto).
Sii realistico: economia, costo della vita, lavoro, servizi/scuola, tessuto sociale, ritmo/qualità della vita. Verità piccole, senza melodrammi.
Niente elenchi, niente domande, niente emoji. Chiudi con una riga riflessiva breve.
`;
    const FEWSHOTS = [
      { role: "system", content:
`IT • Tornare all’Aquila (analitico)
Sai, questa domanda era nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rientrare in una città che ha cambiato pelle ma non respiro: ricostruzione solida, economia che cammina piano, più reti locali che grandi industrie. Il costo della vita è più basso del Nord, così come gli stipendi: qui si guadagna meno, ma spesso si spende con più senso. I servizi ci sono, magari non ovunque con la stessa velocità, ma la distanza tra le persone accorcia molte pratiche. La scuola ha il passo delle stagioni, non delle scadenze; i ritmi sono umani, e la montagna rimette a posto le proporzioni. Ti mancherà il rumore efficiente del Veneto, ma scopriresti che la quiete non è silenzio: è spazio per respirare davvero.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  } else {
    const SYS = en ? `
You are "What If" — warm, slightly poetic but grounded. SECOND PERSON. ONE paragraph (8–12 sentences, ~130–190 words).
Open with a short confidential line to the user (by first name if known).
Use everyday images (keys, lamps, notebooks, hands, air). Small truths; no heroics.
No lists, no questions, no emojis. End with a short reflective line.
` : `
Sei "What If" — caldo, un po’ poetico ma concreto. SECONDA PERSONA. UN paragrafo (8–12 frasi, ~130–190 parole).
Apri con una riga confidenziale all’utente (usa il nome se è nel contesto).
Usa immagini quotidiane (chiavi, lampioni, taccuini, mani, aria). Verità piccole; niente eroismi.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve.
`;
    const FEWSHOTS = [
      { role: "system", content:
`IT • Tornare all’Aquila (poetico)
Bella questa — lo sapevi che prima o poi arrivava. Riapri le finestre e l’aria fredda sa di legna e memoria; le strade ti riconoscono al passo, le montagne ti guardano come se non te ne fossi mai andato. Il bar sotto casa torna a servirti il caffè corto e ruvido, e il tuo nome scivola tra i rumori come fosse rimasto in attesa. I bambini imparano il ritmo delle stagioni, la lentezza che non spreca i giorni; tu riprendi a tenere le chiavi dove stanno davvero. La sera, quando chiudi le imposte, senti un silenzio intero: non è un tornare indietro, è tornare dove la vita aveva smesso di correre.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    // IP richiedente
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // Admin bypass (rate+crediti)
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;

    // PRO flag
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit 10/min
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // Body: supporta minimal ({question, style}) e full
    const raw = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const domanda = toStr(raw.question || raw.domanda || "");
    if (!domanda) return res.status(400).json({ error: "bad_request", detail: "question_required" });

    const stile = toStr((raw.style || raw.stile || "whatif")).toLowerCase(); // "whatif" | "wtf"
    const lang  = toStr(raw.lang || (req.headers["accept-language"] || "it")).slice(0,2);
    const periodo = toStr(raw.periodo || raw.period || "future").toLowerCase(); // "future" | "past"
    const extra = toStr(raw.extra || "");
    const micro = raw.micro || {};
    const sex   = toStr(raw.sex || (micro && micro.sex) || "");
    // variante What if: "analitico" | "poetico"
    let variant = toStr(raw.variant || raw.substyle || "");
    if (!variant && stile === "whatif") variant = guessVariantFromQuestion(domanda, "poetico");

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

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, variant);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed deterministico
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${variant}`), 36) % 1000000;

    // “Frase magica”: imita esattamente gli esempi, niente eco, niente liste
    const magic = isEn(lang)
      ? `Emulate exactly the tone, rhythm, and lexicon of the few-shot examples above. Single paragraph only; no lists; no questions; do NOT restate the user’s question.`
      : `Rispetta esattamente tono, ritmo e lessico degli esempi sopra. Solo paragrafo unico; niente elenchi; niente domande; NON ripetere la domanda dell’utente.`;

    // Prompt utente (con contesto)
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${extra}". MICRO: ${JSON.stringify(micro)}. SEX: "${sex||"unknown"}". INTERNAL SEED: ${seedNum}.`
      : `Domanda: "${domanda}". Contesto: "${extra}". MICRO: ${JSON.stringify(micro)}. SESSO: "${sex||"unknown"}". SEED INTERNO: ${seedNum}.`;

    // Compose messages
    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "system", content: magic },
      // Regole dure aggiuntive per WTF
      ...(stile === "wtf" ? [{
        role: "system",
        content: isEn(lang)
          ? `WTF RULES: Use the placeholder [IMPRECATION] exactly once; we'll replace it with a non-religious strong imprecation. Keep it inside the flow, with at least one funny reaction from objects/people.`
          : `REGOLE WTF: usa il segnaposto [IMPRECATION] esattamente una volta; lo sostituiamo noi con un’imprecazione forte non religiosa. Tienila dentro il flusso, con almeno una reazione comica di oggetti/persone.`
      }] : []),
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 420,
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,
      presence_penalty: stile === "wtf" ? 0.25 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 10 : 12);
    answer = clampWords(answer, stile === "wtf" ? 190 : 190);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") {
      answer = ensureSpicyButSafeWTF(answer, lang, seedNum);
    } else {
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        variant: stile === "whatif" ? variant : null,
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
      if (variant && stile === "whatif") await redis.hincrby("stats:variant", variant, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch (e) {
      console.warn("log failure (non-bloccante)", e);
    }

    return res.status(200).json({
      answer,
      style: stile,
      variant: stile === "whatif" ? variant : null,
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
