// /api/ask.js — What?f Engine (2025 FULL, persona-aware)
// Stili: whatif (realismo/poetico/analitico) · wtf (sarcasmo demenziale affettuoso, “grit” iperbolico narrato)
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
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ---------- GRIT PACK (WTF interiezioni epiche, narrate) ---------- */
// Mai bestemmie letterali. Solo “atto narrato” iperbolico e pulito per store.
const GRIT_PACK = {
  it: {
    light: [
      "sospiro d’officina",
      "colpo di tosse da veterano",
      "rutto mondiale in sordina",
      "occhiata che bestemmia senza audio",
      "mugugno da spogliatoio",
      "fischio che smonta un neon",
    ],
    medium: [
      "rutto mondiale in surround",
      "imprecazione di frontiera a mezza voce",
      "santissima sfuriata non trascritta",
      "bestemmia teatrale (censurata)",
      "scarica di borbottii da manuale",
      "sbraitata da capocantiere col freno tirato",
    ],
    heavy: [
      "bestemmia epica non trascritta",
      "imprecazione da epopea marinaresca",
      "ruggito di stanchezza che piega i bicchieri",
      "sacramentata storica (fuori campo)",
      "invettiva con copyright del destino",
      "rantolo lirico che stacca il poster",
    ],
  },
};
const LAST_GRIT_SIZE = 3;
function nextGrit(state, { locale = "it-IT", heat = "medium" } = {}) {
  const lang = locale.startsWith("it") ? "it" : "it";
  const pool = GRIT_PACK[lang][heat] || GRIT_PACK.it.medium;
  const used = state.__lastGrit || [];
  const options = pool.filter((w) => !used.includes(w));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const phrase = options.length ? pick(options) : pick(pool);
  state.__lastGrit = [...used, phrase].slice(-LAST_GRIT_SIZE);
  return { phrase, state };
}
function injectGrit(text, phrase) {
  try {
    const sents = String(text).split(/(?<=[.!?…])\s+/).filter(Boolean);
    if (!sents.length) return text;
    const r = Math.random();
    if (r < 0.34) {
      return `${phrase.toUpperCase()} — ${text}`;
    } else if (r < 0.68 && sents.length > 1) {
      sents.splice(1, 0, `(${phrase})`);
      return sents.join(" ");
    } else {
      return `${text} — ${phrase}.`;
    }
  } catch {
    return `${phrase.toUpperCase()} — ${text}`;
  }
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional. No lists, no questions, no echo. Keep ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse già stata fatta e mostra come sarebbe andata. Preferisci passato/condizionale. Niente liste o domande. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste o domande. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const genderNickIT = (SEX === "f")
    ? ["regina del casino", "fenomena", "asso di briscola", "capitana del caos", "sirena urbana", "signora dei forse", "rockstar con tacchi comodi"]
    : (SEX === "m")
      ? ["campione", "fenomeno", "asso", "capitano del caos", "sumo dei forse", "rockstar con le tasche vuote", "poeta del bar"]
      : ["leggenda", "fenomen*", "asso universale", "cap* del caos", "rockstar del forse", "astronauta del dubbio"];
  const genderNickEN = (SEX === "f")
    ? ["queen of chaos","ace of ‘maybe’","legend in sneakers","captain of detours"]
    : (SEX === "m")
      ? ["champ","legend","captain of chaos","rocket scientist of ‘maybe’"]
      : ["icon","legend","ace","captain of chaos"];

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words).
OPEN with ONLY a rotating nickname (just the nickname word/phrase).
Use hyperbolic, narrated “grit” interjections (e.g., “EPIC CURSE NOT TRANSCRIBED”, “WORLD-CLASS BURP in surround”), never literal religious slurs.
“Reacting objects” allowed when relevant. Tone: goofy but warm, never hateful.
STRICT: no lists, no questions, no emojis. Respect TEMPORAL MODE.
Close with a warm, funny beat (not a lecture).
`.trim()
      : `
Sei “What the F” — l’amico rumoroso ma affettuoso che punzecchia con bene.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole).
APERTURA SOLO con un nomignolo (solo la parola/frase).
Usa interiezioni “gritty” iperboliche e narrate (es. “BESTEMMIA EPICA NON TRASCRITTA”, “RUTTO MONDIALE in surround”), mai bestemmie letterali.
Oggetti che “reagiscono” quando serve; tono demenziale ma caldo.
RIGIDO: niente elenchi, niente domande, niente emoji. Rispetta la MODALITÀ TEMPORALE.
Chiudi caldo e divertente, non una predica.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Mettersi in proprio (futuro)
Capitano del caos, arrivi col piano che sembra un tovagliolo firmato e l’Excel ti guarda come un cameriere stanco; il registratore di cassa tossisce come scooter in salita ma tre facce tornano e la vetrina si raddrizza da sola, stappi la bottiglia “buona” ed è aceto balsamico: brucia onesto, BESTEMMIA EPICA NON TRASCRITTA e il bancone finge di non sentire, alla sera conti spicci e sorrisi e capisci che non stai vincendo il mondo, stai reggendo te — ed è più redditizio del previsto.` },
      { role: "system", content:
`EXAMPLE EN • Moving city (future)
Champ, you land like a limited series pilot and the buzzer rolls its eyes; the fridge hums “good luck” while the streetlights do wardrobe tests, you walk too far just to tire the nerves, WORLD-CLASS BURP in surround and the mailbox pretends it didn’t hear, by grocery three you find your aisle and your pace — you’re not conquering a city, you’re landing your life.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS, nicks: isEn(lang) ? genderNickEN : genderNickIT };
  }

  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Warm, grounded, simple; ordinary images (keys, streetlights, notebooks, hands, air).
