// /api/track.js  (Pages API - Vercel)
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// 20 richieste/minuto per IP
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 m"),
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString();
    const { success } = await rl.limit(`track:${ip}`);
    if (!success) return res.status(429).json({ ok: false, error: "rate_limited_minute" });

    if (req.method === "POST") {
      await redis.incr("visits");
      return res.status(200).json({ ok: true, message: "📊 Tracking salvato!" });
    }

    const visits = (await redis.get("visits")) || 0;
    return res.status(200).json({ ok: true, visits, message: "✅ Route attiva" });
  } catch (err) {
    console.error("Errore Redis:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
