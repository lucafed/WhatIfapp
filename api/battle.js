// /api/battle.js
import OpenAI from "openai";
import { getAuth } from "firebase-admin/auth";
import admin from "./_firebaseAdmin.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ===== CORS =====
function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ===== AUTH =====
async function getUid(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return (await getAuth(admin).verifyIdToken(m[1])).uid;
}

// ===== WALLET =====
const DEFAULT_DAILY_LIMIT = 3;

function todayRome() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function walletRef(uid) {
  return admin.firestore().collection("wallets").doc(uid);
}

async function consumeOneCredit(uid) {
  const today = todayRome();
  const ref = walletRef(uid);

  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};

    let free = +d.creditsFree || DEFAULT_DAILY_LIMIT;
    let paid = +d.creditsPaid || 0;
    if (free + paid <= 0) throw new Error("no_credits");

    if (free > 0) free--;
    else paid--;

    tx.set(ref, {
      ...d,
      day: today,
      creditsFree: free,
      creditsPaid: paid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return free + paid;
  });
}

async function refundCredit(uid) {
  const ref = walletRef(uid);
  await ref.set({
    creditsPaid: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ===== JSON SAFE PARSE =====
function extractJSON(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

// ===== HANDLER =====
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  let uid;
  let charged = false;

  try {
    uid = await getUid(req);
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const { a, b, category = "cose" } = req.body || {};
    if (!a || !b) return res.status(400).json({ error: "bad_request" });

    await consumeOneCredit(uid);
    charged = true;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.9,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "Sei un giudice rapido. Rispondi SOLO con JSON: " +
            '{"winner":"A"|"B","reason":"...","tagline":"..."}',
        },
        {
          role: "user",
          content: `Categoria: ${category}\nA: ${a}\nB: ${b}`,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || "";
    const data = extractJSON(raw);

    if (!data || !data.winner) {
      throw new Error("bad_ai_response");
    }

    const winner = data.winner === "B" ? b : a;

    return res.status(200).json({
      ok: true,
      winner,
      reason: data.reason || "",
      tagline: data.tagline || "",
    });

  } catch (err) {
    console.error("❌ BATTLE ERROR:", err);

    if (charged && uid) {
      await refundCredit(uid);
    }

    if (err.message === "no_credits") {
      return res.status(402).json({ error: "no_credits" });
    }

    return res.status(500).json({ error: "server_error" });
  }
}
