// FILE: /api/admin-logs.js
// Restituisce log "safe" e statistiche (giornaliere/mensili/all-time) da Upstash Redis.
// ✅ Compatibile: /api/admin-logs?limit=200&order=desc
// ✅ Nuovo:      /api/admin-logs?stats=1&days=31&months=12&tz=Europe/Rome
//
// IMPORTANTISSIMO:
// - i log "recenti" sono SOLO una lista (max 200) per UI -> logs:ask:recent
// - i totali veri sono in hash contatori (∞) -> stats:ask:day:YYYY-MM-DD, stats:ask:month:YYYY-MM, stats:ask:all
//
// Questo file è coerente con /api/save.js che hai incollato (versione contatori).

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.ADMIN_API_TOKEN;

// Coerente con /api/save.js
const RECENT_KEY = "logs:ask:recent";
const ALL_KEY    = "stats:ask:all";

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

function pickResult(out, idx = 0, fallback = null) {
  const item = out && out[idx];
  if (!item) return fallback;
  if (item.error) return fallback;
  return ("result" in item) ? item.result : fallback;
}

async function redisLRange(key, start, stop) {
  const out = await redisPipeline([["LRANGE", key, String(start), String(stop)]]);
  const arr = pickResult(out, 0, []);
  return Array.isArray(arr) ? arr : [];
}

async function redisHGetAll(key) {
  const out = await redisPipeline([["HGETALL", key]]);
  const obj = pickResult(out, 0, null);
  // Upstash REST per HGETALL ritorna tipicamente un oggetto {field:value,...}
  if (!obj || typeof obj !== "object") return {};
  return obj;
}

async function redisMGet(keys) {
  if (!Array.isArray(keys) || !keys.length) return [];
  const cmds = keys.map(k => ["GET", k]);
  const out = await redisPipeline(cmds);
  return out.map((x) => (x && !x.error ? x.result : null));
}

// ---------- Parsing & sanitizzazione ----------
function safeJSONParse(s) {
  try {
    const o = JSON.parse(s);
    return (o && typeof o === "object") ? o : null;
  } catch {
    return null;
  }
}

