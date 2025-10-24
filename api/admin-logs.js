// /api/admin-logs.js
// GET ultimi log (con filtri/limit, opz. maschera IP) — DELETE per svuotare

import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}
async function isAdmin(req) {
  const tok = String(req.headers["x-admin-token"] || "").trim();
  if (!tok) return false;
  const saved = await redis.get(`admin:token:${tok}`);
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
  return !!saved && saved === ip;
}
function maskIp(ip) {
  if (!ip) return "";
  const parts = String(ip).split(".");
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.***.${parts[3]}`;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (!(await isAdmin(req))) return res.status(401).json({ ok: false, error: "unauthorized" });

    if (req.method === "DELETE") {
      await redis.del("logs:ask");
      return res.status(200).json({ ok: true, cleared: true });
    }

    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "200"), 10) || 200));
    const raw = await redis.lrange("logs:ask", 0, limit - 1);
    const items = [];
    for (const r of raw || []) {
      try {
        const o = JSON.parse(r);
        items.push({
          ts: o.ts || Date.now(),
          ip: o.ip || "",
          style: o.style || "whatif",
          lang: o.lang || "it",
          periodo: o.periodo || "future",
          user_type: o.user_type || (o.admin ? "admin" : "free"),
          domanda: o.domanda || "",
          answer_chars: o.answer_chars || 0,
        });
      } catch {}
    }

    const mask = String(req.query.mask || "1") === "1";
    if (mask) for (const it of items) it.ip = maskIp(it.ip);

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    console.error("admin-logs error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
