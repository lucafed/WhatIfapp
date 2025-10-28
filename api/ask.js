// /api/ask.js — What?f Engine (2025 FINAL)
// Stili: whatif (realismo lucido: analitico/poetico) · wtf (sarcasmo demenziale affettuoso)
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
function ensureSpicyButSafeWTF(t) {
  // Garantisce chiusura sentita + evita output vuoto; NON inserisce mai bestemmie letterali
  let out = String(t || "").trim();
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// ---------- Admin check ----------
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional, with quick present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "", substyle = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  // Nicknames per sensibilizzare il tono (non stampati esplicitamente)
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
    const hardRule = isEn(lang)
      ? `HARD RULE WTF • Start calm (2–3 sentences) in the exact tone of the few-shots (“Ah, ma guarda un po’…”, “Ah, eccoci…” vibe), then one explosive beat with a narrated blasphemy (NEVER literal slurs). Variants allowed: “mannaggia al porco volante…”, “la bagassa di tua zia…”, “porca di quella frizione ubriaca…”. Immediately add at least TWO reactions (objects/people/animals). Alcohol beats ok. Adult, rude, affectionate. ONE paragraph, 6–8 sentences (125–165w). No lists, no questions, no emojis. Close warm and funny.`
      : `REGOLE DURE WTF • Parti calmo (2–3 frasi) nello stesso registro degli esempi (“Ah, ma guarda un po’…”, “Ah, eccoci…”), poi esplodi con una imprecazione narrata (MAI letterale). Varianti ammesse: “mannaggia al porco volante…”, “la bagassa di tua zia…”, “porca di quella frizione ubriaca…”. Subito dopo inserisci almeno due reazioni (oggetti/persone/animali). Alcol ok. Adulto, ruvido, affettuoso. Un solo paragrafo, 6–8 frasi (125–165 parole). Niente elenchi, domande, emoji. Chiudi caldo e ironico.`;

    const few = [
      { role: "system", content:
`ESEMPIO IT • What the F — Bar
Ah, ma guarda un po’, il genio dell’espresso che si sveglia con la vocazione imprenditoriale. Ti vedo: grembiule nuovo, sorriso da spot pubblicitario, la moka che sibila come un vecchio nonno stanco di vivere. Arriva il primo cliente, chiede un cappuccino “senza schiuma, ma caldo, però freddo dentro” e già ti parte la pressione; tentando l’impossibile ti bruci un dito e ti scappa un “porca di quella schiuma sorda e bastarda”, le tazzine vibrano come castagnette e il cucchiaino va in sciopero; il frigo rantola, la macchina del caffè fa un ruttino di protesta e una vecchietta ti guarda come se avessi bestemmiato in latino. Tu versi un goccio di grappa nel caffè e pensi che almeno oggi hai aperto un locale che fa ridere anche i mobili; quando chiudi, il bancone sospira “ce la rifacciamo domani, capo?” e tu annuisci col fegato in disarmo ma il morale alto.` },
      { role: "system", content:
`ESEMPIO IT • What the F — Moto
Ah, eccoci, il nuovo Valentino del parcheggio condominiale. Giacca di pelle lucida, casco nuovo e orgoglio che fa attrito; accendi il motore, romba come un drago epilettico e già ti senti immortale. Poi un piccione ti taglia la strada e ti scappa un “mannaggia al porco volante che balla il tango con i miei denti”, il cane del quartiere ulula in do maggiore e il semaforo si gira dall’altra parte per la vergogna; riparti come niente, ma il cavalletto resta giù e ti fa lo sgambetto da bullo. Ti fermi al bar, il bicchiere ride e il bancone ti versa due dita “per compassione”; alla fine capisci che la libertà non era la velocità, era la risata che ti raggiungeva.` },
      { role: "system", content:
`ESEMPIO IT • What the F — Innamorarsi di nuovo
Ah, Luca, che tenera tragedia ambulante. Parti morbido: due messaggi, tre sospiri, la città sembra un film gentile. Poi lei ti lascia in lettura e ti scappa un “la bagassa di tua zia che fa il tip-tap sul mio cuore”, il bicchiere tintinna come un applauso lento e Alexa finge un malfunzionamento; il gatto cambia stanza offeso e la tenda sbatte come se volesse andarsene anche lei. Tu prendi aria, versi troppo, e tra un brindisi e una smorfia capisci che non stai morendo d’amore: stai solo imparando a ridere di te — che, onestamente, ti sta pure meglio.` },
    ];

    const sys = isEn(lang)
      ? `You are “What the F” — loud, loving roast-friend. SECOND PERSON. Keep nickname vibe implicit; imitate the calm → storm structure of few-shots. Nickname pool: ${genderNickEN.join(", ")}.`
      : `Sei “What the F” — amico rumoroso e affettuoso. SECONDA PERSONA. Nomignolo implicito; imita la struttura calma → tempesta degli esempi. Nomignoli: ${genderNickIT.join(", ")}.`;

    return { sys, fewshots: few, hard: hardRule };
  }

  // WHAT IF (analitico / poetico)
  const isAnalytic = String(substyle || "").toLowerCase() === "analitico";
  const SYS_WHATIF = (isEn(lang)
    ? (isAnalytic
      ? `You are "What If — Analytic". SECOND PERSON. One paragraph, 6–9 crisp sentences (~95–135 words). Grounded, social/realistic lens; ordinary images (keys, streetlights, notebooks, hands, air). Short reflective close (not advice). No lists, no questions, no emojis.`
      : `You are "What If — Poetic". SECOND PERSON. One paragraph, 6–9 gentle sentences (~95–135 words). Everyday images, warm cadence, tiny truths; end with a single short reflective line. No lists, no questions, no emojis.`)
    : (isAnalytic
      ? `Sei "What If — Analitico". SECONDA PERSONA. Un paragrafo, 6–9 frasi asciutte (~95–135 parole). Sguardo realistico/sociale; immagini quotidiane (chiavi, lampioni, taccuini, mani, aria). Chiudi con una riga riflessiva (non consiglio). Niente elenchi, domande, emoji.`
      : `Sei "What If — Poetico". SECONDA PERSONA. Un paragrafo, 6–9 frasi leggere (~95–135 parole). Immagini quotidiane, ritmo caldo, verità piccole; chiudi con una riga riflessiva. Niente elenchi, domande, emoji.`));

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • What if — Analitico (Aquila)
Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricucito abitudini oltre ai muri. L’economia si muove piano ma tiene: più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente. Il Veneto ti mancherebbe per ritmo e occasioni, ma qui ritroveresti fiato e relazioni che non devono correre per esistere. Non sarebbe un passo indietro: solo un modo diverso di avanzare, più lento, ma più tuo.` },
    { role: "system", content:
`ESEMPIO IT • What if — Poetico (Aquila)
Bella questa, Luca — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante paziente. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e inverno. Le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è un po’ più semplice, ogni sera un po’ più tua. Non stai tornando indietro: stai tornando dove il tempo ti riconosce per nome.` },
    { role: "system", content:
`EXAMPLE EN • What if — Analytic (move city)
You’ll feel like a guest, then your hands learn the new keys. You walk to tire the noise; by the third grocery you know your aisle. Costs shift, pace softens, the map stops asking for proof. You miss a few things, not all at once. The rest finds its place. It’s not a step back — just a way to move that fits how you breathe.` },
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
      substyle = "",      // "analitico" | "poetico" (solo whatif)
      lang = "it",
      extra = "",
      periodo = "future",
      sex = "",          // "m" | "f" | "nb"
      micro = {},         // micro-profile (mood/anchor/decide/zodiac/sex...)
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots, hard } = personaSystem(stile, lang, resolvedSex, substyle);
    const temporal = temporalSystem(periodo, lang, stile);

    // Deterministic tiny seed
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${substyle}`), 36) % 1000000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional, as if it already happened, keeping the upbeat roasting tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono allegro e pungente.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Memory/context: "${String(extra || "").trim()}". Persona sex="${resolvedSex||"unknown"}". Keep the exact persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Memoria/contesto: "${String(extra || "").trim()}". Sesso persona="${resolvedSex||"unknown"}". Mantieni esattamente la voce. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      ...(hard ? [{ role: "system", content: hard }] : []),
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
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 9);
    answer = clampWords(answer, stile === "wtf" ? 165 : 140);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") answer = ensureSpicyButSafeWTF(answer);
    else { if (!/[.!?…]$/.test(answer)) answer += "."; }

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      const entry = {
        ts: Date.now(), ip, style: stile, lang, periodo,
        sex: resolvedSex || null, substyle: substyle || null,
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
      if (substyle) await redis.hincrby("stats:substyle", substyle, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}:${substyle||""}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch (e) {
      console.warn("log failure (non-bloccante)", e);
    }

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      periodo,
      substyle: substyle || null,
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