function maskIp(ip) {
  if (!ip) return "";
  const parts = String(ip).split(".");
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}.*.*`;
  return String(ip);
}

// NOTA: il tuo /api/save.js NON salva ip/answer_chars: qui restano 0/"".
function toSafeItem(raw, doMask = true) {
  const it = raw || {};

  const safe = {
    ts: it.ts || null,
    style: (it.style || "whatif"),
    periodo: (it.periodo || "future"),
    lang: (it.lang || "it").toString().slice(0, 2),
    user_type: (it.user_type || "free"),
    source: (it.source || "manual"),
    surprise: (typeof it.surprise === "boolean") ? it.surprise : false,
    usedHint: (typeof it.usedHint === "boolean") ? it.usedHint : false,

    // campi legacy/compat (non li usi più ma restano safe)
    ip: doMask ? maskIp(it.ip || "") : (it.ip || ""),
    answer_chars: Number.isFinite(+it.answer_chars) ? +it.answer_chars : 0
  };

  // compat: se qualche client mandava micro.hints (nel tuo save già lo normalizzi)
  if (it.micro && typeof it.micro === "object") {
    if (typeof it.micro.hints === "boolean") safe.hints = it.micro.hints;
  }

  return safe;
}

// ---------- Time helpers ----------
function dateKey(ts, tz) {
  const d = new Date(Number(ts || 0));
  if (isNaN(d.getTime())) return null;

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(d); // YYYY-MM-DD
}

function monthKey(ts, tz) {
  const d = new Date(Number(ts || 0));
  if (isNaN(d.getTime())) return null;

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit"
  });
  return fmt.format(d); // YYYY-MM
}

function todayKey(tz) {
  return dateKey(Date.now(), tz);
}

function monthNowKey(tz) {
  return monthKey(Date.now(), tz);
}

function dayKeyFromAgo(tz, daysAgo) {
  const d = new Date(Date.now() - (daysAgo * 86400000));
  return dateKey(d.getTime(), tz);
}

function monthKeyFromAgo(tz, monthsAgo) {
  const now = new Date();
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() - monthsAgo);
  return monthKey(d.getTime(), tz);
}

// ---------- Stats: lettura contatori veri (∞) ----------
function normalizeHashNumbers(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const n = Number(v);
    out[k] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

function buildSummaryFromHash(h) {
  const hash = normalizeHashNumbers(h);

  const total = hash.total || 0;
  const whatif = hash["style:whatif"] || 0;
  const wtf = hash["style:wtf"] || 0;

  // periodo (modo)
  const future = hash["periodo:future"] || 0;
  const past = hash["periodo:past"] || 0;

  // combinazioni stile|periodo
  const wiFuture = hash["style:whatif|periodo:future"] || 0;
  const wiPast   = hash["style:whatif|periodo:past"] || 0;
  const wtfFuture= hash["style:wtf|periodo:future"] || 0;
  const wtfPast  = hash["style:wtf|periodo:past"] || 0;

  // bySource (tutto quello che inizia con source:)
  const bySource = {};
  for (const [k, v] of Object.entries(hash)) {
    if (k.startsWith("source:")) {
      bySource[k.slice("source:".length)] = v;
    }
  }

  // byLang (lang:it, lang:en,...)
  const byLang = {};
  for (const [k, v] of Object.entries(hash)) {
    if (k.startsWith("lang:")) {
      byLang[k.slice("lang:".length)] = v;
    }
  }

  // byUserType (user_type:free/pro/admin)
  const byUserType = {};
  for (const [k, v] of Object.entries(hash)) {
    if (k.startsWith("user_type:")) {
      byUserType[k.slice("user_type:".length)] = v;
    }
  }

  return {
    total,
    whatif,
    wtf,
    periodo: { future, past },
    matrix: {
      whatif: { future: wiFuture, past: wiPast, total: wiFuture + wiPast },
      wtf:    { future: wtfFuture, past: wtfPast, total: wtfFuture + wtfPast },
      all:    { future, past, total }
    },
    bySource,
    byLang,
    byUserType,
    raw: hash
  };
}

async function buildStats({ tz, days, months }) {
  const dayKeys = [];
  for (let i = 0; i < days; i++) {
    const dk = dayKeyFromAgo(tz, i);
    if (dk) dayKeys.push(dk);
  }

  const monthKeys = [];
  for (let i = 0; i < months; i++) {
    const mk = monthKeyFromAgo(tz, i);
    if (mk) monthKeys.push(mk);
  }

  // Chiavi hash in Redis
  const dayHashKeys = dayKeys.map(k => `stats:ask:day:${k}`);
  const monthHashKeys = monthKeys.map(k => `stats:ask:month:${k}`);

  // Pipeline: HGETALL per ogni key + HGETALL all-time + metadata GET
  const commands = [
    ...dayHashKeys.map(k => ["HGETALL", k]),
    ...monthHashKeys.map(k => ["HGETALL", k]),
    ["HGETALL", ALL_KEY],
  ];

  const out = await redisPipeline(commands);

  // parse output: prima days, poi months, poi all
  const byDay = {};
  for (let i = 0; i < dayKeys.length; i++) {
    const raw = pickResult(out, i, {});
    byDay[dayKeys[i]] = buildSummaryFromHash(raw || {});
  }

  const monthOffset = dayKeys.length;
  const byMonth = {};
  for (let i = 0; i < monthKeys.length; i++) {
    const raw = pickResult(out, monthOffset + i, {});
    byMonth[monthKeys[i]] = buildSummaryFromHash(raw || {});
  }

  const allRaw = pickResult(out, monthOffset + monthKeys.length, {});
  const all = buildSummaryFromHash(allRaw || {});

  // Ordine crescente (più vecchio → più nuovo) per UI pulita
  const byDaySorted = {};
  Object.keys(byDay).sort().forEach(k => (byDaySorted[k] = byDay[k]));

  const byMonthSorted = {};
  Object.keys(byMonth).sort().forEach(k => (byMonthSorted[k] = byMonth[k]));

  return {
    tz,
    range: {
      days,
      months,
      day_end: todayKey(tz),
      month_end: monthNowKey(tz),
      day_start: Object.keys(byDaySorted)[0] || null,
      month_start: Object.keys(byMonthSorted)[0] || null
    },
    all,        // totale vero all-time (∞)
    by_day: byDaySorted,
    by_month: byMonthSorted
  };
}

// ---------- Logs list (compatibilità, max 200) ----------
async function readRecentLogs(limit = 200) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const arr = await redisLRange(RECENT_KEY, 0, max - 1);

  const items = [];
  for (const raw of arr) {
    const obj = safeJSONParse(raw);
    if (obj) items.push(obj);
  }
  return items;
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

    if (!token || token !== ADMIN_TOKEN) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const q = req.query || {};

    // ✅ Modalità stats: legge contatori veri (∞), NON dipende dalla lista 200
    if (String(q.stats || "") === "1") {
      const tz = (q.tz && String(q.tz)) || "Europe/Rome";
      const days = Math.min(Math.max(parseInt(q.days, 10) || 31, 1), 120);
      const months = Math.min(Math.max(parseInt(q.months, 10) || 12, 1), 36);

      const stats = await buildStats({ tz, days, months });
      return res.status(200).json({ ok: true, stats });
    }

    // ✅ Modalità standard (compat) — log recenti (max 200)
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
