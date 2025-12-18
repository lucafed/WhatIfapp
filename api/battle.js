// /api/battle.js
// Battle API — coerente con /api/ask.js (body parse robusto, CORS allowlist, error JSON)
// Crediti: SOLO Firestore (wallets/{uid}) con schema creditsFree + creditsPaid (come /store/credits.js)

import OpenAI from "openai";
import { getAuth } from "firebase-admin/auth";
import admin from "./_firebaseAdmin.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const db = admin.firestore();

// ===== CORS (uguale filosofia di ask.js) =====
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const allow = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : process.env.NODE_ENV !== "production"
    ? origin
    : "";
  if (allow) res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ===== Helpers =====
function safeJsonParse(maybeJson) {
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

async function getUidFromAuth(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const idToken = m[1].trim();
  const decoded = await getAuth(admin).verifyIdToken(idToken);
  return decoded?.uid || null;
}

// YYYY-MM-DD Europe/Rome (come credits.js)
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

const DEFAULT_DAILY_LIMIT = 3;

// Consuma 1 credito (free prima, poi paid) in TRANSAZIONE
async function consumeOneCreditOrThrow(uid) {
  const ref = db.collection("wallets").doc(uid);
  const today = todayISO();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    let data = snap.exists ? snap.data() || {} : {};

    // --- Normalizzazione minima compatibile con /store/credits.js ---
    let creditsFree = Number.isFinite(+data.creditsFree) ? +data.creditsFree : DEFAULT_DAILY_LIMIT;
    let creditsPaid = Number.isFinite(+data.creditsPaid) ? +data.creditsPaid : 0;
    if (creditsFree < 0) creditsFree = 0;
    if (creditsFree > DEFAULT_DAILY_LIMIT) creditsFree = DEFAULT_DAILY_LIMIT;
    if (creditsPaid < 0) creditsPaid = 0;

    let lastFreeReset = typeof data.lastFreeReset === "string" ? data.lastFreeReset : today;
    let day = typeof data.day === "string" ? data.day : today;
    let usedToday = Number.isFinite(+data.usedToday) ? +data.usedToday : 0;
    let totalUsed = Number.isFinite(+data.totalUsed) ? +data.totalUsed : 0;

    // reset giorno/statistica
    if (day !== today) {
      day = today;
      usedToday = 0;
    }
    // reset free giornaliero
    if (lastFreeReset !== today) {
      creditsFree = DEFAULT_DAILY_LIMIT;
      lastFreeReset = today;
    }

    const balance = creditsFree + creditsPaid;
    if (balance <= 0) {
      const err = new Error("no_credits");
      err.code = "no_credits";
      throw err;
    }

    // consuma
    if (creditsFree > 0) creditsFree -= 1;
    else creditsPaid -= 1;

    usedToday += 1;
    totalUsed += 1;

    const payload = {
      day,
      usedToday,
      totalUsed,
      creditsFree,
      creditsPaid,
      lastFreeReset,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: data.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    };

    tx.set(ref, payload, { merge: true });

    return { creditsLeft: creditsFree + creditsPaid };
  });

  return result.creditsLeft;
}

// ===== Handler =====
export default async function handler(req, res) {
  cors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    const uid = await getUidFromAuth(req);
    if (!uid) {
      return res.status(401).json({ error: "unauthorized", redirect: "/index.html" });
    }

    // ✅ robust body parse (come ask.js)
    let body = req.body || {};
    if (typeof body === "string") {
      body = safeJsonParse(body) || {};
    } else if (typeof body === "object" && body && typeof body.body === "string") {
      body = safeJsonParse(body.body) || body;
    }

    const a = String(body.a || "").trim();
    const b = String(body.b || "").trim();
    const category = String(body.category || "cose").trim();

    if (!a || !b) return res.status(400).json({ error: "bad_request", detail: "a_b_required" });

    // ✅ 1) genera risposta AI
    const sys = `Sei un giudice di "Battle" super rapido.
Scegli un vincitore tra A e B.
Rispondi SOLO JSON valido nel formato:
{"winner":"A"|"B","reason":"...","tagline":"..."}.
Vincoli:
- reason: 1–2 frasi max
- tono ironico ma non offensivo
- niente volgarità pesante, niente hate, niente insulti a identità protette.`;

    const user = `Categoria: ${category}\nA: ${a}\nB: ${b}\nDecidi.`;

    let out = {};
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.9,
        max_tokens: 160,
        // forza JSON (se supportato dal modello)
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      });

      const raw = completion?.choices?.[0]?.message?.content?.trim() || "{}";
      out = safeJsonParse(raw) || {};
    } catch (e) {
      console.error("❌ OpenAI error:", e);
      return res.status(502).json({ error: "ai_error" });
    }

    const winnerKey = out.winner === "B" ? "B" : "A";
    const winner = winnerKey === "A" ? a : b;

    const reason = String(out.reason || "Perché oggi sì.").trim();
    const tagline = String(out.tagline || "Fine della discussione.").trim();

    // ✅ 2) SOLO SE la risposta è pronta → consuma 1 credito
    let creditsLeft;
    try {
      creditsLeft = await consumeOneCreditOrThrow(uid);
    } catch (e) {
      if (e?.code === "no_credits" || e?.message === "no_credits") {
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
    console.error("❌ [/api/battle] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
