// /api/ask.js — streaming SSE + risposta JSON, con formato ANALITICO realistico per "whatif"
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
      periodo,   // "past" | "future"
      stile,     // "whatif" (analitico) | "wtf" (ironico)
      stream,
      profile,   // { gender, age, phase, where, who, more }
      archetypes,// { Ricercatore: 78, ... } (0–100)
      anchors,   // { place, person, memory } opzionali
      structured // (opzionale) se true → JSON con 3 nodi
    } = req.body || {};

    const q = (question || domanda || "").toString().trim();
    if (!q) return res.status(400).json({ error: "question required" });

    const safeProfile = (profile && typeof profile === "object") ? profile : {};
    const safeArche   = (archetypes && typeof archetypes === "object") ? archetypes : {};
    const safeAnch    = (anchors && typeof anchors === "object") ? anchors : {};

    const time =
      periodo === "past"
        ? (lang === "en" ? "the past (what if)" : "il passato (what if)")
        : (lang === "en" ? "the near future (plausible what if)" : "il prossimo futuro (what if plausibile)");

    // Linee di contesto da passare all'AI (compatte, niente dati sensibili superflui)
    const profileLine =
      lang === "en"
        ? `User profile: ${JSON.stringify({
            age: safeProfile.age || null,
            phase: safeProfile.phase || null,
            where: safeProfile.where || null,
            who: safeProfile.who || null,
          })}.`
        : `Profilo utente: ${JSON.stringify({
            age: safeProfile.age || null,
            phase: safeProfile.phase || null,
            where: safeProfile.where || null,
            who: safeProfile.who || null,
          })}.`;

    const archeLine =
      lang === "en"
        ? `Psychological archetypes (0–100): ${JSON.stringify(safeArche)}.`
        : `Archetipi psicologici (0–100): ${JSON.stringify(safeArche)}.`;

    const anchorLine = (safeAnch.place || safeAnch.person || safeAnch.memory)
      ? (lang === "en"
          ? `Personal anchors: ${JSON.stringify({
              place: safeAnch.place || null,
              person: safeAnch.person || null,
              memory: safeAnch.memory || null,
            })}.`
          : `Ancore personali: ${JSON.stringify({
              place: safeAnch.place || null,
              person: safeAnch.person || null,
              memory: safeAnch.memory || null,
            })}.`)
      : "";

    // ----------------------------
    // PROMPT
    // ----------------------------
    let systemPrompt;

    if (stile === "wtf") {
      // Modalità WTF: spiritosa ma sempre sicura
      systemPrompt =
        lang === "en"
          ? `You are What?f in WTF mode. Sound like a witty friend at a bar: light, playful, with 2–3 punchlines. Kind, non-offensive (no slurs/hate), no humiliation. Keep it plausible and grounded in the user's context. 120–180 words. Make it clearly about ${time} and still coherent with profile and archetypes.`
          : `Sei What?f in modalità WTF. Suona come un amico al bar: leggero, brillante, con 2–3 battute. Gentile e non offensivo (no insulti/odio), evita umiliazioni. Mantieni plausibilità e ancoraggio al contesto utente. 120–180 parole. Indica chiaramente che parli del ${time} e resta coerente con profilo e archetipi.`;
    } else {
      // Modalità WHAT IF (analitico, senza "storiella")
      const header_en =
        `NO storytelling. Write a compact scenario analysis in clearly labeled sections, second person allowed.
Return this shape (concise bullet points, no fluff):
1) Snapshot (2–3 bullets): personal traits inferred from profile & archetypes; relevant habits/context (place/phase).
2) Turning point: the decision or condition at stake (1 line).
3) Causal chain (${periodo === "past" ? "what would likely have happened then (3 steps within 1–3 years)" : "what could plausibly unfold in the next 6–18 months (3 steps)"}).
4) Verifiable signals (3 bullets): external indicators you could actually notice.
5) Small next step (1 bullet): a minimal, concrete action consistent with your profile.

Use realistic constraints (time, money, obligations). If anchors are present, weave them concretely.
Avoid generic advice and generic life-lessons. 130–180 words.`;

      const header_it =
        `Nessuna narrazione romanzata. Scrivi una breve ANALISI DI SCENARIO in sezioni con etichette chiare (puoi usare la seconda persona).
Usa questo formato (punti concisi, senza fronzoli):
1) Ritratto rapido (2–3 bullet): tratti personali dal profilo/archetipi; abitudini/contesto rilevante (luogo/fase).
2) Punto di svolta: decisione o condizione in gioco (1 riga).
3) Catena causale (${periodo === "past" ? "cosa sarebbe verosimilmente accaduto allora (3 passi entro 1–3 anni)" : "cosa può plausibilmente accadere nei prossimi 6–18 mesi (3 passi)"}).
4) Indicatori verificabili (3 bullet): segnali esterni che potresti davvero notare.
5) Prossimo passo minimo (1 bullet): azione piccola, concreta e coerente con te.

Inserisci vincoli realistici (tempo, soldi, impegni). Se ci sono ancore, usale in modo concreto.
Evita consigli generici e frasi universali. 130–180 parole.`;

      systemPrompt =
        lang === "en"
          ? `You are What?f. ${header_en}`
          : `Sei What?f. ${header_it}`;
    }

    if (structured === true) {
      // opzionale: JSON con 3 nodi (lasciamo disponibile per futuro)
      systemPrompt +=
        lang === "en"
          ? ` If structured=true, instead return valid JSON: {"summary":"...","nodes":[{"label":"...","forces":["..."],"outcomeA":"...","outcomeB":"...","mood":-2..2}, ... (3 items)] }.`
          : ` Se structured=true, restituisci invece JSON valido: {"summary":"...","nodes":[{"label":"...","forces":["..."],"outcomeA":"...","outcomeB":"...","mood":-2..2}, ... (3 elementi)] }.`;
    }

    const userPrompt =
      lang === "en"
        ? `User question: ${q}\n${profileLine}\n${archeLine}\n${anchorLine}\nTime focus: ${time}`
        : `Domanda dell'utente: ${q}\n${profileLine}\n${archeLine}\n${anchorLine}\nFocalizzazione temporale: ${time}`;

    // ----------------------------
    // CHIAMATA MODELLO
    // ----------------------------
    const client = new OpenAI({ apiKey });
    const wantsStream =
      stream === true || req.query?.stream === "1" || req.headers["x-whatif-stream"] === "1";

    const temperature = stile === "wtf" ? 0.9 : 0.55; // analitico leggermente più “freddo”
    const MAX_TOKENS = 360;

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
      profile: safeProfile,
      archetypes: safeArche,
      anchors: safeAnch,
      structured: !!structured,
      answer: text,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
