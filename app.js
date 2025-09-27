(() => {
  const screens = [...document.querySelectorAll('.screen')];
  let current = 0;

  const dots = () => {
    const rows = document.querySelectorAll('.dots');
    rows.forEach(() => {
      document.querySelectorAll('.dot').forEach((d, idx) => {
        // noop; gestito per sezione alla render
      });
    });
    // aggiorna le dot attive per ogni sezione
    document.querySelectorAll('.screen').forEach((s, i) => {
      const row = s.querySelector('.dots');
      if (!row) return;
      row.querySelectorAll('.dot').forEach((d, idx) => d.classList.toggle('active', idx === current));
    });
  };

  const goTo = (idx, dir = 1) => {
    if (idx < 0 || idx >= screens.length || idx === current) return;
    const prev = current;
    current = idx;
    screens.forEach((s, i) => {
      s.classList.remove('active', 'exit-left', 'exit-right');
      if (i === prev) s.classList.add(dir > 0 ? 'exit-left' : 'exit-right');
    });
    requestAnimationFrame(() => {
      screens[current].classList.add('active');
      dots();
    });
  };

  document.querySelectorAll('[data-next]').forEach(btn =>
    btn.addEventListener('click', () => goTo(current + 1, +1))
  );

  // Swipe
  let startX = null;
  window.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, {passive:true});
  window.addEventListener('touchmove', (e) => {
    if (startX === null) return;
    const dx = e.touches[0].clientX - startX;
    if (Math.abs(dx) > 60) {
      goTo(current + (dx < 0 ? 1 : -1), dx < 0 ? +1 : -1);
      startX = null;
    }
  }, {passive:true});
  window.addEventListener('touchend', () => { startX = null; });

  // Toggles
  const timeToggle = document.getElementById('timeToggle');
  const scenarioToggle = document.getElementById('scenarioToggle');
  let time = 'past', scenario = 'sliding';

  timeToggle?.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    [...timeToggle.children].forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    time = e.target.dataset.time;
  });
  scenarioToggle?.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    [...scenarioToggle.children].forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    scenario = e.target.dataset.scenario;
  });

  // Chips → riempiono input
  const input = document.getElementById('questionInput');
  document.getElementById('quickChips')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    input.value = btn.dataset.q || '';
    input.focus();
  });

  // Generazione demo (mock) — una sola risposta, NON doppia
  const goBtn = document.getElementById('goBtn');
  const resultBox = document.getElementById('result');
  const resultText = document.getElementById('resultText');
  const probBadge = document.getElementById('probBadge');

  const pick = (arr) => arr[Math.floor(Math.random()*arr.length)];
  const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));

  const genProbability = () => {
    let base = scenario === 'sliding' ? 58 : 47;
    base += (time === 'future' ? 8 : -2);
    base += (input.value.toLowerCase().includes('bar') ? 7 : 0);
    return clamp(Math.round(base + (Math.random()*18-9)), 12, 96);
  };

  const buildAnswer = () => {
    const q = input.value.trim() || '…se provassi davvero a cambiare rotta?';
    if (scenario === 'sliding') {
      return `Scenario realistico per ${time === 'past' ? 'il passato' : 'il futuro'}: partendo da "${q}", la traiettoria più plausibile prevede piccoli step misurabili. Concentrati su una scelta chiave, pianifica i primi 7 giorni e verifica i segnali deboli.`;
    } else {
      return `Versione “What the F?!”: ${time === 'past' ? 'se avessi aperto quell’altra porta' : 'se aprissi ora quella porta'} succederebbe il caos buono: ${pick(['un cameo improbabile','una serata in un bar al neon','un colpo di fortuna insensato','un reset karmico'])}.`;
    }
  };

  goBtn?.addEventListener('click', () => {
    const prob = genProbability();
    probBadge.textContent = prob + '%';
    resultText.textContent = buildAnswer();
    resultBox.classList.remove('hidden');
    resultBox.scrollIntoView({behavior:'smooth', block:'start'});
  });

  // Avvio
  dots();
})();
