// /api/admin-logs.js
import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

async function ipForToken(token){ try{ return await redis.get(`admin:token:${token}`); }catch{return null;} }

export default async function handler(req, res){
  if (req.method === "OPTIONS") return res.status(200).end();
  const token = String(req.headers["x-admin-token"]||"").trim();
  const ip = token ? await ipForToken(token) : null;
  if(!ip) return res.status(401).json({ ok:false, error:"missing_or_bad_admin_token" });

  try{
    if(req.method === "DELETE"){
      await redis.del("logs:ask");
      return res.status(200).json({ ok:true, cleared:true });
    }
    if(req.method !== "GET") return res.status(405).json({ ok:false, error:"method_not_allowed" });

    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit||"200",10) || 200));
    const raw = await redis.lrange("logs:ask", 0, limit-1);
    const items = [];
    for(const r of raw||[]){
      try{
        const o = JSON.parse(r);
        items.push({
          ts:o.ts||Date.now(), ip:o.ip||"", style:o.style||o.stile||"whatif",
          lang:o.lang||"it", periodo:o.periodo||"future", domanda:o.domanda||"",
          answer_chars:o.answer_chars||0, user_type:o.user_type|| (o.admin?"admin":"free")
        });
      }catch{}
    }
    return res.status(200).json({ ok:true, items, stats:{ total: items.length } });
  }catch(e){
    console.error("admin-logs", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
