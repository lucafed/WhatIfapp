// /api/ask.js
export const config = { runtime: 'edge' };

function json(status, obj){ return new Response(JSON.stringify(obj), { status, headers: { 'content-type':'application/json' } }); }

// quick options per i chip
const QUICK_TONE = ['Breve', 'Dettagliata', 'Pratica'];
const QUICK_SCOPE = ['Solo vita personale', 'Solo lavoro/studio', 'Entrambe'];
const QUICK_HORIZON = ['1-3 mesi', '6-12 mesi', '2-3 anni'];

// Helper: se c'è OPENAI_API_KEY usa OpenAI
async function openaiChat(messages, mode='whatif'){
  const apiKey = process.env.OPENAI_API_KEY;
  if(!apiKey) return null; // nessuna chiave → caller gestirà fallback
  const sys = mode==='wtf'
    ? "Sei un assistente creativo/ironico. Rispondi con tono brillante ma coerente e utile."
    : "Sei un assistente riflessivo e realistico. Fornisci risposte plausibili, concrete e sintetiche.";
  const payload = {
    model: "gpt-4o-mini", // puoi cambiare in gpt-4o o 3.5-turbo se preferisci
    messages: [{role:"system", content:sys}, ...messages],
    temperature: mode==='wtf' ? 0.9 : 0.6,
    max_tokens: 350
  };
  const r = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{ "authorization":"Bearer "+apiKey, "content-type":"application/json" },
    body: JSON.stringify(payload)
  });
  if(!r.ok) throw new Error("OpenAI error");
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content?.trim() || "";
  return content;
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405,{error:'Method not allowed'});
  let body = {}; try { body = await req.json(); } catch { return json(400,{error:'Bad JSON'}); }

  const { action, sessionId, question, turn, transcript, period, mode, profile } = body || {};
  const MODE = mode || 'whatif';

  // 1) Avvio chiarimento
  if (action === 'clarify_start') {
    const q = (question||'').toLowerCase();
    let prompt = '';
    let quick = null;
    if (q.includes('lavor') || q.includes('carriera')) {
      prompt = 'Per capire meglio: settore/ruolo e orizzonte temporale che hai in mente?';
      quick = ['Settore attuale','Cambio settore','Manageriale','Autonomo/freelance'];
    } else if (q.includes('relaz') || q.includes('amore')) {
      prompt = 'Preferisci un taglio più riflessivo o pratico? Ti concentri sui prossimi mesi o più avanti?';
      quick = ['Riflessivo, prossimi mesi','Pratico, prossimi mesi','Riflessivo, lungo termine','Pratico, lungo termine'];
    } else {
      prompt = 'Vuoi una risposta breve/pratica o più articolata con alternative?';
      quick = QUICK_TONE;
    }
    return json(200,{ prompt, quick });
  }

  // 2) Turni successivi
  if (action === 'clarify_next') {
    const t = Number(turn||1);

    // se abbiamo già 2 turni → genera risposta finale
    if (t >= 2) {
      const baseQ = transcript?.find(x=>x.role==='user')?.content || (question || 'la tua domanda');
      // Prova con OpenAI se disponibile
      try{
        const messages = [
          { role:'user', content:
            `Domanda: ${baseQ}\nPeriodo: ${period==='past'?'Passato':'Futuro'}\nStile: ${MODE==='wtf'?'What the F (ironico)':'What if (plausibile)'}\nProfilo utente (facoltativo): ${JSON.stringify(profile||{})}\n` +
            `Scrivi una risposta breve (5–7 righe), personale, con percentuale motivata alla fine (es. "68% perché...").`
          }
        ];
        const answer = await openaiChat(messages, MODE);
        if (answer) return json(200,{ done:true, answer });
      }catch(_){ /* fallback sotto */ }

      // Fallback demo (senza chiave)
      const pLabel = period==='past' ? 'ipotizzando come sarebbe potuto andare' : 'ipotizzando cosa potrebbe accadere';
      const tone = MODE==='wtf'
        ? 'Tono creativo/ironico, con un twist inaspettato ma utile.'
        : 'Tono realistico e plausibile, con passi concreti.';
      const answer =
        `Scenario ${pLabel} partendo da “${baseQ}”. ${tone} `
        + `Valutando contesto e preferenze, una traiettoria coerente emerge con buone chance di risultato. `
        + `Probabilità stimata: 68% perché alcuni fattori chiave giocano a favore, a fronte di rischi gestibili.`;
      return json(200,{ done:true, answer });
    }

    // t === 1 → seconda domanda
    if (t === 1) {
      return json(200,{ done:false, prompt:'Inquadriamo il contesto: vita personale, lavoro/studio o entrambi?', quick: QUICK_SCOPE });
    }

    // t === 2 → (non dovremmo arrivare) ma mettiamo un’ultima
    return json(200,{ done:false, prompt:'Ultimo dettaglio: su quale orizzonte temporale vuoi che mi concentri?', quick: QUICK_HORIZON });
  }

  return json(400,{error:'Unknown action'});
}
