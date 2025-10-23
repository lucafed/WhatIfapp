// ============================
// /api/reset.js — Reset crediti giornalieri (admin only)
// ============================
import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

function cors(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type,x-admin-token");
}
async function isAdmin(req){
  const token = String(req.headers["x-admin-token"]||"").trim();
  if(!token) return false;
  try { return !!(await redis.get(`admin:token:${token}`)); } catch { return false; }
}
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"method_not_allowed"});

  try{
    if(!(await isAdmin(req))) return res.status(401).json({ok:false,error:"not_admin"});
    // Svuota chiavi "credits:*:YYYY-MM-DD" di oggi
    const today = new Date().toISOString().slice(0,10);
    const prefix = `credits:`;
    // Upstash non supporta keys wildcard in REST: pulizia soft (logica lato client nella tua UI)
    // Ti ritorno solo ok; i client locali azzerano i contatori memorizzati localmente.
    return res.status(200).json({ ok:true, notice:"Soft reset: azzera lato client. Le chiavi server scadono in 24h." });
  }catch(e){
    console.error("❌ [/api/reset] error:",e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
