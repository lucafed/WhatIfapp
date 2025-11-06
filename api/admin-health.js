// /api/admin-health.js
// Healthcheck per capire se la Function risponde e se Upstash Redis è operativo.
// - CORS riflesso
// - OPTIONS preflight
// - Cache-Control: no-store
// - Check ENV Upstash
// - Roundtrip set/get su Redis (TTL 60s)

import { Redis } from "@upstash/redis";

const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "https://what-ifapp.vercel.app/",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function setCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Admin-Token, x-admin-token, Authorization"
  );
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const url = process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || "";

  // 1) Se mancano le ENV ti dico subito cosa manca
  if (!url || !token) {
    return res.status(200).json({
      ok: false,
      env: { url_present: !!url, token_present: !!token },
      error: "missing_upstash_env",
      hint:
        "Aggiungi UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN nelle Environment Variables del progetto (Production) e redeploy.",
    });
  }

  // 2) Roundtrip Redis (scrivi & leggi)
  try {
    const redis = new Redis({ url, token });
    const key = `health:whatif:${process.env.VERCEL_ENV || "prod"}`;
    const ts = Date.now();

    await redis.set(key, ts, { ex: 60 });
    const back = await redis.get(key);

    return res.status(200).json({
      ok: true,
      env: { url_present: true, token_present: true },
      redis: {
        write_ts: ts,
        read_back: Number(back),
        roundtrip_ok: Number(back) === ts,
      },
      function: {
        runtime: "vercel-function",
        node: process.version,
      },
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      env: { url_present: true, token_present: true },
      error: "redis_connect_error",
      detail: String(e?.message || e),
      hint:
        "Controlla che URL e TOKEN Upstash siano corretti, il database sia attivo e raggiungibile dal runtime Vercel.",
    });
  }
}
