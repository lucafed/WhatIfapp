// /api/ask.js — What?f Engine (FINAL BALANCED EDITION • FIXED WTF SEQUENCE)
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

// CORS
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Helper functions
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
function normLine(s = "") { return String(s).toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").replace(/[.,;:!?()\[\]\-—]+$/g, "").trim(); }
function tightenSentences(text, maxSentences) {
  const parts = String(text || "").replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  const out = [], seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    if (p.split(/\s+/).length <= 3 && !/[.!?]$/.test(p)) continue;
    out.push(p); seen.add(n);
    if (out.length >= maxSentences) break;
  }
  let t = out.join(" "); if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}
function clampWords(text, max) {
  const w = String(text || "").split(/\s+/);
  if (w.length <= max) return text;
  const slice = w.slice(0, max).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}
function normalizeOneParagraph(t = "") { return String(t).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim(); }
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  if (t.toLowerCase().startsWith(d)) t = t.slice(t.indexOf(".") + 1).trim();
  return t;
}

// Temporal instruction
function temporalInstruction(periodo = "future", lang = "it") {
  const en = isEn(lang);
  return String(periodo).toLowerCase() === "past"
    ? en
      ? "Write as if it already happened."
      : "Scrivi come se fosse già successo."
    : en
      ? "Write as a near-future unfolding."
      : "Scrivi come un prossimo futuro che inizia ora.";
}

// Examples & style rules (omitted here for brevity but unchanged)
const EX_WHATIF_ANALITICO_IT = `Sai, questa domanda... (tagliato per spazio)`;
const EX_WHATIF_REALE_IT = `Bella questa... (tagliato per spazio)`;
const WHATIF_ANALITICO_STYLE_IT = `WHAT IF Analitico: ...`;
const WHATIF_REALE_STYLE_IT = `WHAT IF Reale/Poetico: ...`;

// WTF lexicons
const WTF_SFOGO_BANK = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "madonna della miseria urlata",
  "bestemmia santa implosa"
];

const WTF_REACTIONS_BANK = [
  "la moka fischia una standing ovation",
  "la lampada sfarfalla in Morse",
  "il campanile tossisce un amen stonato",
  "Alexa scappa in non disturbare"
];

// WTF strict instruction
const WTF_STRICT_IT = `
WHAT THE F:
1) presa in giro
2) 4 micro-imprevisti realistici
3) “ti trattieni… provi… riprovi…” + UNO sfogo contenente *bestemmia*
4) subito DOPO esattamente 2 reazioni da lista
5) accenno alcol
6) risposta seria 1-2 frasi
7) chiusa ironica
Seconda persona, un paragrafo, no domanda, 145–165 parole.
`;

// Prompt builder
function buildMessages({ domanda, lang, periodo, stile, mode }) {
  const msgs = [
    { role: "system", content: "Un paragrafo, seconda persona, niente elenco." },
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  if (stile === "wtf") {
    msgs.push(
      { role: "system", content: WTF_STRICT_IT },
      { role: "system", content: "Esempio: ti esplode una bestemmia santa e la moka applaude." }
    );
  } else {
    msgs.push(
      { role: "system", content: mode === "analitico" ? WHATIF_ANALITICO_STYLE_IT : WHATIF_REALE_STYLE_IT },
      { role: "system", content: mode === "analitico" ? EX_WHATIF_ANALITICO_IT : EX_WHATIF_REALE_IT }
    );
  }

  msgs.push({ role: "user", content: `Domanda: "${domanda}". Rispondi senza ripeterla.` });
  return msgs;
}

// Handler
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0];
    const { success } = await rl.limit(`ask:${ip}`);
    if (!success) return res.status(429).json({ error: "rate_limited" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { domanda, stile = "whatif", mode = "reale", lang = "it", periodo = "future" } = body;

    const messages = buildMessages({ domanda, lang, periodo, stile, mode });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      messages,
    });

    let answer = completion.choices[0].message.content.trim();

    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 168 : 160);
    answer = normalizeOneParagraph(answer);

    return res.status(200).json({ answer });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
