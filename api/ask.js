// /api/ask.js - versione "fetch" robusta (sempre JSON)
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'missing_api_key' });
    }

    // accetto sia "question" che "domanda"
    const { question, domanda, lang = 'it', periodo, stile } = req.body || {};
    const q = (question || domanda || '').toString().trim();
    if (!q) return res.status(400).json({ ok: false, error: 'question_required' });

    const tone =
      stile === 'wtf'
        ? (lang === 'en'
            ? 'ironic, surreal, playful (but respectful)'
            : 'ironico, surreale, spiritoso (ma rispettoso)')
        : (lang === 'en'
            ? 'realistic, reflective, concrete'
            : 'realistico, riflessivo, concreto');

    const time =
      periodo === 'past'
        ? (lang === 'en' ? 'the past (what if)' : 'passato (what if)')
        : (lang === 'en' ? 'the future (plausible what if)' : 'futuro (what if plausibile)');

    const systemPrompt =
      lang === 'en'
        ? `You are What?f. Generate a short scenario set in ${time}, with a ${tone} tone. Be clear, helpful and safe.`
        : `Sei What?f. Genera uno scenario breve nel ${time}, con tono ${tone}. Sii chiaro, utile e sicuro.`;

    const userPrompt = lang === 'en' ? `User question: ${q}` : `Domanda dell'utente: ${q}`;

    // Chiamata diretta all'API OpenAI
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: stile === 'wtf' ? 0.9 : 0.6,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    // Provo a leggere sempre JSON; se fallisce leggo testo e lo incapsulo
    let data;
    try {
      data = await r.json();
    } catch {
      const text = await r.text();
      return res
        .status(r.status || 500)
        .json({ ok: false, error: 'upstream_not_json', detail: text.slice(0, 400) });
    }

    if (!r.ok || data?.error) {
      const msg = data?.error?.message || 'upstream_error';
      return res.status(r.status || 500).json({ ok: false, error: msg, raw: data });
    }

    const answer = data.choices?.[0]?.message?.content?.trim() || '';
    return res.status(200).json({
      ok: true,
      model: 'gpt-4o-mini',
      lang,
      periodo,
      stile,
      answer,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: 'server_error', detail: String(err?.message || err) });
  }
}
