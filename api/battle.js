// /api/battle.js
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { getAuth } from "firebase-admin/auth";
import admin from "./_firebaseAdmin.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function getUidFromAuth(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const idToken = m[1].trim();
  const decoded = await getAuth(admin).verifyIdToken(idToken);
  return decoded?.uid || null;
}

function safeTrim(x, max = 80) {
  const s = String(x ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function extractJsonObject(text) {
  const s = String(text || "").trim();
  const m = s.match(/\{[\s\S]*\}/);
  return m ? m[0] : "{}";
}

/**
 * ✅ ATOMICO: scala 1 credito solo se > 0
 * Ritorna crediti rimasti.
 * Se non ci sono crediti: ritorna -1
 */
async function reserveOneCredit(uid) {
  const key = `credits:${uid}`;

  // LUA: if credits > 0 then decrement and return new value else return -1 end
  const script = `
    local v = redis.call("GET", KEYS[1])
    if not v then return -1 end
    local n = tonumber(v)
    if not n then return -1 end
    if n <= 0 then return -1 end
    n = n - 1
    redis.call("SET", KEYS[1], n)
    return n
  `;

  // Upstash Redis supporta EVAL
  const out = await redis.eval(script, [key], []);
  const left = Number(out);
  return Number.isFinite(left) ? left : -1;
}

/** Rimborso 1 credito (best effort) */
async function refundOneCredit(uid) {
  const key = `credits:${uid}`;
  try {
    await redis.incrby(key, 1);
  } catch (e) {
    // best effort: non blocchiamo la response
    console.error("❌ refundOneCredit failed:", e);
  }
}

export default async function handler(req, res) {
  cors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  let uid = null;
  let creditsLeftAfterReserve = null;
  let reserved = false;

  try {
    uid = await getUidFromAuth(req);
    if (!uid) {
      return res
        .status(401)
        .json({ error: "unauthorized", redirect: "/index.html" });
    }

    // body
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const a = safeTrim(body.a, 80);
    const b = safeTrim(body.b, 80);
    const category = safeTrim(body.category || "cose", 24);

    if (!a || !b) {
      return res.status(400).json({ error: "bad_request" });
    }

    // ✅ RESERVE credito PRIMA, in modo atomico (mai sotto zero)
    creditsLeftAfterReserve = await reserveOneCredit(uid);
    if (creditsLeftAfterReserve < 0) {
      return res.status(402).json({
        error: "no_credits",
        redirect: "/store/credit-store.html",
      });
    }
    reserved = true;

    const sys = `Sei un giudice di "battle" rapida.
Scegli un vincitore tra A e B.
Rispondi SOLO in JSON valido con chiavi: winner, reason, tagline.
winner deve essere "A" o "B".
reason: 1-2 frasi max, tono ironico ma non offensivo, niente volgarità pesante.
tagline: una riga breve, memorabile.`;

    const user = `Categoria: ${category}\nA: ${a}\nB: ${b}\nDecidi.`;

    // ✅ OpenAI con JSON “forzato”
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.9,
      max_tokens: 180,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content || "{}";

    let out = {};
    try {
      out = JSON.parse(raw);
    } catch {
      try {
        out = JSON.parse(extractJsonObject(raw));
      } catch {
        out = {};
      }
    }

    const winnerKey = out.winner === "B" ? "B" : "A";
    const winner = winnerKey === "A" ? a : b;

    const reason = String(out.reason || "Perché sì.").trim();
    const tagline = String(out.tagline || "Fine della discussione.").trim();

    return res.status(200).json({
      winner,
      reason,
      tagline,
      creditsLeft: creditsLeftAfterReserve,
    });
  } catch (err) {
    console.error("❌ [/api/battle] error:", err);

    // ✅ Se avevamo riservato credito e qualcosa è esploso -> rimborso
    if (uid && reserved) {
      await refundOneCredit(uid);
    }

    return res.status(500).json({ error: "server_error" });
  }
}
