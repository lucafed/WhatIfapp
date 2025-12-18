// /api/battle.js
import OpenAI from "openai";
import { getAuth } from "firebase-admin/auth";
import admin from "./_firebaseAdmin.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// === CORS (come tua versione) ===
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// === Auth ===
async function getUidFromAuth(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const idToken = m[1].trim();
  const decoded = await getAuth(admin).verifyIdToken(idToken);
  return decoded?.uid || null;
}

// === Helpers wallet: stessa logica di /store/credits.js ===
const DEFAULT_DAILY_LIMIT = 3;

function todayISO_Rome() {
  // YYYY-MM-DD (Europe/Rome) - equivalente al tuo credits.js
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function normalizeWalletData(data = {}, today) {
  const out = { ...(data || {}) };

  // Vecchi campi (compat)
  const oldDailyLimit = Number.isFinite(+out.dailyLimit) ? +out.dailyLimit : DEFAULT_DAILY_LIMIT;
  const oldUsedToday = Number.isFinite(+out.usedToday) ? +out.usedToday : 0;

  const hasNew =
    typeof out.creditsFree !== "undefined" ||
    typeof out.creditsPaid !== "undefined" ||
    typeof out.lastFreeReset !== "undefined";

  // Migrazione vecchio schema -> nuovo
  if (!hasNew) {
    const oldBalance = Math.max(0, oldDailyLimit - oldUsedToday);
    const creditsFree = Math.max(0, Math.min(DEFAULT_DAILY_LIMIT, oldBalance));
    const creditsPaid = Math.max(0, oldBalance - creditsFree);

    out.creditsFree = creditsFree;
    out.creditsPaid = creditsPaid;
    out.lastFreeReset = today;

    out.day = typeof out.day === "string" ? out.day : today;
    out.usedToday = oldUsedToday;
  }

  let creditsFree = Number.isFinite(+out.creditsFree) ? +out.creditsFree : DEFAULT_DAILY_LIMIT;
  let creditsPaid = Number.isFinite(+out.creditsPaid) ? +out.creditsPaid : 0;
  if (creditsPaid < 0) creditsPaid = 0;
  if (creditsFree < 0) creditsFree = 0;
  if (creditsFree > DEFAULT_DAILY_LIMIT) creditsFree = DEFAULT_DAILY_LIMIT;

  let day = typeof out.day === "string" ? out.day : today;
  let usedToday = Number.isFinite(+out.usedToday) ? +out.usedToday : 0;
  if (usedToday < 0) usedToday = 0;

  let lastFreeReset = typeof out.lastFreeReset === "string" ? out.lastFreeReset : today;

  // Cambio giorno: reset statistica
  if (day !== today) {
    day = today;
    usedToday = 0;
  }
  // Reset free giornalieri
  if (lastFreeReset !== today) {
    creditsFree = DEFAULT_DAILY_LIMIT;
    lastFreeReset = today;
  }

  let totalUsed = Number.isFinite(+out.totalUsed) ? +out.totalUsed : 0;
  if (totalUsed < 0) totalUsed = 0;

  out.day = day;
  out.usedToday = usedToday;
  out.totalUsed = totalUsed;
  out.creditsFree = creditsFree;
  out.creditsPaid = creditsPaid;
  out.lastFreeReset = lastFreeReset;

  return out;
}

function walletRef(uid) {
  return admin.firestore().collection("wallets").doc(uid);
}

// ✅ scala 1 credito (FREE -> PAID) atomico, come consumeCredit()
async function chargeOneCreditOrThrow(uid) {
  const ref = walletRef(uid);
  const today = todayISO_Rome();

  const result = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    // Se non esiste, lo creiamo e consumiamo 1 FREE subito (come credits.js)
    if (!snap.exists) {
      const creditsFree = Math.max(0, DEFAULT_DAILY_LIMIT - 1);
      tx.set(ref, {
        day: today,
        usedToday: 1,
        totalUsed: 1,
        creditsFree,
        creditsPaid: 0,
        lastFreeReset: today,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { creditsLeft: creditsFree, ok: true };
    }

    const data = snap.data() || {};
    const normalized = normalizeWalletData(data, today);

    const free = Number.isFinite(+normalized.creditsFree) ? +normalized.creditsFree : 0;
    const paid = Number.isFinite(+normalized.creditsPaid) ? +normalized.creditsPaid : 0;
    const balance = free + paid;

    if (balance <= 0) {
      const err = new Error("no_credits");
      err.code = "no_credits";
      throw err;
    }

    let newFree = free;
    let newPaid = paid;

    if (newFree > 0) newFree -= 1;
    else newPaid -= 1;

    const usedToday = (Number.isFinite(+normalized.usedToday) ? +normalized.usedToday : 0) + 1;
    const totalUsed = (Number.isFinite(+normalized.totalUsed) ? +normalized.totalUsed : 0) + 1;

    const creditsLeft = Math.max(0, newFree + newPaid);

    tx.set(
      ref,
      {
        ...normalized,
        day: today,
        usedToday,
        totalUsed,
        creditsFree: newFree,
        creditsPaid: newPaid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { creditsLeft, ok: true };
  });

  return result.creditsLeft;
}

// ✅ refund 1 credito (rimettiamo 1 su PAID, “persistente”, così non sballa il free reset)
async function refundOneCredit(uid) {
  const ref = walletRef(uid);
  const today = todayISO_Rome();

  try {
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() || {}) : {};
      const normalized = normalizeWalletData(data, today);

      const paid = Number.isFinite(+normalized.creditsPaid) ? +normalized.creditsPaid : 0;
      const newPaid = paid + 1;

      tx.set(
        ref,
        {
          ...normalized,
          creditsPaid: newPaid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: normalized.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  } catch (e) {
    console.error("❌ refundOneCredit failed:", e);
  }
}

// === Safe trim inputs ===
function safeTrim(x, max = 120) {
  const s = String(x ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  let uid = null;
  let charged = false;
  let creditsLeft = null;

  try {
    uid = await getUidFromAuth(req);
    if (!uid) {
      return res.status(401).json({ error: "unauthorized", redirect: "/index.html" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const a = safeTrim(body.a, 80);
    const b = safeTrim(body.b, 80);
    const category = safeTrim(body.category || "cose", 24);

    if (!a || !b) return res.status(400).json({ error: "bad_request" });

    // ✅ Scala credito PRIMA di OpenAI (come vuoi tu)
    try {
      creditsLeft = await chargeOneCreditOrThrow(uid);
      charged = true;
    } catch (e) {
      if (e?.code === "no_credits" || e?.message === "no_credits") {
        return res.status(402).json({
          error: "no_credits",
          redirect: "/store/credit-store.html",
        });
      }
      throw e;
    }

    const sys = `Sei un giudice di "battle" rapida.
Scegli un vincitore tra A e B.
Rispondi SOLO in JSON valido con: winner ("A"|"B"), reason, tagline.
reason: 1-2 frasi max, ironico ma non offensivo, niente volgarità pesante.`;

    const user = `Categoria: ${category}\nA: ${a}\nB: ${b}\nDecidi.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.9,
      max_tokens: 180,
      // IMPORTANT: forza JSON stabile
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content?.trim() || "{}";
    let out = {};
    try { out = JSON.parse(raw); } catch { out = {}; }

    const winnerKey = out.winner === "B" ? "B" : "A";
    const winner = winnerKey === "A" ? a : b;

    return res.status(200).json({
      ok: true,
      winner,
      reason: String(out.reason || "Perché sì.").trim(),
      tagline: String(out.tagline || "Fine della discussione.").trim(),
      creditsLeft,
    });
  } catch (err) {
    console.error("❌ [/api/battle] error:", err);

    // ✅ se ho scalato e poi è esploso qualcosa → refund
    if (uid && charged) await refundOneCredit(uid);

    return res.status(500).json({ error: "server_error" });
  }
}
