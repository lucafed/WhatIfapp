// /api/admin-stats.js
import { Redis } from "@upstash/redis";

const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

export default async function handler(req, res){
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  try{
    const raw = await redis.lrange("logs:ask", 0, 999); // finestra max 1000
    const items = (raw||[]).map(x=>{ try{return JSON.parse(x)}catch{return null} }).filter(Boolean);

    const todayStr = new Date().toISOString().slice(0,10);
    const total = items.length;
    const today = items.filter(x=> new Date(x.ts).toISOString().slice(0,10)===todayStr).length;
    const last7 = items.filter(x=> (Date.now()-x.ts) <= 7*24*3600*1000 ).length;
    const by = (key)=>items.reduce((a,x)=>{ const k=x[key]||"—"; a[k]=(a[k]||0)+1; return a; },{});

    return res.status(200).json({
      ok:true, total, today, last7,
      byStyle: by("style"),
      byLang: by("lang"),
      byPeriod: by("periodo"),
      byUserType: by("user_type")
    });
  }catch(e){
    console.error("admin-stats", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
