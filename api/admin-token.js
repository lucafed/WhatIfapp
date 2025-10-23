// ============================
// /api/admin-token.js — Token ADMIN (∞ crediti) legato all’IP
// Accetta header: admin-secret OPPURE x-admin-secret
// Fallback: pin nel body o nella query (?pin=...)
// TTL: 7 giorni (come tua UI). GET: stato, POST: crea/renew/revoke.
// ============================
import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Usa l'env se presente, altrimenti il PIN che avevi già
const ADMIN_PIN = process.env.ADMIN_PIN || "wtf-setup-2025";
const TTL_SECS = 7 * 24 * 60 * 60; // 7 giorni

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret, admin-secret, x-admin-token");
}
function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}
async function ipForToken(token) {
  try { return await redis.get(`admin:token:${token}`); } catch { return null; }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const ip = getIp(req);

    if (req.method === "GET") {
      // Stato token correntemente inviato
      const tok = String(req.headers["x-admin-token"] || "").trim();
      if (!tok) return res.status(200).json({ admin:false, ip, token:null, ttlHours: TTL_SECS/3600 });
      const savedIp = await ipForToken(tok);
      const admin = !!savedIp && savedIp === ip;
      return res.status(200).json({ admin, ip, token: admin ? tok : null, ttlHours: TTL_SECS/3600 });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok:false, error:"method_not_allowed" });
    }

    // Azioni speciali: renew/revoke
    const url = new URL(req.url, "http://x");
    const renew  = url.searchParams.get("renew");
    const revoke = url.searchParams.get("revoke");
    const clientTok = String(req.headers["x-admin-token"] || "").trim();

    if (revoke) {
      if (clientTok) await redis.del(`admin:token:${clientTok}`);
      return res.status(200).json({ ok:true, revoked: !!clientTok, ip });
    }
    if (renew) {
      if (!clientTok) return res.status(400).json({ ok:false, error:"missing_token" });
      const savedIp = await ipForToken(clientTok);
      if (savedIp !== ip) return res.status(403).json({ ok:false, error:"ip_mismatch" });
      await redis.expire(`admin:token:${clientTok}`, TTL_SECS);
      return res.status(200).json({ ok:true, token: clientTok, ip, ttlHours: TTL_SECS/3600 });
    }

    // Creazione token: accetta header/ body/ query
    const headerSecret =
      String(req.headers["admin-secret"] || req.headers["x-admin-secret"] || "").trim();
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const pinFromBody  = String(body.pin || "").trim();
    const pinFromQuery = String(new URL(req.url, "http://x").searchParams.get("pin") || "").trim();

    const provided = headerSecret || pinFromBody || pinFromQuery;
    if (!provided) return res.status(401).json({ ok:false, error:"missing_pin" });
    if (provided !== ADMIN_PIN) return res.status(403).json({ ok:false, error:"bad_pin" });

    const token = crypto.randomBytes(16).toString("hex");
    await redis.set(`admin:token:${token}`, ip, { ex: TTL_SECS });

    return res.status(200).json({ ok:true, token, ip, ttlHours: TTL_SECS/3600 });
  } catch (e) {
    console.error("❌ [/api/admin-token] error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
