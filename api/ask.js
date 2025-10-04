// /api/ask.js
export const config = { runtime: 'edge' };

function json(status, obj){ return new Response(JSON.stringify(obj), { status, headers: { 'content-type':'application/json' } }); }

const QUICK_TONE = ['Breve', 'Dettagliata', 'Pratica'];
const QUICK_SCOPE = ['Solo vita personale', 'Solo lavoro/studio', 'Entrambe'];
const QUICK_HORIZON = ['1-3 mesi', '6-12 mesi', '2-3 anni'];

export default async function handler(req) {
  if (req.method !== 'POST') return json(405,{error:'Method not allowed'});
  let body = {};
  try { body = await req.json(); } catch { return json(400,{error:'Bad JSON'}); }

  const { action, sessionId, question, turn, transcript, period, mode } = body || {};

  // ── 1) avvio chiarimento ──────────────────────────────────────────────────────
  if (action === 'clarify_start') {
    // prima domanda adattata in modo semplice al testo
    const q = (question||'').toLowerCase();
    let prompt = '';
    let quick = null;

    if (q.includes('lavor') || q.includes('carriera')) {
      prompt = 'Per orientarmi meglio: quale settore/ruolo ti interessa di più e con che orizzonte temporale?';
      quick = ['Settore attuale','Cambio settore','Manageriale','Autonomo/freelance'];
    } else if (q.includes('relaz') || q.includes('amore')) {
      prompt = 'Vuoi un taglio più riflessivo o pratico? Preferisci concentrarti sui prossimi mesi o su un quadro più ampio?';
      quick = ['Riflessivo, prossimi mesi','Pratico, prossimi mesi','Riflessivo, lungo termine','Pratico, lungo termine'];
    } else {
      prompt = 'Ti va di dirmi se vuoi una risposta breve/pratica o più articolata e con alternative?';
      quick = QUICK_TONE;
    }

    return json(200,{ prompt, quick });
  }

  // ── 2) turni successivi di chiarimento ───────────────────────────────────────
  if (action === 'clarify_next') {
    const t = Number(turn||1);

    // dopo 2 chiarimenti → fine con risposta sintetica
    if (t >= 2) {
      const baseQ = (transcript?.find(x=>x.role==='user')?.content)||'la tua domanda';
      const pLabel = period==='past' ? 'ipotizzando come sarebbe potuto andare' : 'ipotizzando cosa potrebbe accadere';
      const style = mode==='wtf'
        ? 'Ton0 creativo/ironico, con un twist inaspettato ma coerente.'
        : 'Tono realistico, concreto e plausibile.';
      const answer =
        `Ecco una possibile traiettoria ${pLabel} partendo da “${baseQ}”. `
        + (mode==='wtf'
            ? 'Immagina una sequenza di eventi improbabili ma non impossibili che ti spingono fuori rotta — e proprio lì trovi uno spunto inatteso.'
            : 'Scandisco i passaggi in obiettivi, scelte e rischi: breve, medio e lungo termine, con esempi pratici e trade-off chiari.');

      return json(200,{ done:true, answer });
    }

    // domanda 2 di chiarimento (con quick)
    if (t === 1) {
      return json(200,{ done:false, prompt:'Inquadriamo il contesto: preferisci concentrarti su vita personale, lavoro/studio o entrambi?', quick: QUICK_SCOPE });
    }

    // fallback
    return json(200,{ done:false, prompt:'Ultimo dettaglio: su quale orizzonte temporale vuoi che mi concentri?', quick: QUICK_HORIZON });
  }

  return json(400,{error:'Unknown action'});
}
