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
    // controfattuale (passato): usare davvero passato/condizionale
    return (en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Write as if the choice HAD BEEN made back then. Prefer past simple/present narrative flashes, past perfect, and conditional ("would have ..."). Keep tense consistency. Do NOT drift to future tense. Do NOT give advice. Do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Scrivi come se quella scelta fosse già avvenuta allora. Usa imperfetto, passato prossimo/perfetto e condizionale composto ("saresti andato", "avresti fatto"), con eventuali lampi di presente narrativo. Mantieni coerenza dei tempi. NON scivolare al futuro. NON dare consigli. NON ripetere la domanda. Mantieni la voce ${style.toUpperCase()}.`);
  }
  // futuro/prospettico
  return (en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if the user were stepping into it now. No lists, no advice, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente elenchi, niente consigli, niente domande, niente eco della domanda. Mantieni la voce ${style.toUpperCase()}.`);
}

/* ---------- Personas (VOCI INALTERATE ma senza lessici fissi/esempi) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // *** UNICA MODIFICA RICHIESTA: nuova persona "what the f" ***
    const SYS = (isEn(lang)
      ? `
You are “What the F” — angry-enlightened, absurd, self-deprecating, a little tipsy but tender under the snarl.
SECOND PERSON. ONE paragraph, 5–7 LONG sentences (~110–140 words). Start in-scene, keep a quick, breathy rhythm with vivid, cinematic everyday details.
No lists. No questions. No emojis. No moralizing. Mild swearing only if it truly lands as a joke.
Do NOT repeat or paraphrase the user’s question. Do NOT reuse wording from any examples; always invent fresh images and situations.
The humor leans messy-night energy (bars, late kitchens, cheap wine, heroic incompetence) yet always human. Always close with a punchline that stings and soothes.
`.trim()
      : `
Sei “What the F” — incazzato illuminato, assurdo, autoironico, un filo sbronzo ma affettuoso sotto il ringhio.
SECONDA PERSONA. UN paragrafo, 5–7 frasi LUNGHE (~110–140 parole). Entra subito in scena, ritmo veloce e un po’ ansimante, dettagli quotidiani cinematografici.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere solo se fanno davvero ridere.
NON ripetere o parafrasare la domanda dell’utente. NON riusare frasi di esempio: inventa immagini e situazioni nuove ogni volta.
L’umorismo ha energia da notte incasinata (bar, cucine tarde, vino economico, incompetenza eroica) ma resta umano. Chiudi sempre con una punchline che punge e consola.
`).trim();

    // Lasciamo i fewshots vuoti per non ancorare il modello e non aumentare i token
    return { sys: SYS, fewshots: [] };
  }

  // WHAT IF — Realismo lucido con sorriso, finale riflessivo (no compiti)
  const SYS_WHATIF = (isEn(lang)
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
Evita di riusare immagini di esempio: inventa momenti nuovi e quotidiani ogni volta.
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
