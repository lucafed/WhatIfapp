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
function setCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}
function getIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0]?.trim();
  return xf || req.socket?.remoteAddress || "unknown";
}

async function isAdmin(req) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const ip = await redis.get(`admin:token:${token}`);
    return ip && ip === getIp(req);
  } catch { return false; }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "unauthorized" });

    const limit = Math.min(parseInt(req.query.limit||"100",10), 500);
    const raw = await redis.lrange("logs:ask", 0, limit-1);
    const items = (raw||[]).map(x=>{ try{return JSON.parse(x)}catch{return null} }).filter(Boolean);

    // stats aggregate
    const [total, style, lang, periodo] = await Promise.all([
      redis.get("stats:total"),
      redis.hgetall("stats:style"),
      redis.hgetall("stats:lang"),
      redis.hgetall("stats:periodo"),
    ]);

    return res.status(200).json({
      ok: true,
      items,
      stats: {
        total: Number(total||0),
        style: style || {},
        lang: lang || {},
        periodo: periodo || {},
      }
    });
  } catch (e) {
    console.error("admin-logs error", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
