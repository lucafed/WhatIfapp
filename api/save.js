// FILE: /api/save.js
// Scopo: salvare ogni domanda+risposta nei log Redis "logs:ask"
// Così l'Admin (admin.html) può leggerli tramite /api/admin-logs

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// helper per IP (stesso stile di /api/admin-logs.js)
function getIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  if (xff) {
    const ip = xff
      .split(",")
      .map((s) => s.trim())
      .find(Boolean);
    if (ip) return ip;
  }
  return (req.socket?.remoteAddress || "unknown").toString();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // body inviato da fifth.html
  let body;
  try {
    body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  } catch {
    body = {};
  }

  const domanda = String(body.domanda || body.question || "").trim();
  const answer = String(body.answer || body.risposta || "").trim();
  const stile = String(body.stile || body.style || "whatif").trim().toLowerCase();
  const periodo = String(body.periodo || body.period || "future").trim().toLowerCase();
  const lang = String(body.lang || body.language || "it").trim().toLowerCase();

  // facoltativo: info "tipo utente"
  const isPro = req.headers["x-pro"] === "1" || body.pro === true;
  const adminTok = String(req.headers["x-admin-token"] || "").trim();
  const userType = adminTok ? "admin" : isPro ? "pro" : "free";

  // Se manca domanda o risposta, non loggo
  if (!domanda || !answer) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const ip = getIp(req);
  const now = Date.now();

  // Oggetto log compatibile con /api/admin-logs.js
  const logItem = {
    ts: now,
    ip,
    style: stile,
    lang,
    periodo,
    user_type: userType,
    domanda,
    answer,
    answer_chars: answer.length,
  };

  try {
    // Salvo in Redis nella lista logs:ask
    // LPUSH = nuovi in testa; LTRIM per tenere max 1000 voci
    await redis.lpush("logs:ask", JSON.stringify(logItem));
    await redis.ltrim("logs:ask", 0, 999);

    // puoi ancora fare altre cose (Firestore, ecc.) se ti servono:
    // ... (lascia vuoto se non ti serve)

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("save log error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
