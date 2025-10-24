// ============================
// /api/ask.js — What?f Engine (Incazzato Illuminato + Realismo Lucido con Sorriso)
// Stili supportati: whatif, wtf
// IT/EN — singolo paragrafo, niente emoji/liste/domande
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log avanzato su Redis (periodo, stile, lang, user_type, domanda)
// ============================

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

// rate limit: 10 req/min per IP (bypassabile SOLO per admin)
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
  let t = out.join(" "); if (!/[.!?…]$/.test(t)) t += "."; return t;
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

// Admin check (mappa token->ip gestita da /api/admin-token.js)
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const ip = await redis.get(`admin:token:${token}`);
    return ip && ip === requesterIp;
  } catch { return false; }
}

/* ---------- Modalità temporale (Passato/Futuro) ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it would likely have unfolded. Prefer past/conditional tenses and present-flash cuts. Do NOT give advice, do NOT ask questions, do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente narrativo. NON dare consigli, NON fare domande, NON ripetere la domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco della domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — amico geniale, filosofo, mezzo brillo: tanta ironia, oggetti “pensanti” immaginati, aperture variate.
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the sharp, half-drunk best friend who loves the user and roasts them with affection.
SECOND PERSON. ONE paragraph, 5–7 long sentences (~100–130 words).
OPEN with a warm shoulder-smack + varied nickname (e.g., “champ”, “genius”, “rocket scientist”, “legend”, “captain of chaos”, “philosopher in a helmet”). Vary openings across generations.
Voice: fast, cinematic, bar-philosophy sarcasm; you tease hard but hug in the subtext.
Concrete, everyday images; “thinking objects” appear as imagined reactions (no dialogue).
No lists. No questions. No emojis. No moralizing. Light swearing allowed if human & funny.
Respect TEMPORAL MODE strictly (past=true counterfactual; future=plausible near-future).
ALWAYS end with a punchline that both teases and soothes.
`.trim()
      : `
Sei “What the F” — l’amico geniale e mezzo brillo: ti vuole bene e ti prende in giro senza pietà.
SECONDA PERSONA. UN paragrafo, 5–7 frasi lunghe (~100–130 parole).
APRI con pacca sulla spalla + nomignolo variabile (“campione”, “asso”, “fenomeno”, “capitano del caos”, “rockstar”, “filosofo col casco”…). Cambia apertura ad ogni generazione.
Voce veloce, cinematografica, sarcasmo da bancone; lo prendi in giro ma sotto lo abbracci.
Lessico concreto; “oggetti pensanti” come reazioni immaginate (non dialoghi).
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere ok se servono alla comicità.
Rispetta la MODALITÀ TEMPORALE alla lettera (passato=controfattuale; futuro=plausibile).
CHIUDI sempre con una battuta che punge e consola.
`.trim());

    // FEWSHOTS — esempi fissi per bloccare personalità/ritmo
    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Moto
Oh campione delle decisioni turbo, ti vedo: sali in sella e il casco ti stringe l’ego come un barattolo troppo ottimista, parti con il rombo che nel cortile suona epico e in strada è un miagolio, e intanto l’anziano in graziella ti supera con la respirazione da app di yoga; ti immagini la frizione che scuote la testa come zia severa, parcheggi diagonale “arte moderna”, prometti prudenza ma il polso fa festa di nascosto, rientri con il cuore a 9.000 giri e quel sorriso cretino che odora di benzina e dignità ammaccata, e indovina? sei vivo, spettinato e un filo più tuo — come un Negroni storto ma bevibile: brucia, ma racconta bene chi sei.` },
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Fenomeno del ritorno scenografico, sbarchi con “ho visto il mondo” e il vento ti riposiziona il carattere come i vasi sul balcone, fai tre passi e le pietre ricordano tutto meglio di te, immagini il portone che alza un sopracciglio tipo “di nuovo?” e tu fai finta di niente, poi arriva il cugino versione director’s cut del 2012, brindate al passato e ti sciogli controvoglia, più tardi guardi le luci e senti la crepa che non fa più male ma posto, e ti esce quella risata breve che sa di casa e di tregua: non sei tornato indietro, campione, sei tornato in pari — che è molto più rock.` },
      { role: "system", content:
`ESEMPIO IT • Aprire un’attività
Asso dell’ottimismo, ti svegli TED Talk e il primo modulo ti ricorda che anche per vendere acqua serve un piccolo esorcismo, il PDF del business plan finge morte apparente, il registratore mentale fa i conti con le carezze invece che coi numeri, immagini lo scaffale che ti valuta come un giudice di talent, poi arrivano tre facce vere e ti accorgi che l’idea regge dove reggi tu: nei lunedì storti; la sera stappi convinto e ovviamente è aceto balsamico — brucia ma dà carattere, e ridi perché sì, il caos ha le quote, ma il CEO dell’autoironia oggi sei ancora tu.` },
      { role: "system", content:
`ESEMPIO IT • Mare e reset
Ehi rockstar della fuga responsabile, atterri in “vita semplice” e la sabbia ti tassa anche i pensieri, immagini l’ombrellone che scuote la testa mentre prometti sobrietà e la genziana ti dà del tu, il sole cuoce i progetti a fuoco lento e verso sera l’aria sa di patatine e perdono; rimandi le verità a domani (classico), ma intanto ti siedi bene dentro il silenzio e scopri che non stavi scappando — stavi solo togliendo il freno a mano alla tua calma.` },
      { role: "system", content:
`EXAMPLE EN • Change city
Alright, legend, you land like a limited series reboot and the streetlights reframe your face better than therapy, you imagine the buzzer rolling its eyes as you miss it twice, the fridge humming “good luck, hero,” you walk too far just to out-breathe the anxious drumline, by supermarket three you find your aisle and your pace, evenings turn down the volume and the map stops asking for permission, and there you are — not a conqueror, just a person arriving — which is the only plot twist that ages well.` },
      { role: "system", content:
`EXAMPLE EN • Start a business
Champ, you wake up bulletproof and the first form chews your cape, the plan pretends to be a PDF but it’s really a brick, you picture the shelves judging your font choices, clients pay in compliments, suppliers answer on lunar time, and still the counter becomes a small republic of names that return; at midnight you open a “victory” bottle that turns out to be balsamic — it hurts, it flavors, it’s honest, and your laugh signs the receipt.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — Realismo lucido con sorriso (8–11 frasi, chiusura riflessiva morbida)
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~110–155 words).
Warm, grounded, simple; ordinary images (keys, streetlights, notebooks, hands, air).
Show small human truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice).
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, con sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~110–155 parole).
Tono caldo e concreto; immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Mostra verità piccole e vere; niente eroismi, niente malinconia.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Tornare non sarebbe un passo indietro ma un passo fatto meglio. Ti stupirebbe la memoria delle strade: tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi capisci che ti rimette in orario. I volti sembrano uguali, ma li guardi con occhi più larghi. Le chiavi tornano sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede accanto e tace. Non serve ricominciare da zero: basta ricominciare da te. E ti sorprende che, sotto il rumore, c’era già qualcosa di tuo.` },
    { role: "system", content:
`ESEMPIO IT • Aprire un’attività
All’inizio tutto è grande: moduli, sigle, attese. Poi il giorno si stringe e scopri che un bancone, un taccuino e tre volti sono già abbastanza. La pazienza pesa meno dell’entusiasmo: tiene quando la luce è piatta. Non devi convincere tutti: ti basta riconoscere chi torna. Anche la stanchezza, quando ha senso, diventa leggera. L’idea non deve stupire: deve reggere. E resta una calma piccola, ma vera, che non chiede nulla.` },
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
    const { domanda = "", stile = "whatif", lang = "it", extra = "", periodo = "future" } = body;
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    // Personas
    const { sys, fewshots } = personaSystem(stile, lang);

    // Temporal mode
    const temporal = temporalSystem(periodo, lang, stile);
    let extraTemporalHint = "";
    if (stile === "wtf" && String(periodo).toLowerCase() === "past") {
      extraTemporalHint = isEn(lang)
        ? "Write entirely in past or conditional tense, as if it already happened, keeping the same teasing-tragicomic tone."
        : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono pungente-tragicomico.";
    }

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "user", content: userPrompt },
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: 320,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 7 : 11);
    answer = clampWords(answer, stile === "wtf" ? 130 : 155);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente (per /api/admin-logs, /api/stats) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,            // "whatif" | "wtf"
        lang,
        periodo,                 // "past" | "future"
        domanda,
        answer_chars: (answer || "").length,
        admin: !!admin,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999); // ultimi 10k
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      // bucket giorno
      const dayKey = `stats:day:${new Date().toISOString().slice(0,10)}`;
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
