// /api/admin-logs.js
// GET: elenco log (opz. maschera IP) | DELETE: svuota log
// Compatibile con Admin Dashboard v2 (What?f)

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "https://what-ifapp.vercel.app/",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function reflectCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,DELETE,OPTIONS");
  // consenti sia minuscolo che maiuscolo (header names case-insensitive, ma qui serve per la preflight)
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Admin-Token, x-admin-token, Authorization"
  );
  // niente cache su API admin
  res.setHeader("Cache-Control", "no-store");
}

function parseCookies(req) {
  const c = String(req.headers.cookie || "");
  const o = {};
  c.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1));
  });
  return o;
}

function getToken(req) {
  const h = String(
    req.headers["x-admin-token"] || req.headers["X-Admin-Token"] || ""
  ).trim();
  if (h) return h;
  const a = String(req.headers.authorization || "");
  if (a.toLowerCase().startsWith("bearer ")) return a.slice(7).trim();
  const q = req.query?.token ? String(req.query.token).trim() : "";
  if (q) return q;
  const ck = parseCookies(req);
  return ck["adm_tok"] || "";
}

function getIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  if (xff) {
    const ip = xff
      .split(",")
      .map((s) => s.trim())
      .find(Boolean);
    if (ip) return ip;
  }
  return (req.socket?.remoteAddress || "unknown").toString();
}

// 🔑 check admin
async function isValidAdmin(req) {
  const tok = getToken(req);
  if (!tok) return false;

  // 🔓 DEV-ONLY: token "1" = admin locale (quello che usi in admin.html)
  // così puoi vedere i log senza dover creare il token su Redis
  if (tok === "1") {
    return true;
  }

  try {
    const data = await redis.hgetall(`admin:token:${tok}`);
    if (!data) return false;

    const LOCK_IP =
      String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if (LOCK_IP) {
      const ip = getIp(req);
      if (!data.ip || data.ip !== ip) return false;
    }

    return true;
  } catch {
    return false;
  }
}

function maskIp(ip) {
  if (!ip) return "";
  const parts = String(ip).split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.${parts[3]}`;
  // IPv6 o altro
  if (ip.includes(":")) {
    const chunks = ip.split(":");
    return chunks
      .map((c, i) => (i >= 2 && i < chunks.length - 1 ? "***" : c))
      .join(":");
  }
  return ip;
}

export default async function handler(req, res) {
  reflectCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const admin = await isValidAdmin(req);
  if (!admin)
    return res.status(401).json({ ok: false, error: "auth_required" });

  try {
    if (req.method === "DELETE") {
      await redis.del("logs:ask");
      return res.status(200).json({ ok: true, cleared: true });
    }

    if (req.method !== "GET") {
      return res
        .status(405)
        .json({ ok: false, error: "method_not_allowed" });
    }

    const limit = Math.max(
      1,
      Math.min(
        1000,
        parseInt(String(req.query.limit || "200"), 10) || 200
      )
    );
    const order = String(req.query.order || "desc").toLowerCase(); // "desc" = più recenti prima
    const mask = String(req.query.mask || "1") === "1";

    // Nota: assumiamo che i log siano inseriti con LPUSH (nuovi in testa) o RPUSH (nuovi in coda).
    // Per robustezza ordineremo per ts lato API.
    const raw = await redis.lrange("logs:ask", 0, limit - 1); // se usi RPUSH potrebbe leggere i più vecchi: ordiniamo dopo

    const items = [];
    for (const r of raw || []) {
      try {
        const o = JSON.parse(r);
        items.push({
          ts: o.ts || o.time || o.timestamp || Date.now(),
          ip: o.ip || o.ip_masked || "",
          style: o.style || o.stile || "whatif",
          lang: o.lang || o.language || "it",
          periodo: o.periodo || o.periodo || o.timeframe || o.tempo || "",
          user_type:
            o.user_type || o.userType || (o.admin ? "admin" : "free"),
          domanda:
            typeof o.domanda === "string"
              ? o.domanda
              : o.question || o.q || "",
          answer_chars:
            typeof o.answer_chars === "number"
              ? o.answer_chars
              : typeof o.answer === "string"
              ? o.answer.length
              : typeof o.risposta === "string"
              ? o.risposta.length
              : 0,
        });
      } catch {
        // ignora entry malformate
      }
    }

    // Ordina per timestamp (default: desc = più recenti prima)
    items.sort((a, b) => (order === "asc" ? a.ts - b.ts : b.ts - a.ts));

    if (mask) for (const it of items) it.ip = maskIp(it.ip);

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    console.error("admin-logs error:", e);
    return res
      .status(500)
      .json({ ok: false, error: "server_error" });
  }
}
