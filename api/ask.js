// /api/ask.js  — supporta streaming SSE e risposta JSON
import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    // body
    const { question, domanda, lang = "it", periodo, stile, stream } = req.body || {};
    const q = (question || domanda || "").toString().trim();
    if (!q) return res.status(400).json({ error: "question required" });

    // tono / tempo
    const tone =
      stile === "wtf"
        ? (lang === "en"
            ? "an ironic, surreal, playful (but respectful) tone"
            : "un tono ironico, surreale e giocoso (ma rispettoso)")
        : (lang === "en"
            ? "a realistic, reflective, concrete tone"
            : "un tono realistico, riflessivo e concreto");

    const time =
      periodo === "past"
        ? (lang === "en" ? "the past (what if)" : "il passato (what if)")
        : (lang === "en" ? "the near future (plausible what if)" : "il prossimo futuro (what if plausibile)");

    const systemPrompt =
      lang === "en"
        ? `You are What?f. Generate a concise scenario in ${time}, with ${tone}. Be clear, safe and helpful. Aim for ~120–180 words.`
        : `Sei What?f. Genera uno scenario conciso nel ${time}, con ${tone}. Sii chiaro, sicuro e utile. Punta a ~120–180 parole.`;

    const userPrompt = lang === "en" ? `User question: ${q}` : `Domanda dell'utente: ${q}`;

    const client = new OpenAI({ apiKey });

    // parametro per decidere lo streaming (anche da header/query)
    const wantsStream =
      stream === true ||
      req.query?.stream === "1" ||
      req.headers["x-whatif-stream"] === "1";

    // Impongo una lunghezza max ragionevole (evita risposte chilometriche)
    const MAX_TOKENS = 350; // circa ~250-300 parole

    if (wantsStream) {
      // --- STREAMING SSE ---
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: stile === "wtf" ? 0.9 : 0.6,
        max_tokens: MAX_TOKENS,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      try {
        for await (const part of completion) {
          const delta = part.choices?.[0]?.delta?.content || "";
          if (delta) {
            res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
          }
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } catch (e) {
        res.write(`data: ${JSON.stringify({ error: "stream_error", detail: String(e?.message || e) })}\n\n`);
        res.end();
      }
      return;
    }

    // --- RISPOSTA JSON (non streaming) ---
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: stile === "wtf" ? 0.9 : 0.6,
      max_tokens: MAX_TOKENS,
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
