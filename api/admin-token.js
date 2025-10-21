// /api/admin-token.js
import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const TOKEN_TTL = 60 * 60; // 1 ora

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const secret = String(process.env.RESET_SECRET || "");
    const supplied = String(req.headers["x-admin-secret"] || "").trim();
    if (!secret || supplied !== secret) {
      return res.status(403).json({ error: "forbidden" });
    }

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
      .toString().split(",")[0].trim() || "unknown";

    const token = crypto.randomBytes(24).toString("hex");
    const key = `admin:token:${token}`;

    await redis.set(key, ip);
    await redis.expire(key, TOKEN_TTL);

    return res.status(200).json({ ok: true, token, ttl_s: TOKEN_TTL, ip });
  } catch (err) {
    console.error("admin-token error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
