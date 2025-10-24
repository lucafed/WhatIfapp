// /api/admin-stats.js
// Aggregati veloci e trend giornaliero (N giorni)

import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}
async function isAdmin(req) {
  const tok = String(req.headers["x-admin-token"] || "").trim();
  if (!tok) return false;
  const saved = await redis.get(`admin:token:${tok}`);
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
  return !!saved && saved === ip;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    if (!(await isAdmin(req))) return res.status(401).json({ ok: false, error: "unauthorized" });

    // contatori cumulativi
    const total = parseInt((await redis.get("stats:total")) || "0", 10) || 0;
    const byStyle   = (await redis.hgetall("stats:style"))   || {};
    const byLang    = (await redis.hgetall("stats:lang"))    || {};
    const byPeriod  = (await redis.hgetall("stats:periodo")) || {};
    const byUserType= (await redis.hgetall("stats:user_type"))|| {};

    // oggi & ultimi 7 (via logs:ask)
    const raw = await redis.lrange("logs:ask", 0, 9999);
    const todayStr = new Date().toISOString().slice(0,10);
    let today = 0, last7 = 0;
    const todayStart = new Date(todayStr + "T00:00:00Z").getTime();
    const sevenDaysAgo = Date.now() - 7*24*3600*1000;
    for (const r of raw || []) {
      try {
        const o = JSON.parse(r);
        if (o.ts >= todayStart) today++;
        if (o.ts >= sevenDaysAgo) last7++;
      } catch {}
    }

    // trend giornaliero (N giorni)
    const n = Math.max(1, Math.min(30, parseInt(String(req.query.days || "7"), 10) || 7));
    const labels = [];
    const data = [];
    for (let i = n-1; i >= 0; i--) {
      const d = new Date(Date.now() - i*24*3600*1000);
      const key = `stats:day:${d.toISOString().slice(0,10)}`;
      const h = (await redis.hgetall(key)) || {};
      let sum = 0;
      for (const v of Object.values(h)) sum += parseInt(v || "0", 10) || 0;
      labels.push(d.toISOString().slice(5,10));
      data.push(sum);
    }

    return res.status(200).json({
      ok: true,
      total, today, last7,
      byStyle, byLang, byPeriod, byUserType,
      trend: { labels, data }
    });
  } catch (e) {
    console.error("admin-stats error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
