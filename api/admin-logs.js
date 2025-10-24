// /api/admin-logs.js — lista/svuota log (auth admin robusta: header/bearer/query/cookie)

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// helpers (replica standalone)
function parseCookies(req){const c=String(req.headers.cookie||"");const o={};c.split(";").forEach(p=>{const i=p.indexOf("=");if(i>-1)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));});return o;}
function getToken(req){const h=String(req.headers["x-admin-token"]||"").trim();if(h)return h;const a=String(req.headers.authorization||"");if(a.toLowerCase().startsWith("bearer "))return a.slice(7).trim();const q=req.query?.token?String(req.query.token).trim():"";if(q)return q;const ck=parseCookies(req);return ck["adm_tok"]||"";}
function getIp(req){const xff=String(req.headers["x-forwarded-for"]||"").trim();if(xff){const ip=xff.split(",").map(s=>s.trim()).find(Boolean);if(ip)return ip;}return (req.socket?.remoteAddress||"unknown").toString();}
async function isValidAdmin(req){const tok=getToken(req);if(!tok)return false;try{const data=await redis.hgetall(`admin:token:${tok}`);if(!data)return false;const LOCK_IP=String(process.env.ADMIN_LOCK_IP||"false").toLowerCase()==="true";if(LOCK_IP){const ip=getIp(req);if(!data.ip||data.ip!==ip)return false;}return true;}catch{return false;}}
function setCors(res){res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","GET,DELETE,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type, x-admin-token, Authorization");res.setHeader("Access-Control-Allow-Credentials","true");}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const admin = await isValidAdmin(req);
  if (!admin) return res.status(401).json({ ok:false, error:"auth_required" });

  try {
    if (req.method === "DELETE") {
      await redis.del("logs:ask");
      return res.status(200).json({ ok:true });
    }

    if (req.method !== "GET") return res.status(405).json({ ok:false, error:"method_not_allowed" });

    const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "200"), 10) || 200));
    const raw = await redis.lrange("logs:ask", 0, limit - 1);
    const items = [];
    for (const r of raw || []) {
      try {
        const o = JSON.parse(r);
        items.push({
          ts: o.ts || Date.now(),
          ip: o.ip || "",
          user_type: o.user_type || (o.admin ? "admin" : "free"),
          style: o.style || "whatif",
          lang: o.lang || "it",
          periodo: o.periodo || "future",
          domanda: o.domanda || "",
          answer_chars: o.answer_chars || 0,
        });
      } catch {}
    }

    const stats = { total: items.length, byStyle:{}, byLang:{}, byPeriod:{}, byUserType:{} };
    for (const it of items) {
      stats.byStyle[it.style] = (stats.byStyle[it.style] || 0) + 1;
      stats.byLang[it.lang] = (stats.byLang[it.lang] || 0) + 1;
      stats.byPeriod[it.periodo] = (stats.byPeriod[it.periodo] || 0) + 1;
      stats.byUserType[it.user_type] = (stats.byUserType[it.user_type] || 0) + 1;
    }

    return res.status(200).json({ ok:true, items, stats });
  } catch (e) {
    console.error("admin-logs error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
