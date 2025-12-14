// FILE: /api/save.js
// Salva in Redis SOLO metadati anonimi + aggiorna contatori (giorno/mese/all-time)
// NIENTE testo domanda, NIENTE risposta, NIENTE IP.

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.ADMIN_API_TOKEN;

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

// Date key in Europe/Rome (non UTC)
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
    console.error("Redis env vars mancanti (UPSTASH_REDIS_REST_URL / _TOKEN).");
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const body = getBody(req);

    // Metadati base
    const style   = normEnum(body.stile || body.style, ["whatif", "wtf"], "whatif");
    const periodo = normEnum(body.periodo, ["future", "past"], "future");
    const lang    = norm2(body.lang, "it");

    // Origine domanda: manual | hint | surprise
    let source = (body.source || "").toString().toLowerCase();
    if (!source) {
      if (body.surprise === true || body.surprise === "true" || (body.micro && body.micro.surprise)) {
        source = "surprise";
      } else {
        source = "manual";
      }
    }
    source = normEnum(source, ["manual", "hint", "surprise"], "manual");

    const surprise = !!(body.surprise || (body.micro && body.micro.surprise));
    const usedHint = source === "hint" || body.usedHint === true || (body.micro && body.micro.hints === true);

    // 🔒 user_type: NON fidarti solo della presenza dell'header.
    const adminHeader = (req.headers["x-admin-token"] || "").toString();
    const isAdmin = !!(ADMIN_TOKEN && adminHeader && adminHeader === ADMIN_TOKEN);

    const isPro = req.headers["x-pro"] === "1";
    const user_type = isAdmin ? "admin" : (isPro ? "pro" : "free");

    const ts = Date.now();
    const { day, month } = getRomeDayMonthKeys(ts);

    // Se non c'è nulla, skip
    if (!style && !periodo && !lang) {
      return res.status(200).json({ ok: true, skipped: true });
    }

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

    // ====== STRATEGIA REDIS ======
    // 1) Lista "recente" (ultimi 200) per UI
    // 2) Contatori per giorno/mese/all-time (sempre corretti anche >200)

    const recentKey = "logs:ask:recent";

    // Hash stats:
    // stats:ask:day:YYYY-MM-DD
    // stats:ask:month:YYYY-MM
    // stats:ask:all
    const dayKey   = `stats:ask:day:${day}`;
    const monthKey = `stats:ask:month:${month}`;
    const allKey   = `stats:ask:all`;

    // campi (hash) — così poi l’admin può fare breakdown super veloce
    const fields = [
      ["total", 1],

      [`style:${style}`, 1],
      [`periodo:${periodo}`, 1],
      [`source:${source}`, 1],
      [`lang:${lang}`, 1],
      [`user_type:${user_type}`, 1],

      // combinazioni utili per dashboard
      [`style:${style}|source:${source}`, 1],
      [`style:${style}|periodo:${periodo}`, 1],
      [`style:${style}|periodo:${periodo}|source:${source}`, 1],
    ];

    const commands = [
      // recent list (max 200)
      ["LPUSH", recentKey, JSON.stringify(logItem)],
      ["LTRIM", recentKey, "0", "199"],

      // counters day/month/all
      ...fields.map(([f, inc]) => ["HINCRBY", dayKey,   f, String(inc)]),
      ...fields.map(([f, inc]) => ["HINCRBY", monthKey, f, String(inc)]),
      ...fields.map(([f, inc]) => ["HINCRBY", allKey,   f, String(inc)]),

      // metadati utili per UI (non obbligatori)
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
