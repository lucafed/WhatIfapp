// ===== /api/ask.js =====

import OpenAI from "openai";

// 🔍 Log per verificare se la chiave è caricata
console.log("Chiave API:", process.env.OPENAI_API_KEY ? "✅ Trovata" : "❌ NON trovata");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito" });
  }

  try {
    const { domanda, lang, periodo, stile, clarifications, profilo } = req.body;

    // controlla la chiave
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Chiave API mancante nel server." });
    }

    // prompt dinamico in base allo stile scelto
    const prompt = `
Sei un'intelligenza artificiale che risponde nello stile "${stile}".
Conosci bene l'utente: si chiama ${profilo?.name || "l’utente"}.

Toni richiesti:
- "What if": empatico, allegro, realistico, con tono positivo e amichevole. 
  Evita malinconia o frasi tristi. Deve sembrare un amico che lo conosce bene.
- "What the F": ironico, sarcastico, da bar, ubriaco ma lucido. 
  Deve far ridere, non essere cattivo, con ritmo brillante e calore umano.

Domanda: "${domanda}"

Contesto extra (profilo utente e chiarimenti):
${JSON.stringify(clarifications || profilo || {}, null, 2)}

Genera una risposta in tono coerente e vivace.
Chiudi SEMPRE con una frase di continuità per il giorno dopo, tipo:
- "Domani vediamo dove porta questa storia." oppure
- "Stesso bancone, domani rimescoliamo."
`;

    // chiamata OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.9,
      max_tokens: 600,
    });

    const answer = completion.choices[0]?.message?.content?.trim();

    res.status(200).json({ answer });
  } catch (err) {
    console.error("Errore in /api/ask:", err);
    res.status(500).json({ error: "Errore server", detail: err.message });
  }
}
