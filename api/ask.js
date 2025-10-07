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

    const client = new OpenAI({ apiKey });

    const {
      action,            // 'suggest-questions' | 'final-answer'
      question,          // domanda iniziale
      answers = [],      // array di { q: string, a: string }
      lang = "it",
      periodo,           // 'past' | 'future'
      stile              // 'whatif' | 'wtf'
    } = req.body || {};

    const q = (question || "").toString().trim();
    if (!q) return res.status(400).json({ error: "question required" });

    // tono/tempo in base alle preferenze
    const tone =
      stile === "wtf"
        ? (lang === "en"
            ? "ironic, playful, slightly surreal (but respectful)"
            : "ironico, giocoso, leggermente surreale (ma rispettoso)")
        : (lang === "en"
            ? "realistic, reflective, concrete"
            : "realistico, riflessivo, concreto");

    const time =
      periodo === "past"
        ? (lang === "en" ? "the past (what if)" : "il passato (what if)")
        : (lang === "en" ? "the future (plausible what if)" : "il futuro (what if plausibile)");

    // MODE 1: follow-up questions
    if (action === "suggest-questions") {
      const sys =
        lang === "en"
          ? `You are What?f. Propose a short set of clarification questions (2 or 3)
to better personalize an answer about ${time}, in a ${tone} tone.
Return STRICT JSON: {"questions":["...","..."]} with concise, single-sentence questions.`
          : `Sei What?f. Proponi un breve set di domande di chiarimento (2 o 3)
per personalizzare la risposta sul ${time}, con tono ${tone}.
Restituisci SOLO JSON: {"questions":["...","..."]} con domande concise a frase singola.`;

      const rsp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.5,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: (lang === "en" ? "User question: " : "Domanda dell'utente: ") + q }
        ]
      });

      let content = rsp.choices?.[0]?.message?.content || "{}";
      let list = [];
      try {
        const obj = JSON.parse(content);
        list = Array.isArray(obj.questions) ? obj.questions.slice(0,3) : [];
      } catch {
        // fallback: estrai righe
        list = content.split(/\n+/).map(s => s.replace(/^[\-\d\.\)\s]+/,"").trim()).filter(Boolean).slice(0,3);
      }
      if (list.length === 0) {
        list = lang === "en"
          ? ["What is your main goal?", "Are there any constraints or preferences I should consider?"]
          : ["Qual è il tuo obiettivo principale?", "Ci sono vincoli o preferenze da considerare?"];
      }

      return res.status(200).json({ ok: true, questions: list });
    }

    // MODE 2: final answer
    const sys =
      lang === "en"
        ? `You are What?f. Generate a personalized, helpful answer about ${time}, in a ${tone} tone.
Be clear, safe, and concise (8–12 sentences max). Use the clarifications if provided.`
        : `Sei What?f. Genera una risposta personalizzata sul ${time}, con tono ${tone}.
Sii chiaro, sicuro e conciso (massimo 8–12 frasi). Usa i chiarimenti se presenti.`;

    const clar =
      answers && answers.length
        ? (lang === "en"
            ? "Clarifications:\n" + answers.map((x,i)=>`${i+1}) ${x.q}\n→ ${x.a}`).join("\n")
            : "Chiarimenti:\n" + answers.map((x,i)=>`${i+1}) ${x.q}\n→ ${x.a}`).join("\n"))
        : (lang === "en" ? "No clarifications provided." : "Nessun chiarimento fornito.");

    const rsp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: stile === "wtf" ? 0.9 : 0.6,
      messages: [
        { role: "system", content: sys },
        { role: "user", content:
            (lang === "en" ? "User question: " : "Domanda utente: ") + q + "\n\n" + clar }
      ]
    });

    const text = rsp.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ ok: true, answer: text });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
