// ============================
// /api/whoami.js — stato rapido (admin sì/no, IP)
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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}

function requesterIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error:"method_not_allowed" });

  try{
    const ip = requesterIp(req);
    const token = String(req.headers["x-admin-token"] || "").trim();
    let admin = false;
    if (token){
      const savedIp = await redis.get(`admin:token:${token}`);
      admin = !!(savedIp && savedIp === ip);
    }
    return res.status(200).json({
      ip,
      admin,
      creditsCap: admin ? Infinity : null, // il cap di 3/10 dipende da header x-pro lato client
    });
  }catch(err){
    console.error("❌ [/api/whoami] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
