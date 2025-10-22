// /api/admin-token.js
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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const PASSPHRASE = "basilico"; // semplice come richiesto

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { token, passphrase } = body;

    if (!token || !passphrase) return res.status(400).json({ error: "bad_request" });
    if (passphrase !== PASSPHRASE) return res.status(403).json({ error: "forbidden" });

    await redis.set(`admin:token:${token}`, ip);
    await redis.expire(`admin:token:${token}`, 60 * 60 * 24 * 7); // 7 giorni
    return res.status(200).json({ ok: true, ip });
  } catch (e) {
    console.error("admin-token error", e);
    return res.status(500).json({ error: "server_error" });
  }
}
