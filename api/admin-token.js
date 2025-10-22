// /api/admin-token.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const secret = req.headers["x-admin-secret"];
  if (!process.env.ADMIN_SETUP_SECRET || secret !== process.env.ADMIN_SETUP_SECRET) {
    return res.status(401).json({ error: "bad_secret" });
  }

  const token = "wtf-admin-master";
  const ip = "ANY";
  await redis.set(`admin:token:${token}`, ip, { ex: 60 * 60 * 24 * 90 }); // valido 90 giorni

  return res.status(200).json({ ok: true, token, bound_to: ip });
}
