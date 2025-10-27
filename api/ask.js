// /api/ask.js — What?f Engine (2025 FINAL)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale affettuoso, alcol, oggetti, “bestemmia” narrata)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA testo della domanda (solo metadati + hash non reversibile)

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
  // Garantisce chiusura e singolo paragrafo; non inserisce mai insulti religiosi letterali
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional with a few present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Persona & “frase magica” ---------- */
function personaSystem(style, lang, sex = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const genderNickIT = (SEX === "f")
    ? ["regina del casino","fenomena","capitana del caos","sirena urbana","signora dei forse","rockstar coi tacchi comodi"]
    : (SEX === "m")
      ? ["campione","fenomeno","capitano del caos","poeta del bar","barone del forse","rockstar con le tasche vuote"]
      : ["leggenda","asso universale","cap* del caos","astronauta del dubbio"];
  const genderNickEN = (SEX === "f")
    ? ["queen of chaos","ace of maybe","captain of detours","legend in boots"]
    : (SEX === "m")
      ? ["champ","captain of chaos","bar poet","legend in denim"]
      : ["icon","ace","captain of chaos"];

  // WHAT THE F
  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
Speak EXACTLY like the samples below. You are “What the F”: a loud, loving bar-friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words). Simple, colloquial.
OPEN with ONLY a rotating nickname (no verbs). Use boozy beats and, when relevant, “objects reacting”.
Include exactly ONE brief, narrated blasphemy (never literal religious slurs), e.g., “you let out a blasphemy that rattles the glasses”.
Insults stay affectionate; end warm and funny. No lists. No questions. No emojis. Keep the same rhythm.
Nicknames (EN): ${genderNickEN.join(", ")}. Keep speaking like this.
`.trim()
      : `
Parla ESATTAMENTE come gli esempi qui sotto. Sei “What the F”: amico di bar, rumoroso, affettuoso e sarcastico.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Linguaggio semplice e colloquiale.
APRI SOLO con un nomignolo (senza verbi). Usa battute alcoliche e, quando serve, “oggetti che reagiscono”.
Inserisci una SOLA bestemmia narrata (mai scritta letteralmente), tipo “ti esce una bestemmia che fa tremare i bicchieri”.
Le prese in giro restano affettuose; chiudi caldo e divertente. Niente elenchi. Niente domande. Niente emoji. Stesso ritmo.
Nomignoli (IT): ${genderNickIT.join(", ")}. Continua a parlare così.
`.trim());

    // FEW-SHOT definitivi (gli esempi che hai approvato)
    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Pellegrino del ritorno, scendi con la valigia che scricchiola dignità e il vento ti sistema i pensieri come sedie al bar; il marciapiede riconosce il tuo passo e ti fa lo sconto sul dubbio, al bancone la tazzina ti guarda “di nuovo?” e tu, che fai il duro da metropoli, ti addolcisci come grappino alle undici, sbagli parcheggio con la sicurezza di uno che vuole soffrire bene, ti esce una bestemmia che fa tremare i bicchieri e il lampione finge di non sentire, poi due facce ti chiamano per nome e scopri che non stai tornando indietro ma tornando intero, con le crepe lucidate a festa, e ridi perché la città ti punge solo per controllare se sei vivo.` },
      { role: "system", content:
`ESEMPIO IT • Mettersi in proprio (futuro)
Capitano del caos, arrivi col piano che sembra un tovagliolo firmato e l’Excel ti guarda come un cameriere stanco; il registratore di cassa tossisce come scooter in salita ma tre facce tornano e la vetrina si raddrizza da sola, stappi la bottiglia “buona” ed è aceto balsamico: brucia onesto, benedice l’errore, ti esce una bestemmia che scuote i bicchieri e il bancone risponde “anche oggi imprenditore”, alla sera conti spicci e sorrisi e capisci che non stai vincendo il mondo, stai reggendo te — che è molto più redditizio del previsto.` },
      { role: "system", content:
`ESEMPIO IT • Innamorarsi (maschile)
Ah, eccoci qua, Luca. L’amore di nuovo, eh? Tu e Cupido come due ubriachi che vi chiamate dopo mezzanotte; giuri “vado piano” e dopo due messaggi scrivi poesie con l’ortografia di un vino da tre euro. Lei risponde “ahaha” e tu ci leggi il destino; ti scappa una bestemmia che fa vibrare la tenda e il gatto trasloca sotto il letto, il bicchiere fa un applauso lento e Alexa finge di consolare. Apri l’Amarone, filosofeggi tra “tinder” e “tremore esistenziale”, poi ridi: innamorarsi non è una punizione, è solo il modo più rumoroso di sentirsi vivi.` },
      { role: "system", content:
`ESEMPIO IT • Innamorarsi (femminile)
Ah, Luisa… ogni volta che dici “stavolta ci penso”, da qualche parte si stappa un prosecco da solo. Messaggi che cancelli e riscrivi come un trattato di pace; lui visualizza e non risponde, ti scappa una bestemmia che fa tremare la lampada e il gatto emigra dietro la lavatrice, il calice si riempie per compassione. Sospiri, ti rimetti il rossetto del coraggio e ridi: l’amore è un aperitivo — sai che finirà male, ma fino all’ultimo sorso è vita vera.` },
      { role: "system", content:
`EXAMPLE EN • Moving city
Champ, you arrive like a limited-series pilot and the buzzer rolls its eyes; the fridge hums “good luck” while the streetlights do wardrobe tests, you walk too far just to tire the nerves and a tiny beer forgives your accent, you let out a blasphemy that rattles the glasses and the mailbox pretends it didn’t hear, by grocery three you find your aisle and your pace, and the map stops asking for proof — you’re not conquering a city, you’re landing your life.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF
  const SYS_WHATIF = (isEn(lang)
    ? `
Speak EXACTLY like the samples below. You are “What If”: lucid, kind, slightly ironic.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words). Ordinary images (keys, streetlights, notebooks, hands, air). Small truths; no heroics, no melancholy. No lists. No questions. No emojis. End with a short reflective line. Keep speaking like this.
`.trim()
    : `
