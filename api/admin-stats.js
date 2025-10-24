// /api/admin-stats.js — aggregati e trend (auth admin robusta + CORS riflesso)

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function reflectCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token, Authorization");
}

// Helpers minimi per token/IP (standalone)
function parseCookies(req){const c=String(req.headers.cookie||"");const o={};c.split(";").forEach(p=>{const i=p.indexOf("=");if(i>-1)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));});return o;}
function getToken(req){const h=String(req.headers["x-admin-token"]||"").trim();if(h)return h;const a=String(req.headers.authorization||"");if(a.toLowerCase().startsWith("bearer "))return a.slice(7).trim();const q=req.query?.token?String(req.query.token).trim():"";if(q)return q;const ck=parseCookies(req);return ck["adm_tok"]||"";}
function getIp(req){const xff=String(req.headers["x-forwarded-for"]||"").trim();if(xff){const ip=xff.split(",").map(s=>s.trim()).find(Boolean);if(ip)return ip;}return (req.socket?.remoteAddress||"unknown").toString();}
async function isValidAdmin(req){const tok=getToken(req);if(!tok)return false;try{const data=await redis.hgetall(`admin:token:${tok}`);if(!data)return false;const LOCK_IP=String(process.env.ADMIN_LOCK_IP||"false").toLowerCase()==="true";if(LOCK_IP){const ip=getIp(req);if(!data.ip||data.ip!==ip)return false;}return true;}catch{return false;}}

export default async function handler(req, res) {
  reflectCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  const admin = await isValidAdmin(req);
  if (!admin) return res.status(401).json({ ok:false, error:"auth_required" });

  try {
    const total = parseInt(await redis.get("stats:total")) || 0;
    const byStyle   = await redis.hgetall("stats:style")   || {};
    const byLang    = await redis.hgetall("stats:lang")    || {};
    const byPeriod  = await redis.hgetall("stats:periodo") || {};
    const byUserType= await redis.hgetall("stats:user_type")|| {};

    // today & last7 (da logs grezzi, fallback se stats:day non esiste)
    const raw = await redis.lrange("logs:ask", 0, 9999);
    const todayStr = new Date().toISOString().slice(0,10);
    let today = 0, last7 = 0;
    const todayStart = new Date(`${todayStr}T00:00:00Z`).getTime();
    const sevenDaysAgo = Date.now() - 7*24*3600*1000;
    for (const r of raw || []) {
      try {
        const o = JSON.parse(r);
        if (o.ts >= todayStart) today++;
        if (o.ts >= sevenDaysAgo) last7++;
      } catch {}
    }

    // Trend giornaliero (N giorni)
    const n = Math.max(1, Math.min(30, parseInt(String(req.query.days || "7"), 10) || 7));
    const labels = [];
    const data = [];
    for (let i = n-1; i >= 0; i--) {
      const d = new Date(Date.now() - i*24*3600*1000);
      const key = `stats:day:${d.toISOString().slice(0,10)}`;
      const h = (await redis.hgetall(key)) || {};
      let sum = 0;
      for (const v of Object.values(h)) sum += parseInt(String(v || "0"), 10) || 0;
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
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
