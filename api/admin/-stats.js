// /api/admin/stats.js — semplice, legge da logs:ask
import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

function cors(res){ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS"); res.setHeader("Access-Control-Allow-Headers","Content-Type"); }

export default async function handler(req,res){
  cors(res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="GET") return res.status(405).json({error:"method_not_allowed"});

  try{
    const raw = await redis.lrange("logs:ask", 0, 9999);
    const events = [];
    for(const r of raw||[]){ try{ const e=JSON.parse(r); if(e.ts) events.push(e); }catch{} }

    const now=Date.now(), day=86400000;
    const todayStart = now - (now % day);
    const weekStart  = now - 7*day;

    let today=0, last7=0;
    for(const e of events){ if(e.ts>=todayStart) today++; if(e.ts>=weekStart) last7++; }

    res.status(200).json({ total: events.length, today, last7 });
  }catch(err){
    console.error("admin/stats",err);
    res.status(500).json({ error:"server_error" });
  }
}
