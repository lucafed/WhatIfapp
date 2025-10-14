// /api/ask.js
// Edge API — restituisce SEMPRE { answer, followups, questions }
// e forza il tono giusto lato server con un sanitizer.

export const config = { runtime: 'edge' };

const SYS_TONES = {
  it: {
    whatif: `Tono: amico intelligente, empatico, asciutto. Zero malinconia, zero poesia.
Frasi brevi, concrete, con un filo di ironia elegante. Mai coach, mai sdolcinato.
Chiudi l’episodio con una micro-spinta sul “ci vediamo domani”.`,
    wtf: `Tono: bar brillante, sarcastico ma affettuoso, da amico lucido e divertente.
Battute intelligenti, ritmo veloce, alcolico quanto basta. Niente cattiveria, niente vittimismo.
Chiudi sempre con: "Clink. Stesso bancone, domani rimescoliamo."`
  },
  en: {
    whatif: `Tone: smart friend, empathetic, crisp. No sadness, no poetry.
Short, concrete lines, a touch of dry wit. Never preachy.`,
    wtf: `Tone: witty bar vibe, cheeky but warm. Punchy jokes, quick rhythm. End with: "Clink. Same counter, we reshuffle tomorrow."`
  }
};

// esempi “ancora meglio”
const FEW_SHOTS = {
  it: {
    whatif: [
      `Sai già che non lo faresti per nostalgia: è più un esperimento di equilibrio. All’inizio penseresti “che ci faccio qui?”, poi ti accorgeresti che respirare senza rumore non è male. Domani vediamo cosa succede quando inizi a sentirti di nuovo parte del posto.`,
      `Hai già gli indizi: ti serve spazio mentale, non un colpo di scena. Posti che ti mettono in asse senza chiederti nulla. Da lì, si riparte.`],
    wtf: [
      `Tornare all’Aquila? Aria fresca, montagne gratis e barista che ti dà del tu dopo due caffè. Ti siedi, ridi, qualcuno offre un giro. Non è nostalgia: è manutenzione emotiva con vista Gran Sasso. Clink. Stesso bancone, domani rimescoliamo.`,
      `Compra pure la moto: se va male hai almeno una scusa elegante per arrivare tardi. Se va bene, ti trovi un sorriso sotto il casco. Clink. Stesso bancone, domani rimescoliamo.`
    ]
  },
  en: { whatif: [], wtf: [] }
};

function ensureString(x){ return (typeof x === 'string' ? x : JSON.stringify(x||'')).trim(); }

