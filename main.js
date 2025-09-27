// -- SUGGERIMENTI per passato/futuro
const SUGGESTIONS = {
  past: [
    "…non avessi lasciato quel lavoro?",
    "…avessi chiamato quella persona?",
    "…mi fossi trasferito/a in un'altra città?",
    "…non avessi interrotto quell’università?",
    "…avessi detto sì a quell’occasione?",
  ],
  future: [
    "…apressi quella porta adesso?",
    "…cambiassi lavoro entro 6 mesi?",
    "…mi trasferissi a vivere all’estero?",
    "…iniziassi quel progetto domani?",
    "…dicessi sì a quella proposta?",
  ]
};

// Utility
function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return [...root.querySelectorAll(sel)]; }
function saveFormToStorage(data){ localStorage.setItem("whatif.form", JSON.stringify(data)); }
function loadForm(){ try{ return JSON.parse(localStorage.getItem("whatif.form")||"{}"); }catch{ return {}; } }

// Pagina 3 (form)
if (document.body.classList.contains('screen--form')) {
  const timeSeg = $('#timeSegment');
  const scenChips = $('#scenarioChips');
  const suggBox = $('#suggestions');
  const name = $('#name'), age = $('#age'), gender = $('#gender'),
        city = $('#city'), domain = $('#domain'), context = $('#context'),
        question = $('#question'), goBtn = $('#goBtn');

  let time = 'past';
  let scenario = 'sliding';

  // init suggestions
  renderSuggestions(time);

  timeSeg.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    $all('button', timeSeg).forEach(b=>b.classList.remove('is-active'));
    btn.classList.add('is-active');
    time = btn.dataset.time;
    renderSuggestions(time);
  });

  scenChips.addEventListener('click', (e)=>{
    const chip = e.target.closest('.chip');
    if(!chip) return;
    $all('.chip', scenChips).forEach(c=>c.classList.remove('is-active'));
    chip.classList.add('is-active');
    scenario = chip.dataset.scen;
  });

  function renderSuggestions(mode){
    suggBox.innerHTML = '';
    SUGGESTIONS[mode].forEach(text=>{
      const b = document.createElement('button');
      b.type='button';
      b.className='chip';
      b.textContent = 'What?f ' + text;
      b.addEventListener('click', ()=>{ question.value = ('What?f ' + text).replace(/^What\?f\s*/,''); });
      suggBox.appendChild(b);
    });
  }

  goBtn.addEventListener('click', ()=>{
    const q = question.value.trim();
    if(!q){ alert("Scrivi la tua domanda dopo 'What?f'…"); question.focus(); return; }

    const data = {
      time, scenario,
      name: name.value.trim(),
      age: age.value,
      gender: gender.value,
      city: city.value.trim(),
      domain: domain.value,
      context: context.value.trim(),
      question: q
    };
    saveFormToStorage(data);
    location.href = 'fourth.html';
  });
}

// Pagina 4 (risultato)
if (document.body.classList.contains('screen--result')) {
  const data = loadForm();
  const badgeScenario = $('#badgeScenario');
  const badgeTime = $('#badgeTime');
  const prob = $('#prob');
  const answer = $('#answer');

  const scenarioLabel = data.scenario === 'sliding' ? 'Sliding Doors' : 'What the F?!';
  const timeLabel = data.time === 'past' ? 'Passato' : 'Futuro';
  badgeScenario.textContent = scenarioLabel;
  badgeTime.textContent = timeLabel;

  // Probabilità (semplice, ma coerente)
  const base = data.scenario === 'sliding' ? 0.62 : 0.55;
  const rand = (Math.sin((data.question.length + (data.city||'x').length) * 17.7) + 1)/2; // 0..1 pseudo
  const p = Math.round((base + rand*0.25) * 100 * 0.9); // limiti + lieve abbassamento
  prob.textContent = `Probabilità stimata: ${Math.min(95, Math.max(35, p))}%`;

  // Generatore risposta ~10 righe
  const lines = generateAnswer(data);
  answer.textContent = lines.join('\n\n');
}

function generateAnswer(d){
  const you = d.name ? d.name : "Tu";
  const city = d.city || "la tua città";
  const tVerb = d.time === 'past' ? "se avessi" : "se decidessi di";
  const domain = d.domain || "la tua vita";
  const ctx = d.context ? `Partendo dal contesto che descrivi (“${d.context}”), ` : "";
  const q = d.question;

  if (d.scenario === 'sliding') {
    // Realistico
    return [
      `${you}, ecco una possibile traiettoria ${d.time === 'past' ? "alternativa" : "futura"} per ${domain} ${d.time === 'past' ? "(Sliding Doors)" : "(Sliding Doors)"}:`,
      `${ctx}immaginiamo cosa accadrebbe ${tVerb} ${q}.`,
      `Nel breve periodo incontreresti qualche resistenza: abitudini, vincoli pratici e aspettative sociali a ${city} non sono banali.`,
      `Tuttavia entro 2–3 mesi emergerebbero primi segnali concreti: piccole vittorie, nuovi contatti e una maggiore chiarezza di priorità.`,
      `Il tuo profilo (${d.age}, pronomi: ${d.gender}) suggerisce una buona capacità di adattamento e di apprendimento.`,
      `Sul piano emotivo ti sentiresti più allineato/a, con oscillazioni fisiologiche dovute al cambiamento ma una media in crescita.`,
      `Nell’ambito “${domain}” vedresti esiti tangibili: obiettivi meglio definiti e decisioni più rapide.`,
      `L’ecosistema locale di ${city} offre opportunità che potresti intercettare grazie alla spinta iniziale.`,
      `Dovresti però presidiare due rischi: dispersione (troppe direzioni) e sovraccarico (aspettative alte in poco tempo).`,
      `In sintesi: scelta impegnativa ma coerente con ciò che stai cercando; con una mappa minima e rituali di verifica mensili, le probabilità di esito positivo aumentano sensibilmente.`
    ];
  } else {
    // What the F?! (ironico ma coerente)
    return [
      `${you}, benvenuto/a nella versione “What the F?!” di ${domain}:`,
      `${ctx}poniamo ${tVerb} ${q}. A ${city} succede l’imprevedibile (ma stranamente plausibile).`,
      `Nel giro di una settimana, incontri una persona che diventa il tuo “complice di serendipità” e innesca eventi a catena.`,
      `Un’occasione bizzarra si presenta proprio quando stavi per rinunciare: accetti… e l’assurdo inizia a funzionare.`,
      `Il mix ${d.age} / pronomi ${d.gender} qui esplode in creatività: ti inventi soluzioni fuori schema che fanno sorridere ma, sorpresa, tengono in piedi il sistema.`,
      `Nell’ambito “${domain}” fai due mosse imprevedibili: la prima sembra un azzardo, la seconda allinea gli astri.`,
      `Gli amici restano perplessi, poi ti imitano; qualcuno storce il naso, ma i risultati iniziano a parlare.`,
      `Nel frattempo impari un trucco: coltivare routine minime per incanalare il caos in energia utile.`,
      `La città di ${city} diventa la tua scenografia: bar, luci, coincidenze, e piccoli sì che aprono porte.`,
      `Morale: dietro il paradosso c’è una direzione; se accetti di “giocare serio”, questo percorso folle potrebbe rivelarsi sorprendentemente tuo.`
    ];
  }
}
