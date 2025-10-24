// ============================
// /api/admin-stats.js — Stats + Log per dashboard
//  - Keys lette: logs:ask, stats:* (compatibile col tuo /api/ask.js)
//  - Query params:
//      limit   -> max elementi log (default 200, max 1000)
//      days    -> finestra per stats lastN (default 7)
//      mask    -> "1" per mascherare IP nel payload log (solo estetica)
// ============================
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function clamp(n, lo, hi) {
  n = Number(n || 0);
  if (Number.isNaN(n)) n = lo;
  return Math.max(lo, Math.min(hi, n));
}

// somma valori numerici di un hash (string->int)
function sumHash(h) {
  let s = 0;
  if (!h) return 0;
  for (const k of Object.keys(h)) s += Number(h[k] || 0);
  return s;
}

function isoDay(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function maskIp(ip = "") {
  if (!ip) return ip;
  if (ip.includes(".")) {
    const p = ip.split(".");
    p[3] = "x";
    return p.join(".");
  }
  // IPv6: tronca
  return ip.replace(/:[0-9a-f]+$/i, ":xxxx");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }

    const url = new URL(req.url, "http://x");
    const limit = clamp(url.searchParams.get("limit") || 200, 1, 1000);
    const days = clamp(url.searchParams.get("days") || 7, 1, 30);
    const mask = String(url.searchParams.get("mask") || "0") === "1";

    // ---- LOGS (ultimi N)
    const raw = await redis.lrange("logs:ask", 0, limit - 1); // già ordinati dal più recente
    let items = [];
    for (const r of raw || []) {
      try {
        const o = JSON.parse(r);
        // normalizzazione minima per robustezza
        items.push({
          ts: Number(o.ts || Date.now()),
          ip: mask ? maskIp(o.ip || "") : String(o.ip || ""),
          style: o.style || o.stile || "whatif",
          lang: o.lang || "it",
          periodo: o.periodo || "future",
          domanda: o.domanda || "",
          answer_chars: Number(o.answer_chars || 0),
          user_type: o.user_type || (o.admin ? "admin" : "free"),
        });
      } catch {}
    }

    // ---- TOTAL (counter cumulativo)
    const total = Number((await redis.get("stats:total")) || 0);

    // ---- TODAY / LAST N DAYS (da bucket stats:day:YYYY-MM-DD)
    const todayKey = `stats:day:${isoDay()}`;
    const todayHash = (await redis.hgetall(todayKey)) || {};
    const today = sumHash(todayHash);

    const keys = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      keys.push(`stats:day:${isoDay(d)}`);
    }
    const hashes = await Promise.all(keys.map((k) => redis.hgetall(k)));
    const lastNBreakdown = {}; // somma per chiave (es. "wtf:future")
    for (const h of hashes) {
      if (!h) continue;
      for (const k of Object.keys(h)) {
        lastNBreakdown[k] = (lastNBreakdown[k] || 0) + Number(h[k] || 0);
      }
    }
    const lastN = sumHash(lastNBreakdown);

    // trend giornaliero (array di { day, count })
    const trend = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = `stats:day:${isoDay(d)}`;
      const h = hashes[days - 1 - i] || {};
      trend.push({ day: isoDay(d), count: sumHash(h) });
    }

    // breakdown globali (ricavati dai logs caricati in finestra)
    const breakdown = {
      style: {},
      lang: {},
      periodo: {},
      user_type: {},
    };
    for (const it of items) {
      breakdown.style[it.style] = (breakdown.style[it.style] || 0) + 1;
      breakdown.lang[it.lang] = (breakdown.lang[it.lang] || 0) + 1;
      breakdown.periodo[it.periodo] =
        (breakdown.periodo[it.periodo] || 0) + 1;
      breakdown.user_type[it.user_type] =
        (breakdown.user_type[it.user_type] || 0) + 1;
    }

    res.status(200).json({
      ok: true,
      total,
      today,
      lastN, // somma ultimi "days"
      days,
      todayBreakdown: todayHash, // es. {"wtf:future":12,"whatif:past":3}
      lastNBreakdown,            // stesso formato
      trend,                     // serie nel tempo per grafico lineare
      breakdown,                 // breakdown sulla finestra di log caricata
      items,                     // lista log (con domanda)
    });
  } catch (e) {
    console.error("admin-stats error:", e);
    res.status(500).json({ ok: false, error: "server_error", detail: String(e?.message || e) });
  }
}
