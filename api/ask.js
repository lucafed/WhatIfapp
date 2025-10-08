// /api/ask.js — supporta:
// 1) clarify=true  -> restituisce 2–3 domande mirate (JSON, no streaming)
// 2) clarify=false -> genera lo scenario (streaming SSE o JSON)
//
// Usa profilo locale + risposte di chiarimento per personalizzare la risposta.
// Tono: "whatif" = realistico, asciutto, concreto; "wtf" = brillante, ironico, da bar ma plausibile.

import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const {
      question, domanda, lang = "it",
      periodo, stile, stream,
      // nuovo:
      clarify = false,        // true => restituisce domande mirate
      clarifications = {},    // risposte utente alle domande mirate
      profilo = {},           // profilo locale dell’utente
      extra = ""              // eventuale istruzione aggiuntiva (es. continua/riavvolgi/bivi)
    } = req.body || {};

    const q = (question || domanda || "").toString().trim();
    if (!q) return res.status(400).json({ error: "question required" });

    const p = profilo || {};
    const snap = [
      p.name ? `nome: ${p.name}` : null,
      p.age ? `età: ${p.age}` : null,
      p.city ? `città: ${p.city}` : null,
      p.gender ? `sesso: ${p.gender}` : null,
      p.phase ? `fase: ${p.phase}` : null,
      p.role ? `professione: ${p.role}` : null,
      p.goal ? `obiettivo: ${p.goal}` : null,
    ].filter(Boolean).join(" · ");

    const micro = p.micro && typeof p.micro === "object"
      ? Object.entries(p.micro).slice(0, 8).map(([k,v]) => `${k}: ${v}`).join(" | ")
      : "";

    const clarStr = clarifications && typeof clarifications === "object"
      ? Object.entries(clarifications).map(([k,v]) => `${k}: ${v}`).join(" | ")
      : "";

    const time =
      periodo === "past"
        ? (lang === "en" ? "the past (what if)" : "il passato (what if)")
        : (lang === "en" ? "the near future (plausible what if)" : "il prossimo futuro (what if plausibile)");

    const tone =
      stile === "wtf"
        ? (lang === "en"
            ? "an ironic, lively, witty bar-story tone (playful yet realistic and respectful)"
            : "tono ironico, brillante, da bar: vivace e divertente, ma plausibile e rispettoso")
        : (lang === "en"
            ? "a realistic, concrete, concise tone (no melodrama, no 1st-person diary)"
            : "tono realistico, concreto e conciso (niente melodramma, niente diario in prima persona)");

    const wtfAddon = stile === "wtf"
      ? (lang === "en"
          ? "Add subtle bar-scene color (a spritz, a busy counter, laughter). Do not encourage dangerous excess."
          : "Aggiungi colore da bar (uno spritz, un bancone affollato, risate). Non incoraggiare eccessi pericolosi.")
      : "";

    const client = new OpenAI({ apiKey });

    // ====== MODALITÀ 1: DOMANDE DI CHIARIMENTO (NO STREAM) ======
    if (clarify === true) {
      const clarifySystem = lang === "en"
        ? `You are What?f. Given the user's question and profile, ask 2–3 SHORT, targeted clarifying questions that make the final scenario more personal and realistic. Output strict JSON: {"questions":[{"id":"q1","label":"...","placeholder":"..."}, ...]}`
        : `Sei What?f. Dalla domanda e dal profilo, formula 2–3 domande di chiarimento, BREVI e mirate, per rendere lo scenario finale più personale e realistico. Rispondi SOLO in JSON: {"questions":[{"id":"q1","label":"...","placeholder":"..."}, ...]}`;

      const clarifyUser = [
        lang === "en" ? `User question: ${q}` : `Domanda utente: ${q}`,
        snap ? (lang === "en" ? `Profile snapshot: ${snap}` : `Profilo: ${snap}`) : "",
        micro ? (lang === "en" ? `Micro-signals: ${micro}` : `Micro-dettagli: ${micro}`) : ""
      ].filter(Boolean).join("\n");

      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          { role: "system", content: clarifySystem },
          { role: "user", content: clarifyUser },
        ],
        response_format: { type: "json_object" }
      });

      const text = resp.choices?.[0]?.message?.content?.trim() || "";
      let json;
      try { json = JSON.parse(text); }
      catch { json = { questions: [] }; }
      return res.status(200).json({ ok: true, clarify: true, questions: json.questions || [] });
    }

    // ====== MODALITÀ 2: GENERAZIONE SCENARIO (STREAM / NON STREAM) ======
    const systemPrompt = lang === "en"
      ? `You are What?f. Generate a concise scenario in ${time}, with ${tone}. Use only provided personal cues (name, city, life phase, routines) or clarifications; never invent facts. Make it feel tailored to this user. 120–180 words.`
      : `Sei What?f. Genera uno scenario conciso nel ${time}, con ${tone}. Usa solo i riferimenti personali forniti (profilo e chiarimenti); non inventare. Deve sembrare su misura per questa persona. 120–180 parole.`;

    const userPrompt = [
      lang === "en" ? `User question: ${q}` : `Domanda: ${q}`,
      snap ? (lang === "en" ? `Profile snapshot: ${snap}` : `Profilo: ${snap}`) : "",
      micro ? (lang === "en" ? `Micro-signals: ${micro}` : `Micro-dettagli: ${micro}`) : "",
      clarStr ? (lang === "en" ? `Clarifications: ${clarStr}` : `Chiarimenti: ${clarStr}`) : "",
      extra ? (lang === "en" ? `Extra instruction: ${extra}` : `Istruzione extra: ${extra}`) : "",
      wtfAddon
    ].filter(Boolean).join("\n");

    const wantsStream =
      stream === true ||
      req.query?.stream === "1" ||
      req.headers["x-whatif-stream"] === "1";

    const MAX_TOKENS = 360;

    if (wantsStream) {
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
      clarify: false,
      model: "gpt-4o-mini",
      lang, periodo, stile,
      answer: text,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
