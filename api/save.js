// FILE: /api/save.js
// Salva in Redis la domanda/risposta per l’admin panel

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// piccola helper per chiamare Upstash Redis (pipeline LPUSH + LTRIM)
async function pushLogToRedis(item) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.error("Redis env vars mancanti (UPSTASH_REDIS_REST_URL / _TOKEN).");
    throw new Error("redis_env_missing");
  }

  const commands = [
    ["LPUSH", "logs:ask", JSON.stringify(item)],
    ["LTRIM", "logs:ask", "0", "199"] // tieni solo gli ultimi 200
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
    console.error("Redis pipeline error:", res.status, txt);
    throw new Error("redis_write_failed");
  }
}

// compat body (se Next ha già fatto JSON.parse, non riparsiamo)
function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const body = getBody(req);

    const domanda = (body.domanda || "").toString().trim();
    const answer = (body.answer || "").toString().trim();
    const style = (body.stile || body.style || "whatif").toString();
    const periodo = (body.periodo || "future").toString();
    const lang = ((body.lang || "it").toString().toLowerCase().slice(0, 2));

    // tipo utente (coerente con quello che usi altrove)
    const hasAdminToken = !!req.headers["x-admin-token"];
    const isPro = req.headers["x-pro"] === "1";
    const user_type = hasAdminToken ? "admin" : (isPro ? "pro" : "free");

    // IP (mascherato poi da /api/admin-logs se vuoi)
    const fwd = (req.headers["x-forwarded-for"] || "").toString();
    const ip = fwd.split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "";

    const ts = Date.now();
    const answer_chars = answer.length || 0;

    const logItem = {
      ts,
      domanda,
      answer,
      style,
      periodo,
      lang,
      ip,
      user_type,
      answer_chars
    };

    // se manca la domanda non ha senso loggare, ma non è errore grave
    if (!domanda && !answer) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    await pushLogToRedis(logItem);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("save handler error:", err);
    return res.status(500).json({ ok: false, error: err.message || "server_error" });
  }
}
