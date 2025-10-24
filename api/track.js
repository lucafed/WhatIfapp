// /api/track.js — minimal tracking con rate limit e CORS per domini consentiti
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// 20 richieste/min per IP
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 m"),
});

// Allinea con /api/ask.js
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500"
];

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function clientIp(req) {
  const raw = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString();
  return raw.split(",")[0].trim();
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const ip = clientIp(req);
    const { success } = await rl.limit(`track:${ip}`);
    if (!success) return res.status(429).json({ ok: false, error: "rate_limited_minute" });

    if (req.method === "POST") {
      await redis.incr("visits");
      return res.status(200).json({ ok: true, message: "tracking_saved" });
    }

    // GET
    const visits = (await redis.get("visits")) || 0;
    return res.status(200).json({ ok: true, visits, message: "alive" });
  } catch (err) {
    console.error("Errore track:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
