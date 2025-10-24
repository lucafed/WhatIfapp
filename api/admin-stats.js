// /api/stats.js — conteggi aggregati veloci (senza domande) con auth admin
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function isValidAdmin(req) {
  const tok = String(req.headers["x-admin-token"] || "").trim();
  if (!tok) return false;
  try {
    const exists = await redis.exists(`admin:token:${tok}`);
    return !!exists;
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  const admin = await isValidAdmin(req);
  if (!admin) return res.status(401).json({ ok:false, error:"auth_required" });

  try {
    const total = parseInt(await redis.get("stats:total")) || 0;
    const byStyle = await redis.hgetall("stats:style") || {};
    const byLang  = await redis.hgetall("stats:lang") || {};
    const byPeriod= await redis.hgetall("stats:periodo") || {};
    const byUserType = await redis.hgetall("stats:user_type") || {};

    // conteggio "oggi"
    const todayKey = `stats:day:${new Date().toISOString().slice(0,10)}`;
    const todayHash = await redis.hgetall(todayKey) || {};
    const today = Object.values(todayHash).map(x => parseInt(x)).reduce((a,b)=>a+b, 0);

    // ultimi 7 giorni (somma grossolana)
    let last7 = 0;
    for (let i=0;i<7;i++){
      const d = new Date(); d.setDate(d.getDate()-i);
      const k = `stats:day:${d.toISOString().slice(0,10)}`;
      const h = await redis.hgetall(k) || {};
      last7 += Object.values(h).map(x=>parseInt(x)).reduce((a,b)=>a+b,0);
    }

    return res.status(200).json({
      ok:true, total, today, last7, byStyle, byLang, byPeriod, byUserType
    });
  } catch (e) {
    console.error("stats error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
