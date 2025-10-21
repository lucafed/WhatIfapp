// /api/admin/reset-credits.js
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

    // Verifica token admin (legato all'IP)
    const adminToken = String(req.headers["x-admin-token"] || "").trim();
    if (!adminToken) return res.status(403).json({ error: "missing_admin_token" });

    const mappedIp = await redis.get(`admin:token:${adminToken}`);
    if (!mappedIp) return res.status(403).json({ error: "invalid_or_expired_admin_token" });
    if (mappedIp !== requesterIp) return res.status(403).json({ error: "token_ip_mismatch" });

    // Reset SOLO per il tuo IP
    const key = todayKey(requesterIp);
    await redis.del(key);

    return res.status(200).json({ ok: true, reset_key: key, ip: requesterIp });
  } catch (err) {
    console.error("reset-credits error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
