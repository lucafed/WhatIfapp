// ============================
// /api/ask.js — What?f Engine
// Stili: "whatif" (Realismo Controfattuale con Luce) · "wtf" (Demenziale autoironico)
// IT/EN — un paragrafo, niente liste/domande/emoji
// Supporta `tempo`: "presente" | "passato" (controfattuale)
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

// rate limit: 10 req/min per IP (bypass con admin/pro)
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

// normalizza frasi, evita duplicati, chiusura a punto
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

// rimuove un eventuale eco della domanda all'inizio della risposta
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const head = t.slice(0, Math.min(t.length, d.length + 8)).toLowerCase().replace(/[“”"']/g, "").trim();
  if (head.startsWith(d) || head.startsWith("domanda:") || head.startsWith("q:")) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  return t;
}

// chiusure morbide (no compiti) per What If
function ensureReflectiveEnding(text, lang) {
  const t = String(text || "").trim();
  if (!t) return t;
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  const last = sentences.pop() || "";
  const lowerLast = last.trim().toLowerCase();

  const itImperatives = [/^prova\b/, /^fai\b/, /^metti\b/, /^chiama\b/, /^scrivi\b/, /^inizia\b/, /^oggi\b/];
  const enImperatives = [/^try\b/, /^do\b/, /^start\b/, /^write\b/, /^call\b/, /^today\b/];
  const isImp = (lang || "it").startsWith("en")
    ? enImperatives.some((r) => r.test(lowerLast))
    : itImperatives.some((r) => r.test(lowerLast));

  const IT_ENDINGS = [
    "E ti accorgi che la scelta non fa rumore: coincide.",
    "E scopri che non serviva una mappa: bastava riconoscerti.",
    "E capisci che non hai perso tempo: hai cambiato misura.",
    "E ti sorprende quanto è semplice quando smetti di trattenere il respiro.",
    "E all’improvviso è chiaro: non era un rimpianto, era una strada parallela."
  ];
  const EN_ENDINGS = [
    "And you notice the choice doesn’t make noise — it fits.",
    "And it turns out you didn’t need a map — just recognition.",
    "And you see it wasn’t lost time — just a different measure.",
    "And it’s simple once you stop holding your breath.",
    "And suddenly it’s clear: not regret, just a parallel road."
  ];
  const pool = (lang || "it").startsWith("en") ? EN_ENDINGS : IT_ENDINGS;
  const tooShort = last.split(/\s+/).length < 4;
  const finalLine = (isImp || tooShort) ? pool[Math.floor(Math.random() * pool.length)] : last;
  return normalizeOneParagraph([...sentences, finalLine].join(" "));
}

/* ---------- Personas ---------- */
function personaSystem(style, lang, tempo = "presente") {
  const isPast = String(tempo || "presente").toLowerCase().startsWith("pass");
  if (style === "wtf") {
    // WHAT THE F — demenziale/autoironico (prima calibrazione)
    const SYS = (isEn(lang)
      ? `
You are “What the F” — a deliriously funny, self-roasting narrator with heart.
SECOND PERSON. ONE paragraph. 6–8 sentences (~120–160 words). Flowing narration, not choppy.
Hyperreal everyday mess, punchy images, gentle swearing only if it truly lands.
No lists. No questions. No emojis. No moralizing. Never repeat the user’s question.
End on a zinger that makes the reader laugh at themselves and feel oddly seen.
`.trim()
      : `
Sei “What the F” — narratore demenziale, autoironico, con cuore sotto l’incazzatura.
SECONDA PERSONA. UN paragrafo. 6–8 frasi (~120–160 parole). Narrazione scorrevole, non a singhiozzi.
Caos quotidiano iper-reale, immagini argute, parolacce leggere solo se servono davvero.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Non ripetere la domanda.
Chiudi con una battuta che fa ridere di te stesso e ti fa sentire paradossalmente capito.
`.trim());

    // ESEMPI — IT & EN (tanti, vari, senza eco domanda)
    const FEWSHOTS = [
      // ====== IT ======
      { role: "system", content: `ESEMPIO IT • Trasloco improvvisato
Ti alzi in modalità campione del mondo e dopo tre scatoloni scopri che il tuo trofeo è una busta di scontrini del 2017. Trascini un mobile che scricchiola in una lingua antica e si vendica sul tuo alluce con la precisione di un cecchino gentile. Ti prometti ordine, poi nascondi il caos in un cassetto che non si chiude e lo chiami minimalismo creativo. Quando finalmente ti siedi, il pavimento decide di dire la sua con un cigolio da teatro d’avanguardia. E ridi, perché l’unico oggetto davvero in ordine sei tu: stanco, storto, ma stranamente al posto giusto.` },
      { role: "system", content: `ESEMPIO IT • Giornata da eroe con scadenze
Esci in anticipo di otto minuti e la città te li ruba tutti con un semaforo meditativo. Provi a essere adulto, ma l’agenda è un origami che ti giudica e tu gli rispondi con un caffè che sa di vendetta cortese. A metà pomeriggio hai già concluso tre tentativi e mezzo, che è comunque più della media dei supereroi fuori servizio. Poi succede la magia: qualcosa fila, non sai nemmeno perché, e ti viene voglia di cantare a bassa voce per non spaventare la fortuna. Ti concedi un sorriso largo da promozione interna e capisci che oggi non hai vinto: hai resistito con stile.` },
      { role: "system", content: `ESEMPIO IT • Palestra del coraggio minimo
Vai in palestra come se stessi andando a un duello, poi ti guardi allo specchio e fai pace con la faccia da “principiante con dignità”. La panca ti accoglie come un sedile pubblico: non giudica, ma prende appunti. Conti le ripetizioni come fossero anni di regno e l’ultima ha la stessa energia di un brindisi in piedi. Esci sudato e fiero, posi la bottiglia con l’eleganza di chi ha appena firmato un trattato di pace con il proprio fiato. E ti scappa da ridere: non sei diventato potente, sei diventato possibile.` },
      { role: "system", content: `ESEMPIO IT • Serata di cucina ottimista
Dichiari cena gourmet e ti ritrovi un riso che crede di essere neve e una padella che fa meteorologia autonoma. Mescoli con la serietà di un direttore d’orchestra mentre l’orchestra suona un genere nuovo: pasticcio sinfonico in maggiore. Impiatti come puoi, inventi un nome francese, e all’improvviso è tutto buono perché porta la tua firma scema e testarda. E lì capisci che certe ricette non si mangiano: si raccontano.` },
      // ====== EN ======
      { role: "system", content: `EXAMPLE EN • Monday heroics
You step out eight minutes early and donate them all to a traffic light that practices mindfulness. You try being an adult but your planner folds into judgmental origami and you answer with coffee that tastes like polite revenge. By mid-afternoon you’ve completed three attempts and a half, which still beats most off-duty superheroes. Then something clicks for no scientific reason and you hum quietly so luck won’t notice you bragging. You didn’t win the day; you styled it.` },
      { role: "system", content: `EXAMPLE EN • Domestic Olympics
You lift a box that claims to weigh “light” and discover it’s emotionally dense. The bookcase negotiates with your spine in fluent creak, and the tape measure retires mid-shift. You meal-prep ambition and serve yourself a plate of almost. And you grin, because apparently competence isn’t sexy—survival with good manners is.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — realismo lucido (presente) + controfattuale narrato (passato)
  const isPast = String(tempo || "presente").toLowerCase().startsWith("pass");
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, warm narrator. Simple language. No advice. No tasks. No questions.
SECOND PERSON. One paragraph. 8–10 sentences (~130–170 words). Do not repeat the user’s question.
When time=PAST: tell the counterfactual version of their life AS IF it really happened in a parallel timeline:
show small human moments, no melodrama, end with a bright reflection, never imperative.
When time=PRESENT: grounded clarity with a gentle smile, hopeful tone, end with a short wow-line, never imperative.
`.trim()
    : `
Sei "What If" — narratore lucido e caldo. Linguaggio semplice. Niente consigli. Niente compiti. Niente domande.
SECONDA PERSONA. Un paragrafo. 8–10 frasi (~130–170 parole). Non ripetere la domanda.
Se tempo=PASSATO: racconta la versione controfattuale della sua vita COME SE fosse davvero accaduta in una linea parallela:
momenti umani piccoli, zero melodramma, chiusura luminosa, mai imperativi.
Se tempo=PRESENTE: chiarezza concreta con sorriso leggero, tono fiducioso, chiusura "wow" breve, mai imperativi.
`.trim());

  // FEWSHOTS What If: molti esempi, IT/EN; alcuni in passato (controfattuale), altri in presente
  const FEWSHOTS = [
    // ====== IT • PRESENTE ======
    { role: "system", content: `ESEMPIO IT (presente) • Ritmo ritrovato
Cammini più piano e le cose non ti scappano, ti vengono incontro. Parli meno forte e la voce non si rompe: finalmente si sente. Le giornate non fanno scena, ma tengono: piccole file di attimi che restano al loro posto. Le persone non cambiano, le vedi meglio. Togli due aspettative, resta spazio che profuma di aria nuova. Non diventi un’altra persona: diventi te, senza sovratitoli. E quando chiudi la porta la sera, c’è silenzio ma non è vuoto: è pace che ha imparato il tuo nome.` },
    { role: "system", content: `ESEMPIO IT (presente) • Casa nel caos buono
Non sistemi tutto: sistemi abbastanza. Due cose a posto e il resto smette di urlare. Ti concedi il lusso di non correre e scopri che la fretta non era carattere, era rumore. I giorni si somigliano quel tanto che basta per sentirti stabile, ma dentro c’è movimento buono. Metti in fila i pensieri come libri corti: pochi, ma leggibili. E ti accorgi che la serenità non si conquista: si riconosce.` },

    // ====== IT • PASSATO (CONTROFATTUALE) ======
    { role: "system", content: `ESEMPIO IT (passato) • Se fossi rimasto
Se fossi rimasto, non sarebbe stata resa: avresti scelto un tempo più lungo per le stesse cose. Le mattine ti avrebbero preso con delicatezza, e i volti intorno avrebbero imparato la forma del tuo passo. Avresti sbagliato comunque, ma senza fretta, e quei piccoli errori sarebbero diventati legna asciutta per il fuoco buono delle sere. Non saresti stato un altro: saresti stato te, con una luce laterale. E un giorno, guardando fuori, avresti capito che la felicità era qui da sempre, solo che parlava piano.` },
    { role: "system", content: `ESEMPIO IT (passato) • Se avessi cambiato città
Se avessi cambiato città, all’inizio ti avrebbe fatto paura il silenzio delle abitudini spezzate. Poi sarebbe diventato un invito. Avresti trovato volti che non ti chiedevano nulla, e proprio per questo ti avrebbero visto. Ti saresti perso il giusto, quanto basta per meritarti la gioia di ritrovarti in una strada qualsiasi. Le domeniche non sarebbero state migliori: sarebbero state tue. E avresti capito che non avevi bisogno di reinventarti: ti bastava riconoscerti.` },

    // ====== EN • PRESENT ======
    { role: "system", content: `EXAMPLE EN (present) • Clear days
You move slower and the day doesn’t leak away. The room is the same size, but it stops shrinking. People don’t change, your lens does. Two honest habits stay and the noise leaves without drama. You don’t perform calm; you let it happen. And by evening you realize you haven’t become new, you’ve become clear.` },
    { role: "system", content: `EXAMPLE EN (present) • Everyday light
You keep what holds and let the rest be background. Routines stop pretending to be a personality and start being a quiet floor. Doubt still visits, just not as a landlord. Your name sits right in your own mouth. And the future isn’t loud anymore; it’s close.` },

    // ====== EN • PAST (COUNTERFACTUAL) ======
    { role: "system", content: `EXAMPLE EN (past) • If you had stayed
If you had stayed, it wouldn’t have been smaller, just closer. Mornings would have unfolded like careful paper, and the familiar streets would have kept your pace without asking for proof. You would have failed in tiny, useful ways and learned the shape of your patience. Not a different person — the same, with the light coming from the side. And one evening you’d have noticed it quietly: you didn’t miss the train; you chose the platform where you could breathe.` },
    { role: "system", content: `EXAMPLE EN (past) • If you had left
If you had left, the first weeks would have felt like a loose knot. Then it would have held. You’d have met people who didn’t know your history and liked you anyway. You’d have gotten lost just enough to earn the joy of finding your own door. Sundays wouldn’t be better; they’d be yours. And the word home would have turned into a verb.` },
  ];
  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
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

    // bypass: x-pro=1 o admin-token valido
    const proBypass = String(req.headers["x-pro"] || "") === "1";
    const admin = await isAdmin(req, ip);
    const bypass = proBypass || admin;

    // rate limit 10/min
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // crediti 3/dì
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

    const { domanda = "", stile = "whatif", lang = "it", extra = "", tempo = "presente" } = parseBody(req);
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { sys, fewshots } = personaSystem(stile, lang, tempo);

    // prompt utente: niente compiti/imperativi, niente eco
    const userPrompt = isEn(lang)
      ? [
          `User intent: "${String(extra || "").trim()}"`,
          `Tone constraints: simple, human, no lists, no questions, no emojis, no advice.`,
          `Do not restate the question.`,
          `Temporal mode: ${String(tempo || "present").toUpperCase()}.`,
          `Write exactly ONE paragraph in the persona voice.`
        ].join("\n")
      : [
          `Contesto utente: "${String(extra || "").trim()}"`,
          `Vincoli di tono: linguaggio semplice, umano; niente elenchi, niente domande, niente emoji, niente consigli.`,
          `Non ripetere la domanda.`,
          `Modalità temporale: ${String(tempo || "presente").toUpperCase()}.`,
          `Scrivi ESATTAMENTE UN paragrafo nella voce della persona.`
        ].join("\n");

    const messages = [{ role: "system", content: sys }, ...(fewshots || []), { role: "user", content: userPrompt }];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.82,
      top_p: 0.9,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-processing
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 160 : 170);
    answer = normalizeOneParagraph(answer);
    if (stile === "whatif") {
      answer = ensureReflectiveEnding(answer, lang);
    }
    if (!/[.!?…]$/.test(answer)) answer += ".";

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      model: MODEL,
      admin,
      credits: bypass ? null : { used, dailyCap }
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
