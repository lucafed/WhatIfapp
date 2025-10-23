// ============================
// /api/admin/stats.js — versione stabile e semplice
// Legge le statistiche da Redis (chiave logs:ask)
// ============================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const raw = await redis.lrange("logs:ask", 0, 9999);
    if (!raw) return res.status(200).json({ total: 0, today: 0, last7: 0, latest: [] });

    const events = [];
    for (const item of raw) {
      try {
        const e = JSON.parse(item);
        if (e.ts) events.push(e);
      } catch {}
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const todayStart = now - (now % dayMs);
    const weekStart = now - 7 * dayMs;

    let today = 0;
    let last7 = 0;

    for (const e of events) {
      if (e.ts >= todayStart) today++;
      if (e.ts >= weekStart) last7++;
    }

    const latest = events
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 10)
      .map((e) => ({
        ts: e.ts,
        style: e.style,
        lang: e.lang,
        domanda: e.domanda || "",
      }));

    return res.status(200).json({
      total: events.length,
      today,
      last7,
      latest,
    });
  } catch (err) {
    console.error("❌ [/api/admin/stats] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err.message || err) });
  }
}
