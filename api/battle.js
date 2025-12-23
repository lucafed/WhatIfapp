// /api/battle.js — Battle Engine (A vs B) per WhatIfapp (multilingua + voice whatif/wtf + più wow)
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
  limiter: Ratelimit.slidingWindow(20, "1 m"),
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
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro"
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
  return String(s || "")
    .trim()
    .replace(/^["“”']+/, "")
    .replace(/["“”']+$/, "")
    .trim();
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
function safeVoice(v = "") {
  const x = String(v || "").toLowerCase().trim();
  if (["wtf", "whatif"].includes(x)) return x;
  return "whatif";
}
function safeLang(l = "") {
  const x = String(l || "").toLowerCase().trim().slice(0, 2);
  if (["it", "en", "es", "fr", "de"].includes(x)) return x;
  return "it";
}

function extractJson(text = "") {
  const t = String(text || "").trim();
  const direct = safeJsonParse(t);
  if (direct) return direct;

  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  return safeJsonParse(m[0]);
}

/* ========= Localized fallbacks ========= */
const FALLBACKS = {
  it: {
    reason: "Vince perché oggi ha l’aura da protagonista. L’altro? NPC con speranze.",
    tagline: "Litigate pure nei commenti.",
    needLogin: "Per usare i crediti devi essere loggato.",
    noCredits: "Hai finito i crediti. Ricarica per continuare.",
    bad: "Errore Battle. Riprova.",
  },
  en: {
    reason: "It wins today. Main character energy. The other one? Side quest vibes.",
    tagline: "Fight me in the comments.",
    needLogin: "You must be logged in to use credits.",
    noCredits: "You’re out of credits. Recharge to continue.",
    bad: "Battle error. Try again.",
  },
  es: {
    reason: "Gana hoy. Energía de protagonista. Lo otro… misión secundaria.",
    tagline: "Nos vemos en comentarios.",
    needLogin: "Debes iniciar sesión para usar créditos.",
    noCredits: "No te quedan créditos. Recarga para continuar.",
    bad: "Error Battle. Inténtalo de nuevo.",
  },
  fr: {
    reason: "Ça gagne aujourd’hui. Énergie de héros. L’autre ? NPC avec de l’espoir.",
    tagline: "On se règle ça en com’.",
    needLogin: "Tu dois être connecté pour utiliser des crédits.",
    noCredits: "Tu n’as plus de crédits. Recharge pour continuer.",
    bad: "Erreur Battle. Réessaie.",
  },
  de: {
    reason: "Es gewinnt heute. Main-Character-Vibes. Das andere? Nebenquest-Energie.",
    tagline: "Diskutiert in den Kommentaren.",
    needLogin: "Du musst eingeloggt sein, um Credits zu nutzen.",
    noCredits: "Keine Credits mehr. Bitte aufladen.",
    bad: "Battle-Fehler. Versuch’s nochmal.",
  },
};

/* ========= Prompt builder ========= */
function buildPrompt({ a, b, category, voice, style, lang }) {
  const effectiveStyle = style
    ? safeStyle(style)
    : voice === "wtf"
    ? "cattivello"
    : "ironico";

  // “wow” boost: più ritmo, punchline, immagini
  const tone =
    effectiveStyle === "serio"
      ? "decisive, clear, practical, no sarcasm"
      : effectiveStyle === "cattivello"
      ? "extra sarcastic, punchy, a witty bartender vibe; roast the CHOICE, never the person"
      : "ironic, sharp, short, meme-worthy";

  const catHint =
    category === "persone"
      ? "Treat them as archetypes (me/friend/ex). No accusations, no diagnoses, no defamation."
      : category === "scelte"
      ? "Focus on trade-offs: risk, energy, consequences, opportunity cost."
      : "Use everyday + pop culture vibes, quick rationale.";

  // micro-variations: evita risposte tutte uguali
  const spice = [
    "Use one vivid metaphor if possible.",
    "End the reason with a tiny twist.",
    "Give the tagline a punchline vibe.",
    "Make it quotable, like a screenshot people share.",
  ];

  const spicePick = spice[Math.floor(Math.random() * spice.length)];

  return `
You are "The Judge" of a fast A-vs-B game inside What?f.
Language must be: ${lang}. Output ONLY in ${lang}.
Tone: ${tone}.
Category: ${category}. ${catHint}
Extra: ${spicePick}

Safety rules:
- No hate, harassment, slurs, discrimination.
- No heavy profanity.
- If real people names appear: do NOT claim negative facts; keep it playful and generic.
- No violence, self-harm, illegal advice.

Rules:
- Always pick ONE winner. No ties. No "it depends".
- Keep it SHORT. No lists. No lectures.
- Be FUNNY but safe: roast the dilemma, not protected traits.

Output constraints:
- reason: 1–2 sentences, max 22 words.
- tagline: max 8 words, meme-worthy.

A: "${a}"
B: "${b}"

Return ONLY valid JSON with EXACTLY these keys:
{
  "winner_side": "A" | "B",
  "reason": "string",
  "tagline": "string"
}
  `.trim();
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString()
      .split(",")[0]
      .trim();

    const ok = await rateOk(`battle:${ip}`);
    if (!ok) return res.status(429).json({ error: "rate_limited_minute" });

    // body robusto
    let body = req.body || {};
    if (typeof body === "string") body = safeJsonParse(body) || {};
    else if (typeof body === "object" && body && typeof body.body === "string") {
      body = safeJsonParse(body.body) || body;
    }

    const a = stripQuotes(body.a || "");
    const b = stripQuotes(body.b || "");
    const category = safeCategory(body.category || "cose");

    const lang = safeLang(body.lang || req.query?.lang || "it");
    const voice = safeVoice(body.voice || "whatif");
    const style = body.style ? safeStyle(body.style) : null;

    if (!a || !b)
      return res.status(400).json({ error: "bad_request", detail: "a_and_b_required" });

    const prompt = buildPrompt({ a, b, category, voice, style, lang });

    // più creatività quando wtf/cattivello
    const effective = style || (voice === "wtf" ? "cattivello" : "ironico");
    const temperature = effective === "serio" ? 0.55 : (effective === "cattivello" ? 1.0 : 0.92);

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature,
      top_p: 0.95,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content:
            "Return ONLY strict JSON. No markdown. No extra keys. Must match the schema exactly.",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content?.trim() || "";
    const obj = extractJson(raw);

    const FB = FALLBACKS[lang] || FALLBACKS.it;

    if (!obj || !obj.winner_side || !obj.reason) {
      const winner_side = Math.random() < 0.5 ? "A" : "B";
      return res.status(200).json({
        mode: "battle",
        model: MODEL,
        a,
        b,
        category,
        lang,
        voice,
        style: effective,
        winner_side,
        winner: winner_side === "A" ? a : b,
        reason: FB.reason,
        tagline: FB.tagline,
        fallback: true,
      });
    }

    const wSide = String(obj.winner_side).toUpperCase() === "A" ? "A" : "B";
    let reason = normalizeOneParagraph(obj.reason || "");
    let tagline = normalizeOneParagraph(obj.tagline || "");

    reason = clampWords(reason, 22);
    tagline = clampWords(tagline, 8);

    return res.status(200).json({
      mode: "battle",
      model: MODEL,
      a,
      b,
      category,
      lang,
      voice,
      style: effective,
      winner_side: wSide,
      winner: wSide === "A" ? a : b,
      reason,
      tagline,
      fallback: false,
    });
  } catch (err) {
    console.error("❌ [/api/battle] error:", err);
    return res
      .status(500)
      .json({ error: "server_error", detail: String(err?.message || err) });
  }
}
