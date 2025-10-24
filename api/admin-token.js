// /api/admin-token.js
// Gestione token ADMIN legato all'IP: crea / valida / rinnova / revoca
// PIN letto dal body (mai da header). TTL 7 giorni.

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const TTL = 7 * 24 * 60 * 60; // 7 giorni

function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}
function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const ip = getIp(req);

  try {
    if (req.method === "GET") {
      // valida token passato nell'header
      const tok = String(req.headers["x-admin-token"] || "").trim();
      if (!tok) return res.status(200).json({ ok: true, admin: false, ip, token: null });
      const savedIp = await redis.get(`admin:token:${tok}`);
      const admin = !!savedIp && savedIp === ip;
      return res.status(200).json({ ok: true, admin, ip, token: admin ? tok : null });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    const url = new URL(req.url, "http://x");
    const action = url.searchParams.get("action"); // renew | revoke | create(default)
    const passedToken = String(req.headers["x-admin-token"] || "").trim();

    if (action === "renew") {
      if (!passedToken) return res.status(400).json({ ok: false, error: "missing_token" });
      const savedIp = await redis.get(`admin:token:${passedToken}`);
      if (savedIp !== ip) return res.status(403).json({ ok: false, error: "ip_mismatch" });
      await redis.expire(`admin:token:${passedToken}`, TTL);
      return res.status(200).json({ ok: true, token: passedToken, ip, ttl: TTL });
    }

    if (action === "revoke") {
      if (passedToken) await redis.del(`admin:token:${passedToken}`);
      return res.status(200).json({ ok: true, revoked: !!passedToken });
    }

    // create: confronta PIN con env
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const pin = String(body.pin || "").trim();
    const envPin = String(process.env.ADMIN_PIN || "").trim();
    if (!envPin) return res.status(500).json({ ok: false, error: "missing_admin_pin_env" });
    if (!pin) return res.status(400).json({ ok: false, error: "missing_pin" });
    if (pin !== envPin) return res.status(401).json({ ok: false, error: "bad_pin" });

    const token = `adm_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    await redis.set(`admin:token:${token}`, ip, { ex: TTL });

    return res.status(200).json({ ok: true, token, ip, ttl: TTL });
  } catch (e) {
    console.error("admin-token error:", e);
    return res.status(500).json({ ok: false, error: "server_error", detail: String(e?.message || e) });
  }
}