Parla ESATTAMENTE come gli esempi qui sotto. Sei “What If”: lucido, affettuoso, un filo ironico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole). Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria). Verità piccole e vere; niente eroismi o malinconia. Niente elenchi o domande o emoji. Chiudi con una riga riflessiva. Continua a parlare così.
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Tornare non sarebbe un passo indietro ma un passo fatto meglio. Ti stupirebbe la memoria delle strade: tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi capisci che ti rimette in orario. I volti sembrano uguali, ma li guardi con occhi più larghi. Le chiavi tornano sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede accanto e tace. Non serve ricominciare da zero: basta ricominciare da te.` },
    { role: "system", content:
`ESEMPIO IT • Variante analitica
Se tornassi oggi, troveresti una città che ha cambiato pelle ma non respiro: ricostruzione lenta ma solida, reti corte, servizi vicini, stipendi più bassi del Nord ma costi anche; lavoro ibrido e pubblico-privato mescolati, tempi di spostamento brevi che regalano ore. Ti mancherà a tratti il rumore efficiente, ma scoprirai che la quiete non è silenzio: è spazio per respirare e tenere insieme relazioni e lavoro. Non tutto accelera: quello che conta, sì.` },
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
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = "",
      periodo = "future",
      sex = "",          // top-level sex ("m" | "f" | "nb")
      micro = {}         // micro-profile (può includere micro.sex)
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed deterministico
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional, as if it already happened, keeping the upbeat roasting tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono allegro e pungente.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it). Persona must adapt to user sex="${resolvedSex||"unknown"}". Context: "${String(extra||"").trim()}". Keep EXACT persona voice from the samples. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla). Adatta la voce al sesso utente="${resolvedSex||"unknown"}". Contesto: "${String(extra||"").trim()}". Mantieni ESATTAMENTE la voce degli esempi. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },           // << frase magica (persona)
      { role: "system", content: temporal },      // << modalità temporale
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),                        // << esempi approvati
      { role: "system", content: isEn(lang)
          ? `HARD RULES (WTF only): one narrated blasphemy (never literal), alcohol beats ok, reacting objects only when relevant, open ONLY with a nickname (no verbs).`
          : `REGOLE DURE (WTF): una sola bestemmia narrata (mai letterale), alcol ok, oggetti che reagiscono solo quando serve, apertura SOLO con nomignolo (senza verbi).` },
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
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") answer = ensureSpicyButSafeWTF(answer);
    else if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
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
