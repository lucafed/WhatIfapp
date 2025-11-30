// /api/save.js
// Salva domanda + risposta + meta su Redis
// NON chiama OpenAI → NON usa crediti.

import { Redis } from "@upstash/redis";

/* ========= Redis ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

/* ========= CORS semplice ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const allow = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : process.env.NODE_ENV !== "production"
    ? origin
    : "";
  if (allow) res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );
}

export default async function handler(req, res) {
  cors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    // IP solo per statistica
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString()
      .split(",")[0]
      .trim();

    // Gestione sia body string che object (come in ask.js)
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    const body =
      rawBody && typeof req.body === "string"
        ? JSON.parse(rawBody || "{}")
        : (req.body || {});

    const {
      domanda = "",
      answer = "",
      stile = "whatif",   // "whatif" | "wtf"
      periodo = "future", // "future" | "past"
      lang = "it",        // "it", "en", ...
    } = body;

    if (!domanda || !answer) {
      return res.status(400).json({
        error: "bad_request",
        detail: "domanda_and_answer_required",
      });
    }

    const item = {
      ts: Date.now(),
      domanda,
      answer,
      stile,
      periodo,
      lang,
      ip,
    };

    // Salviamo in una lista chiamata "whatif:qna"
    await redis.lpush("whatif:qna", JSON.stringify(item));
    // Teniamo solo le ultime 1000
    await redis.ltrim("whatif:qna", 0, 999);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ [/api/save] error:", err);
    return res.status(500).json({
      error: "server_error",
      detail: String(err?.message || err),
    });
  }
}
