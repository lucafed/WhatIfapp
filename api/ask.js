// /api/ask.js
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// rate limit: 10 req/min per IP (skippabile per admin)
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-pro, x-admin-token");
}

function parseBody(req) {
  try {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (req.body && typeof req.body === "object") return req.body;
  } catch {}
  return {};
}
function normalizeOneParagraph(s=""){
  return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim();
}
function isEn(lang){ return String(lang||"it").toLowerCase().startsWith("en"); }

async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  const ip = await redis.get(`admin:token:${token}`);
  return ip && ip === requesterIp;
}

function personaSystem(style, lang) {
  if (style === "wtf") {
    return (isEn(lang)
      ? `You are “What the F” — angry-enlightened, tragicomic, tender under the snarl.
SECOND PERSON. ONE paragraph. 6–8 sentences (~120–160 words).
Voice: sharp, street-wise, concrete (wind, helmet, PDFs, keys, taxis, radiator).
No lists. No questions. No emojis. No moralizing. Light swearing only if it lands.
End with a short, reflective zinger: witty, a little painful, and oddly kind. Keep EXACTLY this voice.`
      : `Sei “What the F” — incazzato illuminato, tragicomico, affettuoso sotto il ringhio.
SECONDA PERSONA. UN paragrafo. 6–8 frasi (~120–160 parole).
Voce: tagliente, concreta (vento, casco, PDF, chiavi, taxi, termosifone), ritmo da strada.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere solo se fanno ridere davvero.
Chiudi con una riga finale folgorante: ironica ma vera, che punge e consola insieme. Mantieni ESATTAMENTE questa voce.`);
  }
  return (isEn(lang)
    ? `You are "What If" — lucid, kind, lightly ironic, never melodramatic.
SECOND PERSON. One paragraph. 8–12 sentences (~140–190 words).
Keep it grounded and concrete (keys, notebooks, hands, air, streetlights, pockets, kettle).
Conversational, clear, human scale. No lists. No questions. No emojis. Not poetic—just precise and warm.
End with two beats: first a small open image that leaves space to imagine; then a gentle, doable nudge for TODAY (one tiny step). Keep EXACTLY this voice.`
    : `Sei "What If" — lucido, affettuoso, con un sorriso leggero, mai melodrammatico.
SECONDA PERSONA. Un paragrafo. 8–12 frasi (~140–190 parole).
Tono concreto e vicino (chiavi, taccuini, mani, aria, lampioni, tasche, bollitore).
Conversazione chiara, a misura d’uomo. Niente elenchi. Niente domande. Niente emoji. Non poetico: preciso e caldo.
Chiudi con due battute: prima una piccola immagine aperta che lasci spazio di immaginare; poi una micro-spinta realistica da fare OGGI (un passo minuscolo). Mantieni ESATTAMENTE questa voce.`);
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    const admin = await isAdmin(req, ip);

    // rate limit al minuto: salta se admin
    if (!admin) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // crediti giornalieri: salta se admin o se header x-pro=1
    const isProHeader = String(req.headers["x-pro"] || "") === "1";
    let used = 0, dailyCap = 3;
    if (!admin && !isProHeader) {
      const today = new Date().toISOString().slice(0,10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 60*60*24);
      if (used > dailyCap) return res.status(402).json({ error:"daily_credits_exhausted", used, dailyCap });
    }

    const { domanda="", stile="whatif", lang="it", extra="", micro={} } = parseBody(req);
    if (!domanda || typeof domanda !== "string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const sys = personaSystem(stile, lang);
    const microLine = Object.entries(micro||{}).filter(([,v])=>String(v||"").trim()).slice(0,6).map(([k,v])=>`${k}: ${String(v).trim()}`).join(" · ");
    const microNote = microLine
      ? (isEn(lang)
          ? `\n[Microprofile (context only, DO NOT alter voice/style): ${microLine}]`
          : `\n[Micro-profilo (solo contesto, NON cambiare voce/stile): ${microLine}]`)
      : "";

    const userPrompt = isEn(lang)
      ? `Question: "${domanda}". Context: "${String(extra||"").trim()}". Keep ONE paragraph and the exact persona voice.${microNote}`
      : `Domanda: "${domanda}". Contesto: "${String(extra||"").trim()}". Mantieni UN paragrafo e la voce esatta della persona.${microNote}`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: 0.0,
      messages: [{ role:"system", content:sys }, { role:"user", content:userPrompt }],
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    return res.status(200).json({
      answer, style:stile, lang,
      credits: (admin || isProHeader) ? null : { used, dailyCap },
      model: MODEL, admin
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
