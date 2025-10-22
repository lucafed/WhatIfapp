// pages/api/admin-token.js
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
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function parseBody(req){
  try{
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (req.body && typeof req.body === "object") return req.body;
  }catch{}
  return {};
}

function getIp(req){
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

function genToken(){
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("");
}

export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const ip = getIp(req);

  try{
    if (req.method === "POST"){
      const { pin = "" } = parseBody(req);
      const adminPin = String(process.env.ADMIN_PIN || "").trim();
      if (!adminPin) return res.status(500).json({ error:"missing_admin_pin" });

      if (String(pin).trim() !== adminPin){
        return res.status(401).json({ ok:false, error:"bad_pin" });
      }

      const token = genToken();
      await redis.set(`admin:token:${token}`, ip, { ex: 60*60*24 }); // TTL 24h
      return res.status(200).json({ ok:true, token, ttl_seconds: 60*60*24 });
    }

    if (req.method === "GET"){
      const token = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i,"").trim();
      if (!token) return res.status(401).json({ ok:false, error:"missing_token" });
      const savedIp = await redis.get(`admin:token:${token}`);
      if (!savedIp || savedIp !== ip) return res.status(401).json({ ok:false, error:"invalid_token" });
      return res.status(200).json({ ok:true });
    }

    return res.status(405).json({ error:"method_not_allowed" });
  }catch(err){
    console.error("❌ [/api/admin-token] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
