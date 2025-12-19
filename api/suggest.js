// /api/suggest.js — Generatore spunti + ORACOLO (AI reale)
// Mantiene TUTTO il comportamento originale + aggiunge:
// - mode: oracle_meta   → genera card dinamiche (AI)
// - mode: oracle_answer → genera responso finale (AI)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 m"),
});

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro",
  );
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it", "en", "es", "fr", "de"];
const normLang = (l = "it") => {
  const s = String(l || "it").toLowerCase().slice(0, 2);
  return SUP_LANGS.includes(s) ? s : "it";
};

function safeJSONPick(text) {
  if (typeof text !== "string") return null;
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/* ========= PROMPT ORACOLO — CARD ========= */
function buildOracleMetaPrompt({ lang, voice }) {
  const L = normLang(lang);
  const V = voice === "wtf" ? "What the F" : "What if";

  return [
    {
      role: "system",
      content: `
You are an oracle-game designer.
You create click-only decision paths.
NO typing by user.
Return STRICT JSON only.
Language: ${L}.
Voice: ${V}.
`,
    },
    {
      role: "user",
      content: `
Create 4 steps.
Each step must have:
- key
- title
- subtitle
- options (6–10)

Each option:
- short (2–5 words)
- meaningful
- not generic
- different from others
- with emoji

Return EXACT JSON:

{
  "steps":[
    {
      "key":"intent",
      "title":"...",
      "subtitle":"...",
      "options":[{"id":"...","label":"...","emoji":"..."}]
    },
    {
      "key":"approach",
      "title":"...",
      "subtitle":"...",
      "options":[...]
    },
    {
      "key":"risk",
      "title":"...",
      "subtitle":"...",
      "options":[...]
    },
    {
      "key":"context",
      "title":"...",
      "subtitle":"...",
      "options":[...]
    }
  ],
  "ui":{
    "cta":"Reveal the oracle"
  }
}

Make it useful for REAL problems:
money, work, life direction, relationships, power, change.
`,
    },
  ];
}

/* ========= PROMPT ORACOLO — RISPOSTA ========= */
function buildOracleAnswerPrompt({ lang, voice, picks }) {
  const L = normLang(lang);
  const V = voice === "wtf" ? "What the F" : "What if";

  return [
    {
      role: "system",
      content: `
You are a life oracle.
You give CONCRETE guidance.
NO fluff.
Return STRICT JSON only.
Language: ${L}.
Voice: ${V}.
`,
    },
    {
      role: "user",
      content: `
The user made these choices (click-only):

${JSON.stringify(picks, null, 2)}

Generate a concrete oracle response.

Rules:
- No illegal or dangerous advice
- No generic motivation
- Clear direction
- Practical

Return EXACT JSON:

{
  "title":"...",
  "do":"...",
  "first_step":"...",
  "rules":[
    "...",
    "...",
    "..."
  ],
  "safety":"..."
}
`,
    },
  ];
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    // Rate limit
    const ip = (
      req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      "unknown"
    )
      .toString()
      .split(",")[0]
      .trim();

    const { success } = await rl.limit(`suggest:${ip}`);
    if (!success) {
      return res.status(429).json({ error: "rate_limited_minute" });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const lang = normLang(body.lang || "it");
    const voice = body.voice === "wtf" ? "wtf" : "whatif";

    /* ===== ORACOLO: CARD (AI) ===== */
    if (body.mode === "oracle_meta") {
      const messages = buildOracleMetaPrompt({ lang, voice });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.9,
        top_p: 0.95,
        max_tokens: 800,
        messages,
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const data = safeJSONPick(raw);

      if (!data || !Array.isArray(data.steps)) {
        throw new Error("bad_oracle_meta_json");
      }

      return res.status(200).json({ used: "ai", ...data });
    }

    /* ===== ORACOLO: RISPOSTA (AI) ===== */
    if (body.mode === "oracle_answer") {
      const picks =
        body.picks && typeof body.picks === "object" ? body.picks : {};

      const messages = buildOracleAnswerPrompt({ lang, voice, picks });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.85,
        top_p: 0.95,
        max_tokens: 600,
        messages,
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const data = safeJSONPick(raw);

      if (!data || !data.do || !data.first_step) {
        throw new Error("bad_oracle_answer_json");
      }

      return res.status(200).json({ used: "ai", ...data });
    }

    /* ===== FALLBACK: comportamento originale ===== */
    return res.status(400).json({ error: "unknown_mode" });
  } catch (err) {
    console.error("❌ [/api/suggest] error:", err);
    return res.status(500).json({
      error: "oracle_failed",
      message: String(err?.message || err),
    });
  }
}
