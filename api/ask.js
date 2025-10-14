// /api/ask.js — serverless (Vercel / Netlify) o Express handler
// Richiede process.env.OPENAI_API_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' }); return;
  }

  // hard timeout per non far “pendere” il front
  const timeoutMs = 12000;
  const timeout = setTimeout(() => {
    try { res.writeHead(200, { 'Content-Type': 'application/json' }); } catch {}
    try { res.end(JSON.stringify({ error: 'timeout' })); } catch {}
  }, timeoutMs);

  try {
    const {
      clarify = false,
      want = 'answer',          // 'answer' | 'clarify' | 'followups'
      domanda = '',
      clarifications = {},
      stile = 'whatif',         // 'whatif' | 'wtf'
      periodo = 'future',       // 'past' | 'future'
      lang = 'it',              // 'it' | 'en'
      stream = false,
      tz = 'UTC'
    } = await parseJSON(req);

    const MODE = clarify ? 'clarify' : want;

    // Prompt di stile blindati
    const PROMPTS = stylePrompts({ stile, periodo, lang });

    if (MODE === 'clarify') {
      const questions = await genClarify({ domanda, stile, periodo, lang, PROMPTS });
      clearTimeout(timeout);
      res.setHeader('Content-Type', 'application/json');
      res.status(200).end(JSON.stringify({ questions }));
      return;
    }

    if (MODE === 'followups') {
      const { answer = '' } = await parseJSON(req);
      const followups = await genFollowups({ domanda, answer, stile, periodo, lang, PROMPTS });
      clearTimeout(timeout);
      res.setHeader('Content-Type', 'application/json');
      res.status(200).end(JSON.stringify({ followups }));
      return;
    }

    // MODE: answer
    if (stream) {
      // streaming SSE
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked'
      });

      try {
        await streamAnswer({
          domanda, clarifications, stile, periodo, lang, PROMPTS,
          onToken: (t) => res.write(`data: ${JSON.stringify({ token: t })}\n\n`),
          onDone: () => res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
        });
        clearTimeout(timeout);
        res.end();
      } catch (e) {
        // se lo stream fallisce, invia un done e chiudi
        res.write(`data: ${JSON.stringify({ done: true, error: true })}\n\n`);
        clearTimeout(timeout);
        res.end();
      }
      return;
    } else {
      const text = await genAnswer({ domanda, clarifications, stile, periodo, lang, PROMPTS });
      clearTimeout(timeout);
      res.setHeader('Content-Type', 'application/json');
      res.status(200).end(JSON.stringify({ text }));
      return;
    }
  } catch (err) {
    clearTimeout(timeout);
    res.status(200).json({ error: err?.message || 'unknown_error' });
  }
}

/* ---------------------- utils ---------------------- */

async function parseJSON(req) {
  const raw = await new Promise((ok, ko) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => ok(b));
    req.on('error', ko);
  });
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function stylePrompts({ stile, periodo, lang }) {
  const P = { sys: '', clarify: '', follow: '', close: '' };

  if (lang === 'it') {
    if (stile === 'wtf') {
      P.sys =
`Sei "What the F": sarcastico, ironico, da bar, ubriaco ma lucido, positivo. 
Fai ridere, mai cattivo, niente malinconia, niente prediche. Frasi brevi, ritmo, battute intelligenti. 
Chiudi spesso con “Clink. Stesso bancone, domani rimescoliamo.”`;
      P.clarify = `Genera 3 domande mirate e concise (max 8 parole) per chiarire la richiesta dell’utente. Non numerarle, restituisci solo un elenco JSON semplice.`;
      P.follow = `Genera 2 follow-up sintetici, scherzosi ma utili, legati alla domanda e alla risposta.`;
      P.close = `Clink. Stesso bancone, domani rimescoliamo.`;
    } else {
      P.sys =
`Sei "What if": empatico, asciutto, lucido. Niente tristezza, niente toni da coach. 
Sembra un amico brillante che conosce l’utente e lo incoraggia con leggerezza. Frasi pulite, ritmo.`;
      P.clarify = `Genera 3 domande mirate e chiare (max 10 parole) per rendere più personale la risposta. Non numerarle, restituisci solo un elenco JSON semplice.`;
      P.follow = `Genera 2 follow-up corti, pratici e positivi, legati a domanda e risposta.`;
      P.close = `Domani ripartiamo da qui.`;
    }
  } else { // EN
    if (stile === 'wtf') {
      P.sys =
`You are "What the F": witty bar-friend, cheeky but kind, zero melancholy. 
Short punchy lines, smart jokes, warm vibe. Never mean. Often end with “Clink. Same counter, we stir again tomorrow.”`;
      P.clarify = `Produce 3 short, focused questions (max 8 words). Return plain JSON list.`;
      P.follow = `Return 2 playful but useful follow-ups tied to question and answer.`;
      P.close = `Clink. Same counter, we stir again tomorrow.`;
    } else {
      P.sys =
`You are "What if": empathetic, concise, uplifting and realistic. 
Sounds like a smart friend who knows the user. No melancholy, no coaching vibe.`;
      P.clarify = `Produce 3 clear, targeted questions (max 10 words). Return plain JSON list.`;
      P.follow = `Return 2 short, practical follow-ups tied to question and answer.`;
      P.close = `Tomorrow we pick up from here.`;
    }
  }

  P.periodo = (periodo === 'past')
    ? (lang === 'it' ? 'Ambientazione: passato.' : 'Setting: past.')
    : (lang === 'it' ? 'Ambientazione: futuro prossimo.' : 'Setting: near future.');

  return P;
}

