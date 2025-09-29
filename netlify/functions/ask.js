// netlify/functions/ask.js
export default async (req, context) => {
  try {
    // CORS
    const origin = req.headers.get('origin') || '';
    const allowed = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim());
    const okOrigin = allowed.some(a => a && origin.startsWith(a));
    const corsHeaders = {
      'Access-Control-Allow-Origin': okOrigin ? origin : 'https://example.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    const { prompt, time, scenario, place, when, answers = [] } = await req.json();

    // Costruisco un prompt pulito (puoi personalizzarlo)
    const sys = `Sei What?f, un assistente che scrive risposte sintetiche (6–8 frasi), 
chiare e personalizzate. Usa un tono ${scenario === 'wtf' ? 'ironico ma rispettoso' : 'realistico e concreto'}.
Se il tempo è "past", ragiona in termini di "cosa sarebbe potuto accadere"; se "future", "cosa potrebbe accadere".
Inserisci dettagli coerenti con luogo e periodo se presenti.`;

    const user = [
      `Tempo: ${time}`,
      `Scenario: ${scenario}`,
      place ? `Luogo: ${place}` : null,
      when ? `Periodo: ${when}` : null,
      answers?.length ? `Dettagli utente: ${answers.join(' | ')}` : null,
      `Domanda: What?f ${prompt}`
    ].filter(Boolean).join('\n');

    // Chiama OpenAI (usa la tua variabile OPENAI_API_KEY su Netlify)
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ],
        temperature: scenario === 'wtf' ? 0.9 : 0.7,
        max_tokens: 450
      })
    });

    if (!r.ok) {
      const txt = await r.text();
      return new Response(`OpenAI error: ${txt}`, { status: 500, headers: corsHeaders });
    }
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content?.trim() || 'Nessuna risposta.';

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(`Server error: ${err.message}`, { status: 500 });
  }
};
