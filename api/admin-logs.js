// /api/admin-logs.js
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
    const ip = await redis.get(`admin:token:${token}`);
    return ip && ip === requesterIp;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    if (!(await isAdmin(req, ip))) return res.status(403).json({ error: "forbidden" });

    const limit = Math.min(parseInt(req.query.limit || "200", 10), 1000);
    const logsRaw = await redis.lrange("logs:ask", 0, limit - 1); // già ordinati dal più recente
    const logs = (logsRaw || []).map((x) => {
      try { return JSON.parse(x); } catch { return null; }
    }).filter(Boolean);

    const total = parseInt((await redis.get("stats:total")) || "0", 10);
    const style = (await redis.hgetall("stats:style")) || {};
    const lang  = (await redis.hgetall("stats:lang")) || {};

    return res.status(200).json({ ok: true, total, style, lang, logs });
  } catch (e) {
    console.error("admin-logs error", e);
    return res.status(500).json({ error: "server_error" });
  }
}
