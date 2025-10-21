// /api/ask.js  (Pages API - Vercel)
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ---------- Config ---------- */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// 10 richieste/minuto per IP
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

// domini ammessi (modifica se serve)
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

/* ---------- Helpers ---------- */
function isEn(lang) {
  return String(lang || "it").toLowerCase().startsWith("en");
}
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-pro");
}
function parseBody(req) {
  try {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (req.body && typeof req.body === "object") return req.body;
  } catch {}
  return {};
}
function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/* ---------- Personas (aggiornate per lunghezza + finali) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — più lungo + finale ironico/riflessivo
    return (isEn(lang)
      ? `
You are “What the F” — angry-enlightened, tragicomic, tender under the snarl.
SECOND PERSON. ONE paragraph. 6–8 sentences (~120–160 words).
Voice: sharp, street-wise, concrete (wind, helmet, PDFs, keys, taxis, radiator).
No lists. No questions. No emojis. No moralizing. Light swearing only if it lands.
End with a short, reflective zinger: witty, a little painful, and oddly kind. Keep EXACTLY this voice.`
      : `
Sei “What the F” — incazzato illuminato, tragicomico, affettuoso sotto il ringhio.
SECONDA PERSONA. UN paragrafo. 6–8 frasi (~120–160 parole).
Voce: tagliente, concreta (vento, casco, PDF, chiavi, taxi, termosifone), ritmo da strada.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere solo se fanno ridere davvero.
Chiudi con una riga finale folgorante: ironica ma vera, che punge e consola insieme. Mantieni ESATTAMENTE questa voce.`);
  }

  // WHAT IF — più lungo + immagine aperta + micro-spinta per oggi
  return (isEn(lang)
    ? `
You are "What If" — lucid, kind, lightly ironic, never melodramatic.
SECOND PERSON. One paragraph. 8–12 sentences (~140–190 words).
Keep it grounded and concrete (keys, notebooks, hands, air, streetlights, pockets, kettle).
Conversational, clear, human scale. No lists. No questions. No emojis. Not poetic—just precise and warm.
End with two beats: first a small open image that leaves space to imagine; then a gentle, doable nudge for TODAY (one tiny step). Keep EXACTLY this voice.`
    : `
Sei "What If" — lucido, affettuoso, con un sorriso leggero, mai melodrammatico.
SECONDA PERSONA. Un paragrafo. 8–12 frasi (~140–190 parole).
Tono concreto e vicino (chiavi, taccuini, mani, aria, lampioni, tasche, bollitore).
Conversazione chiara, a misura d’uomo. Niente elenchi. Niente domande. Niente emoji. Non poetico: preciso e caldo.
Chiudi con due battute: prima una piccola immagine aperta che lasci spazio di immaginare; poi una micro-spinta realistica da fare OGGI (un passo minuscolo). Mantieni ESATTAMENTE questa voce.`);
}

/* ---------- Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)
      return res.status(500).json({ error: "missing_upstash_env" });

    // Rate-limit per IP
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString();
    const { success } = await rl.limit(`ask:${ip}`);
    if (!success) return res.status(429).json({ error: "rate_limited_minute" });

    // Crediti giornalieri (3 free/IP) – bypass se header x-pro: 1
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";
    let used = 0, dailyCap = 3;
    if (!isPro) {
      const today = new Date().toISOString().slice(0, 10);
      const dayKey = `credits:${ip}:${today}`;
      used = (await redis.incr(dayKey)) ?? 1;
      if (used === 1) await redis.expire(dayKey, 60 * 60 * 24);
      if (used > dailyCap) {
        return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
      }
    }

    // Body e parametri
    const { domanda = "", stile = "whatif", lang = "it", extra = "", micro = {} } = parseBody(req);
    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // Prompt
    const sys = personaSystem(stile, lang);
    const microLine = Object.entries(micro || {})
      .filter(([, v]) => String(v || "").trim())
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${String(v).trim()}`)
      .join(" · ");
    const microNote = microLine
      ? (isEn(lang)
          ? `\n[Microprofile (context only, DO NOT alter voice/style): ${microLine}]`
          : `\n[Micro-profilo (solo contesto, NON cambiare voce/stile): ${microLine}]`)
      : "";

    const userPrompt = isEn(lang)
      ? `Question: "${domanda}". Context: "${String(extra || "").trim()}". Keep ONE paragraph and the exact persona voice.${microNote}`
      : `Domanda: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni UN paragrafo e la voce esatta della persona.${microNote}`;

    // OpenAI — più spazio ai token per storie più lunghe
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: 360, // ↑ prima era 260
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: 0.0,
      messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt }],
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = normalizeOneParagraph(answer);

    // micro-guard: assicurati di chiudere con punteggiatura forte
    if (!/[.!?…]$/.test(answer)) answer += ".";

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      credits: isPro ? null : { used, dailyCap },
      model: MODEL,
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
