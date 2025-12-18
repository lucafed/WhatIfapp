// /api/battle.js
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { getAuth } from "firebase-admin/auth";
import admin from "./_firebaseAdmin.js"; // nel tuo repo c’è già

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

async function chargeOneCreditOrThrow(uid) {
  const key = `credits:${uid}`;

  // scala 1 credito
  const left = await redis.decrby(key, 1);

  // se va sotto 0 -> ripristina e segnala "no_credits"
  if (left < 0) {
    await redis.incrby(key, 1);
    const err = new Error("no_credits");
    err.code = "no_credits";
    throw err;
  }

  return left;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const uid = await getUidFromAuth(req);
    if (!uid) {
      return res.status(401).json({ error: "unauthorized", redirect: "/index.html" });
    }

    // ✅ scala credito PRIMA della chiamata OpenAI
    let creditsLeft;
    try {
      creditsLeft = await chargeOneCreditOrThrow(uid);
    } catch (e) {
      if (e?.code === "no_credits" || e?.message === "no_credits") {
        return res.status(402).json({
          error: "no_credits",
          redirect: "/store/credit-store.html",
        });
      }
      throw e;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const a = String(body.a || "").trim();
    const b = String(body.b || "").trim();
    const category = String(body.category || "cose").trim();

    if (!a || !b) return res.status(400).json({ error: "bad_request" });

    const sys = `Sei un giudice di "battle" rapida.
Scegli un vincitore tra A e B.
Formato JSON: {"winner":"A"|"B","reason":"...","tagline":"..."}.
Motivi: 1-2 frasi max, tono ironico ma non offensivo, niente volgarità pesante.`;

    const user = `Categoria: ${category}\nA: ${a}\nB: ${b}\nDecidi.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.9,
      max_tokens: 180,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content?.trim() || "{}";
    let out;
    try { out = JSON.parse(raw); } catch { out = {}; }

    const winnerKey = out.winner === "B" ? "B" : "A";
    const winner = winnerKey === "A" ? a : b;

    return res.status(200).json({
      winner,
      reason: String(out.reason || "Perché sì.").trim(),
      tagline: String(out.tagline || "Fine della discussione.").trim(),
      creditsLeft,
    });
  } catch (err) {
    console.error("❌ [/api/battle] error:", err);
    return res.status(500).json({ error: "server_error" });
  }
}
