// /api/battle.js — Battle Engine (A vs B) per WhatIfapp
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

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
  limiter: Ratelimit.slidingWindow(20, "1 m"), // battle può essere più permissiva
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
} catch {
  /* noop */
}

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
function safeJsonParse(maybeJson) {
  try { return JSON.parse(maybeJson); } catch { return null; }
}
function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\.\.+/g, "…")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}
function clampWords(text, maxWords) {
  const w = String(text || "").trim().split(/\s+/);
  if (w.length <= maxWords) return String(text || "").trim();
  return w.slice(0, maxWords).join(" ") + "…";
}
function stripQuotes(s = "") {
  return String(s || "").trim().replace(/^["“”']+/, "").replace(/["“”']+$/, "").trim();
}
function safeCategory(c = "") {
  const x = String(c || "").toLowerCase().trim();
  if (["persone", "cose", "scelte"].includes(x)) return x;
  return "cose";
}
function safeStyle(s = "") {
  const x = String(s || "").toLowerCase().trim();
  if (["ironico", "serio", "cattivello"].includes(x)) return x;
  return "ironico";
}

function buildPrompt({ a, b, category, style }) {
  // Nota: vogliamo giudizi “discutibili” ma non offensivi/diffamatori
  const tone =
    style === "serio"
      ? "lucido, concreto, senza sarcasmo"
      : style === "cattivello"
      ? "tagliente ma non offensivo, mai crudele"
      : "ironico, secco, memorabile";

  const catHint =
    category === "persone"
      ? "Trattale come archetipi (io/amico/ex), evita accuse, diagnosi, diffamazione."
      : category === "scelte"
      ? "Parla di trade-off pratici, rischio, energia, conseguenze."
      : "Usa cultura pop/quotidiano, motivo breve e stuzzicante.";

  return `
Sei “Il Giudice” di una app Battle. Stile: ${tone}.
Categoria: ${category}. ${catHint}

Devi scegliere SEMPRE un vincitore tra A e B.
Regole di sicurezza:
- Niente volgarità pesante, niente odio, niente insulti verso identità protette.
- Se compaiono nomi di persone reali: niente accuse o affermazioni fattuali negative; resta sul gioco e sul tono.
- Non dire “dipende”, non fare liste, non fare spiegoni.

Output:
- Motivo: 1–2 frasi, massimo 22 parole.
- Tagline: massimo 8 parole, memorabile.

A: "${a}"
B: "${b}"

Rispondi SOLO in JSON valido con esattamente queste chiavi:
{
  "winner": "A" | "B",
  "reason": "string",
  "tagline": "string"
}
  `.trim();
}

function extractJson(text = "") {
  const t = String(text || "").trim();
  // prova JSON diretto
  const direct = safeJsonParse(t);
  if (direct) return direct;

  // prova a prendere il primo blocco {...}
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  return safeJsonParse(m[0]);
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

    // body robusto (come ask)
    let body = req.body || {};
    if (typeof body === "string") body = safeJsonParse(body) || {};
    else if (typeof body === "object" && body && typeof body.body === "string") {
      body = safeJsonParse(body.body) || body;
    }

    const a = stripQuotes(body.a || "");
    const b = stripQuotes(body.b || "");
    const category = safeCategory(body.category || "cose");
    const style = safeStyle(body.style || "ironico");

    if (!a || !b) return res.status(400).json({ error: "bad_request", detail: "a_and_b_required" });

    // prompt
    const prompt = buildPrompt({ a, b, category, style });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: style === "serio" ? 0.5 : 0.9,
      top_p: 0.95,
      max_tokens: 160,
      messages: [
        { role: "system", content: "You output strict JSON only." },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content?.trim() || "";
    const obj = extractJson(raw);

    if (!obj || !obj.winner || !obj.reason) {
      // fallback deterministic “soft”
      const winner = Math.random() < 0.5 ? "A" : "B";
      return res.status(200).json({
        a, b, category, style,
        winner: winner === "A" ? a : b,
        reason: "Vince perché oggi suona più convincente. Domani magari cambia.",
        tagline: "Discussione aperta.",
        model: MODEL,
        mode: "battle",
        fallback: true
      });
    }

    const w = String(obj.winner).toUpperCase() === "A" ? "A" : "B";
    let reason = normalizeOneParagraph(obj.reason || "");
    let tagline = normalizeOneParagraph(obj.tagline || "");

    reason = clampWords(reason, 22);
    tagline = clampWords(tagline, 8);

    // normalizza output
    return res.status(200).json({
      mode: "battle",
      model: MODEL,
      a,
      b,
      category,
      style,
      winner: w === "A" ? a : b,
      reason,
      tagline,
      fallback: false,
    });
  } catch (err) {
    console.error("❌ [/api/battle] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
