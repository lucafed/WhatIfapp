// /api/admin-stats.js — aggregati e trend (auth admin + CORS riflesso + no-store)
// Compatibile con Admin Dashboard v2 (grafico con serie whatif/wtf)

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
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token, x-admin-token, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

// Helpers minimi per token/IP (standalone)
function parseCookies(req) {
  const c = String(req.headers.cookie || ""); const o = {};
  c.split(";").forEach(p => { const i = p.indexOf("="); if (i > -1) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1)); });
  return o;
}
function getToken(req) {
  const h = String(req.headers["x-admin-token"] || req.headers["X-Admin-Token"] || "").trim(); if (h) return h;
  const a = String(req.headers.authorization || ""); if (a.toLowerCase().startsWith("bearer ")) return a.slice(7).trim();
  const q = req.query?.token ? String(req.query.token).trim() : ""; if (q) return q;
  const ck = parseCookies(req); return ck["adm_tok"] || "";
}
function getIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  if (xff) { const ip = xff.split(",").map(s => s.trim()).find(Boolean); if (ip) return ip; }
  return (req.socket?.remoteAddress || "unknown").toString();
}
async function isValidAdmin(req) {
  const tok = getToken(req); if (!tok) return false;
  try {
    const data = await redis.hgetall(`admin:token:${tok}`);
    if (!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if (LOCK_IP) { const ip = getIp(req); if (!data.ip || data.ip !== ip) return false; }
    return true;
  } catch { return false; }
}

// Utils numerici
const toInt = (v) => { const n = parseInt(String(v ?? "0"), 10); return Number.isFinite(n) ? n : 0; };
function numHash(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) out[k] = toInt(v);
  return out;
}

// Calcolo trend da chiavi stats:day oppure fallback da logs
async function computeTrend(days) {
  const labels = [];
  const whatif = [];
  const wtf = [];

  // Proviamo prima con chiavi aggregate per giorno (se esistono)
  let haveDailyKeys = true;
  const daily = []; // [{date:'YYYY-MM-DD', whatif: n, wtf: n}]
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD in UTC
    const key = `stats:day:${iso}`; // atteso: { whatif: N, wtf: N } oppure { ...altro... }

    const h = await redis.hgetall(key);
    if (!h || Object.keys(h).length === 0) { haveDailyKeys = false; }
    const wi = toInt(h?.whatif ?? h?.what_if ?? 0);
    const wf = toInt(h?.wtf ?? h?.what_the_f ?? 0);

    daily.push({ date: iso, wi, wf });
  }

  if (!haveDailyKeys) {
    // Fallback: costruiamo il trend scansionando i log del periodo richiesto
    // Nota: per semplicità prendiamo un numero ragionevole di log (es. 20000)
    const raw = await redis.lrange("logs:ask", 0, 20000);
    const map = new Map(); // date -> {wi, wf}
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      map.set(d.toISOString().slice(0, 10), { wi: 0, wf: 0 });
    }
    for (const r of raw || []) {
      try {
        const o = JSON.parse(r);
        const day = new Date(o.ts || o.time || Date.now()).toISOString().slice(0, 10);
        if (!map.has(day)) continue;
        const style = String(o.style || o.stile || "whatif").toLowerCase();
        if (style === "wtf" || style === "what the f") map.get(day).wf++;
        else map.get(day).wi++;
      } catch {}
    }
    daily.length = 0; // reset
    // ripopola in ordine cronologico
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      const iso = d.toISOString().slice(0, 10);
      const v = map.get(iso) || { wi: 0, wf: 0 };
      daily.push({ date: iso, wi: v.wi, wf: v.wf });
    }
  }

  for (const row of daily) {
    labels.push(row.date.slice(5, 10)); // MM-DD
    whatif.push(row.wi);
    wtf.push(row.wf);
  }
  return { labels, whatif, wtf };
}

export default async function handler(req, res) {
  reflectCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const admin = await isValidAdmin(req);
  if (!admin) return res.status(401).json({ ok: false, error: "auth_required" });

  try {
    const days = Math.max(1, Math.min(30, parseInt(String(req.query.days || "10"), 10) || 10));

    // Aggregati principali (con fallback a 0)
    const total = toInt(await redis.get("stats:total"));

    // Hash numeriche
    const byStyle    = numHash(await redis.hgetall("stats:style"));
    const byLang     = numHash(await redis.hgetall("stats:lang"));
    const byPeriod   = numHash(await redis.hgetall("stats:periodo"));
    const byUserType = numHash(await redis.hgetall("stats:user_type"));

    // today & last7 — fallback da log raw se non hai contatori diretti
    let today = 0, last7 = 0;
    const now = new Date();
    const todayIso = now.toISOString().slice(0,10);
    const todayStart = new Date(`${todayIso}T00:00:00.000Z`).getTime(); // UTC
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;

    // se hai una chiave diretta per oggi/ultimi7 puoi leggere quella; altrimenti fallback:
    const raw = await redis.lrange("logs:ask", 0, 20000);
    for (const r of raw || []) {
      try {
        const o = JSON.parse(r);
        const ts = toInt(o.ts || o.time || o.timestamp || 0);
        if (!ts) continue;
        if (ts >= todayStart) today++;
        if (ts >= sevenDaysAgo) last7++;
      } catch {}
    }

    const trend = await computeTrend(days);

    return res.status(200).json({
      ok: true,
      total, today, last7,
      byStyle, byLang, byPeriod, byUserType,
      trend
    });
  } catch (e) {
    console.error("admin-stats error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
