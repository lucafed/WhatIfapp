// /api/admin-token.js — genera e verifica token admin (HASH + TTL + LOCK_IP opzionale)

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ⚙️ Config
const ADMIN_PIN = process.env.ADMIN_PIN || "wtf-setup-2025";
const TTL_SECS  = parseInt(process.env.ADMIN_TTL_SECS || "", 10) || 2 * 24 * 60 * 60; // default 48h
const LOCK_IP   = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";

function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

// Validator condiviso (usabile anche da altri endpoint se importato)
export async function isValidAdmin(req) {
  const tok = String(req.headers["x-admin-token"] || "").trim();
  if (!tok) return false;
  try {
    const data = await redis.hgetall(`admin:token:${tok}`); // { ip, ua }
    if (!data) return false;
    if (LOCK_IP) {
      const ip = getIp(req);
      if (!data.ip || data.ip !== ip) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token, admin-secret");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // POST => crea/rigenera token da PIN
    if (req.method === "POST") {
      const pin = String(req.headers["admin-secret"] || req.body?.pin || "").trim();
      if (!pin) return res.status(401).json({ ok:false, error:"missing_pin" });
      if (pin !== ADMIN_PIN) return res.status(403).json({ ok:false, error:"bad_pin" });

      const ip = getIp(req);
      const ua = String(req.headers["user-agent"] || "");
      const token = `adm_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

      await redis.hset(`admin:token:${token}`, { ip, ua });
      await redis.expire(`admin:token:${token}`, TTL_SECS);

      return res.status(200).json({
        ok: true,
        token,
        ttlHours: Math.round(TTL_SECS / 3600),
        ip,
        lockIp: LOCK_IP
      });
    }

    // GET => verifica token corrente
    if (req.method === "GET") {
      const ok = await isValidAdmin(req);
      return res.status(200).json({ ok });
    }

    // DELETE => revoca token corrente
    if (req.method === "DELETE") {
      const tok = String(req.headers["x-admin-token"] || "").trim();
      if (!tok) return res.status(400).json({ ok:false, error:"missing_token" });
      await redis.del(`admin:token:${tok}`);
      return res.status(200).json({ ok:true });
    }

    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  } catch (e) {
    console.error("admin-token error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
