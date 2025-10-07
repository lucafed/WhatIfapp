// /api/ask.js
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Modello consigliato (puoi cambiarlo da env con OPENAI_MODEL)
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Metti a true se vuoi risposte finte per test locali
const USE_MOCK = false;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { lang = "it", periodo, stile, question, persona } = req.body || {};

    // Validazioni minime
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Bad request: question required" });
    }
    if (!["past", "future"].includes(periodo || "")) {
      return res.status(400).json({ error: "Bad request: periodo must be past|future" });
    }
    if (!["whatif", "wtf"].includes(stile || "")) {
      return res.status(400).json({ error: "Bad request: stile must be whatif|wtf" });
    }
    if (!["it", "en"].includes((lang || "").toLowerCase())) {
      return res.status(400).json({ error: "Bad request: lang must be it|en" });
    }

    if (USE_MOCK) {
      return res.json({
        ok: true,
        model: "mock",
        lang, periodo, stile, question,
        result: {
          title: stile === "whatif"
            ? (lang === "it" ? "Scenario plausibile" : "Plausible scenario")
            : (lang === "it" ? "Scenario ironico" : "Ironic scenario"),
          summary: lang === "it"
            ? "Risposta di test (mock)."
            : "Test (mock) response.",
          steps: [],
          probability: 0.68,
          disclaimer: lang === "it"
            ? "Contenuti generati automaticamente, non sono consigli professionali."
            : "AI-generated content, not professional advice."
        }
      });
    }

    const sysIt = `
Sei l'AI di What?f. Rispondi in italiano.
- "whatif": tono realistico e plausibile con 4–6 passi concreti.
- "wtf": tono ironico/surreale ma utile e benevolo.
- "past": come sarebbe potuto andare; "future": cosa potrebbe accadere.
- Personalizza con eventuale "persona".
- Restituisci JSON: {title, summary, steps[], probability(0..1), disclaimer}.
Non fornire consigli medici/legali/finanziari.
`;
    const sysEn = `
You are What?f's AI. Reply in English.
- "whatif": realistic & plausible with 4–6 concrete steps.
- "wtf": playful/ironic, surreal yet helpful.
- "past": what could have happened; "future": what could happen.
- Personalize using "persona" if present.
- Return JSON: {title, summary, steps[], probability(0..1), disclaimer}.
No medical/legal/financial advice.
`;

    const system = lang === "it" ? sysIt : sysEn;
    const user = {
      role: "user",
      content:
        (lang === "it"
          ? `Periodo: ${periodo}. Stile: ${stile}. Domanda: ${question}.`
          : `Period: ${periodo}. Style: ${stile}. Question: ${question}.`) +
        (persona ? (lang === "it" ? ` Persona: ${persona}.` : ` Persona: ${persona}.`) : "")
    };

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.9 : 0.6,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, user]
    });

    const content = completion.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = { summary: content }; }

    return res.json({
      ok: true,
      model: MODEL,
      lang, periodo, stile, question,
      result: parsed
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "AI error", detail: String(err?.message || err) });
  }
}
