// /api/ask.js — What?f Engine (2025 REDO)
// Stili: whatif (analitico | poetico) · wtf (demenziale affettuoso, imprecazioni “rustiche” variate)
// IT/EN: singolo paragrafo, niente liste/emoji. Niente nomignoli.
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto della domanda (metadati + hash non reversibile)

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

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
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

/* ---------- Imprecazioni rustiche (WTF) ---------- */
const IMP = [
  "porca di quella grappa fulminata",
  "santo spritz sgasato",
  "maledetta tazzina storta",
  "per la luna sbeccata",
  "vacca del semaforo",
  "per il gelo del Gran Sasso",
  "diamine del bancone traballante",
  "maremoto di Negroni",
  "per tutte le gomme sgonfie",
  "osti del parabrezza",
  "gran malora del caffè bruciato",
  "dannazione del tappo a vite",
];

/* ---------- Aperture confidenziali ---------- */
const OPEN_WHATIF = [
  "Sai, questa domanda era nell’aria da un po’, vero?",
  "Bella domanda — ci sta tutta.",
  "Ehi, lo sentivo che prima o poi te la saresti fatta.",
  "Ok, parliamone con calma: ne vale la pena.",
];
const OPEN_WTF = [
  "Oh, oggi domanda con il bicchiere pieno, eh?",
  "Eccoci: idea lucida come dopo il secondo giro.",
  "Ok, ci mettiamo comodi: hai acceso il jukebox delle decisioni.",
  "Va bene, tira su lo sgabello: si ragiona.",
];

