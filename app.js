(function () {
  // --- Simple pager state (0..2) ---
  let page = 0;
  const screens = Array.from(document.querySelectorAll('.screen'));
  const dots = Array.from(document.querySelectorAll('.swipe-hint .dot'));

  function show(i){
    page = Math.max(0, Math.min(screens.length-1, i));
    screens.forEach((s,idx)=> s.hidden = idx!==page);
    dots.forEach((d,idx)=> d.classList.toggle('active', idx===page));
  }
  show(0);

  // Buttons [data-next]
  document.querySelectorAll('[data-next]').forEach(btn=>{
    btn.addEventListener('click', ()=> show(page+1));
  });

  // Swipe L/R
  let sx=0, sy=0, dragging=false;
  function start(e){ dragging=true; const t=e.touches?e.touches[0]:e; sx=t.clientX; sy=t.clientY; }
  function end(e){
    if(!dragging) return; dragging=false;
    const t=e.changedTouches?e.changedTouches[0]:e;
    const dx=t.clientX - sx, dy=t.clientY - sy;
    if(Math.abs(dx)>60 && Math.abs(dy)<80){
      if(dx<0) show(page+1); else show(page-1);
    }
  }
  window.addEventListener('touchstart', start, {passive:true});
  window.addEventListener('touchend', end);
  window.addEventListener('mousedown', start);
  window.addEventListener('mouseup', end);

  // --- Third screen logic (mock generator) ---
  const form = document.querySelector('#whatif-form');
  const out = document.querySelector('#result');
  if(form && out){
    form.addEventListener('submit', (e)=>{
      e.preventDefault();
      const fd = new FormData(form);
      const tense = fd.get('tense');                // past | future
      const mode  = fd.get('mode');                 // sliding | whataf
      let q = (fd.get('question')||'').trim();
      const notes = (fd.get('notes')||'').trim();
      if(!q) q = 'What?f I changed one big choice?';
      const age = fd.get('age')||'';
      const love = fd.get('love')||'';
      const tags = [...form.querySelectorAll('input[name="tags"]:checked')].map(c=>c.value);

      // seed semplice locale
      const seed = (q+tense+mode+age+love+tags.join(',')+notes).length;
      let prob = 40 + (seed % 60); // 40..99
      if(mode==='whataf'){ prob = Math.max(5, Math.min(95, prob- (seed%17) + 8)); }

      const title = mode==='sliding' ? 'Scenario realistico' : 'Scenario What the F?!';
      const core = q.replace(/^What\?f\s*/i,'').replace(/\?+$/,'');
      const extra = notes ? ` Dettagli personali considerati: ${notes}.` : '';

      const blurb = mode==='sliding'
        ? `In uno scenario ${tense==='past'?'alternativo passato':'plausibile futuro'}, è probabile che ${core}.${extra}`
        : `Nel multiverso bar-cosmico: ${core}… e potresti pure finire a brindare con degli sconosciuti simpatici!${extra}`;

      out.innerHTML = `
        <div class="card">
          <div class="card-hd">
            <h3>${title}</h3>
            <div class="pill">${prob}%</div>
          </div>
          <p class="blurb">${blurb}</p>
          <button class="primary" type="button" onclick="window.scrollTo({top:0,behavior:'smooth'})">Nuova domanda</button>
        </div>
      `;
      out.scrollIntoView({behavior:'smooth', block:'start'});
    });
  }
})();
