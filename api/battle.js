import OpenAI from "openai";
import { Redis } from "@upstash/redis";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
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
    "Content-Type, Authorization"
  );
}

/* ========= Helpers ========= */
function safeJsonParse(x) {
  try {
    return JSON.parse(x);
  } catch {
    return null;
  }
}

function getUserKey(req, body) {
  return (
    body?.micro?.userKey ||
    body?.userKey ||
    req.headers["x-user-key"] ||
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "anon"
  );
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    /* ===== BODY PARSE ROBUSTO (IDENTICO A ASK) ===== */
    let body = req.body || {};
    if (typeof body === "string") {
      body = safeJsonParse(body) || {};
    } else if (typeof body === "object" && typeof body.body === "string") {
      body = safeJsonParse(body.body) || body;
    }

    const categoria = String(body.categoria || "").trim();
    const a = String(body.a || "").trim();
    const b = String(body.b || "").trim();

    if (!categoria || !a || !b) {
      return res.status(400).json({ error: "missing_fields" });
    }

    /* ===== IDENTITÀ UTENTE ===== */
    const userKey = getUserKey(req, body);
    const creditsKey = `credits:${userKey}`;

    /* ===== CREDITI ===== */
    let credits = await redis.get(creditsKey);

    if (credits === null) {
      // inizializzazione soft, NON inventiamo numeri
      credits = 0;
    }

    credits = Number(credits) || 0;

    if (credits <= 0) {
      return res.status(402).json({
        error: "no_credits",
        redirect: "/buy.html",
      });
    }

    /* ===== PROMPT ===== */
    const prompt = `
Categoria: ${categoria}

Opzione A: ${a}
Opzione B: ${b}

Scegli UN vincitore netto e spiega il perché in 1–2 frasi secche.
Tono diretto, lucido, niente morale, niente emoji.
Rispondi così:

Vincitore: A oppure B
Motivo: ...
`.trim();

    /* ===== OPENAI ===== */
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 120,
      messages: [
        { role: "system", content: "Sei un giudice imparziale e sintetico." },
        { role: "user", content: prompt },
      ],
    });

    const text =
      completion?.choices?.[0]?.message?.content?.trim() || "";

    if (!text) {
      throw new Error("empty_model_response");
    }

    /* ===== SCALO 1 CREDITO SOLO ORA ===== */
    await redis.decr(creditsKey);
    const newCredits = credits - 1;

    /* ===== RISPOSTA ===== */
    return res.status(200).json({
      winner: text,
      credits: newCredits,
    });
  } catch (err) {
    console.error("❌ [/api/battle] error:", err);
    return res.status(500).json({
      error: "server_error",
    });
  }
}
