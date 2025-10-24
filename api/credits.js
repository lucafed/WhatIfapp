// ============================
// /api/credits.js — Stato crediti (solo lettura)
// Admin: ∞ ; PRO: 10/g ; Free: 3/g
// ============================
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

async function isAdmin(req, ip) {
  const tok = String(req.headers["x-admin-token"] || "").trim();
  if (!tok) return false;
  try {
    const saved = await redis.get(`admin:token:${tok}`);
    return !!saved && saved === ip;
  } catch { return false; }
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "GET") return res.status(405).json({ ok:false, error:"method_not_allowed" });

    const ip = getIp(req);
    const admin = await isAdmin(req, ip);
    const isPro = String(req.headers["x-pro"] || "") === "1";

    if (admin) {
      return res.status(200).json({
        ok: true, ip, admin: true, pro: isPro,
        credits: { used: 0, dailyCap: null, remaining: null, mode: "admin" }
      });
    }

    const today = new Date().toISOString().slice(0,10);
    const key = `credits:${ip}:${today}`;
    let used = 0;
    try { used = Number(await redis.get(key)) || 0; } catch {}
    const dailyCap = isPro ? 10 : 3;
    const remaining = Math.max(0, dailyCap - used);

    return res.status(200).json({
      ok: true, ip, admin: false, pro: isPro,
      credits: { used, dailyCap, remaining, mode: isPro ? "pro" : "free" }
    });
  } catch (e) {
    console.error("credits error:", e);
    res.status(500).json({ ok:false, error:"server_error" });
  }
}
