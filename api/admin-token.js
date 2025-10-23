// ============================
// /api/admin-token.js — Token ADMIN (∞ crediti) legato all’IP, TTL 48h
// ============================
import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const TTL_SECS = 48 * 60 * 60; // 48 ore
const ADMIN_PIN = process.env.ADMIN_PIN || "wtf-setup-2025"; // cambia in Vercel

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token, admin-secret, x-admin-secret");
}
function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // GET: verifica stato token
    if (req.method === "GET") {
      const token = String(req.headers["x-admin-token"] || "").trim();
      const ip = getIp(req);
      if (!token) return res.status(200).json({ ok: true, admin: false, ip });
      const savedIp = await redis.get(`admin:token:${token}`);
      const admin = !!savedIp && savedIp === ip;
      return res.status(200).json({ ok: true, admin, ip, token: admin ? token : null });
    }

    // POST: genera token (serve PIN)
    if (req.method === "POST") {
      const pin = String(req.headers["x-admin-secret"] || req.headers["admin-secret"] || "").trim();
      if (!pin) return res.status(401).json({ ok: false, error: "missing_pin" });
      if (pin !== ADMIN_PIN) return res.status(403).json({ ok: false, error: "bad_pin" });

      const ip = getIp(req);
      const token = crypto.randomBytes(16).toString("hex");
      await redis.set(`admin:token:${token}`, ip, { ex: TTL_SECS });
      return res.status(200).json({ ok: true, token, ip, ttlHours: TTL_SECS / 3600 });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    console.error("❌ [/api/admin-token] error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
