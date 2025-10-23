// ============================
// /api/admin-logs.js — Ultimi log + DELETE per svuotare
// Fonte: lista Redis "logs:ask" scritta da /api/ask.js
// ============================
import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}
async function isAdmin(req) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try { return !!(await redis.get(`admin:token:${token}`)); } catch { return false; }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (!(await isAdmin(req))) return res.status(401).json({ ok:false, error:"not_admin" });

    if (req.method === "DELETE") {
      await redis.del("logs:ask");
      return res.status(200).json({ ok:true, cleared:true });
    }

    // GET
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

    // compute stats (finestra caricata)
    const stats = { total: items.length, byStyle:{}, byLang:{}, byTime:{}, byUser:{} };
    for (const it of items) {
      stats.byStyle[it.style]   = (stats.byStyle[it.style]||0)+1;
      stats.byLang[it.lang]     = (stats.byLang[it.lang]||0)+1;
      stats.byTime[it.periodo]  = (stats.byTime[it.periodo]||0)+1;
      stats.byUser[it.user_type]= (stats.byUser[it.user_type]||0)+1;
    }

    return res.status(200).json({ ok:true, items, stats });
  } catch (e) {
    console.error("❌ [/api/admin-logs] error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
