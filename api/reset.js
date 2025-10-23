// /api/reset.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}
async function ipForToken(token) {
  try { return await redis.get(`admin:token:${token}`); } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  try {
    const token = String(req.headers["x-admin-token"] || "").trim();
    if (!token) return res.status(401).json({ ok:false, error:"missing_admin_token" });
    const savedIp = await ipForToken(token);
    if (!savedIp) return res.status(403).json({ ok:false, error:"invalid_or_expired_token" });

    const ip = getIp(req);
    const today = new Date().toISOString().slice(0,10);
    const key = `credits:${ip}:${today}`;
    await redis.del(key);

    return res.status(200).json({ ok:true, ip, date:today });
  } catch (e) {
    console.error("reset error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
