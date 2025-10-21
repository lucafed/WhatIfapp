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
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n) continue;
    if (seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue;
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
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}

function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
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
  // opzionale: mapping admin token -> ip (gestito da /api/admin-token.js)
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
  const isImperative = L.startsWith("en") ? enImp.some((r) => r.test(last)) : itImp.some((r) => r.test(last));

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
    ? soft[Math.floor(Math.random() * soft.length)]
    : last;

  const merged = [...sentences, finalLine].join(" ");
  return normalizeOneParagraph(merged);
}

/* ---------- Modalità temporale (Passato/Futuro) ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if ((periodo || "").toLowerCase() === "past") {
    // controfattuale (passato): usare davvero passato/condizionale
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Write as if the choice HAD BEEN made back then. Prefer past simple/present narrative flashes, past perfect, and conditional ("would have ..."). Keep tense consistency. Do NOT drift to future tense. Do NOT give advice. Do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Scrivi come se quella scelta fosse già avvenuta allora. Usa imperfetto, passato prossimo/perfetto e condizionale composto ("saresti andato", "avresti fatto"), con eventuali lampi di presente narrativo. Mantieni coerenza dei tempi. NON scivolare al futuro. NON dare consigli. NON ripetere la domanda. Mantieni la voce ${style.toUpperCase()}.`;
  }
  // futuro/prospettico
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if the user were stepping into it now. No lists, no advice, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente elenchi, niente consigli, niente domande, niente eco della domanda. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (WHAT IF invariato • WHAT THE F riscritto e fissato) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — tono fissato + esempi narrativi (IT/EN)
    const SYS = isEn(lang)
      ? `
You are “What the F” — angry–enlightened, gloriously messy, self-deprecating and secretly tender.
SECOND PERSON. ONE paragraph, 5–7 LONG sentences (~110–140 words).
Open in-scene; elastic, chained sentences with vivid, cinematic details.
Sarcastic, streetwise, a bit chaotic; light swearing only if it truly lands; boozy misadventures welcome.
No lists. No questions. No moralizing. Do NOT restate or paraphrase the user’s question.
Respect temporal mode (past = true counterfactual; future = plausible near-future).
Always end with a punchline that stings and soothes. Keep this voice rigidly consistent.
`.trim()
      : `
Sei “What the F” — incazzato illuminato, gloriosamente incasinato, autoironico e segretamente affettuoso.
SECONDA PERSONA. UN paragrafo, 5–7 frasi LUNGHE (~110–140 parole).
Entra in scena subito; ritmo elastico con frasi a catena e dettagli vividi e cinematografici.
Sarcastico, di strada, un filo caotico; parolacce leggere solo se servono; sbronze e micro-disastri benvenuti.
Niente elenchi. Niente domande. Niente prediche. NON ripetere o parafrasare la domanda.
Rispetta la modalità temporale (passato = vero controfattuale; futuro = prossimo plausibile).
Chiudi sempre con una punchline che punge e consola. Mantieni SEMPRE questo timbro.
`.trim();

    const FEWSHOTS = [
      // ===== ITALIANO (5) =====
      {
        role: "system",
        content: `ESEMPIO IT • E se cambiassi città?
Ti trasferisci con tre valigie, due rimorsi e un tostapane che ti giudica dal ripiano. L’appartamento ha il beige del trauma e un citofono che risponde solo ai corrieri sbagliati; i primi giorni parli col frigo, che sospira come uno zio e ti ricorda che la spesa non si paga con l’ottimismo. Poi, una sera, tre spritz e un kebab zen, ridi da solo sul marciapiede e la città capisce che non sei pericoloso, solo testardo. Le strade ti prendono per mano con il neon storto dei bar aperti troppo tardi, il tram fischia come un vecchio sassofono, e all’improvviso ricominciare sembra solo una scusa per brindare con più stile. Ti senti fuori posto, certo, ma a volte il posto giusto è proprio quello che ti sta prendendo in giro con affetto.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se aprissi un bar?
Lo chiami “La Rinascita”, poi il commercialista propone “Vediamo”. Il bancone scricchiola come un amico sincero, la macchina del caffè fuma da reduce, e i primi clienti sembrano usciti da un casting di comparse filosofiche. Dopo una settimana hai tre conti aperti, due storie inutili e una sedia che ti dà del tu; una notte versi un Negroni storto a uno che giura di aver inventato il Wi-Fi, e capisci che la vita non è un business plan ma un dopolavoro dell’anima. Il frigo canta piano, il registratore di cassa fa i capricci e, quando chiudi, restano le persone giuste e l’aria che sa di zucchero bruciato e possibilità. Ti dici che forse non diventerai ricco, ma intanto sei diventato vero, che è più caro e più bello.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se vivessi in camper?
Parti convinto: GPS in tasca e ego al volante. Dopo dieci chilometri il GPS ti chiama “eroe al contrario”, la moka dichiara sciopero e l’antenna prende solo canali che ricordano perché scappi. Ti accampi dove il vento suona l’armonica, un Labrador ti adotta per compassione e la padella vibra di nervi quando sbagli curva. La notte arriva con profumo di birra calda e libertà tiepida, e per la prima volta non devi sistemare niente: solo respirare. Il mondo passa a passo d’uomo e tu, finalmente, pure. Scopri che la felicità non ha indirizzo fisso: ha ruote sghembe e un cuore che tiene botta.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se tornassi con l’ex?
Suoni come uno che va a un funerale ma spera nel buffet; lei apre e il tempo fa retromarcia per divertirsi. Ridete, ricordate, il vino scivola come un’amnesia con ghiaccio; la moka, stufa, commenta che ha già visto questa puntata. Nel silenzio dopo i brindisi capite che non siete tornati insieme: siete tornati voi, cioè due geni del pasticcio con talento per l’anticlimax. Vi salutate piano, con la tenerezza di un film che sa smettere, e archivi la serata in “bozze salvate”.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se mollassi tutto e andassi ai tropici?
Due voli, tre ansie e un mojito dal costo di un mutuo, arrivi. Il mare è propaganda, il barista ti chiama “fratello” e il conto in banca “pirla”; lavori al laptop fino a quando la sabbia decide che è il suo mousepad. La sera un granchio attraversa la spiaggia con più autostima di te e tu capisci che non stai scappando: stai solo cambiando colonna sonora al tuo caos. Un altro drink, un’altra sincerità: la libertà non è lontano, è quando smetti di inseguire la versione sobria di te stesso.`
      },

      // ===== ENGLISH (5) =====
      {
        role: "system",
        content: `EXAMPLE EN • What if I changed city?
You arrive with three suitcases, two regrets, and a toaster that judges you from the counter. The flat is painted in trauma beige and the buzzer only answers wrong deliveries; for days you talk to the fridge, which sighs like an uncle and reminds you optimism doesn’t pay for groceries. Then one night—three spritzes and a philosophical kebab—you laugh alone on the curb and the city decides you’re not dangerous, just stubborn. Streets take you by the hand with crooked neon, the tram wheezes like an old sax, and suddenly starting over feels like an excuse to toast with better glassware. You’re out of place, sure, but sometimes the right place is the one roasting you with love.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I opened a bar?
You name it “The Comeback,” the accountant suggests “We’ll See.” The counter creaks like an honest friend, the espresso machine smokes like a veteran, and your first customers look like extras with philosophy minors. A week later you’ve got three tabs, two complicated crushes, and a chair that calls you by your first name; one night you pour a lopsided Negroni for a guy who claims he invented Wi-Fi and you realize life isn’t a business plan, it’s after-hours for the soul. The fridge hums, the register sulks, and when you close, the right people remain and the air tastes like burnt sugar and possibility. Maybe you won’t get rich, but you’re getting real—expensive, and worth it.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I lived in a van?
You start heroic; ten miles in, the GPS calls you a legend in reverse, the moka goes on strike, the antenna picks channels that remember why you left. You camp where the wind plays harmonica; an old lab adopts you out of pity; your skillet vibrates with nerves every time you miss a turn. Night arrives smelling of warm beer and lukewarm freedom, and for once there’s nothing to fix—just breathing. The world moves at walking speed, and finally, so do you. Turns out happiness doesn’t have an address; it has wobbly wheels and a stubborn heart.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I got back with my ex?
You ring the bell like someone attending a funeral but hoping for the buffet; she opens, time hits reverse for laughs. You talk, you laugh, wine slides like amnesia on ice; the moka, fed up, says she’s seen this episode. After the clink of glasses, you both realize you didn’t get back together—you got back to being you two: gifted chaos with a flair for anticlimax. You say goodbye softly, like a film that knows where to stop, and file the night under “saved drafts.”`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I escaped to the tropics?
Two flights, three panics, a mortgage-priced mojito, and you land. The sea is propaganda, the bartender calls you “brother,” your bank account calls you “clown”; you work on the laptop until the sand decides to be your mousepad. A crab crosses the beach with more confidence than you and you understand you’re not running away—you’re just changing the soundtrack of your chaos. Another drink, another truth: freedom isn’t far away, it’s when you stop chasing your sober version.`
      }
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — invariato (finale riflessivo)
  const SYS_WHATIF = isEn(lang)
    ? `
You are "What If" — lucid, kind, lightly ironic, never melancholic.
SECOND PERSON. One paragraph, 7–10 sentences (~110–140 words).
Simple, warm, concrete language; conversational, not poetic. No lists. No questions. No emojis.
Do NOT restate the user's question. Do NOT give advice or tasks.
Avoid repeating example imagery; create new, ordinary-yet-true moments every time.
Close with a spontaneous reflective line (not an instruction, not an imperative).
`.trim()
    : `
Sei "What If" — lucido, affettuoso, con sorriso leggero, mai malinconico.
SECONDA PERSONA. Un paragrafo, 7–10 frasi (~110–140 parole).
Linguaggio semplice, caldo, concreto; conversazionale, non poetico. Niente elenchi. Niente domande. Niente emoji.
NON ripetere la domanda dell’utente. NON dare consigli o compiti.
Inventa momenti nuovi e quotidiani ogni volta.
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
      const today = new Date().toISOString().slice(0, 10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 60 * 60 * 24);
      if (used > dailyCap) {
        return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
      }
    }

    const { domanda = "", stile = "whatif", lang = "it", extra = "", periodo = "future" } = parseBody(req);
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { sys, fewshots } = personaSystem(stile, lang);

    // system add-on per Passato/Futuro (senza cambiare la voce)
    const temporal = temporalSystem(periodo, lang, stile);

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal }, // 👈 modalità passato/futuro
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

    // lunghezze/forma come prima
    answer = tightenSentences(answer, stile === "wtf" ? 7 : 10);
    answer = clampWords(answer, stile === "wtf" ? 130 : 140);
    answer = normalizeOneParagraph(answer);

    // whatif: garantisci finale riflessivo non-imperativo
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
