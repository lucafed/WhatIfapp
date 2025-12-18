// /api/battle.js — Battle Engine (A vs B) + Credits via Firestore wallets/{uid}
// ✅ allineato al pattern di /api/ask.js:
// - CORS whitelist
// - rate limit Upstash
// - body parsing robusto
// - auth Firebase Admin (Bearer token)
// - crediti Firestore (stesso schema di /store/credits.js)
// - scala 1 credito SOLO se OpenAI risponde OK
// - no_credits => 402 + redirect

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { getAuth } from "firebase-admin/auth";
import admin from "./_firebaseAdmin.js";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 m"), // battle un po' più permissivo
});

// Wrapper tollerante
let rateOk = async () => true;
try {
  rateOk = async (key) => {
    try {
      const { success } = await rl.limit(key);
      return !!success;
    } catch {
      return true;
    }
  };
} catch {}

/* ========= CORS ========= */
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
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token"
  );
}

/* ========= Helpers ========= */
function safeJsonParse(maybeJson) {
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

const SUP_LANGS = ["it", "en", "es", "fr", "de"];
function normLang(l = "it") {
  const s = String(l || "it").toLowerCase().slice(0, 2);
  return SUP_LANGS.includes(s) ? s : "it";
}

function todayISO_Rome() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`; // YYYY-MM-DD
}

async function getUidFromAuth(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const idToken = m[1].trim();
  const decoded = await getAuth(admin).verifyIdToken(idToken);
  return decoded?.uid || null;
}

function isAdminByHeader(req) {
  // opzionale: se vuoi “admin_token” lato client, puoi anche passarne uno in header
  // es: fetch(..., { headers: { "x-admin-token": localStorage.getItem("admin_token") }})
  const t = String(req.headers["x-admin-token"] || "");
  return !!t;
}

/* ========= Credits (Firestore wallets/{uid}) ========= */
const DEFAULT_DAILY_LIMIT = 3;

function normalizeWallet(data = {}, today) {
  const out = { ...(data || {}) };

  // nuovi campi
  let creditsFree = Number.isFinite(+out.creditsFree) ? +out.creditsFree : DEFAULT_DAILY_LIMIT;
  let creditsPaid = Number.isFinite(+out.creditsPaid) ? +out.creditsPaid : 0;

  if (creditsFree < 0) creditsFree = 0;
  if (creditsPaid < 0) creditsPaid = 0;
  if (creditsFree > DEFAULT_DAILY_LIMIT) creditsFree = DEFAULT_DAILY_LIMIT;

  let day = typeof out.day === "string" ? out.day : today;
  let usedToday = Number.isFinite(+out.usedToday) ? +out.usedToday : 0;
  if (usedToday < 0) usedToday = 0;

  let lastFreeReset = typeof out.lastFreeReset === "string" ? out.lastFreeReset : today;

  // reset giorno
  if (day !== today) {
    day = today;
    usedToday = 0;
  }
  // reset free giornalieri
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

async function consumeOneCreditServer(uid) {
  const db = admin.firestore();
  const ref = db.collection("wallets").doc(uid);
  const today = todayISO_Rome();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      // primo accesso -> crea wallet e consuma 1 free
      const creditsFree = Math.max(0, DEFAULT_DAILY_LIMIT - 1);
      const creditsPaid = 0;
      const newDoc = {
        day: today,
        usedToday: 1,
        totalUsed: 1,
        creditsFree,
        creditsPaid,
        lastFreeReset: today,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      tx.set(ref, newDoc);
      return creditsFree + creditsPaid;
    }

    const data = snap.data() || {};
    const w = normalizeWallet(data, today);

    const balance = (w.creditsFree || 0) + (w.creditsPaid || 0);
    if (balance <= 0) return null;

    let newFree = w.creditsFree || 0;
    let newPaid = w.creditsPaid || 0;

    if (newFree > 0) newFree -= 1;
    else newPaid -= 1;

    const usedToday = (w.usedToday || 0) + 1;
    const totalUsed = (w.totalUsed || 0) + 1;

    tx.set(
      ref,
      {
        ...w,
        day: today,
        usedToday,
        totalUsed,
        creditsFree: newFree,
        creditsPaid: newPaid,
        lastFreeReset: w.lastFreeReset || today,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return Math.max(0, newFree + newPaid);
  });

  return result; // number | null
}

/* ========= Battle prompt ========= */
function buildBattlePrompt({ lang, category, a, b }) {
  const L = normLang(lang);

  const sys =
    L === "it"
      ? `Sei un giudice di "Battle" rapida.
Scegli un vincitore tra A e B.
Rispondi SOLO in JSON valido: {"winner":"A"|"B","reason":"...","tagline":"..."}.
- reason: 1–2 frasi max, tono ironico ma non offensivo.
- tagline: molto breve, tipo “Fine della discussione.” (sempre pulito).
- Niente insulti pesanti, niente hate, niente volgarità pesante.`
      : L === "en"
      ? `You are the judge of a fast "Battle".
Pick a winner between A and B.
Return ONLY valid JSON: {"winner":"A"|"B","reason":"...","tagline":"..."}.
- reason: max 1–2 sentences, ironic but not offensive.
- tagline: very short.
- No hate, no heavy vulgarity.`
      : L === "es"
      ? `Eres el juez de una "Battle" rápida.
Elige un ganador entre A y B.
Devuelve SOLO JSON válido: {"winner":"A"|"B","reason":"...","tagline":"..."}.
- reason: 1–2 frases máximo, irónico pero no ofensivo.
- tagline: muy corto.
- Sin odio, sin vulgaridad fuerte.`
      : L === "fr"
      ? `Tu es le juge d’une "Battle" rapide.
Choisis un gagnant entre A et B.
Réponds UNIQUEMENT en JSON valide: {"winner":"A"|"B","reason":"...","tagline":"..."}.
- reason: 1–2 phrases max, ironique sans être offensant.
- tagline: très court.
- Pas de haine, pas de vulgarité lourde.`
      : `Du bist der Judge einer schnellen "Battle".
Wähle zwischen A und B.
Gib NUR gültiges JSON zurück: {"winner":"A"|"B","reason":"...","tagline":"..."}.
- reason: max 1–2 Sätze, ironisch aber nicht beleidigend.
- tagline: sehr kurz.
- Kein Hass, keine harte Vulgarität.`;

  const user =
    L === "it"
      ? `Categoria: ${category}\nA: ${a}\nB: ${b}\nDecidi.`
      : `Category: ${category}\nA: ${a}\nB: ${b}\nDecide.`;

  return { sys, user };
}

function safeParseBattleJSON(raw) {
  const s = String(raw || "").trim();
  try {
    const obj = JSON.parse(s);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    // fallback: prova a estrarre prima/ultima graffa
    const i = s.indexOf("{");
    const j = s.lastIndexOf("}");
    if (i >= 0 && j > i) {
      const cut = s.slice(i, j + 1);
      try {
        return JSON.parse(cut);
      } catch {}
    }
    return null;
  }
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString()
      .split(",")[0]
      .trim();

    const ok = await rateOk(`battle:${ip}`);
    if (!ok) return res.status(429).json({ error: "rate_limited_minute" });

    // ✅ robust body parse
    let body = req.body || {};
    if (typeof body === "string") body = safeJsonParse(body) || {};
    else if (typeof body === "object" && body && typeof body.body === "string") {
      body = safeJsonParse(body.body) || body;
    }

    const a = String(body.a || "").trim();
    const b = String(body.b || "").trim();
    const category = String(body.category || "cose").trim();
    const lang = normLang(body.lang || "it");

    if (!a || !b) return res.status(400).json({ error: "bad_request" });

    // auth
    const uid = await getUidFromAuth(req);
    if (!uid) {
      return res.status(401).json({ error: "unauthorized", redirect: "/index.html" });
    }

    // admin bypass (opzionale)
    const isAdmin = isAdminByHeader(req);

    // ✅ 1) prima chiamiamo OpenAI
    const { sys, user } = buildBattlePrompt({ lang, category, a, b });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.9,
      top_p: 0.95,
      max_tokens: 160,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content?.trim() || "";
    const parsed = safeParseBattleJSON(raw) || {};

    const winnerKey = parsed.winner === "B" ? "B" : "A";
    const winner = winnerKey === "A" ? a : b;

    const reason = String(parsed.reason || (lang === "it" ? "Perché sì." : "Because yes.")).trim();
    const tagline = String(parsed.tagline || (lang === "it" ? "Fine della discussione." : "End of story.")).trim();

    // ✅ 2) solo se OpenAI è andata OK, scali 1 credito (se non admin)
    let creditsLeft = null;
    if (!isAdmin) {
      const left = await consumeOneCreditServer(uid);
      if (left === null) {
        return res.status(402).json({
          error: "no_credits",
          redirect: "/store/credit-store.html",
        });
      }
      creditsLeft = left;
    }

    return res.status(200).json({
      winner,
      winnerKey,
      reason,
      tagline,
      creditsLeft, // null se admin
      model: MODEL,
      lang,
      category,
    });
  } catch (err) {
    console.error("❌ [/api/battle] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
