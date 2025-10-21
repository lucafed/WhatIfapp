// /api/reset.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function todayKey(ip) {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `credits:${ip}:${day}`;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const requesterIp = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
      .toString().split(",")[0].trim() || "unknown";

    const adminToken = String(req.headers["x-admin-token"] || "").trim();
    let targetIp = requesterIp;

    if (adminToken) {
      const mappedIp = await redis.get(`admin:token:${adminToken}`);
      if (!mappedIp) return res.status(403).json({ error: "invalid_or_expired_admin_token" });
      if (mappedIp !== requesterIp) return res.status(403).json({ error: "token_ip_mismatch" });
      targetIp = mappedIp;
    }

    const key = todayKey(targetIp);
    await redis.del(key);

    return res.status(200).json({ ok: true, reset_key: key, targetIp });
  } catch (err) {
    console.error("reset error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
