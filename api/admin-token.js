// /api/admin-token.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Passphrase (PIN) semplice per mobile — cambiala quando vuoi
const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE || "mobile";
// Quanto dura il token admin (in secondi)
const TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24h

function getIp(req){
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const secret = String(req.headers["x-admin-secret"] || "");
  if (!secret || secret !== ADMIN_PASSPHRASE) {
    return res.status(401).json({ error: "bad_secret" });
  }

  // Token “semplice per mobile” come richiesto; in futuro possiamo randomizzarlo
  const token = "any-mobile-admin-token-4u7x";
  const ip = getIp(req);

  try {
    // Salva il token legato al tuo IP per 24h
    await redis.set(`admin:token:${token}`, ip, { ex: TOKEN_TTL_SECONDS });
    return res.status(200).json({ token, ttl: TOKEN_TTL_SECONDS });
  } catch (e) {
    console.error("[/api/admin-token] error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