// Post-process stile
function sanitize(style, text, lang='it'){
  let t = ensureString(text)
    .replace(/[“”«»]/g,'"')
    .replace(/\s+\n/g,'\n')
    .trim();

  // spezzatura in righe corte
  const lines = t.split(/\n+|(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);

  if(style==='wtf'){
    // taglia e rendi più punchy
    let out = lines.map(s=>{
      // togli zucchero e frasi tristi
      if(/(nostalgia|triste|mancanza|vuoto)/i.test(s)) return '';
      // stringhe lunghe -> accorcia
      if(s.length>140){ s = s.slice(0,120).replace(/[,;:]?[^.?!]*$/,'')+'.'; }
      return s;
    }).filter(Boolean);

    // evita doppioni della chiusura
    out = out.filter(s=>!/(Stesso bancone|rimescoliamo)/i.test(s));
    // massimo 8-12 righe
    out = out.slice(0,10);
    // chiusura obbligatoria
    out.push(lang==='en' ? 'Clink. Same counter, we reshuffle tomorrow.' : 'Clink. Stesso bancone, domani rimescoliamo.');
    return out.join('\n');
  }

  // WHATIF: asciutto, positivo
  let out = lines.map(s=>{
    if(/(tristezza|mancanza|vuoto|dolore)/i.test(s)) return '';
    if(s.length>160){ s = s.slice(0,140).replace(/[,;:]?[^.?!]*$/,'')+'.'; }
    return s;
  }).filter(Boolean);

  // 7–11 frasi
  out = out.slice(0,11);
  if(out.length<6 && FEW_SHOTS[lang]?.whatif?.length){
    out = [FEW_SHOTS[lang].whatif[0]];
  }
  // chiusura soft
  const end = lang==='en'
    ? 'Tomorrow we nudge it forward.'
    : 'Domani la spingiamo un passo avanti.';
  if(!out[out.length-1]?.match(/Domani|Tomorrow/i)) out.push(end);
  return out.join('\n');
}

// fallback followups dinamici
function buildFollowups(domanda, stile='whatif', lang='it'){
  const q = ensureString(domanda);
  const isIt = lang==='it';
  const base = [
    isIt ? `Qual è il primo segnale concreto che ti direbbe che "${q}" sta funzionando?`
         : `What is the first tangible signal that "${q}" is working?`,
    isIt ? `Cosa puoi testare nei prossimi 7 giorni con rischio quasi zero?`
         : `What can you test in the next 7 days with near-zero risk?`
  ];
  if(stile==='wtf'){
    base[0] = isIt ? `Quando capisci che non ti stai raccontando storie su "${q}"?`
                   : `When do you know you’re not fooling yourself about "${q}"?`;
    base[1] = isIt ? `Qual è il “colpo della casa” che puoi provare entro una settimana?`
                   : `What’s the “house special” you can try within a week?`;
  }
  return base;
}

// fallback domande di chiarimento
function buildClarify(domanda, periodo='future', lang='it'){
  const isIt = lang==='it';
  if(periodo==='past'){
    return isIt
      ? ['In che anno sarebbe cambiata la rotta?',
         'Dove e con chi eri allora?',
         'Che segnale ti avrebbe fatto capire che funzionava?']
      : ['Which year was the turning point?',
         'Where and with whom back then?',
         'Which signal would tell you it worked?'];
  }
  return isIt
    ? ['Finestra decisionale reale? (questo mese / 3–6 mesi)',
       `Un indicatore su "${domanda}" che puoi misurare entro 30 giorni?`,
       'Un vincolo concreto da non ignorare? (budget/tempo/energia)']
    : ['Your real decision window? (this month / 3–6 months)',
       `One indicator about "${domanda}" measurable within 30 days?`,
       'A concrete constraint you can’t ignore? (budget/time/energy)'];
}

async function callModel(prompt){
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_EDGE || '';
  if(!key) return null;
  try{
    const r = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'content-type':'application/json','authorization':`Bearer ${key}`},
      body:JSON.stringify({
        model:'gpt-4o-mini',
        messages:prompt,
        temperature:0.7,
        max_tokens:600
      })
    });
    if(!r.ok) return null;
    const j = await r.json();
    return j.choices?.[0]?.message?.content || '';
  }catch{
    return null;
  }
}

export default async function handler(req){
  try{
    const body = await req.json();
    const lang = (body.lang||'it').toLowerCase();
    const stile = (body.stile==='wtf') ? 'wtf' : 'whatif';
    const periodo = (body.periodo==='past') ? 'past' : 'future';
    const domanda = ensureString(body.domanda||'');
    const episodio = Number(body.episodio||1);
    const clarify = !!body.clarify;

    // Clarify only
    if(clarify){
      return new Response(JSON.stringify({
        ok:true,
        questions: buildClarify(domanda, periodo, lang)
      }), {headers:{'content-type':'application/json'}});
    }

    // Prompt
    const sys = SYS_TONES[lang]?.[stile] || SYS_TONES.it[stile];
    const few = FEW_SHOTS[lang]?.[stile] || FEW_SHOTS.it[stile] || [];
    const messages = [
      {role:'system', content: sys},
      ...few.slice(0,2).map(ex => ({role:'user', content: domanda}),),
      {role:'user', content:
`Domanda: ${domanda}
Periodo: ${periodo}
Episodio: ${episodio}
Lingua: ${lang}

Scrivi l’episodio in 7–12 righe. Non fare elenchi puntati. Non ripetere la domanda.
Se stile=wtf chiudi con 'Clink. Stesso bancone, domani rimescoliamo.'`
      }
    ];

    // tenta il modello
    let raw = await callModel(messages);
    if(!raw || raw.length<10){
      // fallback locale minimale
      raw = stile==='wtf'
        ? `Ok, ${domanda}? Mossa audace: meno rumore, più gusto. Fatti un giro di realtà, poi un giro al bancone. Clink. Stesso bancone, domani rimescoliamo.`
        : `Hai già gli indizi: ${domanda}. Non ti serve un colpo di scena, ma un passo giusto. Domani lo portiamo avanti.`;
    }

    const answer = sanitize(stile, raw, lang);
    const followups = buildFollowups(domanda, stile, lang);

    return new Response(JSON.stringify({ ok:true, answer, followups }), {
      headers:{'content-type':'application/json'}
    });
  }catch(e){
    return new Response(JSON.stringify({ ok:false, error:'server' }), { status:500, headers:{'content-type':'application/json'}});
  }
}