/* ---------- Post-processing specifico WTF ---------- */
function ensureWTFSpice(text, seedNum) {
  let out = String(text || "").trim();
  // se manca almeno un'imprecazione, inseriscine una
  const hasImp = IMP.some((w) => out.toLowerCase().includes(w));
  if (!hasImp) {
    const pick = IMP[seedNum % IMP.length];
    // inserisci dopo la 3ª frase circa
    const parts = out.split(/(?<=[.!?])\s+/);
    const idx = clamp(2, 0, Math.max(0, parts.length - 2));
    parts[idx] = parts[idx].replace(/([,;:]?)(\s*)$/, ` — ${pick}!$1$2`);
    out = parts.join(" ");
  }
  // togli invettive isolate tipo “— … —” se sono l’ultima cosa
  out = out.replace(/(?:—|\-)\s*(?:porca|maledetta|vacca|diamine|dannazione|maremoto|osti)[^.!?]*[.!?]\s*$/i, (m) => m.trim().endsWith(".") ? m : m + ".");
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Write as if it already happened; prefer past/conditional. One paragraph. Keep the selected voice.`
      : `MODALITÀ: PASSATO / CONTROFATTUALE. Scrivi come se fosse già successo; preferisci passato/condizionale. Un paragrafo. Mantieni la voce scelta.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe near-future unfolding starting now. One paragraph. Keep the selected voice.`
    : `MODALITÀ: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile a partire da ora. Un paragrafo. Mantieni la voce scelta.`;
}

/* ---------- Personas ---------- */
function personaSystem(style, lang, whatifMode = "analitico") {
  if (style === "wtf") {
    const SYS = `
Scrivi in italiano come un amico di bar brillante e affettuoso: sarcastico, comico, ma mai offensivo.
Un paragrafo, 6–9 frasi, ritmo alto. Niente elenchi, niente emoji, niente domande retoriche in serie.
Apertura confidenziale da bancone (scegli una tra: ${OPEN_WTF.join(" · ")}).
Imprecazioni rustiche integrate nella frase (non isolate), 1–2 al massimo, variandole tra: ${IMP.join(" · ")}.
Inserisci piccole reazioni dell’ambiente/oggetti alla scena (es. bicchieri che tremano, lampioni che fischiano).
Chiudi con una doppia mini-punchline che rientra morbida.`;
    const FEWS = [
      { role: "system", content:
`ESEMPIO • Moto
Oh, oggi domanda con il bicchiere pieno, eh? Parti lucido come il casco nuovo e al primo semaforo il mondo decide che sei un cartone; un moscerino prende il dente per pista e ti scappa un “porca di quella grappa fulminata” che fa vibrare la visiera, il vento si ricompone in pettinatura da foto tessera, al bar ordini un Negroni e il bancone risponde col conto “per la luna sbeccata”, riparti e la curva ti perdona restituendoti la pelle d’oca buona, torni a casa con più storie che chilometri — e capisci che la libertà era a portata di polso — e di casco.` },
    ];
    return { sys: SYS.trim(), fewshots: FEWS };
  }

  if (whatifMode === "poetico") {
    const SYS = `
Italiano, voce da confidente. Un paragrafo, 8–11 frasi.
Apri con un commento confidenziale breve (es. “Bella questa — te la saresti fatta prima o poi.”).
Immagini quotidiane (aria, luce, bar, vicoli, montagna, mani, chiavi).
Niente nomignoli, niente elenchi, niente emoji. Chiusura pacata (non slogan).`.trim();
    const FEWS = [
      { role: "system", content:
`ESEMPIO • Tornare all’Aquila (poetico)
Bella questa — te la saresti fatta prima o poi. Riapri le finestre e l’aria fredda sa di legna e memoria; i vicoli ti riconoscono dal passo e le montagne ti guardano come se non te ne fossi mai andato. Il bar sotto casa serve ancora il caffè corto e ruvido, qualcuno ti chiama per nome come se il tempo avesse aspettato. I bambini imparano il calendario dalle stagioni, non dall’orologio. Le serate hanno il suono dei portoni che si chiudono e delle chiacchiere che restano sulla soglia. Ogni mattino è un inizio semplice; ogni sera è un pezzo di pace cucito al giorno. Non stai tornando indietro: stai tornando dove la corsa smette di comandare.` },
    ];
    return { sys: SYS, fewshots: FEWS };
  }

  // whatif analitico
  const SYS = `
Italiano, tono caldo e concreto. Un paragrafo, 8–11 frasi.
Apri con commento confidenziale breve (es. “Sai, questa domanda era nell’aria da un po’, vero?”).
Analizza: economia locale, lavoro, servizi, scuola, reti sociali, costo e qualità della vita; 1–2 frasi di confronto col Nord senza giudizio.
Niente nomignoli, niente elenchi, niente emoji. Chiudi con una riga sobria.`.trim();
  const FEWS = [
    { role: "system", content:
`ESEMPIO • Tornare all’Aquila (analitico)
Sai, questa domanda era nell’aria da un po’, vero? Tornare all’Aquila oggi vorrebbe dire rientrare in una città che ha cambiato pelle ma non respiro. La ricostruzione ha rimesso in moto artigiani e servizi a ritmo lento; meno industria, più impresa locale e università che trattiene giovani per scelta. Il costo della vita resta sotto il Nord, e anche gli stipendi: qui si guadagna meno ma si spende con più senso. Gli spostamenti sono brevi, l’aria è pulita, le reti di vicinato alleggeriscono le giornate. Scuola diffusa, sport legati alla montagna, sanità vicina con attese variabili. Il Veneto ti mancherebbe per mercato e velocità, ma qui ritrovi pressione più bassa e relazioni più dense. In pratica: meno rumore, più continuità; e la sera il silenzio non è vuoto, è spazio per respirare.` },
  ];
  return { sys: SYS, fewshots: FEWS };
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
    const token = String(req.headers["x-admin-token"] || "").trim();
    const admin = !!token;
    const bypass = admin;

    // PRO header (UI locale): x-pro: "1"
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

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
      name = "",             // nome opzionale (per saluto confidenziale)
      whatif_mode = "analitico", // "analitico" | "poetico" (richiesto per whatif)
      micro = {}
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, whatif_mode);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed per varietà stabile
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${whatif_mode}`), 36) % 1000000;

    const userPrompt = isEn(lang)
      ? `Question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". NAME="${name||""}". Style="${stile}" ${stile==="whatif"?`mode="${whatif_mode}"`:""}. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". NOME="${name||""}". Stile="${stile}" ${stile==="whatif"?`variante="${whatif_mode}"`:""}. SEED INTERNO: ${seedNum}.`;

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
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = normalizeOneParagraph(answer);

    // Intro confidenziale obbligatoria
    const introList = (stile === "wtf") ? OPEN_WTF : OPEN_WHATIF;
    const intro = introList[seedNum % introList.length];
    const nm = String(name || "").trim();
    const introWithName = nm ? intro.replace(/(Sai|Bella domanda|Ehi|Ok|Oh)/, "$1, " + nm) : intro;
    const startsProperly = /^[A-ZÀ-Ý][^.!?]{3,}[.!?]/.test(answer);
    if (startsProperly) {
      // se la prima frase non è chiaramente confidenziale, preprendila
      if (!/^(Sai|Bella|Ehi|Ok|Oh)\b/i.test(answer)) {
        answer = `${introWithName} ${answer}`;
      }
    } else {
      answer = `${introWithName}. ${answer}`;
    }

    // Limiti per stile
    if (stile === "wtf") {
      // 6–9 frasi, ~125–170 parole, spezie garantite
      answer = tightenSentences(answer, 9);
      answer = clampWords(answer, 170);
      answer = ensureWTFSpice(answer, seedNum);
    } else {
      // 8–11 frasi, ~115–170 parole
      answer = tightenSentences(answer, 11);
      answer = clampWords(answer, 170);
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // LOG (privacy-safe)
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        whatif_mode,
        name_present: !!name,
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
      await redis.hincrby("stats:whatif_mode", whatif_mode, 1);
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
      whatif_mode,
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
