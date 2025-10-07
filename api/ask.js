// /api/ask.js
import OpenAI from "openai";

/**
 * Supporta:
 * - POST JSON { question|domanda, lang, periodo, stile, maxChars?, stream? }
 * - stream: true  -> prova streaming reale (SSE); se non supportato dal runtime, ricade su risposta classica
 * - maxChars: limite caratteri lato server (default 900)
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  try {
    const {
      question,
      domanda,
      lang = "it",
      periodo,
      stile,
      maxChars = 900,
      stream = false,
    } = req.body || {};

    const q = (question || domanda || "").toString().trim();
    if (!q) return res.status(400).json({ error: "question required" });

    // tono & contesto
    const tone =
      stile === "wtf"
        ? (lang === "en"
            ? "ironic, surreal, playful (but respectful) tone"
            : "tono ironico, surreale e giocoso (ma rispettoso)")
        : (lang === "en"
            ? "realistic, reflective and concrete tone"
            : "tono realistico, riflessivo e concreto");

    const time =
      periodo === "past"
        ? (lang === "en" ? "the past (what if)" : "il passato (what if)")
        : (lang === "en" ? "the future (plausible what if)" : "il futuro (what if plausibile)");

    const sys =
      lang === "en"
        ? `You are What?f. Generate a concise scenario in ${time}, with a ${tone}. Be helpful, safe and specific to the user. Keep it under ~${Math.floor(
            maxChars * 0.9
          )} characters.`
        : `Sei What?f. Genera uno scenario conciso nel ${time}, con ${tone}. Sii utile, sicuro e specifico. Tieni tutto entro ~${Math.floor(
            maxChars * 0.9
          )} caratteri.`;

    const user =
      lang === "en" ? `User question: ${q}` : `Domanda dell'utente: ${q}`;

    const client = new OpenAI({ apiKey });

    // Parametri generali
    const baseParams = {
      model: "gpt-4o-mini",
      temperature: stile === "wtf" ? 0.9 : 0.6,
      max_tokens: 260, // soft cap lato modello
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    };

    // STREAM REALE (SSE) – se richiesto
    if (stream) {
      try {
        const streamResp = await client.chat.completions.create({
          ...baseParams,
          stream: true,
        });

        // headers SSE
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        let sent = 0;
        for await (const part of streamResp) {
          const chunk = part?.choices?.[0]?.delta?.content || "";
          if (!chunk) continue;
          // taglio duro lato server
          const remaining = maxChars - sent;
          const toSend = chunk.slice(0, Math.max(0, remaining));
          if (toSend) {
            res.write(toSend);
            sent += toSend.length;
          }
          if (sent >= maxChars) break;
        }
        if (sent >= maxChars) res.write("…");
        return res.end();
      } catch (e) {
        // se il runtime non supporta streaming, cade sotto a risposta non streaming
        console.warn("Streaming fallback:", e?.message || e);
      }
    }

    // RISPOSTA CLASSICA (fallback)
    const full = await client.chat.completions.create(baseParams);
    let text = full.choices?.[0]?.message?.content?.trim() || "";
    if (text.length > maxChars) text = text.slice(0, maxChars) + "…";

    return res.status(200).json({
      ok: true,
      model: baseParams.model,
      lang,
      periodo,
      stile,
      answer: text,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: "server_error", detail: String(err?.message || err) });
  }
}
