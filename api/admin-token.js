// /api/admin-token.js — registra token admin legato al PIN
import { Redis } from "@upstash/redis";
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// imposta il PIN reale qui sotto:
const REAL_PIN = "010818";

// token generato (puoi cambiarlo se vuoi)
const ADMIN_TOKEN = "basilico";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  const { pin } = await req.json().catch(() => ({}));
  if (pin !== REAL_PIN)
    return res.status(401).json({ error: "invalid_pin" });

  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .toString()
    .split(",")[0]
    .trim();

  try {
    await redis.set(`admin:token:${ADMIN_TOKEN}`, ip);
    await redis.expire(`admin:token:${ADMIN_TOKEN}`, 60 * 60 * 6); // valido 6 ore
  } catch (e) {
    console.error("Redis fail", e);
  }

  return res.status(200).json({ ok: true, token: ADMIN_TOKEN });
}
