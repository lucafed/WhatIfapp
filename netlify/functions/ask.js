export async function handler(event) {
  try {
    // Legge la API key da Netlify
    const API_KEY = process.env.OPENAI_API_KEY;

    // Se manca la chiave → errore
    if (!API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: "Chiave API mancante su Netlify" })
      };
    }

    // 🔹 DEBUG MODE: se non arriva un body, risponde solo testando la chiave
    if (!event.body) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          test: "Funziona! La chiave è caricata.",
          key: API_KEY.substring(0, 6) + "... (nascosta)"
        })
      };
    }

    // Se invece riceve un body, procediamo normalmente con la chiamata a OpenAI
    const payload = JSON.parse(event.body);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Sei un assistente che aiuta a esplorare scenari 'What if'." },
          { role: "user", content: payload.prompt || "Genera una domanda di esempio." }
        ]
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error("Errore API OpenAI: " + txt);
    }

    const data = await res.json();

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, data })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
}
