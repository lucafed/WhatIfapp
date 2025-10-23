// /api/reset.js — resetta i crediti dell'IP associato al token admin (oggi)
import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

function cors(res){ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS"); res.setHeader("Access-Control-Allow-Headers","Content-Type, x-admin-token"); }

async function ipForToken(tok){ try{ return await redis.get(`admin:token:${tok}`); }catch{ return null; } }

export default async function handler(req,res){
  cors(res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  try{
    const token = String(req.headers["x-admin-token"]||"").trim();
    if(!token) return res.status(401).json({ ok:false, error:"missing_admin_token" });
    const ip = await ipForToken(token);
    if(!ip) return res.status(403).json({ ok:false, error:"invalid_or_expired_token" });

    const today = new Date().toISOString().slice(0,10);
    const key = `credits:${ip}:${today}`;

    await redis.del(key);
    return res.status(200).json({ ok:true, ip, date: today });
  }catch(err){
    console.error("reset error:",err);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
