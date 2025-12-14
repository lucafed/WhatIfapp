// FILE: /api/admin-logs.js
// Restituisce log "safe" e statistiche (giornaliere/mensili) leggendo da Upstash Redis.
// ✅ Compatibile con l'uso attuale: /api/admin-logs?limit=200&order=desc
// ✅ Nuovo: /api/admin-logs?stats=1&days=31&months=12&tz=Europe/Rome

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.ADMIN_API_TOKEN;

const LIST_KEY = "logs:ask";

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

async function redisLLen(key) {
  const out = await redisPipeline([["LLEN", key]]);
  const first = out[0];
  const n = first && first.result;
  const len = Number.isFinite(+n) ? +n : 0;
  return len;
}

async function redisLRange(key, start, stop) {
  const out = await redisPipeline([["LRANGE", key, String(start), String(stop)]]);
  const first = out[0];
  const arr = (first && Array.isArray(first.result)) ? first.result : [];
  return arr;
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

  if (it.micro && typeof it.micro === "object") {
    if (typeof it.micro.source === "string" && !safe.source) safe.source = it.micro.source;
    if (typeof it.micro.surprise === "boolean" && safe.surprise == null) safe.surprise = it.micro.surprise;
    if (typeof it.micro.hints === "boolean") safe.hints = it.micro.hints;
  }
  if (typeof it.hints === "boolean" && safe.hints == null) safe.hints = it.hints;

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

// ---------- Time helpers (timezone-safe, senza librerie) ----------
function dateKey(ts, tz) {
  // YYYY-MM-DD in timezone tz
  const d = new Date(Number(ts || 0));
  if (isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(d); // en-CA => YYYY-MM-DD
}

function monthKey(ts, tz) {
  // YYYY-MM in timezone tz
  const d = new Date(Number(ts || 0));
  if (isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit"
  });
  return fmt.format(d); // en-CA => YYYY-MM
}

function todayKey(tz) {
  return dateKey(Date.now(), tz);
}

function subtractDaysKey(tz, daysAgo) {
  const d = new Date(Date.now() - (daysAgo * 86400000));
  return dateKey(d.getTime(), tz);
}

function subtractMonthsKey(tz, monthsAgo) {
  const now = new Date();
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() - monthsAgo);
  return monthKey(d.getTime(), tz);
}

// ---------- Stats aggregation ----------
function ensureBucket(map, key) {
  if (!map[key]) {
    map[key] = {
      total: 0,
      whatif: 0,
      wtf: 0,
      bySource: {},     // manual/hint/surprise/...
      surprise_yes: 0,
      hints_yes: 0
    };
  }
  return map[key];
}

function incBucket(bucket, item) {
  bucket.total += 1;

  const style = (item.style === "wtf") ? "wtf" : "whatif";
  bucket[style] += 1;

  const src = (typeof item.source === "string" && item.source.trim()) ? item.source.trim() : "manual";
  bucket.bySource[src] = (bucket.bySource[src] || 0) + 1;

  if (item.surprise === true) bucket.surprise_yes += 1;
  if (item.hints === true) bucket.hints_yes += 1;
}