Small truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice).
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Verità piccole e vere; niente eroismi, niente malinconia.
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

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS, nicks: isEn(lang) ? genderNickEN : genderNickIT };
}

/* ---------- Heuristics dal micro-profilo ---------- */
function pickWhatIfRegister(extra = "", micro = {}, lang = "it") {
  const lower = String(extra || "").toLowerCase();
  if (lower.includes("registro=poetico")) return "poetico";
  if (lower.includes("registro=analitico") || lower.includes("registro=analytical")) return "analitico";
  if (lower.includes("registro=realistico") || lower.includes("registro=realistic")) return "realistico";

  const mood = String(micro?.mood || "").toLowerCase();
  const anchor = String(micro?.anchor || "").toLowerCase();
  const decide = String(micro?.decide || "").toLowerCase();

  // Poetico se mood leggero/nostalgico o anchor=persone/curiosità
  if (/(legger|chatty|calm|quiet|nostal|curios|persone|people)/.test(mood+anchor)) return "poetico";
  // Analitico se decide=liste/scadenze/coin
  if (/(lista|lists|pro|contro|deadline|scadenza|coin|moneta)/.test(decide)) return "analitico";
  // Altrimenti realistico
  return "realistico";
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
      micro = {}         // micro-profile; e.g., { mood, anchor, decide, zodiac }
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots, nicks } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Registro (solo What if)
    const registerForWhatIf = (stile === "whatif")
      ? pickWhatIfRegister(extra, micro, lang) // "realistico" | "poetico" | "analitico"
      : null;

    // Nickname di apertura per WTF
    const nickname = (stile === "wtf" && Array.isArray(nicks) && nicks.length)
      ? (nicks[Math.floor(Math.random() * nicks.length)])
      : "";

    // Seed deterministico (varietà stabile)
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${registerForWhatIf||""}`), 36) % 1000000;

    // Extra hint per passati
    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past/conditional, upbeat roasting."
          : "Scrivi tutto al passato/condizionale, tono allegro e pungente.")
        : "";

    // Profilazione soft dal micro-profilo
    const toneHint = (() => {
      const md = String(micro?.mood || "").toLowerCase();
      const dc = String(micro?.decide || "").toLowerCase();
      const an = String(micro?.anchor || "").toLowerCase();
      if (stile === "whatif") {
        if (/lista|lists|pro|contro|deadline|scadenza/.test(dc)) return isEn(lang)
          ? "Prefer slightly analytical cadence; keep warmth."
          : "Preferisci una cadenza leggermente analitica, restando caldo.";
        if (/curios|people|persone/.test(md+an)) return isEn(lang)
          ? "Allow a hint of poetic imagery; keep it grounded."
          : "Concedi un accenno poetico restando concreto.";
      } else {
        if (/irrequiet|restless|charged|presa|socket/.test(md)) return isEn(lang)
          ? "Let the banter punch a bit harder (still affectionate)."
          : "Lascia che le stoccate siano un filo più decise (sempre affettuose).";
      }
      return "";
    })();

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}". If style is "whatif", prefer register="${registerForWhatIf||"auto"}". MICRO: ${JSON.stringify(micro)}. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". Se stile "whatif", preferisci registro="${registerForWhatIf||"auto"}". MICRO: ${JSON.stringify(micro)}. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(toneHint ? [{ role: "system", content: toneHint }] : []),
      ...(fewshots || []),
      ...(stile === "wtf"
        ? [{ role: "system", content: isEn(lang)
            ? "Hard rules: narrated hyperbolic grit allowed, never literal slurs; opening must be ONLY a nickname (no verbs); no fixed catchphrases."
            : "Regole dure: ‘grit’ iperbolico narrato consentito, mai bestemmie letterali; apertura SOLO con nomignolo (senza verbi); niente tormentoni fissi." }]
        : []),
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (registerForWhatIf === "poetico" ? 0.86 : registerForWhatIf === "analitico" ? 0.62 : 0.78),
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.45 : 0.12,
      presence_penalty: stile === "wtf" ? 0.25 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Nickname head per WTF (garantito)
    if (stile === "wtf" && nickname) {
      const trimmed = answer.replace(/^\s*[\w’' ]{2,20}\s*,?\s*/i, ""); // fallback: rimuove eventuali parole iniziali generiche
      answer = `${nickname}, ${trimmed}`;
    }

    // Anti-eco, tightening, clamp, normalize
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // GRIT injection per WTF (ipertrofico, mai letterale)
    if (stile === "wtf") {
      const directness = 0.5; // se vuoi, derivala da micro/altro
      const heat = /irrequiet|restless|charged|presa|socket/i.test(String(micro?.mood||""))
        ? "heavy"
        : (directness > 0.66 ? "heavy" : directness < 0.33 ? "light" : "medium");
      const p = 0.55;
      if (Math.random() < p) {
        const { phrase } = nextGrit({}, { locale: isEn(lang) ? "en-GB" : "it-IT", heat });
        answer = injectGrit(answer, phrase);
      }
    }

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        sex: resolvedSex || null,
        registro: registerForWhatIf,
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
      registro: registerForWhatIf,
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
