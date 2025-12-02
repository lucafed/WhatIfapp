// FILE: /api/save.js
// Salva in Redis SOLO metadati anonimi per l’admin panel
// NIENTE testo della domanda, NIENTE risposta, NIENTE IP.

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

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

    // Metadati base
    const style   = (body.stile   || body.style   || "whatif").toString();
    const periodo = (body.periodo || "future").toString();
    const lang    = ((body.lang   || "it").toString().toLowerCase().slice(0, 2));

    // Origine domanda:
    //  - "manual"   = scritta a mano
    //  - "hint"     = spunti rapidi
    //  - "surprise" = sorprendimi
    let source = (body.source || "").toString();
    if (!source) {
      if (body.surprise === true || body.surprise === "true") {
        source = "surprise";
      } else {
        source = "manual";
      }
    }

    const surprise = !!(body.surprise || (body.micro && body.micro.surprise));
    const usedHint = source === "hint" || body.usedHint === true;

    const hasAdminToken = !!req.headers["x-admin-token"];
    const isPro = req.headers["x-pro"] === "1";
    const user_type = hasAdminToken ? "admin" : (isPro ? "pro" : "free");

    const ts = Date.now();

    // Se non abbiamo almeno stile/periodo/lang, non ha senso salvare
    if (!style && !periodo && !lang) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const logItem = {
      ts,
      style,
      periodo,
      lang,
      user_type,
      source,    // "manual" | "hint" | "surprise"
      surprise,  // boolean
      usedHint   // boolean
      // NOTA: nessun testo di domanda/risposta, nessun IP.
    };

    await pushLogToRedis(logItem);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("save handler error:", err);
    return res.status(500).json({ ok: false, error: err.message || "server_error" });
  }
}
