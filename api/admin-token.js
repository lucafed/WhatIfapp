// ==============================
// /api/admin-token.js
// Gestione accesso admin via PIN + token IP
// Compatibile con admin.html (usa query ?pin=...)
// ==============================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ✅ PIN letto dalla QUERY (non dal body!)
    const { pin } = req.query;
    const ADMIN_PIN = process.env.ADMIN_PIN;

    if (!ADMIN_PIN)
      return res.status(500).json({ ok: false, error: "missing_env_PIN" });

    if (!pin || pin !== ADMIN_PIN)
      return res.status(401).json({ ok: false, error: "bad_pin" });

    // IP del richiedente
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // genera token random
    const token = Math.random().toString(36).slice(2);

    // salva token legato all’IP (12 ore)
    await redis.set(`admin:token:${token}`, ip, { ex: 3600 * 12 });

    return res.status(200).json({ ok: true, token, ip });
  } catch (err) {
    console.error("❌ /api/admin-token.js error", err);
    return res.status(500).json({ ok: false, error: "server_error", detail: String(err.message || err) });
  }
}
