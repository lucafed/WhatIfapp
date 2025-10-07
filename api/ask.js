// api/ask.js — Vercel Serverless Function (Node.js)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  // Leggi body in modo robusto
  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { body = {}; }
  }

  const {
    lang = 'it',
    period = 'future',    // 'past' | 'future'
    style = 'whatif',     // 'whatif' | 'wtf'
    question = '',
    profile = {}
  } = body;

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Bad request: question required' });
  }

  const isEN = (lang || 'it').toLowerCase() === 'en';
  const tone = style === 'wtf'
    ? (isEN
        ? 'Answer with imaginative, ironic, slightly surreal humor—but be kind and safe. Short lively paragraphs, concrete ideas.'
        : 'Rispondi in modo immaginativo, ironico e un po’ surreale — sempre gentile e sicuro. Paragrafi brevi, idee concrete.')
    : (isEN
        ? 'Answer realistically and constructively, using plausible steps and coherent reasoning. Friendly and concise.'
        : 'Rispondi in modo realistico e costruttivo, con passi plausibili e ragionamento coerente. Tono amichevole e conciso.');

  const periodHint = isEN
    ? (period === 'past'
        ? 'Focus on plausible alternative past outcomes and downstream effects to the present.'
        : 'Project a plausible near-future trajectory with actionable steps and risks.')
    : (period === 'past'
        ? 'Concentrati su esiti alternativi plausibili del passato e sugli effetti fino al presente.'
        : 'Proietta una traiettoria plausibile di futuro prossimo con passi concreti e rischi.');

  const sys = `${tone}
${periodHint}
Keep safety; avoid medical/legal/financial advice. Return in ${isEN ? 'English' : 'Italiano'}.
When helpful, end with 3 actionable next steps. If possible, estimate a rough likelihood and key factors.`;

  const { who, age, stage, city, extra } = profile || {};
  const contextParts = [];
  if (who)  contextParts.push(isEN ? `I am ${who}` : `Sono ${who}`);
  if (age)  contextParts.push(isEN ? `age ${age}` : `età ${age}`);
  if (stage)contextParts.push(isEN ? `stage: ${stage}` : `fase: ${stage}`);
  if (city) contextParts.push(isEN ? `from ${city}` : `da ${city}`);
  if (extra)contextParts.push(extra);
  const profileLine = contextParts.length
    ? (isEN ? 'Context: ' : 'Contesto: ') + contextParts.join(', ')
    : '';

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const temperature = style === 'wtf' ? 0.9 : 0.5;

  try {
    const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `${profileLine}\nQuestion: ${question}`.trim() }
        ]
      })
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text().catch(()=>'');
      return res.status(500).json({ error: 'OpenAI error', detail });
    }

    const data = await apiRes.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() || '';

    return res.status(200).json({
      ok: true,
      model,
      lang,
      period,
      style,
      answer
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
