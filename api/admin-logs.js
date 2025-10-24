// /api/admin-logs.js — elenco richieste + domande (auth admin, validator coerente)

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Validator coerente con /api/admin-token.js
async function isValidAdmin(req) {
  const tok = String(req.headers["x-admin-token"] || "").trim();
  if (!tok) return false;
  try {
    const data = await redis.hgetall(`admin:token:${tok}`);
    if (!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if (LOCK_IP) {
      const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
        .toString().split(",")[0].trim();
      if (!data.ip || data.ip !== ip) return false;
    }
    return true;
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();

  const admin = await isValidAdmin(req);
  if (!admin) return res.status(401).json({ ok:false, error: "auth_required" });

  try {
    if (req.method === "DELETE") {
      await redis.del("logs:ask");
      return res.status(200).json({ ok:true });
    }

    if (req.method !== "GET") return res.status(405).json({ ok:false, error:"method_not_allowed" });

    const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "200"), 10) || 200));
    const raw = await redis.lrange("logs:ask", 0, limit - 1);
    const items = [];
    for (const r of raw || []) {
      try {
        const o = JSON.parse(r);
        items.push({
          ts: o.ts || Date.now(),
          ip: o.ip || "",
          user_type: o.user_type || (o.admin ? "admin" : "free"),
          style: o.style || "whatif",
          lang: o.lang || "it",
          periodo: o.periodo || "future",
          domanda: o.domanda || "",
          answer_chars: o.answer_chars || 0,
        });
      } catch {}
    }

    // stats locali sul blocco caricato
    const stats = { total: items.length, byStyle:{}, byLang:{}, byPeriod:{}, byUserType:{} };
    for (const it of items) {
      stats.byStyle[it.style] = (stats.byStyle[it.style] || 0) + 1;
      stats.byLang[it.lang] = (stats.byLang[it.lang] || 0) + 1;
      stats.byPeriod[it.periodo] = (stats.byPeriod[it.periodo] || 0) + 1;
      stats.byUserType[it.user_type] = (stats.byUserType[it.user_type] || 0) + 1;
    }

    return res.status(200).json({ ok:true, items, stats });
  } catch (e) {
    console.error("admin-logs error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
