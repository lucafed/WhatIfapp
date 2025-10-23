// ============================
// /api/admin/stats.js — Statistiche per Console Admin
// ============================
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const token = String(req.headers["x-admin-token"] || "").trim();
    if (!token) return res.status(401).json({ error: "missing_admin_token" });

    const ip = await redis.get(`admin:token:${token}`);
    if (!ip) return res.status(403).json({ error: "invalid_or_expired_token" });

    // Legge log da Redis
    const logs = (await redis.lrange("logs:ask", 0, 9999)) || [];
    if (!logs.length)
      return res.status(200).json({ total: 0, today: 0, week: 0 });

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * oneDay;
    const todayStr = new Date().toISOString().slice(0, 10);

    let total = 0,
      today = 0,
      week = 0;

    for (const item of logs) {
      try {
        const obj = JSON.parse(item);
        total++;
        const t = new Date(obj?.ts || obj?.time || 0).getTime();
        if (isNaN(t)) continue;
        if (t > sevenDaysAgo) week++;
        const dstr = new Date(t).toISOString().slice(0, 10);
        if (dstr === todayStr) today++;
      } catch {
        continue;
      }
    }

    return res.status(200).json({ total, today, week });
  } catch (err) {
    console.error("❌ [/api/admin/stats] error:", err);
    return res
      .status(500)
      .json({ error: "server_error", detail: String(err?.message || err) });
  }
}
