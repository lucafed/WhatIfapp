// ============================
// /api/admin-logs.js — elenco log What?f (per dashboard admin)
// Autenticazione: header x-admin-token legato a IP (come /api/admin-token)
// Query supportate: ?offset=0&limit=100&style=whatif|wtf|all&lang=it|en|all&periodo=past|future|all&q=testo
// ============================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();
    const token = String(req.headers["x-admin-token"] || "").trim();
    if (!token) return res.status(401).json({ error: "missing_token" });

    // auth: token -> ip
    const boundIp = await redis.get(`admin:token:${token}`);
    if (!boundIp || boundIp !== ip) {
      return res.status(403).json({ error: "unauthorized" });
    }

    // query
    const offset = toInt(req.query.offset, 0);
    const limit  = Math.min(toInt(req.query.limit, 100), 500);

    const style   = String(req.query.style || "all").toLowerCase();
    const lang    = String(req.query.lang || "all").toLowerCase();
    const periodo = String(req.query.periodo || "all").toLowerCase();
    const q       = String(req.query.q || "").toLowerCase().trim();

    // prendi un blocco ampio (ultimi 2000) e filtra
    const RAW_MAX = 2000;
    const raws = await redis.lrange("logs:ask", 0, RAW_MAX - 1);

    const all = [];
    for (const r of raws) {
      try {
        const o = typeof r === "string" ? JSON.parse(r) : r;
        if (!o || !o.ts) continue;

        // filtri
        if (style !== "all"   && String(o.style || "").toLowerCase()   !== style) continue;
        if (lang  !== "all"   && String(o.lang  || "").toLowerCase()    !== lang) continue;
        if (periodo !== "all" && String(o.periodo || "").toLowerCase()  !== periodo) continue;
        if (q && !String(o.domanda || "").toLowerCase().includes(q)) continue;

        all.push({
          ts: o.ts,
          whenISO: new Date(o.ts).toISOString(),
          ip: o.ip || "-",
          style: o.style || "",
          lang: o.lang || "",
          periodo: o.periodo || "",
          domanda: o.domanda || "",
          answer_chars: o.answer_chars || 0,
          pro: !!o.pro,
        });
      } catch { /* skip corrotto */ }
    }

    // ordinamento: più recenti prima
    all.sort((a, b) => b.ts - a.ts);

    const total = all.length;
    const items = all.slice(offset, offset + limit);

    return res.status(200).json({ ok: true, total, items });
  } catch (err) {
    console.error("❌ [/api/admin-logs] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
