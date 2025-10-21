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

/* ---------- Fix WTF meta & puntatura ---------- */
function stripPunchlineMeta(t){
  let out = String(t||"");
  out = out.replace(/\b[pP]unchline\b[:?]?\s*/g, "");
  return out;
}
function ensureNoTrailingQuestion(t){
  let out = String(t||"").trim();
  if (/[?]+$/.test(out)) out = out.replace(/[?]+$/, ".");
  return out;
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
    // WHAT THE F — demenziale narrativo con oggetti parlanti (sempre, anche su temi seri), tono fissato
    const SYS = isEn(lang)
      ? `
You are “What the F” — angry–enlightened, gloriously messy, self-deprecating, secretly tender.
SECOND PERSON. ONE paragraph, 5–7 LONG sentences (~110–140 words).
Open in-scene; elastic, chained sentences with vivid cinematic details and timing-based jokes.
Talking objects are part of the narrator’s world: 1–3 per story, speaking or acting at the right plot beat (never all at once), doing impossible, funny things that heighten the scene and defuse tension (e.g., a moka giving relationship advice, a mirror staging an intervention, a coat rack filing a complaint).
Use this surreal device EVEN for serious questions to gently defuse; end with a soothing, reassuring final line.
No lists. No questions. No emojis. No moralizing. Do NOT restate the user’s question. Respect temporal mode (past = true counterfactual; future = plausible near-future). Keep this exact voice ALWAYS.
`.trim()
      : `
Sei “What the F” — incazzato illuminato, gloriosamente incasinato, autoironico e segretamente affettuoso.
SECONDA PERSONA. UN paragrafo, 5–7 frasi LUNGHE (~110–140 parole).
Entra in scena; frasi a catena elastiche, dettagli cinematografici, battute a tempo.
Gli oggetti PARLANO e AGISCONO: 1–3 per storia, al momento giusto (mai tutti insieme), facendo cose impossibili e comiche che amplificano la scena e sdrammatizzano (es. la moka dà consigli di coppia, lo specchio indice un’assemblea, l’appendiabiti sporge reclamo).
Usa sempre questo espediente anche su temi seri, chiudendo con una riga finale che consola.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. NON ripetere la domanda. Rispetta la modalità temporale (passato = controfattuale vero; futuro = plausibile). Mantieni SEMPRE questo timbro.
`.trim();

    const FEWSHOTS = [
      // ===== ITALIANO =====
      {
        role: "system",
        content: `ESEMPIO IT • E se cambiassi città?
Arrivi con tre valigie, due rimorsi e un tostapane che ti squadra dal ripiano come il portiere di un club escluso, l’appartamento è beige trauma e il citofono risponde solo ai corrieri sbagliati, così per i primi giorni parli col frigo che sospira da zio stanco e ti comunica che l’ottimismo non passa la cassa; poi, una sera di pioggia fluorescente, tre spritz e un kebab filosofico, ridi da solo sul marciapiede e la città, che fingeva indifferenza, ti prende per mano con il neon storto dei bar aperti, mentre lo specchio dell’ingresso indice un’assemblea e vota una versione di te più gentile, il tram fischia come un sassofono con l’asma, e in quel caos tenero capisci che ricominciare non è eroico ma umano, e ti accorgi che sei ancora intero—solo più vero.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se aprissi un bar?
Lo chiami “La Rinascita”, il commercialista propone “Vediamo”, il bancone scricchiola come un amico che ha visto cose e la macchina del caffè fuma da reduce, finché la moka, con tono da zia, ti consiglia di flirtare meno coi preventivi e più con le tazze, mentre il registratore di cassa fa il broncio e il frigo canticchia un pezzo anni ’90; a notte fonda versi un Negroni storto a uno che giura di aver inventato il Wi-Fi e capisci che nessun business plan batte la geografia dei volti, e quando chiudi restano due luci, tre risate e quell’aria di zucchero bruciato e possibilità, abbastanza per sapere che forse non sarai ricco, ma sei già al sicuro nella vita che ti somiglia.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se vivessi in camper?
Parti feroce e dopo dieci chilometri il GPS ti chiama “eroe al contrario”, l’antenna pesca solo canali che ricordano perché scappi e la padella vibra di nervi a ogni curva; al tramonto il vento suona l’armonica, un vecchio Labrador ti adotta per compassione e il fornello, serissimo, ti chiede se oggi cucini o preghi; ridi perché la libertà non è un manifesto ma una caviglia impolverata che dice andiamo, la notte profuma di birra tiepida e tregua breve, abbastanza lunga da farti capire che la felicità non ha indirizzo: ha ruote storte e un cuore che tiene botta.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se tornassi con l’ex? (passato/controfattuale)
Hai suonato come uno che entra a un funerale sperando nel buffet, lei ha aperto e il tempo è andato in retromarcia per divertirsi; avete riso, ricordato, il vino è scivolato come un’amnesia con ghiaccio, la moka ha sussurrato “questa puntata l’ho già vista” e il divano, alleato, ha trattenuto due lacrime e tre scuse, e dopo i brindisi avete capito che non siete tornati insieme: siete tornati voi, due geni del pasticcio con talento per gli anticlimax; il saluto è stato piano, il tipo che archivia la serata in “bozze salvate” e lascia al silenzio il compito di rimettere a posto i battiti.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se scappassi ai tropici?
Due voli, tre panici, un mojito a prezzo mutuo, il mare che fa propaganda, il barista ti chiama “fratello” e il conto in banca “poeta”, lavori finché la sabbia decide di essere il tuo mousepad, un granchio attraversa la spiaggia con più autostima di te e l’ombrellone, in voce da life coach, ricorda che l’ombra non è fuga ma ritmo; quando arrivano le stelle capisci che non stavi scappando: stavi solo cambiando la colonna sonora del tuo casino, e per una volta il rumore ti abbraccia invece di spaventarti.`
      },

      // ===== ENGLISH =====
      {
        role: "system",
        content: `EXAMPLE EN • What if I changed city?
You arrive with three suitcases, two regrets, and a toaster judging you from the counter like a bouncer on probation; the flat comes in trauma-beige and the buzzer only answers wrong deliveries, so for days you talk to the fridge, which sighs like a tired uncle and reminds you optimism doesn’t pay for groceries, until one neon-slick night—three spritzes and a philosophical kebab—you laugh on the curb and the city, pretending not to care, quietly takes your hand, the hallway mirror calls a vote for a kinder face, the tram wheezes like an asthmatic sax, and starting over stops being heroic and starts being human; you’re still in one piece, and now you finally look like it.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I opened a bar?
You name it “The Comeback,” the accountant suggests “We’ll See,” the counter creaks like an honest friend, the espresso machine smokes like a veteran, then the moka, in aunt-tone, says to flirt less with spreadsheets and more with cups while the register sulks and the fridge hums a 90s chorus; near midnight you pour a lopsided Negroni for a guy who claims he invented Wi-Fi and realize no business plan beats the map of faces, and when you close, two lights, three laughs and that burnt-sugar possibility air remain—maybe you won’t be rich, but you’re already inside a life that fits.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I lived in a van?
You launch heroic and ten miles in the GPS calls you a reverse legend, the antenna pulls channels that remember why you left, your skillet buzzes at every missed turn; dusk arrives with harmonica wind, an elderly lab adopts you, and the stove, very serious, asks whether you plan to cook or pray; you laugh because freedom isn’t a poster, it’s a dusty ankle that says go, the night smells like warm beer and brief truce, long enough to learn happiness has no address—just wobbly wheels and a stubborn heart.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I got back with my ex? (past/counterfactual)
You rang the bell like someone attending a funeral hoping for the buffet, she opened and time reversed for kicks; you talked and laughed and the wine slid like amnesia on ice, the moka muttered “seen this episode,” the couch held two tears and three apologies, and after the clink you understood you didn’t get back together—you got back to being you two, prodigies of beautiful mess with a gift for anticlimax; the goodbye was gentle, the kind that files the night under saved drafts and lets the quiet tuck you in.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I escaped to the tropics?
Two flights, three panics, a mortgage-priced mojito, a sea that’s propaganda, the bartender calls you “brother,” your bank account calls you “poet,” you work until the sand decides to be your mousepad, a crab crosses with more confidence than your LinkedIn, and the umbrella, in coach voice, says shade is rhythm not retreat; by starlight you get it—you weren’t running away, just changing the soundtrack of your chaos, and for once the noise hugs you back.`
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
      temperature: stile === "wtf" ? 0.75 : 0.82,  // fissaggio stile WTF
      top_p: 0.9,
      max_tokens: 260,
      frequency_penalty: stile === "wtf" ? 0.6 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
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

    // fix meta+punti per WTF
    if (stile === "wtf") {
      answer = stripPunchlineMeta(answer);
      answer = ensureNoTrailingQuestion(answer);
    }

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
