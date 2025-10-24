// ============================
// /api/admin-logs.js — versione stabile
// GET    : ultimi N log (default 200). ?limit=, ?mask=1 per IP mascherato
// DELETE : svuota log (richiede admin)
// Auth   : header x-admin-token valido (token↔IP)
// ============================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function tokenIp(tok) {
  try { return await redis.get(`admin:token:${tok}`); } catch { return null; }
}

function maskIp(ip) {
  if (!ip) return "";
  const parts = String(ip).split(".");
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.*.*`;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const tok = String(req.headers["x-admin-token"] || "").trim();
  const ip = await tokenIp(tok);
  if (!ip) return res.status(401).json({ ok: false, error: "auth_required" });

  try {
    if (req.method === "GET") {
      const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "200"), 10) || 200));
      const mask = String(req.query.mask || "0") === "1";
      const raw = await redis.lrange("logs:ask", 0, limit - 1);
      const items = [];
      for (const r of raw || []) {
        try {
          const o = JSON.parse(r);
          items.push({
            ts: o.ts || Date.now(),
            ip: mask ? maskIp(o.ip) : o.ip,
            style: o.style || "whatif",
            lang: o.lang || "it",
            periodo: o.periodo || "future",
            user_type: o.user_type || (o.admin ? "admin" : "free"),
            domanda: o.domanda || "",
            answer_chars: o.answer_chars || 0,
          });
        } catch {}
      }
      return res.status(200).json({ ok: true, items });
    }

    if (req.method === "DELETE") {
      await redis.del("logs:ask");
      return res.status(200).json({ ok: true, cleared: true });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    console.error("admin-logs error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
