// /api/ask.js — What?f Engine (2025 • persona-aware + Jung + gritty WTF)
// Compatibile con la tua struttura in /api (Next.js API Route)

// ---------- OpenAI ----------
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// ---------- Upstash ----------
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if it already happened. Prefer past/conditional. No lists, no questions, no echo. Keep ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Scrivi come se fosse già successo. Preferisci passato/condizionale. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near future as if entering it now. No lists, no questions, no echo. Keep ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Gritties (imprecazioni teatrali) ---------- */
// UNA per risposta, posizionata dal modello (non letterale: è una “narrazione”).
const GRITTY_IT = [
  "(bestemmia epica non trascritta che fa vibrare i bicchieri)",
  "(urlo sacro che buca le nuvole e torna indietro con l’eco)",
  "(imprecazione baritonale che sgrana il destino)",
  "(rutto mondiale in surround, le sedie si guardano complici)",
  "(scoppio d’anima, mezz’ora di silenzio dopo)"
];
const GRITTY_EN = [
  "(holy meltdown of the century, glasses rattle)",
  "(divine facepalm in Dolby Atmos, thunder chuckles)",
  "(cathedral-grade outburst, the streetlights blink)",
  "(mythic baritone curse, the sky pretends not to hear)",
  "(cosmic belch in surround, destiny loses balance)"
];
function gritty(lang) { return (isEn(lang) ? GRITTY_EN : GRITTY_IT); }

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "", registro = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const nickIT = (SEX === "f")
    ? ["regina del casino","fenomena","capitana del caos","sirena urbana","signora dei forse","rockstar con tacchi comodi"]
    : (SEX === "m")
      ? ["campione","fenomeno","capitano del caos","poeta del bar","asso di giornata","viaggiatore consumato"]
      : ["leggenda","asso universale","cap* del caos","astronauta del dubbio","icon* di periferia"];
  const nickEN = (SEX === "f")
    ? ["queen of chaos","legend in sneakers","captain of detours","saint of side quests"]
    : (SEX === "m")
      ? ["champ","captain of chaos","bar poet","grizzled legend"]
      : ["icon","ace","captain of chaos","wanderer"];

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — seasoned, theatrical, rough-around-the-edges but loving.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words).
OPEN with ONLY a nickname (no verbs). No catchphrases. Never write literal religious slurs.
Exactly one gritty, narrated outburst (choose from this bank and place where tension peaks):
${gritty(lang).join(" · ")}.
Objects can ‘react’ when relevant. Alcohol beats ok.
End warm with a smirk. No lists, no questions, no emojis. Respect TEMPORAL MODE.
Nicknames (EN): ${nickEN.join(", ")}.
`.trim()
      : `
