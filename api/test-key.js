// /api/test-key.js
import { Redis } from "@upstash/redis";

export default async function handler(req, res) {
  try {
    const hasUrl = !!process.env.UPSTASH_REDIS_REST_URL;
    const hasTok = !!process.env.UPSTASH_REDIS_REST_TOKEN;
    let ok = false;
    if (hasUrl && hasTok) {
      const r = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
      try { await r.set("upstash:ping", "ok", { px: 1000 }); ok = true; } catch {}
    }
    res.status(200).json({ ok: true, env: { url: hasUrl, token: hasTok }, redisOk: ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
