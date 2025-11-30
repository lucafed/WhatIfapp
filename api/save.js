// /api/save.js
// Salva domanda + risposta su Redis (lista logs:ask)
// NON consuma crediti, NON chiama OpenAI

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Stessi origin di admin-logs (per stare larghi)
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "https://what-ifapp.vercel.app/",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function reflectCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Admin-Token, x-admin-token, Authorization"
  );
  res.setHeader("Cache-Control", "no-store");
}

function getIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  if (xff) {
    const ip = xff
      .split(",")
      .map((s) => s.trim())
      .find(Boolean);
    if (ip) return ip;
  }
  return (req.socket?.remoteAddress || "unknown").toString();
}

function getToken(req) {
  const h = String(
    req.headers["x-admin-token"] || req.headers["X-Admin-Token"] || ""
  ).trim();
  if (h) return h;
  const a = String(req.headers.authorization || "");
  if (a.toLowerCase().startsWith("bearer ")) return a.slice(7).trim();
  return "";
}

export default async function handler(req, res) {
  reflectCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const domanda = String(body.domanda || "").trim();
    const answer = String(body.answer || "").trim();
    const stile = String(body.stile || body.style || "whatif").trim();
    const periodo = String(body.periodo || body.timeframe || "").trim();
    const lang = String(body.lang || "it").trim();

    if (!domanda || !answer) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_fields" });
    }

    const ts = Date.now();
    const ip = getIp(req);
    const token = getToken(req);
    const user_type = token ? "admin" : "free";

    const entry = {
      ts,
      ip,
      style: stile,
      lang,
      periodo,
      user_type,
      domanda,
      answer,
      answer_chars: answer.length,
    };

    // Inserisci in testa alla lista
    await redis.lpush("logs:ask", JSON.stringify(entry));
    // Mantieni la lista ragionevole (ultimi 2000 log)
    await redis.ltrim("logs:ask", 0, 1999);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("save error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
