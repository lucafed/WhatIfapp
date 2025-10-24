// ============================
// /api/stats.js — versione stabile
// Aggrega gli ultimi N log (default 200) + trend ultimi X giorni
// Parametri: ?limit=200&trendDays=7
// Se presente x-admin-token valido, ritorna anche breakdown per user_type
// ============================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function isAdmin(req) {
  const tok = String(req.headers["x-admin-token"] || "").trim();
  if (!tok) return false;
  try {
    const ip = await redis.get(`admin:token:${tok}`);
    const reqIp = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();
    return !!ip && ip === reqIp;
  } catch { return false; }
}

export default async function handler(req, res) {
  try {
    const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "200"), 10) || 200));
    const trendDays = Math.max(1, Math.min(30, parseInt(String(req.query.trendDays || "7"), 10) || 7));
    const admin = await isAdmin(req);

    const raw = await redis.lrange("logs:ask", 0, limit - 1);
    const items = [];
    for (const r of raw || []) {
      try { items.push(JSON.parse(r)); } catch {}
    }

    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;
    const startToday = new Date().toISOString().slice(0,10);

    const stats = {
      ok: true,
      total: items.length,
      today: items.filter(x => new Date(x.ts).toISOString().slice(0,10) === startToday).length,
      last7: items.filter(x => now - (x.ts||now) <= 7*dayMs).length,
      byStyle: {},
      byLang: {},
      byPeriod: {},
      byUserType: {},
      trend: [], // [{day:'YYYY-MM-DD', count:n}]
    };

    for (const it of items) {
      stats.byStyle[it.style || "whatif"] = (stats.byStyle[it.style || "whatif"] || 0) + 1;
      stats.byLang[it.lang || "it"] = (stats.byLang[it.lang || "it"] || 0) + 1;
      stats.byPeriod[it.periodo || "future"] = (stats.byPeriod[it.periodo || "future"] || 0) + 1;
      if (admin) {
        const t = it.user_type || (it.admin ? "admin" : "free");
        stats.byUserType[t] = (stats.byUserType[t] || 0) + 1;
      }
    }

    // trend ultimi N giorni (client-friendly)
    const days = {};
    for (let i = 0; i < trendDays; i++) {
      const d = new Date(now - i*dayMs).toISOString().slice(0,10);
      days[d] = 0;
    }
    for (const it of items) {
      const d = new Date(it.ts || now).toISOString().slice(0,10);
      if (d in days) days[d] += 1;
    }
    stats.trend = Object.keys(days).sort().map(d => ({ day: d, count: days[d] }));

    return res.status(200).json(stats);
  } catch (e) {
    console.error("stats error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
