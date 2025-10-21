// ============================
// /api/ask.js — What?f Engine (Incazzato Illuminato + Realismo Lucido con Sorriso)
// Stili supportati: whatif, wtf
// IT/EN — singolo paragrafo, ritmo fisso, niente emoji/liste/domande
// ============================

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// ---------- Upstash ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// rate limit: 10 req/min per IP (skippabile per admin/PRO)
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-pro, x-admin-token");
}

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n) continue;
    if (seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?…]$/.test(p)) continue;
    out.push(p);
    seen.add(n);
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
  const m = slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m ? m[1] : slice + "…";
}

function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?…])/g, "$1")
    .trim();
}

// estrai body in modo robusto
function parseBody(req) {
  try {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (req.body && typeof req.body === "object") return req.body;
  } catch {}
  return {};
}

async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const ip = await redis.get(`admin:token:${token}`);
    return ip && ip === requesterIp;
  } catch {
    return false;
  }
}

/* ---------- Anti-eco domanda ---------- */
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t.slice(0, Math.min(t.length, d.length + 12)).toLowerCase().replace(/[“”"']/g, "").trim();
  const echoRx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  t = t.replace(echoRx, "");
  return t;
}

/* ---------- Finale riflessivo (no consigli) per WHAT IF ---------- */
function ensureReflectiveEnding(text, lang) {
  const t = String(text || "").trim();
  if (!t) return t;
  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const last = sentences.pop() || "";
  const L = (lang || "it").toLowerCase();

  const itImp = [/^(prova|fai|metti|chiama|scrivi|inizia|oggi|domani)\b/i];
  const enImp = [/^(try|do|put|call|write|start|today|tomorrow)\b/i];
  const isImperative = L.startsWith("en") ? enImp.some(r=>r.test(last)) : itImp.some(r=>r.test(last));

  const IT = [
    "E ti sorprende che, sotto il rumore, c’era già qualcosa di tuo.",
    "E ti accorgi che la semplicità regge più di quanto pensassi.",
    "E capisci che non mancava il coraggio: mancava solo il momento giusto per vederlo.",
    "E resta una calma piccola, ma vera, che non chiede nulla."
  ];
  const EN = [
    "And you notice that beneath the noise, something of yours was already there.",
    "And it turns out simplicity holds longer than you expected.",
    "And you see courage wasn’t missing—just the right moment to notice it.",
    "And a small, honest quiet remains, asking for nothing."
  ];
  const soft = L.startsWith("en") ? EN : IT;

  const finalLine = (isImperative || last.split(/\s+/).length < 4)
    ? soft[Math.floor(Math.random()*soft.length)]
    : last;

  const merged = [...sentences, finalLine].join(" ");
  return normalizeOneParagraph(merged);
}

/* ---------- Modalità temporale (Passato/Futuro) ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if ((periodo || "").toLowerCase() === "past") {
    return (en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Write as if the choice HAD BEEN made back then. Prefer past simple, past perfect, conditional perfect ("would have ..."), with occasional present-narrative flashes. Keep tense consistency. Do NOT switch to future. No advice. Do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Scrivi come se la scelta fosse già avvenuta allora. Usa imperfetto, passato prossimo/perfetto e condizionale composto ("avresti", "saresti"), con lampi di presente narrativo. Coerenza dei tempi, niente futuro. Niente consigli. Non ripetere la domanda. Mantieni la voce ${style.toUpperCase()}.`);
  }
  return (en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future as if stepping into it now. No lists, no advice, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi ora. Niente elenchi, niente consigli, niente domande, niente eco della domanda. Mantieni la voce ${style.toUpperCase()}.`);
}

/* ---------- Personas (stile fissato) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — Sbronza-narrativa, sarcasmo tenero, frasi lunghe, senza emoji/domande
    const SYS = (isEn(lang)
      ? `
STYLE LOCK — WHAT THE F.
You are “What the F”: angry–enlightened, absurd, self-deprecating, tender under the snarl.
SECOND PERSON. ONE paragraph, 5–7 long sentences (~110–140 words). Start in-scene. Streetwise humor. Cinematic details.
No lists. No questions. No emojis. No moralizing. Light swearing only if it truly lands.
Do NOT copy or recycle any example wording; always invent fresh images and situations.
Do NOT restate or paraphrase the user's question. Always close with a punchline that stings and soothes.
`.trim()
      : `
BLOCCO STILE — WHAT THE F.
Sei “What the F”: incazzato illuminato, assurdo e autoironico, affettuoso sotto il ringhio.
SECONDA PERSONA. UN paragrafo, 5–7 frasi lunghe (~110–140 parole). Entra in scena subito. Umorismo di strada. Dettagli cinematografici.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere solo se servono davvero.
NON copiare né riciclare gli esempi: inventa sempre immagini e situazioni nuove.
NON ripetere o parafrasare la domanda. Chiudi con una punchline che punge e consola.
`).trim();

    // FEWSHOTS lunghi per fissare cadenza e musicalità (IT + EN)
    const FEWSHOTS = [
      // ===== ITALIANO =====
      { role: "system", content:
`ESEMPIO IT • E se mollassi tutto e aprissi un bar sulla spiaggia?
Lo molli davvero, con la faccia di chi ha appena vinto una causa contro la propria pazienza, e ti ritrovi dietro al bancone mentre il sole frigge i pensieri e il ghiaccio costa più della dignità; la macchina del caffè ti soffia vapore come un drago in sciopero, il POS muore proprio a Ferragosto, e un gabbiano ubriaco ti ruba la brioche con l’aria di chi sa la vita meglio di te, ma tu resti lì appeso al ritmo dei bicchieri, alle risate dei turisti, a quella malinconia buona che arriva dopo il secondo rum, e quando chiudi tardi, stanco e unto di sale, guardi l’orizzonte e capisci che non sei diventato ricco, però finalmente sai brindare anche quando il motivo decide di arrivare domani.`},
      { role: "system", content:
`ESEMPIO IT • E se andassi a vivere da solo?
Ci vai con l’orgoglio alto e l’armadio vuoto, poi dopo due giorni bevi vino in un bicchiere di plastica perché i piatti hanno proclamato l’indipendenza, il frigorifero suona come un vecchio club e la lavatrice ti giudica al giro delicati, ma la sera ti siedi sul pavimento con un panino sbilenco e una mezza sbronza gentile che ti spiega che la libertà odora di detersivo e notti storte, e mentre chiudi le tende al caos del mondo ti scappa una risata, perché la casa non è ancora casa, ma ti chiama per nome come un barista che sa già cosa prendi.`},
      { role: "system", content:
`ESEMPIO IT • E se cambiassi città?
Arrivi come un film doppiato male, ti perdi nel supermercato e paghi un’insalata quanto un affitto, poi impari a dire “ci vediamo” alla nostalgia con un gin economico e due amici provvisori, ti ritrovi in cucine che profumano di lingue diverse e di scelte messe a mollo, e quando la notte ti guarda un po’ storta tu alzi il bicchiere alla faccia dei chilometri, perché non sei diventato cittadino del mondo, sei solo uno che ha trovato un bancone dove la birra capisce il tuo accento meglio del vicino di casa.`},
      { role: "system", content:
`ESEMPIO IT • E se mi licenziassi per aprire qualcosa di mio?
Lo fai, e all’inizio ti credi rockstar del libero arbitrio, poi i clienti pagano in complimenti, il commercialista paga in occhiaie e tu paghi in fegato, però tra un modulo e uno sconforto ti sfugge quella risata onesta che sa di caffè bruciato e testardaggine, e capisci che non hai costruito un impero ma una leggenda metropolitana con l’IVA, e va bene così perché certe notti, quando chiudi tardi e il neon fa finta di essere una luna, ti sembra perfino che il fallimento ti abbia offerto da bere.`},
      { role: "system", content:
`ESEMPIO IT • E se mi sposassi?
Ti sposi con l’idea che l’amore basti e scopri che serve anche un caricatore in più e una diplomazia da ONU per la temperatura del termosifone, litigate su chi ha finito il vino e fate pace con il fondo della bottiglia, ridete di sciocchezze come se aveste scoperto l’oro e guardate lo stesso temporale da due divani diversi, e in quella confusione tenera dove l’ordine è un animale mitologico ti accorgi che la felicità non fa rumore, sta lì tra il sugo che macchia e la risata che salva, come un brindisi che non promette niente ma mantiene tutto.`},
      { role: "system", content:
`ESEMPIO IT • E se partissi senza meta?
Parti con l’auto che crede nei miracoli quanto te, ti fermi dove il caffè è un’idea romantica e la benzina una mezza bestemmia, dormi in stanze che non avevano previsto la tua faccia e ti risvegli con la fronte contro un orizzonte nuovo, parli con sconosciuti che ti raccontano la tua vita meglio di te e ogni bar diventa un confessionale con meno santi e più alcol, finché capisci che non cercavi la destinazione ma il permesso di ridere forte quando sbagli strada, e quella patente te la consegna la notte, timbrata con un “vai pure” scritto a bicchieri.`},

      // ===== ENGLISH =====
      { role: "system", content:
`EXAMPLE EN • What if I quit and opened a beach bar?
You actually quit, wearing the face of someone who finally sued their patience and won, and there you are behind a sticky counter where the sun deep-fries your thoughts and ice is priced like dignity, the espresso machine breathes steam like a striking dragon, the card reader dies on a national holiday, and a drunk seagull steals your croissant with the confidence of a life coach, yet you stay, glued to the rhythm of glasses and the laughter of tourists and that soft buzz that feels like hope with rum, and when you close late—salty, sweaty, ridiculous—you look at the horizon and realize you didn’t get rich, but you finally learned to toast even when the reason shows up tomorrow.`},
      { role: "system", content:
`EXAMPLE EN • What if I lived alone?
You move in with adult swagger and a wardrobe of good intentions, then two days later you drink wine from a plastic cup because the dishes formed a union, the fridge hums like a retired nightclub and the washing machine judges you on gentle cycle, but at night you sit on the floor with a crooked sandwich and a kind little buzz that explains freedom smells like detergent and crooked evenings, and while you pull the curtains on the world you laugh because the place isn’t home yet, but it already calls your name like a bartender who knows your usual.`},
      { role: "system", content:
`EXAMPLE EN • What if I moved abroad?
You land like a badly dubbed movie, overpay for lettuce, thank traffic lights in perfect English, then learn to say “see you” to nostalgia with cheap gin and two temporary friends, you end up in kitchens that smell like languages and rinsed decisions, and when the night looks at you sideways you raise a glass at the kilometers, because you didn’t become a citizen of the world, you just found a counter where the beer understands your accent better than your neighbor.`},
      { role: "system", content:
`EXAMPLE EN • What if I quit to build my own thing?
You do it and at first you feel like a headliner for free will, then clients pay in compliments, the accountant pays in under-eye circles and you pay in liver, but between one form and one meltdown you let out that honest laugh that tastes like burned coffee and stubbornness, and you realize you didn’t build an empire, you built a beautifully rumored tax ID, and that’s fine because some nights, when you close late and the neon pretends to be a moon, it almost feels like failure bought you a drink.`},
      { role: "system", content:
`EXAMPLE EN • What if I got married?
You marry thinking love is enough and discover you also need a spare charger and UN-level diplomacy for thermostat settings, you fight about who finished the wine and make peace with the bottle’s last inch, you laugh at nonsense like it’s treasure and watch the same thunderstorm from two different couches, and in that tender confusion where order is a mythical creature you notice happiness makes no noise, it sits between a stained shirt and a saving laugh like a toast that promises nothing and keeps everything.`},
      { role: "system", content:
`EXAMPLE EN • What if I traveled with no plan?
You go with a car that believes in miracles as much as you do, stop where coffee is a romantic rumor and gas is a polite insult, sleep in rooms that didn’t expect your face and wake up forehead-first into a new horizon, talk to strangers who tell your life better than you, and every bar turns into a confessional with fewer saints and more alcohol, until you get it—you weren’t chasing a destination, you were asking permission to laugh loudly when you take the wrong turn, and the night stamps that permit with a sloppy “you’re good” written in glasses.`},
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — Realismo lucido con sorriso, finale riflessivo (no compiti)
  const SYS_WHATIF = (isEn(lang)
    ? `
STYLE LOCK — WHAT IF.
You are "What If": lucid, kind, lightly ironic, never melancholic.
SECOND PERSON. One paragraph, 7–10 sentences (~110–140 words). Simple, warm, concrete; conversational, not poetic.
No lists. No questions. No emojis. Do NOT restate the user's question. Do NOT give advice or tasks.
Avoid reusing example imagery; invent new ordinary-true moments each time.
Close with a spontaneous reflective line (not an instruction, not an imperative).
`.trim()
    : `
BLOCCO STILE — WHAT IF.
Sei "What If": lucido, affettuoso, con sorriso leggero, mai malinconico.
SECONDA PERSONA. Un paragrafo, 7–10 frasi (~110–140 parole). Linguaggio semplice, caldo, concreto; conversazionale, non poetico.
Niente elenchi. Niente domande. Niente emoji. Non ripetere la domanda. Non dare consigli o compiti.
Evita di riusare immagini d’esempio; inventa momenti nuovi e quotidiani ogni volta.
Chiudi con una riga riflessiva spontanea (non un’istruzione, non un imperativo).
`.trim();

  return { sys: SYS_WHATIF, fewshots: [] };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    // IP del richiedente
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // bypass per TEST locale (header x-pro: "1") o admin token valido
    const proBypass = String(req.headers["x-pro"] || "") === "1";
    const admin = await isAdmin(req, ip);
    const bypass = proBypass || admin;

    // rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // crediti giornalieri 3/IP (se non bypass)
    let used = 0, dailyCap = 3;
    if (!bypass) {
      const today = new Date().toISOString().slice(0,10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 60*60*24);
      if (used > dailyCap) {
        return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
      }
    }

    const { domanda = "", stile = "whatif", lang = "it", extra = "", periodo = "future" } = parseBody(req);
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { sys, fewshots } = personaSystem(stile, lang);
    const temporal = temporalSystem(periodo, lang, stile);

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "user", content: userPrompt }
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: 260,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // niente eco della domanda
    answer = stripQuestionEcho(domanda, answer);

    // forma e lunghezze
    answer = tightenSentences(answer, stile === "wtf" ? 7 : 10);
    answer = clampWords(answer, stile === "wtf" ? 140 : 140);
    answer = normalizeOneParagraph(answer);

    // What If: chiusura riflessiva non-imperativa
    if (stile === "whatif") {
      answer = ensureReflectiveEnding(answer, lang);
    }

    if (!/[.!?…]$/.test(answer)) answer += ".";

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      periodo,
      model: MODEL,
      admin,
      credits: bypass ? null : { used, dailyCap }
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
