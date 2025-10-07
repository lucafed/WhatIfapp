// /api/ask.js
// Serverless API per What?f – follow-up mirati + risposta finale (SSE opzionale)
import OpenAI from "openai";

/** Mappa tono in base allo stile scelto */
function toneFor(stile, lang) {
  const it = stile === "wtf"
    ? "tono ironico, surreale, brillante ma rispettoso"
    : "tono realistico, riflessivo, concreto e utile";
  const en = stile === "wtf"
    ? "an ironic, surreal, playful yet respectful tone"
    : "a realistic, reflective, concrete and helpful tone";
  return (lang === "en" ? en : it);
}

/** Mappa periodo in etichetta */
function timeFor(periodo, lang) {
  const it = periodo === "past" ? "what if sul passato (controfattuale plausibile)"
                                : "what if sul futuro (scenario plausibile)";
  const en = periodo === "past" ? "what-if about the past (plausible counterfactual)"
                                : "what-if about the future (plausible scenario)";
  return (lang === "en" ? en : it);
}

/** Prompt di sistema per l’assistente */
function systemPrompt({ lang, periodo, stile, maxChars }) {
  const t = toneFor(stile, lang);
  const tm = timeFor(periodo, lang);
  if (lang === "en") {
    return `You are What?f, an assistant that crafts short, personal scenarios.
Write in ${tm}, with ${t}. Keep it safe, non-judgmental, and concise.
Hard maximum length: ${maxChars} characters (truncate if needed).
If user selected "What the F", you may be playful/ironic but never offensive.`;
  }
  return `Sei What?f, un assistente che crea scenari brevi e personali.
Scrivi in ${tm}, con ${t}. Sii sicuro, non giudicante e conciso.
Lunghezza massima rigida: ${maxChars} caratteri (tronca se necessario).
Se l’utente ha scelto "What the F", puoi essere giocoso/ironico ma mai offensivo.`;
}

/** Prompt per generare follow-up mirati */
function followupSystemPrompt(lang) {
  if (lang === "en") {
    return `Generate 2-3 short, specific follow-up questions to clarify the user's question.
They must be tailored, non-redundant, and help produce a more personal, contextual answer.
Return ONLY a valid JSON array of strings (no preface, no extra keys).`;
  }
  return `Genera 2-3 domande brevi e specifiche per chiarire la domanda dell’utente.
Devono essere mirate, non ridondanti e utili a rendere la risposta più personale e contestuale.
Restituisci SOLO un array JSON di stringhe valido (niente prefazioni o chiavi extra).`;
}

/** Costruisce il contesto delle risposte ai follow-up */
function answersBlock(answers, lang) {
  if (!Array.isArray(answers) || !answers.length) return "";
  const lines = answers.map(x => `- Q: ${x.q}\n  A: ${x.a}`).join("\n");
  return (lang === "en"
    ? `Extra clarifications provided by the user:\n${lines}\n`
    : `Chiarimenti aggiuntivi forniti dall’utente:\n${lines}\n`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    const client = new OpenAI({ apiKey });

    // Body
    const {
      action,               // "suggest-questions" | "final-answer"
      question, domanda,    // domanda utente
      answers = [],         // [{q, a}]
      periodo,              // "past" | "future"
      stile,                // "whatif" | "wtf"
      lang = "it",
      stream = false,
      maxChars = 900
    } = req.body || {};

    const q = (question || domanda || "").toString().trim();
    if (!action) {
      // fallback: se non specificato, consideriamo "final-answer"
      req.body.action = "final-answer";
    }

    // ---- SUGGERISCI FOLLOW-UP ----
    if ((action || "final-answer") === "suggest-questions") {
      if (!q) return res.status(400).json({ error: "question required" });

      const sys = followupSystemPrompt(lang);
      const user = lang === "en"
        ? `User question: ${q}`
        : `Domanda utente: ${q}`;

      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user }
        ]
      });

      const raw = resp.choices?.[0]?.message?.content || "[]";
      let list = [];
      try {
        // prova parse dell'array JSON
        list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
      } catch {
        // in caso di risposta non-JSON, prova a estrarre con fallback rozzo
        list = raw.split("\n").map(s => s.trim()).filter(Boolean).slice(0,3);
      }
      // normalizza
      list = list.filter(x => typeof x === "string" && x.trim()).slice(0,3);

      return res.status(200).json({ ok: true, questions: list });
    }

    // ---- RISPOSTA FINALE ----
    if ((action || "final-answer") === "final-answer") {
      if (!q) return res.status(400).json({ error: "question required" });

      const sys = systemPrompt({ lang, periodo: periodo || "future", stile: stile || "whatif", maxChars });
      const hints = answersBlock(answers, lang);
      const user = (lang === "en"
        ? `User question: ${q}\n${hints}Write a concise, personal answer (max ~${maxChars} characters).`
        : `Domanda dell'utente: ${q}\n${hints}Scrivi una risposta personale e concisa (max ~${maxChars} caratteri).`);

      // STREAMING SSE
      if (stream) {
        // headers SSE
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");

        try {
          const completion = await client.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: (stile === "wtf" ? 0.9 : 0.6),
            stream: true,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: user }
            ],
          });

          let sent = 0;
          for await (const part of completion) {
            const delta = part.choices?.[0]?.delta?.content || "";
            if (!delta) continue;
            const remaining = maxChars - sent;
            const chunk = remaining > 0 ? delta.slice(0, remaining) : "";
            if (chunk) {
              // invia chunk puro (fifth.html mostra chunk così com’è)
              res.write(chunk);
              sent += chunk.length;
            }
            if (sent >= maxChars) break;
          }
          return res.end();
        } catch (err) {
          console.error("SSE error:", err);
          // degrada a JSON
          const fallback = await client.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: (stile === "wtf" ? 0.9 : 0.6),
            messages: [
              { role: "system", content: sys },
              { role: "user", content: user }
            ],
          });
          let text = fallback.choices?.[0]?.message?.content?.trim() || "";
          if (text.length > maxChars) text = text.slice(0, maxChars) + "…";
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          return res.status(200).json({ ok: true, answer: text, streamed: false });
        }
      }

      // NO STREAM → JSON
      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: (stile === "wtf" ? 0.9 : 0.6),
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user }
        ],
      });
      let text = resp.choices?.[0]?.message?.content?.trim() || "";
      if (text.length > maxChars) text = text.slice(0, maxChars) + "…";

      return res.status(200).json({
        ok: true,
        answer: text,
        streamed: false,
        model: "gpt-4o-mini",
        lang, periodo, stile
      });
    }

    // default (shouldn't happen)
    return res.status(400).json({ error: "unknown_action" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