Sei “What the F” — voce vissuta, teatrale, affettuosa e sfrontata.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole).
APRI con SOLO un nomignolo (niente verbi). Niente tormentoni fissi. Mai scrivere bestemmie letterali.
Inserisci esattamente una esplosione narrata, scegliendola da qui:
${gritty(lang).join(" · ")}.
Gli oggetti possono “reagire” quando ha senso. Alcol ok.
Chiudi caldo con una smorfia. Niente elenchi, niente domande, niente emoji. Rispetta la MODALITÀ TEMPORALE.
Nomignoli (IT): ${nickIT.join(", ")}.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Mettersi in proprio (futuro)
Capitano del caos, arrivi col piano che sembra un tovagliolo firmato; l’Excel ti guarda come un cameriere stanco, due clienti tornano e la vetrina si raddrizza; stappi “la buona” ed è aceto onesto: brucia, battezza l’errore, (bestemmia epica non trascritta che fa vibrare i bicchieri), il bancone ride “anche oggi imprenditore”; la sera conti spicci e fiato e capisci che non stai vincendo il mondo, stai reggendo te.` },
      { role: "system", content:
`EXAMPLE EN • Changing city (future)
Champ, you arrive like a pilot episode and the buzzer sighs; the fridge hums “good luck”, you walk too far to tire the nerves, a small beer forgives your accent, (holy meltdown of the century, glasses rattle), by grocery three you find your aisle and your pace; you’re not conquering a city, you’re landing your life.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF
  const REG = String(registro || "").toLowerCase(); // realistico | poetico | analitico
  const baseIT = `
Sei "What If": amico lucido e affettuoso.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (115–160 parole).
Immagini quotidiane, vocabolario vario. Niente elenchi, domande o emoji.
Chiudi con una riga riflessiva breve (non un consiglio).
`.trim();
  const regIT = (REG === "poetico") ? "Registro: POETICO — immagini sobrie, suono morbido, verbi precisi."
              : (REG === "analitico") ? "Registro: ANALITICO — criteri concreti, micro-schema mentale, verbi operativi."
              : "Registro: REALISTICO — terra-terra, dettagli veri, zero enfasi superflua.";
  const baseEN = `
You are "What If": lucid, kind, grounded friend.
SECOND PERSON. One paragraph, 8–11 sentences (115–160 words).
Everyday imagery, varied vocabulary. No lists, no questions, no emojis.
End with a short reflective line (not advice).
`.trim();
  const regEN = (REG === "poetico") ? "Register: POETIC — restrained imagery, clean rhythm, precise verbs."
              : (REG === "analitico") ? "Register: ANALYTICAL — concrete criteria, tiny mental schema, action verbs."
              : "Register: REALISTIC — down-to-earth, tangible details, no fuss.";

  const SYS_WHATIF = isEn(lang) ? `${baseEN}\n${regEN}` : `${baseIT}\n${regIT}`;

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (realistico)
Tornare non sarebbe un passo indietro ma un passo fatto meglio. Ti stupirebbe la memoria delle strade: tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi capisci che ti rimettono in orario. Le chiavi tornano sul piattino giusto e il bar impara di nuovo il tuo caffè. A sera l’aria è più semplice del previsto. E scopri che cambiare non è fuggire: è scegliere cosa tenere.` },
    { role: "system", content:
`EXAMPLE EN • Move city (analytical)
Start by mapping rent, commute, support network, and growth options. Give each a weight now, and another in six months; see if the delta matches your gut. Keep one ritual from today to anchor the change. Lose one habit that kept you stuck. If the map and the stomach agree twice, you’ve got enough to step.` },
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
}

/* ---------- Jung mapping (dal micro profilo) ---------- */
function jungHints(micro = {}, lang = "it") {
  const t = String(micro?.decide || "").toLowerCase();
  const mood = String(micro?.mood || "").toLowerCase();
  const anchor = String(micro?.anchor || "").toLowerCase();
  const z = String(micro?.zodiac || "").toLowerCase();

  // Punteggi semplici per Thought/Feeling/Intuition/Sensation
  let T=0,F=0,N=0,S=0;
  if (/lista|pro|contro|schema|deadline|scadenza|list|pros|cons|deadline/.test(t)) T+=2;
  if (/pancia|cuore|amico|friend|gut/.test(t)) F+=2;
  if (/curios|immagin|vibes|lucky/.test(anchor+z)) N+=1;
  if (/routine|bollette|money|spesa/.test(anchor)) S+=1;
  if (/calmo|quiet|solid|silenzio/.test(mood)) S+=1;
  if (/irrequieto|restless|chatty|light/.test(mood)) N+=1;

  const label = (isEn(lang)
    ? `Jung tilt → T:${T} F:${F} N:${N} S:${S}`
    : `Jung tilt → T:${T} F:${F} N:${N} S:${S}`);

  const steer = (isEn(lang)
    ? `Balance the tone accordingly: if T high → be structured; F high → be gentle; N high → allow imagery; S high → stay concrete.`
    : `Bilancia il tono: T alto → più struttura; F alto → più calore; N alto → immagini; S alto → concretezza.`);

  return `${label}. ${steer}`;
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

    // rate
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // credits
    let used = 0, dailyCap = isPro ? 10 : 3;
    if (!bypass) {
      const today = new Date().toISOString().slice(0, 10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 86400);
      if (used > dailyCap) return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
    }

    // body
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = "",
      periodo = "future",
      sex = "",
      micro = {},
      registro = ""   // NEW: realistic/poetico/analitico per What If
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, registro);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${registro}`), 36) % 1000000;

    const jungGuide = jungHints(micro, lang);
    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona sex="${resolvedSex||"unknown"}". INTERNAL SEED: ${seedNum}. ${jungGuide}`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Sesso utente="${resolvedSex||"unknown"}". SEED INTERNO: ${seedNum}. ${jungGuide}`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "system", content: (stile === "wtf")
          ? (isEn(lang)
              ? `Hard rules for WTF: exactly one narrated outburst from the bank "${gritty(lang).join(" | ")}", never literal slurs, opening is ONLY a nickname.`
              : `Regole dure per WTF: una sola esplosione narrata tra "${gritty(lang).join(" | ")}", mai letterale, apertura SOLO con nomignolo.`)
          : (isEn(lang)
              ? `WHAT IF register hint: ${String(registro||"realistic")}.`
              : `Suggerimento registro WHAT IF: ${String(registro||"realistico")}.`)},
      { role: "user", content: userPrompt },
    ];

    // LLM
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
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG (privacy-safe) ---
    try {
      const entry = {
        ts: Date.now(), ip, style: stile, lang, periodo,
        sex: resolvedSex || null, domanda_len: String(domanda || "").length,
        domanda_hash: tinyHash(domanda || ""), answer_chars: (answer || "").length,
        admin: !!admin, user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
        registro: registro || null
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
    } catch (e) { console.warn("log failure (non-bloccante)", e); }

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      periodo,
      registro: registro || null,
      model: MODEL,
      credits: bypass ? null : { used, dailyCap },
    });

  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
