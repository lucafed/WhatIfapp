// /api/ask.js
import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const { question, domanda, lang = "it", periodo, stile } = req.body || {};
    const q = (question || domanda || "").toString().trim();

    if (!q) return res.status(400).json({ error: "question required" });

    // prompt di sistema in base allo stile scelto
    const tone =
      stile === "wtf"
        ? "tono ironico, surreale, spiritoso (ma rispettoso)"
        : "tono realistico, riflessivo, concreto";
    const time = periodo === "past" ? "passato (what if)" : "futuro (what if plausibile)";

    const systemPrompt =
      lang === "en"
        ? `You are What?f. Generate a short scenario in ${time}, ${tone}. Be clear, helpful and safe.`
        : `Sei What?f. Genera uno scenario breve nel ${time}, con ${tone}. Sii chiaro, utile e sicuro.`;

    const userPrompt =
      lang === "en"
        ? `User question: ${q}`
        : `Domanda dell'utente: ${q}`;

    const client = new OpenAI({ apiKey });

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: stile === "wtf" ? 0.9 : 0.6,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";

    return res.status(200).json({
      ok: true,
      model: "gpt-4o-mini",
      lang,
      periodo,
      stile,
      answer: text,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
