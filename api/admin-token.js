// ============================
// /api/admin-token.js
// Crea/controlla/revoca token admin (token -> IP) con TTL
// ============================
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

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}

function requesterIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

function randHex(len=32){
  const bytes = Array.from({length:len/2}, ()=> Math.floor(Math.random()*256));
  return bytes.map(b=> b.toString(16).padStart(2,"0")).join("");
}

export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try{
    const ip = requesterIp(req);

    if (req.method === "GET"){
      const token = String(req.headers["x-admin-token"] || "").trim();
      if(!token) return res.status(200).json({ admin:false, ip, token:null });
      const savedIp = await redis.get(`admin:token:${token}`);
      return res.status(200).json({ admin: !!(savedIp && savedIp === ip), ip, token: token || null });
    }

    if (req.method === "POST"){
      // crea o rinnova un token admin per QUESTO IP
      // se arriva x-admin-token, lo ri-associa all'IP; altrimenti ne genera uno
      let token = String(req.headers["x-admin-token"] || "").trim();
      if(!token) token = randHex(32);
      await redis.set(`admin:token:${token}`, ip, { ex: 60 * 60 * 24 * 7 }); // 7gg
      return res.status(200).json({ ok:true, token, ip, ttl_days:7 });
    }

    if (req.method === "DELETE"){
      const token = String(req.headers["x-admin-token"] || "").trim();
      if(!token) return res.status(400).json({ error:"missing_token" });
      await redis.del(`admin:token:${token}`);
      return res.status(200).json({ ok:true });
    }

    return res.status(405).json({ error:"method_not_allowed" });
  }catch(err){
    console.error("❌ [/api/admin-token] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
