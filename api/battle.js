import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const { a, b, category } = body || {};

    if (!a || !b) {
      return res.status(400).json({ error: "bad_request" });
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.8,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            "Decidi chi vince tra A e B. Rispondi in JSON: { winner, reason }",
        },
        {
          role: "user",
          content: `Categoria: ${category}\nA: ${a}\nB: ${b}`,
        },
      ],
    });

    const raw = completion.choices[0].message.content;
    const parsed = JSON.parse(raw);

    return res.status(200).json({
      winner: parsed.winner === "B" ? b : a,
      reason: parsed.reason,
      creditsLeft: 999, // fake
    });
  } catch (err) {
    console.error("BATTLE DEBUG ERROR:", err);
    return res.status(500).json({ error: "server_error_debug" });
  }
}
