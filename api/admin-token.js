// /api/admin-token.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// PIN letto dall'header per poterlo digitare da mobile (no hardcode client)
const ADMIN_PIN = process.env.ADMIN_PIN || "wtf-setup-2025";
const TTL_SECS = 60 * 60 * 48; // 48h

function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const ip = getIp(req);

    if (req.method === "GET") {
      const tok = String(req.headers["x-admin-token"] || "").trim();
      if (!tok) return res.status(200).json({ admin:false, ip, token:null });
      const savedIp = await redis.get(`admin:token:${tok}`);
      const admin = !!savedIp && savedIp === ip;
      return res.status(200).json({ admin, ip, token: admin ? tok : null });
    }

    if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

    const secret = String(req.headers["x-admin-secret"] || "").trim();
    if (!secret) return res.status(401).json({ ok:false, error:"missing_pin" });
    if (secret !== ADMIN_PIN) return res.status(403).json({ ok:false, error:"bad_pin" });

    const token = `adm_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    await redis.set(`admin:token:${token}`, ip, { ex: TTL_SECS });

    return res.status(200).json({ ok:true, token, ttlHours: TTL_SECS/3600, ip });
  } catch (e) {
    console.error("admin-token error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
