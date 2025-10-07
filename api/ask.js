// /api/ask.js — supporta streaming SSE e risposta JSON
import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    // === BODY ===
    const {
      question,
      domanda,
      lang = "it",
      periodo,       // "past" | "future" (da index.html)
      stile,         // "whatif" | "wtf"
      stream,
      profile,       // { gender, age, phase, where, who, more } (second.html)
      archetypes,    // { Ricercatore: 78, ... } (third.html normalizzati 0–100)
      structured,    // opzionale: se true ritorna JSON con 3 bivi
    } = req.body || {};

    const q = (question || domanda || "").toString().trim();
    if (!q) return res.status(400).json({ error: "question required" });

    // === TONO / TEMPO ===
    const time =
      periodo === "past"
        ? (lang === "en" ? "the past (what if)" : "il passato (what if)")
        : (lang === "en" ? "the near future (plausible what if)" : "il prossimo futuro (what if plausibile)");

    // profilo/archetipi (sanificazione minima)
    const safeProfile = typeof profile === "object" && profile ? profile : {};
    const safeArche  = typeof archetypes === "object" && archetypes ? archetypes : {};

    const profileLine =
      lang === "en"
        ? `User profile (free text fields may be empty): ${JSON.stringify({
            gender: safeProfile.gender || null,
            age: safeProfile.age || null,
            phase: safeProfile.phase || null,
            where: safeProfile.where || null,
            who: safeProfile.who || null,
          })}.`
        : `Profilo utente (alcuni campi potrebbero essere vuoti): ${JSON.stringify({
            gender: safeProfile.gender || null,
            age: safeProfile.age || null,
            phase: safeProfile.phase || null,
            where: safeProfile.where || null,
            who: safeProfile.who || null,
          })}.`;

    const archeLine =
      lang === "en"
        ? `Psychological archetypes (0–100): ${JSON.stringify(safeArche)}.`
        : `Archetipi psicologici (0–100): ${JSON.stringify(safeArche)}.`;

    // === PROMPT ===
    let systemPrompt;
    if (stile === "wtf") {
      systemPrompt =
        lang === "en"
          ? `You are What?f in WTF mode. Write like a witty friend at a bar: light, playful, with 2–3 punchlines. Keep it kind and non-offensive (no slurs/hate). Avoid humiliation. Use vivid, funny comparisons and an upbeat rhythm. 120–180 words. Make it clearly about ${time} and still coherent with the user's profile and archetypes.`
          : `Sei What?f in modalità WTF. Scrivi come un amico al bar: leggero, brillante, con 2–3 battute. Gentile e non offensivo (no insulti/odio). Evita umiliazioni. Usa paragoni divertenti e ritmo vivace. 120–180 parole. Indica chiaramente che parli del ${time} e resta coerente con profilo e archetipi dell’utente.`;
    } else {
      systemPrompt =
        lang === "en"
          ? `You are What?f. Generate a concise scenario in ${time}, with a realistic, reflective, concrete tone. Be clear, safe and helpful. Aim for ~120–180 words. The scenario must be psychologically coherent with the user's profile and archetypes. Prefer plausible, concrete dynamics over vague fluff.`
          : `Sei What?f. Genera uno scenario conciso nel ${time}, con un tono realistico, riflessivo e concreto. Sii chiaro, sicuro e utile. ~120–180 parole. Lo scenario deve essere psicologicamente coerente con profilo e archetipi. Prediligi dinamiche plausibili e concrete.`;
    }

    if (structured === true) {
      systemPrompt +=
        lang === "en"
          ? ` Return valid JSON with: {"summary":"...","nodes":[{"label":"...","forces":["..."],"outcomeA":"...","outcomeB":"...","mood":-2..2}, ... (3 items)] }.`
          : ` Restituisci JSON valido con: {"summary":"...","nodes":[{"label":"...","forces":["..."],"outcomeA":"...","outcomeB":"...","mood":-2..2}, ... (3 elementi)] }.`;
    }

    const userPrompt =
      lang === "en"
        ? `User question: ${q}\n${profileLine}\n${archeLine}`
        : `Domanda dell'utente: ${q}\n${profileLine}\n${archeLine}`;

    const client = new OpenAI({ apiKey });
    const wantsStream =
      stream === true ||
      req.query?.stream === "1" ||
      req.headers["x-whatif-stream"] === "1";

    const temperature = stile === "wtf" ? 0.9 : 0.6;
    const MAX_TOKENS = 350;

    if (wantsStream) {
      // --- STREAMING SSE ---
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature,
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
          if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } catch (e) {
        res.write(`data: ${JSON.stringify({ error: "stream_error", detail: String(e?.message || e) })}\n\n`);
        res.end();
      }
      return;
    }

    // --- NON STREAM ---
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature,
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
      profile: safeProfile,
      archetypes: safeArche,
      structured: !!structured,
      answer: text,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
