// FILE: /api/admin-logs.js
// Restituisce:
// 1) log "safe" recenti (max 200) da Redis list logs:ask:recent
// 2) statistiche (giorni/mesi/all) da Redis hash stats:ask:*
//
// Compat:
//   /api/admin-logs?limit=200&order=desc
// Nuovo stats:
//   /api/admin-logs?stats=1&days=31&months=12&tz=Europe/Rome

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.ADMIN_API_TOKEN;

const RECENT_KEY = "logs:ask:recent";

async function redisPipeline(commands) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.error("Redis env vars mancanti in admin-logs.");
    throw new Error("redis_env_missing");
  }

  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("Redis pipeline error:", res.status, txt);
    throw new Error("redis_call_failed");
  }

  const json = await res.json().catch(() => null);
  if (!Array.isArray(json)) throw new Error("redis_bad_response");
  return json;
}

function safeJSONParse(s) {
  try {
    const o = JSON.parse(s);
    return (o && typeof o === "object") ? o : null;
  } catch {
    return null;
  }
}

function toSafeItem(raw) {
  const it = raw || {};
  return {
    ts: it.ts || null,
    style: (it.style || "whatif").toString(),
    periodo: (it.periodo || "future").toString(),
    lang: (it.lang || "it").toString().slice(0, 2),
    user_type: (it.user_type || "free").toString(),
    source: (it.source || "manual").toString(),
    surprise: !!it.surprise,
    hints: !!(it.usedHint || it.hints),
  };
}

// ===== Time helpers (Europe/Rome di default) =====
function dateKey(ts, tz) {
  const d = new Date(Number(ts || 0));
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // YYYY-MM-DD
}
function monthKey(ts, tz) {
  const d = new Date(Number(ts || 0));
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).format(d); // YYYY-MM
}
function todayDayKey(tz) {
  return dateKey(Date.now(), tz);
}
function thisMonthKey(tz) {
  return monthKey(Date.now(), tz);
}
function dayKeyAgo(tz, daysAgo) {
  return dateKey(Date.now() - (daysAgo * 86400000), tz);
}
function monthKeyAgo(tz, monthsAgo) {
  const now = new Date();
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() - monthsAgo);
  return monthKey(d.getTime(), tz);
}

// ===== Stats from hashes =====
async function hgetall(key) {
  const out = await redisPipeline([["HGETALL", key]]);
  const first = out[0];
  const obj = (first && first.result && typeof first.result === "object") ? first.result : {};
  // Upstash può tornare {} oppure null
  return obj || {};
}

function toNumberMap(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const n = Number(v);
    out[k] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

async function buildStats({ tz, days, months }) {
  const dayKeys = [];
  for (let i = 0; i < days; i++) dayKeys.push(dayKeyAgo(tz, i));
  dayKeys.reverse(); // asc

  const monthKeys = [];
  for (let i = 0; i < months; i++) monthKeys.push(monthKeyAgo(tz, i));
  monthKeys.reverse(); // asc

  // Pipeline: HGETALL per tutti i giorni/mesi + all
  const commands = [
    ...dayKeys.map(k => ["HGETALL", `stats:ask:day:${k}`]),
    ...monthKeys.map(k => ["HGETALL", `stats:ask:month:${k}`]),
    ["HGETALL", "stats:ask:all"],
    ["GET", "stats:ask:last_ts"],
    ["GET", "stats:ask:last_day"],
    ["GET", "stats:ask:last_month"],
  ];

  const results = await redisPipeline(commands);

  let idx = 0;
  const by_day = {};
  for (const dk of dayKeys) {
    const r = results[idx++] || {};
    const raw = (r.result && typeof r.result === "object") ? r.result : {};
    by_day[dk] = toNumberMap(raw);
  }

  const by_month = {};
  for (const mk of monthKeys) {
    const r = results[idx++] || {};
    const raw = (r.result && typeof r.result === "object") ? r.result : {};
    by_month[mk] = toNumberMap(raw);
  }

  const allRes = results[idx++] || {};
  const allRaw = (allRes.result && typeof allRes.result === "object") ? allRes.result : {};
  const all = toNumberMap(allRaw);

  const last_ts = Number((results[idx++] || {}).result || 0) || 0;
  const last_day = String((results[idx++] || {}).result || "");
  const last_month = String((results[idx++] || {}).result || "");

  return {
    tz,
    range: {
      days,
      months,
      day_end: todayDayKey(tz),
      month_end: thisMonthKey(tz),
    },
    keys: {
      today_day: todayDayKey(tz),
      this_month: thisMonthKey(tz),
    },
    last: { ts: last_ts || null, day: last_day || null, month: last_month || null },
    by_day,
    by_month,
    all,
  };
}

// ===== Recent logs =====
async function readRecentLogs(limit = 200) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const out = await redisPipeline([["LRANGE", RECENT_KEY, "0", String(max - 1)]]);
  const arr = (out[0] && Array.isArray(out[0].result)) ? out[0].result : [];
  const parsed = arr.map(safeJSONParse).filter(Boolean).map(toSafeItem);
  return parsed;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const token = req.headers["x-admin-token"];

    if (!ADMIN_TOKEN) {
      console.error("ADMIN_TOKEN non configurato.");
      return res.status(500).json({ ok: false, error: "admin_token_missing" });
    }
    if (!token || token !== ADMIN_TOKEN) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const q = req.query || {};

    // ===== STATS MODE =====
    if (String(q.stats || "") === "1") {
      const tz = (q.tz && String(q.tz)) || "Europe/Rome";
      const days = Math.min(Math.max(parseInt(q.days, 10) || 31, 1), 120);
      const months = Math.min(Math.max(parseInt(q.months, 10) || 12, 1), 36);

      const stats = await buildStats({ tz, days, months });
      return res.status(200).json({ ok: true, stats });
    }

    // ===== RECENT MODE (compat) =====
    const { limit = "200", order = "desc" } = q;

    let items = await readRecentLogs(limit);

    // di default i recent sono già “desc” perché LPUSH
    if (String(order).toLowerCase() === "asc") items = items.slice().reverse();

    return res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error("admin-logs handler error:", err);
    return res.status(500).json({ ok: false, error: err.message || "server_error" });
  }
}
