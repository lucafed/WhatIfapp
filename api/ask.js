import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Connessione Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Rate limit: max 10 richieste/minuto per IP
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "https://what-ifapp.vercel.app");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();

    // Rate limit
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString();
    const { success } = await ratelimit.limit(`ask:${ip}`);
    if (!success)
      return res.status(429).json({ error: "Limite di richieste superato. Attendi un minuto!" });

    // Estrai prompt dal body
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const prompt = body.prompt || "Ciao!";

    // Chiamata a OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    res.status(200).json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore interno del server" });
  }
}
