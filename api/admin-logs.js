// FILE: /api/admin-logs.js
// Restituisce:
// - modalità standard: lista log "safe" recenti (max 200) da Redis list logs:ask:recent
// - modalità stats: contatori veri (giorno/mese/all-time) da Redis hash stats:ask:*
//
// ✅ Compatibile: /api/admin-logs?limit=200&order=desc
// ✅ Stats: /api/admin-logs?stats=1&days=31&months=12&tz=Europe/Rome

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.ADMIN_API_TOKEN;

const RECENT_LIST_KEY = "logs:ask:recent";

// ---------- Redis helpers ----------
async function redisPipeline(commands) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.error("Redis env vars mancanti in admin-logs.");
    throw new Error("redis_env_missing");
  }

  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commands)
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

async function redisLRange(key, start, stop) {
  const out = await redisPipeline([["LRANGE", key, String(start), String(stop)]]);
  const first = out[0];
  const arr = (first && Array.isArray(first.result)) ? first.result : [];
  return arr;
}

function hgetallFromPipelineResult(r) {
  // Upstash REST: HGETALL result è array [k1,v1,k2,v2,...] oppure null
  const raw = r && r.result;
  if (!Array.isArray(raw) || raw.length < 2) return {};
  const obj = {};
  for (let i = 0; i < raw.length - 1; i += 2) {
    const k = String(raw[i]);
    const v = raw[i + 1];
    obj[k] = (v == null ? "0" : String(v));
  }
  return obj;
}

