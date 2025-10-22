// /api/admin-stats.js
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

async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const bound = await redis.get(`admin:token:${token}`);
    if (!bound) return false;
    if (bound === "ANY") return true;
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();
    return ip === bound;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const ok = await isAdmin(req);
    if (!ok) return res.status(401).json({ error: "unauthorized" });

    const [total, style, lang, periodo] = await Promise.all([
      redis.get("stats:total").then(v => Number(v || 0)),
      redis.hgetall("stats:style").then(v => v || {}),
      redis.hgetall("stats:lang").then(v => v || {}),
      redis.hgetall("stats:periodo").then(v => v || {}), // 👈 nuovo
    ]);

    // ultimi N dal log (solo header, senza testo risposta)
    const N = Math.min(Number(req.query.limit || 20), 200);
    const raw = await redis.lrange("logs:ask", 0, N - 1);
    const logs = (raw || []).map(x => {
      try { return JSON.parse(x); } catch { return null; }
    }).filter(Boolean);

    return res.status(200).json({ ok: true, total, style, lang, periodo, logs });
  } catch (e) {
    console.error("admin-stats error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
