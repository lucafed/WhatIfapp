import { Redis } from "@upstash/redis";

export default async (req, res) => {
  try {
    const redis = Redis.fromEnv(); // legge UPSTASH_REDIS_REST_URL e TOKEN da Vercel
    await redis.set("whatif:keepalive", Date.now(), { ex: 3600 });
    const pong = await redis.ping();
    res.status(200).json({ ok: true, pong });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
