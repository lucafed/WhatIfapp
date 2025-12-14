// FILE: /api/save.js
// Salva in Redis SOLO metadati anonimi + aggiorna contatori (giorno/mese/all-time)
// NIENTE testo domanda, NIENTE risposta, NIENTE IP.

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.ADMIN_API_TOKEN;

/* =======================
   Helpers
======================= */

function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

function norm2(x, fallback = "it") {
  const s = (x || "").toString().toLowerCase();
  return (s.length >= 2 ? s.slice(0, 2) : fallback);
}

function normEnum(x, allowed, fallback) {
  const s = (x || "").toString().toLowerCase();
  return allowed.includes(s) ? s : fallback;
}

// Date key in Europe/Rome (NON UTC)
function getRomeDayMonthKeys(ts = Date.now()) {
  const d = new Date(ts);

  // YYYY-MM-DD
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

  // YYYY-MM
  const month = day.slice(0, 7);

  return { day, month };
}

async function redisPipeline(commands) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.error("Redis env vars mancanti.");
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
    throw new Error("redis_write_failed");
  }

  return res.json().catch(() => null);
}

/* =======================
   Handler
======================= */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const body = getBody(req);

    // === Metadati base ===
    const style   = normEnum(body.stile || body.style, ["whatif", "wtf"], "whatif");
    const periodo = normEnum(body.periodo, ["future", "past"], "future");
    const lang    = norm2(body.lang, "it");

    // === Origine domanda ===
    let source = (body.source || "").toString().toLowerCase();
    if (!source) {
      if (body.surprise === true || (body.micro && body.micro.surprise)) {
        source = "surprise";
      } else {
        source = "manual";
      }
    }
    source = normEnum(source, ["manual", "hint", "surprise"], "manual");

    const surprise = !!(body.surprise || (body.micro && body.micro.surprise));
    const usedHint = source === "hint" || body.usedHint === true || (body.micro && body.micro.hints === true);

    // === User type (verifica SERIA admin) ===
    const adminHeader = (req.headers["x-admin-token"] || "").toString();
    const isAdmin = !!(ADMIN_TOKEN && adminHeader && adminHeader === ADMIN_TOKEN);
    const isPro = req.headers["x-pro"] === "1";

    const user_type = isAdmin ? "admin" : (isPro ? "pro" : "free");

    const ts = Date.now();
    const { day, month } = getRomeDayMonthKeys(ts);

    const logItem = {
      ts,
      style,
      periodo,
      lang,
      user_type,
      source,
      surprise,
      usedHint,
    };

    /* =======================
       STRATEGIA REDIS
       1) logs:ask:recent  → ultimi 200 (UI)
       2) stats:ask:*      → contatori reali (∞)
    ======================= */

    const recentKey = "logs:ask:recent";
    const dayKey   = `stats:ask:day:${day}`;
    const monthKey = `stats:ask:month:${month}`;
    const allKey   = `stats:ask:all`;

    const fields = [
      ["total", 1],
      [`style:${style}`, 1],
      [`periodo:${periodo}`, 1],
      [`source:${source}`, 1],
      [`lang:${lang}`, 1],
      [`user_type:${user_type}`, 1],
      [`style:${style}|source:${source}`, 1],
      [`style:${style}|periodo:${periodo}`, 1],
      [`style:${style}|periodo:${periodo}|source:${source}`, 1],
    ];

    const commands = [
      ["LPUSH", recentKey, JSON.stringify(logItem)],
      ["LTRIM", recentKey, "0", "199"],

      ...fields.map(([f, inc]) => ["HINCRBY", dayKey,   f, String(inc)]),
      ...fields.map(([f, inc]) => ["HINCRBY", monthKey, f, String(inc)]),
      ...fields.map(([f, inc]) => ["HINCRBY", allKey,   f, String(inc)]),

      ["SET", "stats:ask:last_ts", String(ts)],
      ["SET", "stats:ask:last_day", day],
      ["SET", "stats:ask:last_month", month],
    ];

    await redisPipeline(commands);

    return res.status(200).json({ ok: true, day, month });
  } catch (err) {
    console.error("save handler error:", err);
    return res.status(500).json({ ok: false, error: err.message || "server_error" });
  }
}
