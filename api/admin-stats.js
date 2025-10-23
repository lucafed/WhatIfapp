// ============================
// /api/admin/stats.js — Statistiche console Admin
// Legge counters + ultimi eventi da Redis
// Compatibile con i log scritti da /api/ask (logs:ask, stats:*)
// ============================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// --- CORS base (aperto: la UI admin legge in GET) ---
function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(500).json({ error: "missing_redis_env" });
  }

  try {
    // ---- Parametri opzionali ----
    const url = new URL(req.url, "http://x");
    const maxEvents = Math.max(100, Math.min(10000, Number(url.searchParams.get("limit")) || 10000));
    const includeLatest = (url.searchParams.get("latest") || "1") !== "0";  // default: sì
    const now = Date.now();
    const startOfToday = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
    const todayMs0 = new Date(startOfToday + "T00:00:00.000Z").getTime();
    const last7Ms = now - 7 * 24 * 60 * 60 * 1000;

    // ---- Letture veloci counters (se presenti) ----
    // Non sono obbligatori: se mancano, li ricaviamo dagli eventi.
    const [totalCounter, byStyleH, byLangH, byPeriodoH] = await Promise.all([
      redis.get("stats:total"),
      redis.hgetall("stats:style"),
      redis.hgetall("stats:lang"),
      redis.hgetall("stats:periodo")
    ]).catch(() => [null, null, null, null]);

    // ---- Ultimi eventi (per oggi / ultimi 7 giorni + latest) ----
    // /api/ask spinge JSON in LPUSH logs:ask, mantieni ultimi ~5000
    const raw = await redis.lrange("logs:ask", 0, maxEvents - 1);
    const events = [];
    for (const r of raw || []) {
      try {
        const e = typeof r === "string" ? JSON.parse(r) : r;
        // atteso: {ts, ip, style, lang, periodo, domanda, answer_chars, admin}
        if (e && typeof e.ts === "number") events.push(e);
      } catch { /* ignore */ }
    }

    // ---- Aggregazioni dinamiche ----
    let total = typeof totalCounter === "number" ? totalCounter : (await redis.llen("logs:ask")).catch(() => 0);
    if (!total || isNaN(total)) total = events.length; // fallback

    let today = 0, last7 = 0;
    const byStyle = { whatif: 0, wtf: 0, ...(byStyleH || {}) };
    const byLang = { it: 0, en: 0, ...(byLangH || {}) };
    const byPeriodo = { future: 0, past: 0, ...(byPeriodoH || {}) };

    for (const e of events) {
      if (e.ts >= todayMs0) today++;
      if (e.ts >= last7Ms) last7++;
      if (e.style) byStyle[e.style] = (Number(byStyle[e.style]) || 0) + 1;
      if (e.lang) byLang[e.lang] = (Number(byLang[e.lang]) || 0) + 1;
      if (e.periodo) byPeriodo[e.periodo] = (Number(byPeriodo[e.periodo]) || 0) + 1;
    }

    // ordina gli ultimi (max 20) per ts desc
    let latest = [];
    if (includeLatest) {
      latest = events
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 20)
        .map((e) => ({
          ts: e.ts,
          style: e.style,
          lang: e.lang,
          periodo: e.periodo,
          admin: !!e.admin,
          domanda: e.domanda || "",
          answer_chars: e.answer_chars || 0
        }));
    }

    return res.status(200).json({
      ok: true,
      now,
      total,
      today,
      last7,
      by_style: tidyNums(byStyle),
      by_lang: tidyNums(byLang),
      by_periodo: tidyNums(byPeriodo),
      sample: events.length,
      latest
    });
  } catch (err) {
    console.error("❌ [/api/admin/stats] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}

// Converte eventuali stringhe numeriche in numeri veri, rimuove chiavi vuote
function tidyNums(obj = {}) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v == null) continue;
    const n = Number(v);
    out[k] = Number.isFinite(n) ? n : v;
  }
  return out;
}
