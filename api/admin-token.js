// ============================
// /api/admin-token.js — Token ADMIN (∞ crediti) legato all’IP, TTL 7gg
// ============================
import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}

function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const ip = getIp(req);
  const ttl = 7 * 24 * 60 * 60; // 7 giorni

  try {
    if (req.method === "GET") {
      const tok = String(req.headers["x-admin-token"] || "").trim();
      if (!tok) return res.status(200).json({ admin: false, ip, token: null });
      const savedIp = await redis.get(`admin:token:${tok}`);
      const admin = !!savedIp && savedIp === ip;
      return res.status(200).json({ admin, ip, token: admin ? tok : null });
    }

    const url = new URL(req.url, "http://x");
    const renew = url.searchParams.get("renew");
    const revoke = url.searchParams.get("revoke");
    const clientTok = String(req.headers["x-admin-token"] || "").trim();

    if (revoke) {
      if (clientTok) await redis.del(`admin:token:${clientTok}`);
      return res.status(200).json({ ok: true, ip, revoked: !!clientTok });
    }

    if (renew) {
      if (!clientTok) return res.status(400).json({ error: "missing_token" });
      const savedIp = await redis.get(`admin:token:${clientTok}`);
      if (savedIp !== ip) return res.status(403).json({ error: "ip_mismatch" });
      await redis.expire(`admin:token:${clientTok}`, ttl);
      return res.status(200).json({ ok: true, ip, token: clientTok });
    }

    // attiva nuovo token
    const token = crypto.randomBytes(16).toString("hex");
    await redis.set(`admin:token:${token}`, ip, { ex: ttl });
    return res.status(200).json({ ok: true, ip, token });
  } catch (err) {
    console.error("❌ [/api/admin-token] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
