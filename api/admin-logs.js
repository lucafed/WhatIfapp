// FILE: /api/admin-logs.js
// Restituisce la lista di log salvati da /api/save, leggendo da Redis

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.ADMIN_API_TOKEN; // usa quello che hai in Vercel

async function readLogsFromRedis(limit = 200) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.error("Redis env vars mancanti in admin-logs.");
    throw new Error("redis_env_missing");
  }

  const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  const commands = [
    ["LRANGE", "logs:ask", "0", String(max - 1)]
  ];

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
    console.error("Redis LRANGE error:", res.status, txt);
    throw new Error("redis_read_failed");
  }

  const json = await res.json().catch(() => null);
  const first = Array.isArray(json) ? json[0] : null;
  const arr = (first && Array.isArray(first.result)) ? first.result : [];

  const items = [];
  for (const raw of arr) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        items.push(obj);
      }
    } catch {
      // ignora stringhe non parse-abili
    }
  }
  return items;
}

function maskIp(ip) {
  if (!ip) return "";
  // molto semplice: taglia dopo il secondo punto
  const parts = ip.split(".");
  if (parts.length >= 2) {
    return parts[0] + "." + parts[1] + ".*.*";
  }
  return ip;
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

    const { limit = "200", order = "desc", mask = "1" } = req.query || {};

    let items = await readLogsFromRedis(limit);

    // ordina per timestamp
    items.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (String(order).toLowerCase() === "desc") {
      items = items.reverse();
    }

    // maschera IP se richiesto
    if (String(mask) === "1") {
      items = items.map(it => ({
        ...it,
        ip: maskIp(it.ip || "")
      }));
    }

    return res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error("admin-logs handler error:", err);
    return res.status(500).json({ ok: false, error: err.message || "server_error" });
  }
}
