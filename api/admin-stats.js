// ============================
// /api/admin/stats.js — Dashboard Stats (protetto da admin-token)
// Legge logs:ask (ultimi 5000) + contatori stats:*  e calcola breakdown
// ============================
import { Redis } from "@upstash/redis";

// ---------- Redis ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ---------- CORS ----------
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}

// ---------- Helpers ----------
function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}
function ymd(ts) {
  try {
    return new Date(ts).toISOString().slice(0,10);
  } catch { return ""; }
}
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
function safeParseJSON(s){ try { return JSON.parse(s); } catch { return null; } }

async function isAdmin(req, ip) {
  const tok = String(req.headers["x-admin-token"] || "").trim();
  if (!tok) return false;
  try {
    const savedIp = await redis.get(`admin:token:${tok}`);
    return !!savedIp && savedIp === ip;
  } catch { return false; }
}

// ---------- Handler ----------
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const ip = getIp(req);
  const admin = await isAdmin(req, ip);
  if (!admin) return res.status(401).json({ error: "unauthorized" });

  try {
    const url = new URL(req.url, "http://x");
    const maxScan = clamp(Number(url.searchParams.get("max") || 5000), 200, 10000);
    const includeRecent = clamp(Number(url.searchParams.get("recent") || 50), 0, 200);
    const daysWindow = clamp(Number(url.searchParams.get("days") || 14), 1, 90);

    // --- Carica logs recenti (LREM range 0..maxScan-1) ---
    const raw = await redis.lrange("logs:ask", 0, maxScan - 1);
    const rows = [];
    for (const s of raw) {
      const v = safeParseJSON(s);
      if (!v) continue;
      // v = { ts, ip, style, lang, periodo, domanda, answer_chars, admin }
      rows.push(v);
    }

    const now = Date.now();
    const today = ymd(now);
    const dayCutoff = (n) => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - n);
      return d.valueOf();
    };
    const ts7 = dayCutoff(7);
    const tsWindow = dayCutoff(daysWindow);

    // --- Contatori globali memorizzati (se esistono) ---
    const [totalStored, styleH, langH, periodH] = await Promise.all([
      redis.get("stats:total").catch(() => null),
      redis.hgetall("stats:style").catch(() => ({})),
      redis.hgetall("stats:lang").catch(() => ({})),
      redis.hgetall("stats:periodo").catch(() => ({})),
    ]);

    // --- Aggregazioni dinamiche sui logs caricati ---
    const agg = {
      total: rows.length,
      today: 0,
      last7: 0,
      uniqueIPs_total: 0,
      uniqueIPs_today: 0,
      uniqueIPs_last7: 0,
      admin_calls: 0,
      user_calls: 0,
      avg_answer_chars: 0,
      max_answer_chars: 0,
      style: {},      // { whatif: n, wtf: n }
      lang: {},       // { it: n, en: n, ... }
      periodo: {},    // { past: n, future: n }
      byDay: {},      // { YYYY-MM-DD: n }
    };

    let sumChars = 0;
    const ipAll = new Set();
    const ipToday = new Set();
    const ipLast7 = new Set();

    for (const r of rows) {
      const isToday = ymd(r.ts) === today;
      const isLast7 = (r.ts >= ts7);
      if (isToday) agg.today++;
      if (isLast7) agg.last7++;

      if (r.admin) agg.admin_calls++; else agg.user_calls++;

      const ch = Number(r.answer_chars || 0) || 0;
      sumChars += ch;
      if (ch > agg.max_answer_chars) agg.max_answer_chars = ch;

      const st = String(r.style || "").toLowerCase();
      const la = String(r.lang || "").toLowerCase();
      const pe = String(r.periodo || "").toLowerCase();
      agg.style[st] = (agg.style[st] || 0) + 1;
      agg.lang[la] = (agg.lang[la] || 0) + 1;
      agg.periodo[pe] = (agg.periodo[pe] || 0) + 1;

      const d = ymd(r.ts);
      agg.byDay[d] = (agg.byDay[d] || 0) + 1;

      const ipItem = String(r.ip || "");
      if (ipItem) {
        ipAll.add(ipItem);
        if (isToday) ipToday.add(ipItem);
        if (isLast7) ipLast7.add(ipItem);
      }
    }
    agg.uniqueIPs_total = ipAll.size;
    agg.uniqueIPs_today = ipToday.size;
    agg.uniqueIPs_last7 = ipLast7.size;
    agg.avg_answer_chars = rows.length ? Math.round(sumChars / rows.length) : 0;

    // --- Serie temporale (ultimi N giorni) ordinata ---
    const days = [];
    for (let i = daysWindow - 1; i >= 0; i--) {
      const d = ymd(dayCutoff(i));
      days.push({ day: d, count: agg.byDay[d] || 0 });
    }

    // --- Recenti (ultimi N) sanificati ---
    const recent = rows.slice(0, includeRecent).map(r => ({
      ts: r.ts,
      day: ymd(r.ts),
      style: r.style,
      lang: r.lang,
      periodo: r.periodo,
      admin: !!r.admin,
      ipHash: hashIpLike(r.ip), // maschera IP per privacy
      domanda: trimQ(r.domanda),
      answer_chars: Number(r.answer_chars || 0) || 0,
    }));

    function hashIpLike(x="") {
      // hash rozzo solo per UI (non reversibile qui)
      let h = 5381; const s = String(x);
      for (let i=0;i<s.length;i++) { h=((h<<5)+h)+s.charCodeAt(i); h|=0; }
      return "h" + Math.abs(h);
    }
    function trimQ(q="") {
      const s = String(q).replace(/\s+/g," ").trim();
      if (s.length <= 160) return s;
      return s.slice(0,157) + "…";
    }

    // --- Risposta ---
    return res.status(200).json({
      ok: true,
      now: new Date().toISOString(),
      admin: true,
      ip,
      // contatori memorizzati (se presenti)
      stored: {
        total: Number(totalStored || 0),
        style: styleH || {},
        lang:  langH || {},
        periodo: periodH || {},
      },
      // aggregazioni calcolate sui logs:ask caricati
      computed: {
        sampleSize: rows.length,
        totals: {
          overall: agg.total,
          today: agg.today,
          last7: agg.last7,
          admin_calls: agg.admin_calls,
          user_calls: agg.user_calls,
          uniqueIPs: {
            overall: agg.uniqueIPs_total,
            today: agg.uniqueIPs_today,
            last7: agg.uniqueIPs_last7,
          },
        },
        breakdowns: {
          style: agg.style,
          lang: agg.lang,
          periodo: agg.periodo,
        },
        content: {
          avg_answer_chars: agg.avg_answer_chars,
          max_answer_chars: agg.max_answer_chars,
        },
        timeline: days,     // [{day, count}] ultimi N giorni (N=daysWindow)
        recent,             // ultimi `includeRecent` item
      },
    });

  } catch (err) {
    console.error("❌ [/api/admin/stats] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
