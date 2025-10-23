// /api/admin-logs.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function ipForToken(token) {
  try { return await redis.get(`admin:token:${token}`); } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const token = String(req.headers["x-admin-token"] || "").trim();
    if (!token) return res.status(401).json({ ok:false, error:"missing_admin_token" });
    const ip = await ipForToken(token);
    if (!ip) return res.status(403).json({ ok:false, error:"invalid_or_expired_token" });

    if (req.method === "DELETE") {
      await redis.del("logs:ask");
      return res.status(200).json({ ok:true, cleared:true });
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
          style: o.style || o.stile || "whatif",
          lang: o.lang || "it",
          periodo: o.periodo || "future",
          user_type: o.user_type || (o.admin ? "admin" : "free"),
          domanda: o.domanda || "",
          answer_chars: o.answer_chars || 0,
        });
      } catch {}
    }

    return res.status(200).json({ ok:true, items });
  } catch (e) {
    console.error("admin-logs error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
