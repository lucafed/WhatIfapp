// /api/battle.js
import OpenAI from "openai";
import { getAuth } from "firebase-admin/auth";
import admin from "./_firebaseAdmin.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const db = admin.firestore();

/* ================== HELPERS ================== */

function cors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function getUidFromAuth(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1];
  const decoded = await getAuth(admin).verifyIdToken(token);
  return decoded?.uid || null;
}

function todayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function safeJsonParse(txt) {
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/* ======== CREDITI (Firestore wallets) ========= */

const DEFAULT_DAILY_LIMIT = 3;

async function consumeOneCreditOrThrow(uid) {
  const ref = db.collection("wallets").doc(uid);
  const today = todayISO();

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};

    let creditsFree = Number.isFinite(+data.creditsFree)
      ? +data.creditsFree
      : DEFAULT_DAILY_LIMIT;
    let creditsPaid = Number.isFinite(+data.creditsPaid)
      ? +data.creditsPaid
      : 0;

    let day = typeof data.day === "string" ? data.day : today;
    let lastFreeReset =
      typeof data.lastFreeReset === "string" ? data.lastFreeReset : today;
    let usedToday = Number.isFinite(+data.usedToday) ? +data.usedToday : 0;
    let totalUsed = Number.isFinite(+data.totalUsed) ? +data.totalUsed : 0;

    if (day !== today) {
      day = today;
      usedToday = 0;
    }

    if (lastFreeReset !== today) {
      creditsFree = DEFAULT_DAILY_LIMIT;
      lastFreeReset = today;
    }

    const balance = creditsFree + creditsPaid;
    if (balance <= 0) {
      const e = new Error("no_credits");
      e.code = "no_credits";
      throw e;
    }

    if (creditsFree > 0) creditsFree -= 1;
    else creditsPaid -= 1;

    usedToday += 1;
    totalUsed += 1;

    tx.set(
      ref,
      {
        day,
        usedToday,
        totalUsed,
        creditsFree,
        creditsPaid,
        lastFreeReset,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt:
          data.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return creditsFree + creditsPaid;
  });
}

/* ================== HANDLER ================== */

export default async function handler(req, res) {
  cors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_openai_key" });
    }

    const uid = await getUidFromAuth(req);
    if (!uid) {
      return res
        .status(401)
        .json({ error: "unauthorized", redirect: "/index.html" });
    }

    let body = req.body;
    if (typeof body === "string") body = safeJsonParse(body) || {};
    if (!body || typeof body !== "object") body = {};

    const a = String(body.a || "").trim();
    const b = String(body.b || "").trim();
    const category = String(body.category || "cose").trim();

    if (!a || !b) {
      return res.status(400).json({ error: "bad_request" });
    }

    /* ======= OPENAI (PRIMA) ======= */

    const systemPrompt = `
Sei un giudice di Battle rapido e deciso.
Devi scegliere un vincitore tra A e B.

Rispondi SOLO in JSON valido:
{
  "winner": "A" | "B",
  "reason": "1–2 frasi brevi",
  "tagline": "chiusura secca"
}

Tono ironico ma NON offensivo.
Niente volgarità.
    `.trim();

    const userPrompt = `
Categoria: ${category}
A: ${a}
B: ${b}
Decidi ora.
    `.trim();

    let aiOut = {};
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.9,
        max_tokens: 180,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const raw =
        completion?.choices?.[0]?.message?.content?.trim() || "{}";

      aiOut = safeJsonParse(raw) || {};
    } catch (aiErr) {
      console.error("❌ OpenAI error:", aiErr);
      return res.status(502).json({ error: "ai_error" });
    }

    const winnerKey = aiOut.winner === "B" ? "B" : "A";
    const winner = winnerKey === "A" ? a : b;

    const reason = String(aiOut.reason || "Perché sì.").trim();
    const tagline = String(aiOut.tagline || "Verdetto finale.").trim();

    /* ======= SCALA CREDITO (DOPO) ======= */

    let creditsLeft;
    try {
      creditsLeft = await consumeOneCreditOrThrow(uid);
    } catch (e) {
      if (e.code === "no_credits") {
        return res.status(402).json({
          error: "no_credits",
          redirect: "/store/credit-store.html",
        });
      }
      throw e;
    }

    return res.status(200).json({
      winner,
      reason,
      tagline,
      creditsLeft,
    });
  } catch (err) {
    console.error("❌ [/api/battle] FATAL:", err);
    return res.status(500).json({ error: "server_error" });
  }
}