// ---------- Parsing & sanitizzazione ----------
function maskIp(ip) {
  if (!ip) return "";
  const parts = String(ip).split(".");
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}.*.*`;
  return String(ip);
}

function toSafeItem(raw, doMask = true) {
  const it = raw || {};

  const safe = {
    ts: it.ts || null,
    style: it.style || "whatif",
    periodo: it.periodo || "future",
    lang: (it.lang || "it").toString().slice(0, 2),
    user_type: it.user_type || "free",
    ip: doMask ? maskIp(it.ip || "") : (it.ip || ""),
    answer_chars: Number.isFinite(+it.answer_chars) ? +it.answer_chars : 0
  };

  if (typeof it.source === "string") safe.source = it.source;
  if (typeof it.surprise === "boolean") safe.surprise = it.surprise;

  // compat eventuale micro/hints
  if (it.micro && typeof it.micro === "object") {
    if (typeof it.micro.source === "string" && !safe.source) safe.source = it.micro.source;
    if (typeof it.micro.surprise === "boolean" && safe.surprise == null) safe.surprise = it.micro.surprise;
    if (typeof it.micro.hints === "boolean") safe.hints = it.micro.hints;
  }
  if (typeof it.hints === "boolean" && safe.hints == null) safe.hints = it.hints;

  // normalize
  safe.style = (String(safe.style).toLowerCase() === "wtf") ? "wtf" : "whatif";
  safe.periodo = (String(safe.periodo).toLowerCase() === "past") ? "past" : "future";
  safe.source = (safe.source ? String(safe.source).toLowerCase() : "manual");

  return safe;
}

function safeJSONParse(s) {
  try {
    const o = JSON.parse(s);
    return (o && typeof o === "object") ? o : null;
  } catch {
    return null;
  }
}

// ---------- Time helpers (timezone-safe) ----------
function formatRomeDay(ts, tz) {
  const d = new Date(Number(ts || 0));
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d); // YYYY-MM-DD
}

function formatRomeMonth(ts, tz) {
  const day = formatRomeDay(ts, tz);
  return day ? day.slice(0, 7) : null; // YYYY-MM
}

function lastNDaysKeys(tz, days) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const ts = Date.now() - i * 86400000;
    const k = formatRomeDay(ts, tz);
    if (k) out.push(k);
  }
  // UI più comoda: asc
  return out.sort();
}

function lastNMonthsKeys(tz, months) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getTime());
    d.setMonth(d.getMonth() - i);
    const k = formatRomeMonth(d.getTime(), tz);
    if (k) out.push(k);
  }
  return out.sort();
}

// ---------- Logs list (compatibilità) ----------
async function readRecentLogs(limit = 200) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const arr = await redisLRange(RECENT_LIST_KEY, 0, max - 1);

  const items = [];
  for (const raw of arr) {
    const obj = safeJSONParse(raw);
    if (obj) items.push(obj);
  }
  return items;
}

// ---------- Stats from Redis hashes (NO LIMIT) ----------
async function buildHashStats({ tz, days, months }) {
  const dayKeys = lastNDaysKeys(tz, days);
  const monthKeys = lastNMonthsKeys(tz, months);

  const dayHashKeys = dayKeys.map(k => `stats:ask:day:${k}`);
  const monthHashKeys = monthKeys.map(k => `stats:ask:month:${k}`);
  const allKey = "stats:ask:all";

  const commands = [];

  // HGETALL per ogni day/month + all
  for (const k of dayHashKeys) commands.push(["HGETALL", k]);
  for (const k of monthHashKeys) commands.push(["HGETALL", k]);
  commands.push(["HGETALL", allKey]);

  // meta (optional)
  commands.push(["GET", "stats:ask:last_ts"]);
  commands.push(["GET", "stats:ask:last_day"]);
  commands.push(["GET", "stats:ask:last_month"]);

  const out = await redisPipeline(commands);

  const by_day = {};
  const by_month = {};

  // parse day hashes
  for (let i = 0; i < dayHashKeys.length; i++) {
    const k = dayKeys[i];
    by_day[k] = hgetallFromPipelineResult(out[i]);
  }

  // parse month hashes
  const monthOffset = dayHashKeys.length;
  for (let i = 0; i < monthHashKeys.length; i++) {
    const k = monthKeys[i];
    by_month[k] = hgetallFromPipelineResult(out[monthOffset + i]);
  }

  // parse all
  const allOffset = monthOffset + monthHashKeys.length;
  const all = hgetallFromPipelineResult(out[allOffset]);

  // meta
  const metaOffset = allOffset + 1;
  const last_ts = (out[metaOffset] && out[metaOffset].result) ? String(out[metaOffset].result) : "";
  const last_day = (out[metaOffset + 1] && out[metaOffset + 1].result) ? String(out[metaOffset + 1].result) : "";
  const last_month = (out[metaOffset + 2] && out[metaOffset + 2].result) ? String(out[metaOffset + 2].result) : "";

  return {
    tz,
    days,
    months,
    day_keys: dayKeys,
    month_keys: monthKeys,
    by_day,
    by_month,
    all,
    meta: { last_ts, last_day, last_month }
  };
}

// ---------- Handler ----------
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

    if (!token || String(token) !== String(ADMIN_TOKEN)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const q = req.query || {};

    // ✅ Stats mode (no limite)
    if (String(q.stats || "") === "1") {
      const tz = (q.tz && String(q.tz)) || "Europe/Rome";
      const days = Math.min(Math.max(parseInt(q.days, 10) || 31, 1), 120);
      const months = Math.min(Math.max(parseInt(q.months, 10) || 12, 1), 36);

      const stats = await buildHashStats({ tz, days, months });
      return res.status(200).json({ ok: true, stats });
    }

    // ✅ Modalità standard: recenti (max 200)
    const { limit = "200", order = "desc", mask = "1" } = q;

    let items = await readRecentLogs(limit);

    // ordina per timestamp
    items.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (String(order).toLowerCase() === "desc") items = items.reverse();

    const doMask = String(mask) === "1";
    const safeItems = items.map(raw => toSafeItem(raw, doMask));

    return res.status(200).json({ ok: true, items: safeItems });
  } catch (err) {
    console.error("admin-logs handler error:", err);
    return res.status(500).json({ ok: false, error: err.message || "server_error" });
  }
}
