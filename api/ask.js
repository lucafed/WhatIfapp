// /api/ask.js — SSE + JSON. Narrazione realistica, personale (no fiaba, no elenco puntato)
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
      periodo,           // "past" | "future"
      stile,             // "whatif" (realistico) | "wtf" (ironico)
      stream,
      profile,           // include: values[], style, change_attitude, motivation, self_view (+ eventuali age/phase/where/who)
      archetypes,        // { Ricercatore, Costruttore, Visionario, Mediatore } 0–100
      anchors,           // { place, person, memory } opzionale
      structured         // opzionale
    } = req.body || {};

    const q = (question || domanda || "").toString().trim();
    if (!q) return res.status(400).json({ error: "question required" });

    // ---- Sanitize/compact context ----
    const P = (typeof profile === "object" && profile) ? profile : {};
    const A = (typeof archetypes === "object" && archetypes) ? archetypes : {};
    const AN = (typeof anchors === "object" && anchors) ? anchors : {};

    const time =
      periodo === "past"
        ? (lang === "en" ? "the past (what if)" : "il passato (what if)")
        : (lang === "en" ? "the near future (plausible what if)" : "il prossimo futuro (what if plausibile)");

    // Profilo compatto che esponiamo al modello (solo ciò che serve a personalizzare il tono)
    const profileBrief = {
      age: P.age || null,
      phase: P.phase || null,
      where: P.where || null,
      who: P.who || null,
      values: Array.isArray(P.values) ? P.values.slice(0, 4) : null,
      style: P.style || null,                // analitico/intuitivo/adattivo/equilibrato
      change_attitude: P.change_attitude || null, // cauto/stimolato/valutativo/cerca il cambiamento
      motivation: P.motivation || null,      // stabilità/crescita/libertà/riconoscimento
      self_view: P.self_view || null         // serio/ironico/introspettivo/leggero
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

    // ---- Prompting: due modalità ----
    let systemPrompt;

    if (stile === "wtf") {
      // Ironico, “da bar”, ma plausibile e non offensivo
      systemPrompt =
        lang === "en"
          ? `You are What?f in WTF mode. Sound like a witty friend at a bar: light, playful, with 2–3 punchlines. Be kind, non-offensive (no slurs/hate), no humiliation. Keep it plausible, grounded in the user's context and psychology. Use real-world constraints (time, money, obligations). Length 140–180 words. Make it clearly about ${time}.`
          : `Sei What?f in modalità WTF. Suona come un amico al bar: leggero, brillante, con 2–3 battute. Gentile e non offensivo (no insulti/odio), senza umiliazioni. Mantieni la plausibilità, ancorati al contesto e alla psicologia dell’utente. Usa vincoli reali (tempo, soldi, impegni). Lunghezza 140–180 parole. Indica chiaramente che parli del ${time}.`;
    } else {
      // Realistico, personale, “immagine di vita possibile”: narrativo sobrio, non romanzato, senza elenco
      const core_en = `You are What?f, a reflective narrator. Write as if you truly knew this person—tone, doubts, ambitions.
Describe a parallel timeline that feels intimate, plausible and emotionally true, without turning it into a plot or moral lesson.
Weave the user's VALUES, STYLE of decision-making, ATTITUDE to change, core MOTIVATION and SELF-VIEW into the way you select details and explain causes.
If anchors are provided, use them concretely (place/person/memory). Use sensory cues (light, sounds, smells) sparingly, and only if they make it feel real. Mention realistic constraints (time, work, fatigue, money).
Make the user think: "this could really be my life." Calm, lucid tone. 140–180 words. Keep it clearly about ${time}.`;

      const core_it = `Sei What?f, un narratore riflessivo. Scrivi come se conoscessi davvero questa persona — tono, dubbi, ambizioni.
Descrivi una linea di vita parallela, plausibile e vera emotivamente, senza trasformarla in una trama o in una morale.
Intreccia nei dettagli il sistema di VALORI, lo STILE decisionale, l’ATTEGGIAMENTO verso il cambiamento, la MOTIVAZIONE dominante e l’AUTOPERCEZIONE (self-view).
Se ci sono ancore, usale in modo concreto (luogo/persona/ricordo). Usa accenni sensoriali con misura e solo se rendono autentica la scena. Cita vincoli realistici (tempo, lavoro, stanchezza, denaro).
L’obiettivo è: “potrei davvero essere io”. Tono calmo e lucido. 140–180 parole. Rendi chiaro che parli del ${time}.`;

      // boost specifico se passato
      const pastBoost_en = `When focusing on the past, prefer small believable shifts (jobs, routines, social circle) over dramatic twists; add time markers (years/seasons) only if natural.`;
      const pastBoost_it = `Se parli del passato, privilegia piccoli scarti credibili (lavori, routine, cerchia sociale) rispetto a colpi di scena; inserisci marcatori temporali (anni/stagioni) solo se naturali.`;

      systemPrompt = (lang === "en" ? core_en : core_it) +
        (periodo === "past" ? (" " + (lang === "en" ? pastBoost_en : pastBoost_it)) : "");
    }

    if (structured === true) {
      // opzionale per futuri viewer
      systemPrompt += (lang === "en")
        ? ` If structured=true, instead return valid JSON: {"summary":"...","nodes":[{"label":"...","forces":["..."],"outcomeA":"...","outcomeB":"...","mood":-2..2}, ... (3 items)] }.`
        : ` Se structured=true, restituisci invece JSON valido: {"summary":"...","nodes":[{"label":"...","forces":["..."],"outcomeA":"...","outcomeB":"...","mood":-2..2}, ... (3 elementi)] }.`;
    }

    const userPrompt =
      (lang === "en"
        ? `User question: ${q}\n${line_profile}\n${line_arche}\n${line_anchors}\nTime focus: ${time}`
        : `Domanda dell'utente: ${q}\n${line_profile}\n${line_arche}\n${line_anchors}\nFocalizzazione temporale: ${time}`
      ).trim();

    // ---- Model call ----
    const client = new OpenAI({ apiKey });
    const wantsStream =
      stream === true || req.query?.stream === "1" || req.headers["x-whatif-stream"] === "1";

    const temperature = stile === "wtf" ? 0.9 : 0.6;   // WTF più creativo, What-if più sobrio
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
