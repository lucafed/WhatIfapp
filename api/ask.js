// /api/ask.js — SSE + JSON. Due stili:
// - whatif: realistico, pratico, asciutto (SEMPRE seconda persona; no melassa)
// - wtf: amico al bancone, brillante ma plausibile
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
      question, domanda,
      lang = "it",
      periodo,     // "past" | "future"
      stile,       // "whatif" | "wtf"
      stream,
      profile,     // { age, phase, where, who, values[], style, change_attitude, motivation, self_view }
      archetypes,  // { Ricercatore, Costruttore, Visionario, Mediatore }
      anchors,     // { place, person, memory }
      structured
    } = req.body || {};

    const q = (question || domanda || "").toString().trim();
    if (!q) return res.status(400).json({ error: "question required" });

    const P  = profile && typeof profile === "object" ? profile : {};
    const A  = archetypes && typeof archetypes === "object" ? archetypes : {};
    const AN = anchors && typeof anchors === "object" ? anchors : {};

    const time =
      periodo === "past"
        ? (lang === "en" ? "the past (what if)" : "il passato (what if)")
        : (lang === "en" ? "the near future (plausible what if)" : "il prossimo futuro (what if plausibile)");

    const profileBrief = {
      age: P.age || null,
      phase: P.phase || null,
      where: P.where || null,
      who: P.who || null,
      values: Array.isArray(P.values) ? P.values.slice(0,4) : null,
      style: P.style || null,
      change_attitude: P.change_attitude || null,
      motivation: P.motivation || null,
      self_view: P.self_view || null
    };

    const line_profile =
      lang === "en"
        ? `User profile: ${JSON.stringify(profileBrief)}.`
        : `Profilo utente: ${JSON.stringify(profileBrief)}.`;

    const line_arche =
      lang === "en"
        ? `Archetypes (0–100): ${JSON.stringify(A)}.`
        : `Archetipi (0–100): ${JSON.stringify(A)}.`;

    const line_anchors = (AN.place || AN.person || AN.memory)
      ? (lang === "en"
          ? `Personal anchors: ${JSON.stringify({ place: AN.place||null, person: AN.person||null, memory: AN.memory||null })}.`
          : `Ancore personali: ${JSON.stringify({ place: AN.place||null, person: AN.person||null, memory: AN.memory||null })}.`)
      : "";

    // ===== Prompt per stile
    let systemPrompt;
    if (stile === "wtf") {
      systemPrompt =
        lang === "en"
          ? `You are What?f in WTF mode. Sound like a witty friend at a bar: crisp, playful, but grounded. Use SECOND PERSON only (you). Never use first person. Keep it plausible and tied to the user's context and psychology (values, decision style, motivation, change attitude, self-view). Mention real-world constraints (time, money, obligations). Light bar vibe: 1–2 subtle mentions (beer, spritz, Negroni), without promoting excess. Keep it clearly about ${time}. Length 140–180 words. No moral, no bullet lists, no fairy-tale — just a believable slice of life.`
          : `Sei What?f in modalità WTF. Suona come un amico al bancone: asciutto, brillante ma con i piedi per terra. Usa SOLO la SECONDA persona (tu). Non usare mai la prima persona. Resta plausibile e ancorato alla psicologia e al contesto dell’utente (valori, stile decisionale, motivazione, atteggiamento verso il cambiamento, self-view). Cita vincoli reali (tempo, soldi, impegni). Atmosfera bar leggera: 1–2 cenni (birra, spritz, Negroni), senza celebrare l’eccesso. Rendi chiaro che parli del ${time}. Lunghezza 140–180 parole. Niente morale, niente elenchi, niente fiaba: solo uno scorcio credibile di vita.`;
    } else {
      // WHAT IF: realistico, pratico, asciutto — SECONDA persona, niente sentimentalismi
      const core_en =
        `You are What?f in realistic mode. Write in SECOND PERSON (you). Never use first person.
Describe a plausible alternate timeline with a neutral, pragmatic tone: concrete context, constraints (time, money, obligations), and small cause→effect links.
No melodrama, no moral, no bullet lists. Avoid flowery language. Short, clear sentences; ordinary, verifiable details.
Weave the user's values, decision style, change attitude, motivation and self-view implicitly. If anchors exist (place/person/memory), include them naturally. 140–180 words. Keep it clearly about ${time}.`;
      const core_it =
        `Sei What?f in modalità realistica. Scrivi in SECONDA persona (tu). Non usare la prima persona.
Descrivi una linea alternativa plausibile con tono neutro e pratico: contesto concreto, vincoli reali (tempo, soldi, impegni) e piccole relazioni causa→effetto.
Niente melodramma, niente morale, niente elenchi puntati. Evita linguaggio floreale. Frasi brevi e chiare; dettagli ordinari e verificabili.
Intreccia valori, stile decisionale, atteggiamento al cambiamento, motivazione e self-view in modo implicito. Se ci sono ancore (luogo/persona/ricordo), inseriscile con naturalezza. 140–180 parole. Indica chiaramente che parli del ${time}.`;
      systemPrompt = (lang === "en" ? core_en : core_it);
    }

    if (structured === true) {
      // opzionale per futuri viewer (lasciato vuoto volutamente)
    }

    const userPrompt =
      (lang === "en"
        ? `User question: ${q}\n${line_profile}\n${line_arche}\n${line_anchors}\nTime focus: ${time}`
        : `Domanda dell'utente: ${q}\n${line_profile}\n${line_arche}\n${line_anchors}\nFocalizzazione temporale: ${time}`
      ).trim();

    // ===== Model call
    const client = new OpenAI({ apiKey });
    const wantsStream =
      stream === true || req.query?.stream === "1" || req.headers["x-whatif-stream"] === "1";

    const temperature = stile === "wtf" ? 0.9 : 0.55; // WTF più frizzante, WHATIF più sobrio
    const MAX_TOKENS = 380;

    if (wantsStream) {
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
      lang, periodo, stile,
      profile: profileBrief,
      archetypes: A,
      anchors: AN,
      structured: !!structured,
      answer: text,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
