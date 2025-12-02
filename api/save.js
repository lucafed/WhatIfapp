// FILE: /api/save.js
// Salva in Redis SOLO metadati anonimi per l’admin panel (niente testo utente)

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function pushLogToRedis(item) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.error("Redis env vars mancanti (UPSTASH_REDIS_REST_URL / _TOKEN).");
    throw new Error("redis_env_missing");
  }

  const commands = [
    ["LPUSH", "logs:ask_meta", JSON.stringify(item)],
    ["LTRIM", "logs:ask_meta", "0", "199"] // tieni solo gli ultimi 200
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

    // 🔒 NIENTE testo utente, niente IP, niente email
    // Prendiamo solo i metadati che ti servono

    const styleRaw   = (body.stile   || body.style || "whatif").toString();
    const periodoRaw = (body.periodo || "future").toString();
    const langRaw    = (body.lang    || "it").toString().toLowerCase().slice(0, 2);

    // Normalizzazioni semplici
    const style =
      styleRaw === "wtf"
        ? "wtf"
        : "whatif";

    const periodo =
      periodoRaw === "past"
        ? "past"
        : "future";

    const lang = ["it", "en", "es", "fr", "de"].includes(langRaw)
      ? langRaw
      : "it";

    // Flag se è stata usata la modalità sorpresa
    const surprise =
      Boolean(body.surprise) ||
      Boolean(body?.micro?.surprise);

    // Source: da dove viene la domanda
    // - "manual"   = scritta a mano dall'utente
    // - "surprise" = tasto "Sorprendimi"
    // - "hint"     = spunto rapido
    const sourceRaw =
      (body.source ||
       body?.micro?.source ||
       "manual").toString().toLowerCase();

    let source = "manual";
    if (sourceRaw === "surprise") source = "surprise";
    else if (sourceRaw === "hint") source = "hint";

    const ts = Date.now();

    // Se non abbiamo nemmeno stile/periodo/lang, non ha senso loggare
    if (!style && !periodo && !lang) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const logItem = {
      ts,
      style,
      periodo,
      lang,
      surprise,
      source
      // 🔐 NOTA: nessuna domanda, nessuna risposta, nessun IP
    };

    await pushLogToRedis(logItem);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("save handler error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "server_error" });
  }
}
