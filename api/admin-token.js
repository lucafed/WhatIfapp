// /api/admin-token.js — genera/verifica/revoca token admin (HASH + TTL, lock IP opzionale + cookie)
// Accetta token via header x-admin-token, Authorization: Bearer, query ?token=..., o cookie adm_tok

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ⚙️ Config
const ADMIN_PIN  = process.env.ADMIN_PIN || "wtf-setup-2025";
const TTL_SECS   = parseInt(process.env.ADMIN_TTL_SECS || "", 10) || 2 * 24 * 60 * 60; // 48h
const LOCK_IP    = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
const COOKIE_NAME = "adm_tok";

function parseCookies(req) {
  const c = String(req.headers.cookie || "");
  const out = {};
  c.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1));
  });
  return out;
}
function getToken(req) {
  const h = String(req.headers["x-admin-token"] || "").trim();
  if (h) return h;
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const q = req.query?.token ? String(req.query.token).trim() : "";
  if (q) return q;
  const cookies = parseCookies(req);
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME].trim();
  return "";
}
function getIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  if (xff) {
    // prendi il PRIMO IP non-vuoto
    const ip = xff.split(",").map(s => s.trim()).find(Boolean);
    if (ip) return ip;
  }
  return (req.socket?.remoteAddress || "unknown").toString();
}

// Validator condiviso
export async function isValidAdmin(req) {
  const tok = getToken(req);
  if (!tok) return false;
  try {
    const data = await redis.hgetall(`admin:token:${tok}`); // { ip, ua }
    if (!data) return false;
    if (LOCK_IP) {
      const ip = getIp(req);
      if (!data.ip || data.ip !== ip) return false;
    }
    return true;
  } catch { return false; }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token, admin-secret, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "POST") {
      const pin = String(req.headers["admin-secret"] || req.body?.pin || "").trim();
      if (!pin) return res.status(401).json({ ok:false, error:"missing_pin" });
      if (pin !== ADMIN_PIN) return res.status(403).json({ ok:false, error:"bad_pin" });

      const ip = getIp(req);
      const ua = String(req.headers["user-agent"] || "");
      const token = `adm_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

      await redis.hset(`admin:token:${token}`, { ip, ua });
      await redis.expire(`admin:token:${token}`, TTL_SECS);

      // imposta cookie comodo lato browser
      res.setHeader("Set-Cookie",
        `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${TTL_SECS}; Path=/; SameSite=Lax; Secure`);

      return res.status(200).json({ ok:true, token, ttlHours: Math.round(TTL_SECS/3600), ip, lockIp: LOCK_IP });
    }

    if (req.method === "GET") {
      const ok = await isValidAdmin(req);
      return res.status(200).json({ ok });
    }

    if (req.method === "DELETE") {
      const tok = getToken(req);
      if (!tok) return res.status(400).json({ ok:false, error:"missing_token" });
      await redis.del(`admin:token:${tok}`);
      // cancella cookie
      res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax; Secure`);
      return res.status(200).json({ ok:true });
    }

    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  } catch (e) {
    console.error("admin-token error:", e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
}
