// /api/admin-logs.js — Lista ultimi log What?f (solo admin)
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}

async function isAdmin(req) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const saved = await redis.get(`admin:token:${token}`);
    return saved && saved === ip;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "unauthorized" });

    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
    const data = await redis.lrange("logs:ask", 0, limit - 1);
    // Parse safe
    const items = (data || []).map((s) => {
      try { return JSON.parse(s); } catch { return null; }
    }).filter(Boolean);

    // opzionale: piccoli conteggi veloci
    const total = Number(await redis.get("stats:total")) || 0;
    const style = await redis.hgetall("stats:style") || {};
    const lang  = await redis.hgetall("stats:lang")  || {};
    const periodo = await redis.hgetall("stats:periodo") || {};

    return res.status(200).json({ items, stats: { total, style, lang, periodo } });
  } catch (e) {
    console.error("admin-logs error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
