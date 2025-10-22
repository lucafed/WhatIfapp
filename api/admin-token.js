// /api/admin-token.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// segreto “di setup” usato dal client per poter generare il token admin
const ADMIN_SETUP_SECRET = process.env.ADMIN_SETUP_SECRET || "wtf-setup-2025";
// PIN valido (quello che digiti nella UI)
const ADMIN_PIN = process.env.ADMIN_PIN || "010818";

// CORS base
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function setCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, admin-secret");
}

function getIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0]?.trim();
  return xf || req.socket?.remoteAddress || "unknown";
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const secret = String(req.headers["admin-secret"] || "").trim();
    if (!secret || secret !== ADMIN_SETUP_SECRET) {
      return res.status(401).json({ ok: false, error: "missing_or_invalid_secret" });
    }

    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    } catch { body = {}; }

    const pin = String(body.pin || "").trim();
    if (!pin || pin !== ADMIN_PIN) {
      return res.status(403).json({ ok: false, error: "bad_pin" });
    }

    // genera token “fisso” (va benissimo uno statico)
    const token = "wtf-admin-master";
    const ip = getIp(req);

    // lega token -> ip per 48h
    await redis.set(`admin:token:${token}`, ip, { ex: 60 * 60 * 48 });

    return res.status(200).json({ ok: true, token, bound_to: ip || "ANY" });
  } catch (e) {
    console.error("admin-token error", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
