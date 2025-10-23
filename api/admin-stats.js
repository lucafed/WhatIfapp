// ============================
// /api/stats.js — Dashboard aggregata per Console Admin
// Legge "logs:ask" (ultimi 10k) e restituisce:
//   - totals: all-time, today, 7d
//   - breakdown: style, periodo, lang, user_type
//   - sparkline: ultimi 7 giorni (per style/periodo)
// ============================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function dayStr(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}
function withinDays(ts, days) {
  const now = Date.now();
  return (now - ts) <= days * 24 * 60 * 60 * 1000;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    // prendi ultimi N log
    const raw = await redis.lrange("logs:ask", 0, 9999);
    const rows = (raw || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);

    const today = dayStr();
    const totals = { all: rows.length, today: 0, last7d: 0 };
    const breakdown = {
      style: { whatif: 0, wtf: 0 },
      periodo: { past: 0, future: 0 },
      user_type: { free: 0, pro: 0, admin: 0 },
      lang: {},
    };
    const byDay = {}; // yyyy-mm-dd -> count
    const spark = []; // ultimi 7 giorni

    for (const r of rows) {
      const d = dayStr(r.ts || Date.now());
      byDay[d] = (byDay[d] || 0) + 1;

      if (d === today) totals.today++;
      if (withinDays(r.ts || Date.now(), 7)) totals.last7d++;

      if (r.style && breakdown.style[r.style] !== undefined) breakdown.style[r.style]++;
      if (r.periodo && breakdown.periodo[r.periodo] !== undefined) breakdown.periodo[r.periodo]++;
      if (r.user_type && breakdown.user_type[r.user_type] !== undefined) breakdown.user_type[r.user_type]++;
      breakdown.lang[r.lang || "unk"] = (breakdown.lang[r.lang || "unk"] || 0) + 1;
    }

    // Sparkline ultimi 7 giorni
    for (let i = 6; i >= 0; i--) {
      const d = dayStr(Date.now() - i * 24 * 60 * 60 * 1000);
      spark.push({ day: d, total: byDay[d] || 0 });
    }

    return res.status(200).json({
      ok: true,
      totals,
      breakdown,
      spark,
      sample: rows.slice(0, 20)  // piccola coda per debug in admin
    });
  } catch (err) {
    console.error("❌ [/api/stats] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
