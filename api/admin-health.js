// /api/admin-health.js — verifica ENV + roundtrip su Upstash Redis (no segreti)
import { Redis } from "@upstash/redis";

const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function cors(res, origin) {
  if (ALLOWED_ORIGINS.includes(origin || "")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token, x-admin-token, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res, req.headers.origin);
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || "";
  const envOk = Boolean(url && token);

  if (!envOk) {
    return res.status(200).json({
      ok: false,
      env: {
        url_present: Boolean(url),
        token_present: Boolean(token),
      },
      error: "missing_upstash_env",
    });
  }

  try {
    const redis = new Redis({ url, token });
    const key = "health:whatif:" + (process.env.VERCEL_ENV || "local");
    const ts = Date.now();
    // roundtrip write + read (TTL 60s)
    await redis.set(key, ts, { ex: 60 });
    const back = await redis.get(key);

    return res.status(200).json({
      ok: true,
      env: { url_present: true, token_present: true },
      redis: {
        write_ts: ts,
        read_back: back,
        roundtrip_ok: Number(back) === ts,
      },
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      env: { url_present: true, token_present: true },
      error: "redis_connect_error",
      detail: String(e?.message || e),
    });
  }
}
