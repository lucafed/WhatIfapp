// /api/battle.js
import OpenAI from "openai";
import { getAuth } from "firebase-admin/auth";
import admin from "./_firebaseAdmin.js";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= CORS (come ask.js) ========= */
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token");
}

/* ========= Helpers ========= */
function safeJsonParse(maybeJson) {
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

function isAdminMode(req) {
  // stessa logica: se arriva x-admin-token puoi decidere di bypassare crediti
  // (se non ti serve, lascia sempre false)
  const t = String(req.headers["x-admin-token"] || "").trim();
  return !!t && t === String(process.env.ADMIN_TOKEN || "").trim();
}

async function getUidFromAuth(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const idToken = m[1].trim();
  try {
    const decoded = await getAuth(admin).verifyIdToken(idToken);
    return decoded?.uid || null;
  } catch {
    return null; // IMPORTANT: niente 500 se token non valido
  }
}

/* ========= Firestore credits (stesso schema di /store/credits.js) ========= */
const DEFAULT_DAILY_LIMIT = 3;
const db = admin.firestore();

function todayISO_Rome() {
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

  // migrazione dal vecchio schema (dailyLimit/usedToday) se serve
  const oldDailyLimit = Number.isFinite(+out.dailyLimit) ? +out.dailyLimit : DEFAULT_DAILY_LIMIT;
  const oldUsedToday = Number.isFinite(+out.usedToday) ? +out.usedToday : 0;

  const hasNew =
    typeof out.creditsFree !== "undefined" ||
    typeof out.creditsPaid !== "undefined" ||
    typeof out.lastFreeReset !== "undefined";

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

  if (day !== today) {
    day = today;
    usedToday = 0;
  }
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
  return db.collection("wallets").doc(uid);
}

/**
 * Decrementa 1 credito in transazione.
 * Torna: { ok, creditsLeft, snapshotAfter }
 */
async function consumeOneCredit(uid) {
  const ref = walletRef(uid);
  const today = todayISO_Rome();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    let data = snap.exists ? snap.data() : null;
    if (!data) {
      // wallet nuovo
      data = {
        day: today,
        usedToday: 0,
        totalUsed: 0,
        creditsFree: DEFAULT_DAILY_LIMIT,
        creditsPaid: 0,
        lastFreeReset: today,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
    }

    const normalized = normalizeWalletData(data, today);
    const free = +normalized.creditsFree || 0;
    const paid = +normalized.creditsPaid || 0;
    const balance = free + paid;

    if (balance <= 0) {
      // aggiorna normalizzazione comunque (es. cambio giorno)
      tx.set(
        ref,
        { ...normalized, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      return { ok: false, creditsLeft: 0 };
    }

    let newFree = free;
    let newPaid = paid;
    if (newFree > 0) newFree -= 1;
    else newPaid -= 1;

    const usedToday = (+normalized.usedToday || 0) + 1;
    const totalUsed = (+normalized.totalUsed || 0) + 1;

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

    return { ok: true, creditsLeft };
  });

  return result;
}

/** Rimborso 1 credito (se OpenAI fallisce) */
async function refundOneCredit(uid) {
  const ref = walletRef(uid);
  const today = todayISO_Rome();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const normalized = normalizeWalletData(data, today);

    // Rimborso su PAID (più “safe”), ma se preferisci free basta cambiare qui
    const paid = Number.isFinite(+normalized.creditsPaid) ? +normalized.creditsPaid : 0;
    const newPaid = paid + 1;

    tx.set(
      ref,
      {
        ...normalized,
        day: today,
        creditsPaid: newPaid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

/* ========= OpenAI battle ========= */
async function runBattleLLM({ a, b, category }) {
  const sys = `Sei un giudice di "battle" rapida.
Scegli un vincitore tra A e B.
Rispondi SOLO JSON valido: {"winner":"A"|"B","reason":"...","tagline":"..."}.
Motivi: 1-2 frasi max, tono ironico ma non offensivo, niente volgarità pesante.`;

  const user = `Categoria: ${category}\nA: ${a}\nB: ${b}\nDecidi.`;

  // Proviamo anche a “forzare” JSON in modo robusto
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.9,
    max_tokens: 180,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    // se il tuo runtime/SDK lo supporta, aiuta tantissimo:
    // response_format: { type: "json_object" },
  });

  const raw = completion?.choices?.[0]?.message?.content?.trim() || "{}";
  let out = safeJsonParse(raw);
  if (!out || typeof out !== "object") out = {};

  const winnerKey = out.winner === "B" ? "B" : "A";
  return {
    winnerKey,
    reason: String(out.reason || "Perché sì.").trim(),
    tagline: String(out.tagline || "Fine della discussione.").trim(),
  };
}

/* ========= Handler ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    // body robusto (come ask.js)
    let body = req.body || {};
    if (typeof body === "string") body = safeJsonParse(body) || {};
    else if (typeof body === "object" && body && typeof body.body === "string") {
      body = safeJsonParse(body.body) || body;
    }

    const a = String(body.a || "").trim();
    const b = String(body.b || "").trim();
    const category = String(body.category || "cose").trim();

    if (!a || !b) return res.status(400).json({ error: "bad_request" });

    const adminMode = isAdminMode(req);

    // auth (se non admin)
    let uid = null;
    if (!adminMode) {
      uid = await getUidFromAuth(req);
      if (!uid) {
        return res.status(401).json({ error: "unauthorized", redirect: "/index.html" });
      }
    }

    // 1) scala credito (solo se non admin)
    let creditsLeft = null;
    if (!adminMode) {
      const charged = await consumeOneCredit(uid);
      if (!charged.ok) {
        return res.status(402).json({
          error: "no_credits",
          redirect: "/store/credit-store.html",
        });
      }
      creditsLeft = charged.creditsLeft;
    }

    // 2) OpenAI
    try {
      const judged = await runBattleLLM({ a, b, category });

      const winner = judged.winnerKey === "A" ? a : b;

      return res.status(200).json({
        winner,
        winnerKey: judged.winnerKey,
        reason: judged.reason,
        tagline: judged.tagline,
        creditsLeft: adminMode ? Infinity : creditsLeft,
      });
    } catch (e) {
      // 3) rimborso se OpenAI fallisce
      if (!adminMode && uid) {
        try {
          await refundOneCredit(uid);
        } catch {
          // se fallisce il refund, almeno non blocchiamo la risposta
        }
      }
      const detail = String(e?.message || e);
      return res.status(500).json({
        error: "server_error",
        detail: process.env.NODE_ENV !== "production" ? detail : undefined,
      });
    }
  } catch (err) {
    console.error("❌ [/api/battle] fatal:", err);
    return res.status(500).json({
      error: "server_error",
      detail: process.env.NODE_ENV !== "production" ? String(err?.message || err) : undefined,
    });
  }
}
