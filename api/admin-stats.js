// /api/admin-stats.js
// Aggregati veloci e trend giornaliero (N giorni)

import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
}
async function isAdmin(req) {
  const tok = String(req.headers["x-admin-token"] || "").trim();
  if (!tok) return false;
  const saved = await redis.get(`admin:token:${tok}`);
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
  return !!saved && saved === ip;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    if (!(await isAdmin(req))) return res.status(401).json({ ok: false, error: "unauthorized" });

    // contatori cumulativi
    const total = parseInt((await redis.get("stats:total")) || "0", 10) || 0
