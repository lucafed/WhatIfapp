// /api/save.js
// Salva DOMANDA + RISPOSTA nei log Redis (lista "logs:ask")

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const MAX_LOGS = 5000;

function getIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  if (xff) {
    const ip = xff.split(",").map((s) => s.trim()).find(Boolean);
    if (ip) return ip;
  }
  return (req.socket?.remoteAddress || "unknown").toString();
}

async function getBody(req) {
  // Next API (Node): req.body è già pronto
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  // fallback per eventuale runtime tipo Request (edge)
  if (typeof req.text === "function") {
    try {
      const txt = await req.text();
      return txt ? JSON.parse(txt) : {};
    } catch {
      return {};
    }
  }

  return {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const body = await getBody(req);

    const domanda = String(body.domanda || "").slice(0, 500);
    const answer = String(body.answer || "").slice(0, 8000);
    const stile = String(body.stile || "whatif");
    const periodo = String(body.periodo || "future");
    const lang = String(body.lang || "it").slice(0, 2);
    const surprise = !!body.surprise;

    if (!domanda && !answer) {
      return res.status(400).json({ ok: false, error: "missing_data" });
    }

    const ip = getIp(req);
    const ts = Date.now();

    const item = {
      ts,
      ip,
      style: stile,
      lang,
      periodo,
      surprise,
      domanda,
      answer,
      answer_chars: answer.length,
      user_type: "free",
    };

    // scrivi in coda e taglia la lista
    await redis.lpush("logs:ask", JSON.stringify(item));
    await redis.ltrim("logs:ask", 0, MAX_LOGS - 1);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("save error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
