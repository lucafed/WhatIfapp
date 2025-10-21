import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// 1. Connessione a Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// 2. Imposta il rate limit: 20 richieste/minuto per IP
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 m"),
});

export default async function handler(req, res) {
  try {
    // 3. CORS
    res.setHeader("Access-Control-Allow-Origin", "https://what-ifapp.vercel.app");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();

    // 4. Rate limit
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString();
    const { success } = await ratelimit.limit(`track:${ip}`);
    if (!success) {
      return res.status(429).json({
        ok: false,
        error: "Troppo traffico! Riprova tra un minuto.",
      });
    }

    // 5. Logica principale
    if (req.method === "POST") {
      await redis.incr("visits");
      return res.status(200).json({ ok: true, message: "📊 Tracking salvato!" });
    }

    const visits = (await redis.get("visits")) || 0;
    return res.status(200).json({ ok: true, visits, message: "✅ Route attiva" });

  } catch (err) {
    console.error("Errore Redis:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
