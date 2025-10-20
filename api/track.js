// api/track.js
export default async function handler(req, res) {
  try {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!redisUrl || !redisToken) {
      throw new Error("❌ Variabili Upstash mancanti");
    }

    const payload = {
      event: "visit",
      timestamp: new Date().toISOString(),
      ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"] || "unknown",
    };

    await fetch(`${redisUrl}/set/whatif:lastVisit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    res.status(200).json({
      message: "✅ Tracking funzionante e collegato a Upstash!",
      timestamp: payload.timestamp,
    });
  } catch (error) {
    console.error("Errore tracking:", error);
    res.status(500).json({
      error: "❌ Errore interno nel server",
      details: error.message,
    });
  }
}
