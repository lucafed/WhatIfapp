// /api/admin-stats.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function ipForToken(token) {
  try { return await redis.get(`admin:token:${token}`); } catch { return null; }
}
function dateISO(d){ return new Date(d).toISOString().slice(0,10); }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  try {
    const token = String(req.headers["x-admin-token"] || "").trim();
    if (!token) return res.status(401).json({ ok:false, error:"missing_admin_token" });
    const ip = await ipForToken(token);
    if (!ip) return res.status(403).json({ ok:false, error:"invalid_or_expired_token" });

    const total = parseInt((await redis.get("stats:total")) || "0", 10);
    const style   = (await redis.hgetall("stats:style"))   || {};
    const lang    = (await redis.hgetall("stats:lang"))    || {};
    const periodo = (await redis.hgetall("stats:periodo")) || {};
    const userType= (await redis.hgetall("stats:user_type")) || {};

    // ultimi 14 giorni: stats:day:YYYY-MM-DD -> hmap { "wtf:future":N, "whatif:past":N, ... }
    const days = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today.getTime() - i*24*3600*1000);
      const key = `stats:day:${dateISO(d)}`;
      const h = (await redis.hgetall(key)) || {};
      days.push({ day: dateISO(d), buckets: h });
    }

    return res.status(200).json({
      ok:true,
      counters: { total, style, lang, periodo, userType },
      days: days.reverse(),
    });
  } catch (e) {
    console.error("admin-stats error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
