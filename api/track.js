import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "https://what-ifapp.vercel.app");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();

    if (req.method === "POST") {
      await redis.incr("visits");
      return res.status(200).json({ ok: true, message: "📊 Tracking salvato!" });
    }

    const visits = (await redis.get("visits")) || 0;
    return res.status(200).json({ ok: true, visits, message: "✅ Route attiva", ts: new Date().toISOString() });
  } catch (err) {
    console.error("Errore Redis:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
