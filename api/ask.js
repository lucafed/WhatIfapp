// api/ask.js  (Vercel Serverless Function)
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { mode, prefs, user, question, followupAnswers } = req.body || {};
    if (!mode || !question) return res.status(400).json({ error: 'Bad request' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    // Costruisci il contesto da passare al modello
    const style = prefs?.stile === 'wtf' ? 'ironico/creativo' : 'plausibile/riflessivo';
    const time  = prefs?.periodo === 'past' ? 'passato' : 'futuro';

    // Prompt di sistema comune
    const system = `Sei What?f, un assistente che risponde in modo ${style}.
- Se l'utente esplora il passato, spiega "cosa sarebbe potuto accadere".
- Se esplora il futuro, spiega "cosa potrebbe accadere".
- Sii concreto, personale e breve (5–7 righe), senza superare 1200 caratteri.
- Restituisci SEMPRE output nel formato richiesto.`;

    // Scegli modello (puoi cambiare qui se preferisci)
    const model = "gpt-3.5-turbo";

    if (mode === 'followups') {
      const userMsg = `Domanda utente: "${question}"
Profilo: ${JSON.stringify(user||{})}
Periodo: ${time}. Stile: ${style}.
Genera 2 o 3 DOMANDE DI CHIARIMENTO mirate (brevi, specifiche) per migliorare la risposta finale.
Rispondi SOLO come JSON: {"followups":["...","...","..."]} senza testo extra.`;

      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.7,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg }
          ]
        })
      });
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content || "{}";
      let out = {};
      try { out = JSON.parse(text); } catch { out = { followups: [] }; }
      return res.status(200).json({ followups: out.followups || [] });
    }

    if (mode === 'final') {
      const userMsg = `Domanda utente: "${question}"
Risposte follow-up: ${JSON.stringify(followupAnswers||[])}
Profilo: ${JSON.stringify(user||{})}
Periodo: ${time}. Stile: ${style}.
Fornisci una risposta personale e contestualizzata (5–7 righe) e una STIMA DI PROBABILITÀ (0-100) con breve motivazione.
Rispondi SOLO come JSON:
{"answer":"testo risposta (senza markdown)","probability": 0-100}`;

      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.8,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg }
          ]
        })
      });
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content || "{}";
      let out = {};
      try { out = JSON.parse(text); } catch { out = { answer:"", probability:null }; }
      return res.status(200).json({
        answer: out.answer || "",
        probability: out.probability
      });
    }

    return res.status(400).json({ error: 'Unknown mode' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