async function buildStats({ tz, days, months, maxScan }) {
  const totalAllTime = await redisLLen(LIST_KEY);

  const dayStart = subtractDaysKey(tz, Math.max(days - 1, 0));
  const monthStart = subtractMonthsKey(tz, Math.max(months - 1, 0));

  const wantDayKeys = new Set();
  for (let i = 0; i < days; i++) wantDayKeys.add(subtractDaysKey(tz, i));

  const wantMonthKeys = new Set();
  for (let i = 0; i < months; i++) wantMonthKeys.add(subtractMonthsKey(tz, i));

  const byDay = {};
  const byMonth = {};

  // Scansiona in chunk dalla testa della lista.
  // Se in Redis usi LPUSH (consigliato), qui hai i più recenti subito.
  const CHUNK = 250; // equilibrato
  let scanned = 0;
  let done = false;

  // Heuristica: se i primi due ts sono decrescenti -> lista è "recent-first"
  let recentFirst = null;

  while (!done && scanned < Math.min(totalAllTime, maxScan)) {
    const start = scanned;
    const stop = scanned + CHUNK - 1;

    const raws = await redisLRange(LIST_KEY, start, stop);
    if (!raws.length) break;

    const parsed = raws.map(safeJSONParse).filter(Boolean);

    if (recentFirst === null && parsed.length >= 2) {
      const a = Number(parsed[0].ts || 0);
      const b = Number(parsed[1].ts || 0);
      if (Number.isFinite(a) && Number.isFinite(b) && a && b) {
        recentFirst = a >= b; // true se ts[0] >= ts[1]
      }
    }

    for (const rawObj of parsed) {
      const item = toSafeItem(rawObj, true);
      const ts = Number(item.ts || 0);
      if (!Number.isFinite(ts) || !ts) continue;

      const dk = dateKey(ts, tz);
      const mk = monthKey(ts, tz);

      if (dk && wantDayKeys.has(dk)) incBucket(ensureBucket(byDay, dk), item);
      if (mk && wantMonthKeys.has(mk)) incBucket(ensureBucket(byMonth, mk), item);

      // Stop condition: se la lista è recent-first e siamo andati oltre l'intervallo più vecchio richiesto
      // (cioè stiamo leggendo log sempre più vecchi), possiamo fermarci.
      if (recentFirst === true) {
        // se dk esiste ed è più vecchio del giorno minimo richiesto e mk più vecchio del mese minimo richiesto
        // basta fermarsi quando siamo sicuramente oltre entrambi i range.
        if (dk && dk < dayStart && mk && mk < monthStart) {
          done = true;
          break;
        }
      }
    }

    scanned += raws.length;

    // Se recentFirst non è determinabile, non possiamo fermarci in modo "furbo":
    // continuiamo fino a maxScan.
    if (raws.length < CHUNK) break;
  }

  // Riempie eventuali giorni/mesi mancanti con 0 (per UI ordinata)
  for (const k of wantDayKeys) ensureBucket(byDay, k);
  for (const k of wantMonthKeys) ensureBucket(byMonth, k);

  // Ordina chiavi (day asc, month asc)
  const daysSorted = Object.keys(byDay).sort();
  const monthsSorted = Object.keys(byMonth).sort();

  const outByDay = {};
  for (const k of daysSorted) outByDay[k] = byDay[k];

  const outByMonth = {};
  for (const k of monthsSorted) outByMonth[k] = byMonth[k];

  return {
    total_all_time: totalAllTime,
    scanned_items: scanned,
    recent_first: recentFirst, // true/false/null
    tz,
    range: {
      days,
      months,
      day_start: dayStart,
      day_end: todayKey(tz),
      month_start: monthStart
    },
    by_day: outByDay,
    by_month: outByMonth
  };
}

// ---------- Logs list (compatibilità) ----------
async function readLogsList(limit = 200) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const arr = await redisLRange(LIST_KEY, 0, max - 1);

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

    // ✅ NUOVO: stats mode
    if (String(q.stats || "") === "1") {
      const tz = (q.tz && String(q.tz)) || "Europe/Rome";
      const days = Math.min(Math.max(parseInt(q.days, 10) || 31, 1), 120);
      const months = Math.min(Math.max(parseInt(q.months, 10) || 12, 1), 36);
      const maxScan = Math.min(Math.max(parseInt(q.maxScan, 10) || 20000, 1000), 200000);

      const stats = await buildStats({ tz, days, months, maxScan });
      return res.status(200).json({ ok: true, stats });
    }

    // ✅ Modalità standard (come prima)
    const { limit = "200", order = "desc", mask = "1" } = q;

    let items = await readLogsList(limit);

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
