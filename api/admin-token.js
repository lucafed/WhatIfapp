// /api/admin-token.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ADMIN_PIN = process.env.ADMIN_PIN || "wtf-setup-2025";
const TTL_SECS = 60 * 60 * 48; // 48h

function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, admin-secret, x-admin-secret");
}

function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  try {
    const headerSecret = String(req.headers["x-admin-secret"] || req.headers["admin-secret"] || "").trim();
    if (!headerSecret) return res.status(401).json({ ok:false, error:"missing_pin" });
    if (headerSecret !== ADMIN_PIN) return res.status(403).json({ ok:false, error:"bad_pin" });

    const ip = getIp(req);
    const token = `adm_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    await redis.set(`admin:token:${token}`, ip, { ex: TTL_SECS });

    return res.status(200).json({ ok:true, token, ttlHours: TTL_SECS / 3600, ip });
  } catch (e) {
    console.error("admin-token error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
