// /api/admin-stats.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// auth: token admin legato all'IP
async function isAdmin(req) {
  try {
    const tok = String(req.headers["x-admin-token"] || "").trim();
    if (!tok) return false;
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();
    const saved = await redis.get(`admin:token:${tok}`);
    return !!saved && saved === ip;
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ ok:false, error:"method_not_allowed" });

  try {
    if (!(await isAdmin(req)))
      return res.status(401).json({ ok:false, error:"unauthorized" });

    // contatori cumulativi (incrementati da /api/ask)
    const total   = parseInt((await redis.get("stats:total")) || "0", 10);
    const byStyle = (await redis.hgetall("stats:style"))   || {};
    const byLang  = (await redis.hgetall("stats:lang"))    || {};
    const byTime  = (await redis.hgetall("stats:periodo")) || {};
    const byUser  = (await redis.hgetall("stats:user_type")) || {};

    // finestra: ultimi 10k log
    const raw = await redis.lrange("logs:ask", 0, 9999);
    const now = Date.now();
    const dayMs = 24*60*60*1000;
    let today = 0, last7 = 0;

    for (const r of raw || []) {
      try {
        const o = JSON.parse(r);
        const dt = Number(o.ts || 0);
        if (!dt) continue;
        if (now - dt < dayMs) today++;
        if (now - dt < 7*dayMs) last7++;
      } catch {}
    }

    return res.status(200).json({
      ok:true,
      total, today, last7,
      byStyle, byLang, byTime, byUser
    });
  } catch (e) {
    console.error("admin-stats error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
