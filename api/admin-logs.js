// /api/admin-logs.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}

async function ipForToken(token) {
  try { return await redis.get(`admin:token:${token}`); } catch { return null; }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!["GET","DELETE"].includes(req.method))
    return res.status(405).json({ ok:false, error:"method_not_allowed" });

  try {
    const token = String(req.headers["x-admin-token"] || "").trim();
    if (!token) return res.status(401).json({ ok:false, error:"missing_admin_token" });

    const ip = await ipForToken(token);
    if (!ip) return res.status(403).json({ ok:false, error:"invalid_or_expired_token" });

    if (req.method === "DELETE") {
      // Svuota i log completamente (come fa la tua UI)
      await redis.del("logs:ask");
      return res.status(200).json({ ok:true, cleared:true });
    }

    // GET — lista ultimi N
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
          domanda: o.domanda || "",
          answer_chars: o.answer_chars || 0,
          pro: !!o.pro,
        });
      } catch {}
    }

    const stats = { total: items.length, style: {}, lang: {}, periodo: {} };
    for (const it of items) {
      stats.style[it.style] = (stats.style[it.style] || 0) + 1;
      stats.lang[it.lang] = (stats.lang[it.lang] || 0) + 1;
      stats.periodo[it.periodo] = (stats.periodo[it.periodo] || 0) + 1;
    }

    return res.status(200).json({ ok:true, items, stats });
  } catch (e) {
    console.error("admin-logs error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
