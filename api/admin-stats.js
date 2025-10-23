// ============================
// /api/admin-stats.js — Statistiche globali veloci
// Legge i contatori incrementali creati in /api/ask.js
// ============================
import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}
async function isAdmin(req) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try { return !!(await redis.get(`admin:token:${token}`)); } catch { return false; }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  try {
    if (!(await isAdmin(req))) return res.status(401).json({ ok:false, error:"not_admin" });

    // contatori cumulativi
    const total = parseInt((await redis.get("stats:total")) || "0", 10) || 0;
    const style  = (await redis.hgetall("stats:style"))   || {};
    const lang   = (await redis.hgetall("stats:lang"))    || {};
    const period = (await redis.hgetall("stats:periodo")) || {};
    const utype  = (await redis.hgetall("stats:user_type")) || {};

    // oggi & ultimi 7 giorni dal bucket day
    const todayKey = `stats:day:${new Date().toISOString().slice(0,10)}`;
    const todayHash = (await redis.hgetall(todayKey)) || {};
    let last7 = 0;
    for (let i=0;i<7;i++){
      const d = new Date(); d.setDate(d.getDate()-i);
      const k = `stats:day:${d.toISOString().slice(0,10)}`;
      const h = (await redis.hgetall(k)) || {};
      last7 += Object.values(h).map(v=>parseInt(v||"0",10)||0).reduce((a,b)=>a+b,0);
    }
    const today = Object.values(todayHash).map(v=>parseInt(v||"0",10)||0).reduce((a,b)=>a+b,0);

    return res.status(200).json({
      ok:true,
      total, today, last7,
      byStyle: style, byLang: lang, byTime: period, byUser: utype
    });
  } catch (e) {
    console.error("❌ [/api/admin-stats] error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