async function openAIChat(payload) {
  const key = process.env.OPENAI_API_KEY || '';
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini', // veloce e a basso costo; cambia se vuoi
      temperature: payload.temperature ?? 0.7,
      top_p: 0.9,
      presence_penalty: payload.presence_penalty ?? 0.3,
      max_tokens: payload.max_tokens ?? 420,
      messages: payload.messages
    })
  });
  if (!resp.ok) throw new Error(`openai_${resp.status}`);
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || '';
}

/* -------- clarify -------- */
async function genClarify({ domanda, stile, periodo, lang, PROMPTS }) {
  const content = await openAIChat({
    temperature: 0.2,
    max_tokens: 120,
    messages: [
      { role: 'system', content: `${PROMPTS.sys}\n${PROMPTS.periodo}` },
      { role: 'user', content: lang==='it'
        ? `Domanda utente: "${domanda}". ${PROMPTS.clarify}`
        : `User question: "${domanda}". ${PROMPTS.clarify}`
      }
    ]
  });
  // Prova a leggere JSON; in fallback splitta per newline
  try {
    const asJson = JSON.parse(content);
    if (Array.isArray(asJson)) return asJson.map(s => ({ label: s }));
  } catch {}
  const lines = content.split(/\n/).map(s => s.replace(/^[\-•\d\.\s]+/,'').trim()).filter(Boolean);
  return lines.slice(0,3).map(s => ({ label: s }));
}

/* -------- followups -------- */
async function genFollowups({ domanda, answer, stile, periodo, lang, PROMPTS }) {
  const content = await openAIChat({
    temperature: 0.5,
    max_tokens: 120,
    messages: [
      { role: 'system', content: `${PROMPTS.sys}\n${PROMPTS.periodo}` },
      { role: 'user', content: lang==='it'
        ? `Domanda: "${domanda}"\nRisposta: """${answer}"""\n${PROMPTS.follow}\nRispondi con un elenco JSON con 2 stringhe.`
        : `Question: "${domanda}"\nAnswer: """${answer}"""\n${PROMPTS.follow}\nReply with a JSON array of 2 strings.`
      }
    ]
  });
  try {
    const arr = JSON.parse(content);
    if (Array.isArray(arr) && arr.length) return arr;
  } catch {}
  const lines = content.split(/\n/).map(s => s.replace(/^[\-•\d\.\s]+/,'').trim()).filter(Boolean);
  return lines.slice(0,2);
}

/* -------- answer (non-stream) -------- */
async function genAnswer({ domanda, clarifications, stile, periodo, lang, PROMPTS }) {
  const clar = Object.values(clarifications||{}).filter(Boolean);
  const clarText = clar.length ? (lang==='it' ? `Chiarimenti: ${clar.join(' • ')}` : `Clarifications: ${clar.join(' • ')}`) : '';
  const content = await openAIChat({
    temperature: stile==='wtf' ? 0.85 : 0.6,
    max_tokens: 520,
    presence_penalty: stile==='wtf' ? 0.6 : 0.2,
    messages: [
      { role: 'system', content: `${PROMPTS.sys}\n${PROMPTS.periodo}` },
      { role: 'user', content:
          (lang==='it'
            ? `Domanda: "${domanda}". ${clarText}\nScrivi un episodio breve (10–14 righe max) nello stile indicato. Chiudi con: ${PROMPTS.close}`
            : `Question: "${domanda}". ${clarText}\nWrite a short episode (10–14 lines max) in the style. End with: ${PROMPTS.close}`
          )
      }
    ]
  });
  return content;
}

/* -------- answer (stream) -------- */
async function streamAnswer({ domanda, clarifications, stile, periodo, lang, PROMPTS, onToken, onDone }) {
  const key = process.env.OPENAI_API_KEY || '';
  const clar = Object.values(clarifications||{}).filter(Boolean);
  const clarText = clar.length ? (lang==='it' ? `Chiarimenti: ${clar.join(' • ')}` : `Clarifications: ${clar.join(' • ')}`) : '';
  const body = {
    model: 'gpt-4o-mini',
    temperature: stile==='wtf' ? 0.85 : 0.6,
    top_p: 0.9,
    presence_penalty: stile==='wtf' ? 0.6 : 0.2,
    max_tokens: 520,
    stream: true,
    messages: [
      { role: 'system', content: `${PROMPTS.sys}\n${PROMPTS.periodo}` },
      { role: 'user', content:
          (lang==='it'
            ? `Domanda: "${domanda}". ${clarText}\nScrivi un episodio breve (10–14 righe max) nello stile indicato. Chiudi con: ${PROMPTS.close}`
            : `Question: "${domanda}". ${clarText}\nWrite a short episode (10–14 lines max) in the style. End with: ${PROMPTS.close}`
          )
      }
    ]
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok || !resp.body) throw new Error(`openai_stream_${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let done = false, buffer = '';
  while (!done) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    // risposta "chunked" del chat.completions stream
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';
    for (const line of parts) {
      const m = line.match(/^data:\s*(.*)$/);
      if (!m) continue;
      if (m[1] === '[DONE]') { onDone(); return; }
      try {
        const j = JSON.parse(m[1]);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) onToken(delta);
      } catch {}
    }
  }
  onDone();
}
