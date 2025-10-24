// /api/stats.js — conteggi aggregati (auth admin robusta: header/bearer/query/cookie)

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// helpers minimi (replica da admin-token.js per standalone)
function parseCookies(req){const c=String(req.headers.cookie||"");const o={};c.split(";").forEach(p=>{const i=p.indexOf("=");if(i>-1)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));});return o;}
function getToken(req){const h=String(req.headers["x-admin-token"]||"").trim();if(h)return h;const a=String(req.headers.authorization||"");if(a.toLowerCase().startsWith("bearer "))return a.slice(7).trim();const q=req.query?.token?String(req.query.token).trim():"";if(q)return q;const ck=parseCookies(req);return ck["adm_tok"]||"";}
function getIp(req){const xff=String(req.headers["x-forwarded-for"]||"").trim();if(xff){const ip=xff.split(",").map(s=>s.trim()).find(Boolean);if(ip)return ip;}return (req.socket?.remoteAddress||"unknown").toString();}
async function isValidAdmin(req){const tok=getToken(req);if(!tok)return false;try{const data=await redis.hgetall(`admin:token:${tok}`);if(!data)return false;const LOCK_IP=String(process.env.ADMIN_LOCK_IP||"false").toLowerCase()==="true";if(LOCK_IP){const ip=getIp(req);if(!data.ip||data.ip!==ip)return false;}return true;}catch{return false;}}
function setCors(res){res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type, x-admin-token, Authorization");res.setHeader("Access-Control-Allow-Credentials","true");}

export default async function handler(req, res) {
  setCors(res);
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

    const todayKey = `stats:day:${new Date().toISOString().slice(0,10)}`;
    const todayHash = await redis.hgetall(todayKey) || {};
    const today = Object.values(todayHash).map(x => parseInt(x)).reduce((a,b)=>a+b, 0);

    let last7 = 0;
    for (let i=0;i<7;i++){
      const d = new Date(); d.setDate(d.getDate()-i);
      const k = `stats:day:${d.toISOString().slice(0,10)}`;
      const h = await redis.hgetall(k) || {};
      last7 += Object.values(h).map(x=>parseInt(x)).reduce((a,b)=>a+b,0);
    }

    return res.status(200).json({ ok:true, total, today, last7, byStyle, byLang, byPeriod, byUserType });
  } catch (e) {
    console.error("stats error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
