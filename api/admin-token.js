// ============================
// /api/admin-token.js — versione stabile
// PIN -> token admin legato all'IP (TTL 7 giorni)
// Header atteso:  admin-secret: <PIN>  (oppure x-admin-secret)
// GET  : verifica token (x-admin-token)
// POST : crea / rinnova / revoca (query ?renew=1 | ?revoke=1)
// ============================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ADMIN_PIN = process.env.ADMIN_PIN || "wtf-2025";
const TTL = 7 * 24 * 60 * 60; // 7 giorni

function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token, admin-secret, x-admin-secret");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const ip = getIp(req);

    if (req.method === "GET") {
      const tok = String(req.headers["x-admin-token"] || "").trim();
      if (!tok) return res.status(200).json({ ok: true, admin: false, ip, token: null });
      const saved = await redis.get(`admin:token:${tok}`);
      const admin = !!saved && saved === ip;
      return res.status(200).json({ ok: true, admin, ip, token: admin ? tok : null });
    }

    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const url = new URL(req.url, "http://x");
    const renew = url.searchParams.get("renew");
    const revoke = url.searchParams.get("revoke");
    const clientTok = String(req.headers["x-admin-token"] || "").trim();

    if (revoke) {
      if (clientTok) await redis.del(`admin:token:${clientTok}`);
      return res.status(200).json({ ok: true, revoked: !!clientTok, ip });
    }

    if (renew) {
      if (!clientTok) return res.status(400).json({ ok: false, error: "missing_token" });
      const saved = await redis.get(`admin:token:${clientTok}`);
      if (saved !== ip) return res.status(403).json({ ok: false, error: "ip_mismatch" });
      await redis.expire(`admin:token:${clientTok}`, TTL);
      return res.status(200).json({ ok: true, token: clientTok, ip });
    }

    // creazione nuovo token (serve PIN)
    const pin = String(req.headers["admin-secret"] || req.headers["x-admin-secret"] || "").trim();
    if (!pin) return res.status(401).json({ ok: false, error: "missing_pin" });
    if (pin !== ADMIN_PIN) return res.status(403).json({ ok: false, error: "bad_pin" });

    const token = `adm_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    await redis.set(`admin:token:${token}`, ip, { ex: TTL });

    return res.status(200).json({ ok: true, token, ip, ttlHours: TTL / 3600 });
  } catch (e) {
    console.error("admin-token error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
