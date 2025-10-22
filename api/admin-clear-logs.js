// ============================
// /api/admin-clear-logs.js — pulizia sicura log What?f
// Solo per admin autenticati via token
// ============================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
  const token = String(req.headers["x-admin-token"] || "").trim();

  try {
    // verifica token admin legato a IP
    const storedIp = await redis.get(`admin:token:${token}`);
    if (!storedIp || storedIp !== ip) {
      return res.status(403).json({ error: "unauthorized" });
    }

    // cancella log ma lascia statistiche
    await redis.del("logs:ask");

    return res.status(200).json({ ok: true, message: "Log azzerati con successo ✅" });
  } catch (err) {
    console.error("❌ clear-logs error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
