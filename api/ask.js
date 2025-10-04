export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, hint: 'POST /api/ask con {mode, question, prefs, user, followupAnswers}' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { mode, prefs, user, question, followupAnswers } = req.body || {};
    if (!mode || !question) return res.status(400).json({ error: 'Bad request' });

    const apiKey = process.env.OPENAI_API_KEY;

    // --- Fallback MOCK se manca la chiave ---
    if (!apiKey) {
      if (mode === 'followups') {
        return res.status(200).json({
          followups: mockFollowups(question, prefs),
          mock: true
        });
      }
      if (mode === 'final') {
        const m = mockAnswer(question, prefs, followupAnswers || []);
        return res.status(200).json({ answer: m.text, probability: m.p, mock: true });
      }
      return res.status(400).json({ error: 'Unknown mode' });
    }

    // --- Prompt & chiamata OpenAI (GPT-3.5-turbo) ---
    const style = prefs?.stile === 'wtf' ? 'ironico/creativo' : 'plausibile/riflessivo';
    const time  = prefs?.periodo === 'past' ? 'passato' : 'futuro';
    const system = `Sei What?f, un assistente che risponde in modo ${style}. Se si esplora il passato, spiega cosa SAREBBE potuto accadere; se il futuro, cosa POTREBBE accadere. Sii concreto, personale, 5–7 righe.`;

    if (mode === 'followups') {
      const userMsg = `Domanda: "${question}"\nProfilo: ${JSON.stringify(user||{})}\nPeriodo: ${time}. Stile: ${style}.\nGenera 2-3 domande di follow-up brevi.\nRispondi SOLO JSON: {"followups":["...","...","..."]}`;
      const data = await openai(system, userMsg, apiKey);
      let out={}; try{ out = JSON.parse(data) }catch{ out={ followups: [] } }
      return res.status(200).json({ followups: out.followups || [] });
    }

    if (mode === 'final') {
      const userMsg = `Domanda: "${question}"\nFollow-up: ${JSON.stringify(followupAnswers||[])}\nProfilo: ${JSON.stringify(user||{})}\nPeriodo: ${time}. Stile: ${style}.\nRispondi SOLO JSON: {"answer":"testo","probability":0-100}`;
      const data = await openai(system, userMsg, apiKey);
      let out={}; try{ out = JSON.parse(data) }catch{ out={ answer:"", probability:null } }
      return res.status(200).json({ answer: out.answer || "", probability: out.probability });
    }

    return res.status(400).json({ error: 'Unknown mode' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function openai(system, userMsg, apiKey){
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${apiKey}` },
    body: JSON.stringify({ model:"gpt-3.5-turbo", temperature:0.8, messages:[ {role:"system",content:system}, {role:"user",content:userMsg} ] })
  });
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || "{}";
}

// --- Mock helpers ---
function mockFollowups(q, prefs){
  const arr=[];
  if((prefs?.periodo||'')==='past'){ arr.push('Qual era l’alternativa concreta che avevi in mente?'); }
  else { arr.push('Qual è il primo passo realistico che potresti fare?'); }
  arr.push('Quale ostacolo principale senti in questo scenario?');
  arr.push('Che risultato considereresti un successo entro 6–12 mesi?');
  return arr;
}
function mockAnswer(q, prefs, fu){
  const style = (prefs?.stile==='wtf')?'ironica e creativa':'plausibile e realistica';
  const time  = (prefs?.periodo==='past')?'sarebbe potuto accadere':'potrebbe accadere';
  const p = 55 + Math.floor(Math.random()*21) - 10; // 45–65
  const text = `In modo ${style}, ecco cosa ${time}: partendo da "${q}", emerge che ${fu?.[0]||'l’intento è chiaro'}, con il limite di ${fu?.[1]||'tempo/risorse'} e un successo come ${fu?.[2]||'stabilità e crescita'}. Prova 30 giorni con un micro-obiettivo misurabile, feedback esterno e check settimanale; poi rivaluta la direzione.`;
  return { text, p };
}
