export default async function handler(req, res) {
  const hasKey = !!process.env.OPENAI_API_KEY;
  console.log("Verifica API key:", hasKey ? "✅ trovata" : "❌ mancante");
  res.status(200).json({
    keyExists: hasKey,
    keyPrefix: hasKey ? process.env.OPENAI_API_KEY.slice(0, 8) + "..." : null,
  });
}
