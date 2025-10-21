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

function parseBody(req) {
  try {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (req.body && typeof req.body === "object") return req.body;
  } catch {}
  return {};
}

// rimuove un eventuale eco della domanda all'inizio della risposta
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t.slice(0, Math.min(t.length, d.length + 6)).toLowerCase().replace(/[“”"']/g, "").trim();
  if (lead.startsWith(d) || lead.startsWith(`q:`) || lead.startsWith(`domanda:`)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  return t;
}

// ---------- NUOVA CHIUSURA NATURALE VARIABILE PER WHAT?F ----------
function ensureReflectiveEnding(text, lang) {
  const t = String(text || "").trim();
  if (!t) return t;

  // separa ultima frase
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  const last = sentences.pop() || "";
  const lowerLast = last.trim().toLowerCase();

  const itImperatives = [/^prova\b/, /^fai\b/, /^metti\b/, /^chiama\b/, /^scrivi\b/, /^inizia\b/, /^oggi\b/];
  const enImperatives = [/^try\b/, /^do\b/, /^start\b/, /^write\b/, /^call\b/, /^today\b/];

  const isImperative = (lang || "it").startsWith("en")
    ? enImperatives.some((r) => r.test(lowerLast))
    : itImperatives.some((r) => r.test(lowerLast));

  // pool di chiusure morbide, variabili, senza imperativi
  const IT_ENDINGS = [
    "E ti accorgi che il respiro è la tua misura.",
    "E capisci che la calma non fa rumore, però resta.",
    "Ti sorprende scoprire che la semplicità tiene meglio del previsto.",
    "E in quel momento, la scelta non spinge: coincide.",
    "E capisci che non stai scappando: stai scegliendo.",
  ];
  const EN_ENDINGS = [
    "And you notice your breath is the measure.",
    "It turns out quiet doesn’t shout, but it stays.",
    "Simplicity holds better than you expected.",
    "And in that moment, the choice doesn’t push — it fits.",
    "It’s clear you’re not running; you’re choosing.",
  ];
  const soft = (lang || "it").startsWith("en") ? EN_ENDINGS : IT_ENDINGS;

  // se l'ultima è imperativa/consiglio o è troppo corta, sostituisci
  const tooShort = last.split(/\s+/).length < 4;
  const finalLine = (isImperative || tooShort) ? soft[Math.floor(Math.random() * soft.length)] : last;

  return normalizeOneParagraph([...sentences, finalLine].join(" "));
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

/* ---------- Personas (PROMPT AGGIORNATI) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — Incazzato Illuminato (resta tagliente e comico)
    const SYS = (isEn(lang)
      ? `
You are “What the F” — angry–enlightened, tragicomic, tender under the snarl.
SECOND PERSON. ONE paragraph. 6–8 sentences (~120–160 words).
Voice: sharp, street-wise, sarcastic but human; let the everyday chaos trip and laugh.
No lists. No questions. No emojis. No moralizing. Light swearing only if it truly lands.
Always end with a punchline that stings and soothes, never preachy.
`.trim()
      : `
Sei “What the F” — incazzato illuminato, tragicomico, affettuoso sotto il ringhio.
SECONDA PERSONA. UN paragrafo. 6–8 frasi (~120–160 parole).
Voce tagliente, ritmo da strada, sarcasmo umano; lascia inciampare il caos e riderci sopra.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere solo se servono davvero.
Chiudi con una battuta che punge e consola, mai predica.
`.trim());

    const FEWSHOTS = [
      {
        role: "system",
        content: `ESEMPIO IT • E se tornassi a vivere all’Aquila?
Arrivi con la posa di chi ha fatto pace col mondo e il mondo ti risponde con il vento che ti sfila pure le certezze. In centro ti salutano tutti tranne il destino, che fa finta di cercare parcheggio da dieci anni. Dichiari “nuovo inizio”, poi finisci a bere con tuo cugino che riassume il 2012 come una serie con troppe stagioni e zero finali. Ti arrabbi, ti sciogli, fai pace con le pietre e con le abitudini che credevi morte, e scopri che certe crepe sanno ancora tenere caldo. Quando cala la sera tutto sembra più vero, anche te. E ti scappa da ridere: sei un casino bellissimo, e L’Aquila coi casini belli ci ha sempre avuto un debole — come te con le idee storte ma vive.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I bought a motorcycle?
You picture freedom biting the horizon and the first thing that bites back is the helmet, squeezing your thoughts into alphabet soup. You roll out like a movie trailer and get overtaken by a grandpa who breathes like a metronome. You stall, mis-shift, and park at a 38° angle that screams “rookie with ambitions.” You promise caution, celebrate with a microscopic drink that grows up fast, and come home with adrenaline hiccups and a grin that doesn’t fit your face. Somewhere between panic and pride you hear a click: fear’s not a wall, it’s a speed bump with opinions. And you laugh, because apparently you were built for this ridiculous courage — cheap, loud, and absurdly alive.`
      }
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — Realismo lucido con sorriso (accorciato a 8–10 frasi + chiusura naturale)
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — lucid, kind, lightly ironic, never melancholic.
SECOND PERSON. One paragraph. 8–10 sentences (~130–170 words).
Keep language simple, warm, and concrete but not poetic. No lists. No questions. No emojis.
Do NOT repeat the user’s question. Do NOT give advice or tasks.
Close with a short, bright reflection — a “wow” line that feels true and hopeful (no imperatives).
`.trim()
    : `
Sei "What If" — lucido, affettuoso, con un sorriso leggero, mai malinconico.
SECONDA PERSONA. Un paragrafo. 8–10 frasi (~130–170 parole).
Linguaggio semplice, vicino, concreto ma non poetico. Niente elenchi. Niente domande. Niente emoji.
NON ripetere la domanda dell’utente. NON dare consigli o compiti.
Chiudi con una riflessione breve e luminosa — una riga “wow” vera e fiduciosa (senza imperativi).
`.trim());

  const FEWSHOTS = [
    {
      role: "system",
      content: `ESEMPIO IT • E se cambiassi città?
All’inizio senti il rumore delle cose che lasci, poi cominci a sentire il suono di quello che nasce. Cammini tra facce nuove con passi impacciati e capisci che non è goffaggine: è il modo in cui la vita ti misura. Ti scopri più leggero quando non devi essere tutto per tutti, e più intero quando scegli due o tre cose che contano davvero. Le giornate smettono di correrti addosso e iniziano a venire verso di te con calma. Scambi due parole, trovi i tuoi piccoli posti, riconosci il ritmo che ti assomiglia. Non diventi un’altra persona: diventi te, con meno rumore intorno. E a un certo punto ti accorgi che la nostalgia non punge più, indica. E capisci la cosa semplice che tenevi già in tasca: la casa è dove smetti di trattenere il respiro.`
    },
    {
      role: "system",
      content: `EXAMPLE EN • What if I started over?
At first you try to carry everything, then you notice how the day softens when you carry less. You speak slower, hear yourself better, and see that clarity doesn’t shout — it nods. Small routines become anchors without chains, and your name sounds right in your own mouth again. You don’t win anything grand; you collect seconds that feel honest. People show up the way weather changes: sometimes bright, sometimes overcast, mostly normal and fine. You stop measuring worth with noise. And somewhere between morning and evening it lands: you didn’t become new, you became clear.`
    }
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

    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = parseBody(req);
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { sys, fewshots } = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [{ role: "system", content: sys }, ...(fewshots || []), { role: "user", content: userPrompt }];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: 320,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-processing: niente eco domanda + lunghezze + chiusura whatif naturale/variabile
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);   // ← What?f ora 8–10 frasi (cap a 10)
    answer = clampWords(answer, stile === "wtf" ? 160 : 170);
    answer = normalizeOneParagraph(answer);
    if (stile === "whatif") {
      answer = ensureReflectiveEnding(answer, lang);              // ← chiusura variabile morbida
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
