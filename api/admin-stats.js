// ============================
// /api/admin-stats.js — Statistiche aggregate
// (usa sia contatori veloci sia i bucket giornalieri creati da /api/ask)
// Protetto da x-admin-token
// ============================
import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

function cors(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, x-admin-token");
}
async function isAdmin(req){
  const tok = String(req.headers["x-admin-token"]||"").trim();
  if(!tok) return false;
  try{
    const ip   = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const save = await redis.get(`admin:token:${tok}`);
    return !!save && save===ip;
  }catch{ return false; }
}
function iso(d){ return d.toISOString().slice(0,10); }

export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="GET") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  try{
    if(!(await isAdmin(req))) return res.status(401).json({ ok:false, error:"not_admin" });

    const total = parseInt(await redis.get("stats:total")||"0",10);

    // today & last7 dai bucket stats:day:YYYY-MM-DD
    const today   = new Date();
    const keys7   = [];
    for(let i=0;i<7;i++){ const d = new Date(today); d.setDate(d.getDate()-i); keys7.push(`stats:day:${iso(d)}`); }

    let todayCount = 0, last7 = 0;
    const [todayMap, ...rest] = await redis.hmget(keys7[0], []) // hmget([]) non serve, facciamo hgetall
      .catch(()=>[null]) || [null];
    const all = await Promise.all(keys7.map(k => redis.hgetall(k).catch(()=>null)));
    for(let i=0;i<all.length;i++){
      const m = all[i]; if(!m) continue;
      const sum = Object.values(m).map(v=>parseInt(v||"0",10)).reduce((a,b)=>a+b,0);
      if(i===0) todayCount = sum;
      last7 += sum;
    }

    // breakdown veloci
    const [byStyle, byLang, byPeriod, byType] = await Promise.all([
      redis.hgetall("stats:style").catch(()=>null),
      redis.hgetall("stats:lang").catch(()=>null),
      redis.hgetall("stats:periodo").catch(()=>null),
      redis.hgetall("stats:user_type").catch(()=>null),
    ]);

    return res.status(200).json({
      ok:true,
      total,
      today: todayCount,
      last7,
      byStyle:  byStyle  || {},
      byLang:   byLang   || {},
      byPeriod: byPeriod || {},
      byUser:   byType   || {},
    });
  }catch(e){
    console.error("admin-stats error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
