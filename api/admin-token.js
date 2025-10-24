// /api/admin-token.js
import { Redis } from "@upstash/redis";
import crypto from "crypto";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

const TTL = 7*24*3600; // 7 giorni
const ADMIN_PIN = process.env.ADMIN_PIN || "wtf-setup-2025";

function getIp(req){ return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim(); }

function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, x-admin-secret, x-admin-token");
}

export default async function handler(req,res){
  cors(res);
  if(req.method==="OPTIONS") return res.status(200).end();

  const ip = getIp(req);

  try{
    if(req.method==="GET"){
      const tok = String(req.headers["x-admin-token"]||"").trim();
      if(!tok) return res.status(200).json({ admin:false, ip, token:null });
      const savedIp = await redis.get(`admin:token:${tok}`);
      const admin = !!savedIp && savedIp===ip;
      return res.status(200).json({ admin, ip, token: admin?tok:null });
    }

    const url = new URL(req.url,"http://x");
    if(url.searchParams.get("renew")){
      const tok = String(req.headers["x-admin-token"]||"").trim();
      if(!tok) return res.status(400).json({ ok:false, error:"missing_token" });
      const savedIp = await redis.get(`admin:token:${tok}`);
      if(savedIp!==ip) return res.status(403).json({ ok:false, error:"ip_mismatch" });
      await redis.expire(`admin:token:${tok}`, TTL);
      return res.status(200).json({ ok:true, ip, token:tok });
    }
    if(url.searchParams.get("revoke")){
      const tok = String(req.headers["x-admin-token"]||"").trim();
      if(tok) await redis.del(`admin:token:${tok}`);
      return res.status(200).json({ ok:true, revoked:!!tok });
    }

    if(req.method!=="POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });
    const pin = String(req.headers["x-admin-secret"]||"").trim();
    if(!pin) return res.status(401).json({ ok:false, error:"missing_pin" });
    if(pin!==ADMIN_PIN) return res.status(403).json({ ok:false, error:"bad_pin" });

    const token = crypto.randomBytes(16).toString("hex");
    await redis.set(`admin:token:${token}`, ip, { ex: TTL });
    return res.status(200).json({ ok:true, token, ip, ttlHours: TTL/3600 });
  }catch(e){
    console.error("admin-token", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
