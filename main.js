(function(){
  const body = document.body;
  const go = href => { body.classList.add('leaving'); setTimeout(()=>location.href = href, 350); };

  // fade sui link “primari” (bottoni)
  document.querySelectorAll('a.btn, a[data-nav]').forEach(a=>{
    a.addEventListener('click', e=>{
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      e.preventDefault(); go(href);
    });
  });

  // swipe L/R su tutte le pagine
  let x0=null, y0=null, t0=0;
  const THRESH=55, VERT_GUARD=80, TIME=700;

  function onTouchStart(e){
    const t=e.touches[0]; x0=t.clientX; y0=t.clientY; t0=Date.now();
  }
  function onTouchEnd(e){
    if(x0==null) return;
    const t=e.changedTouches[0];
    const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
    x0=y0=null;

    if(Math.abs(dx)>THRESH && Math.abs(dy)<VERT_GUARD && dt<TIME){
      const prev = body.dataset.prev, next = body.dataset.next;
      if(dx<0 && next){ go(next); }        // swipe ← va avanti
      else if(dx>0 && prev){ go(prev); }   // swipe → torna indietro
    }
  }
  window.addEventListener('touchstart', onTouchStart, {passive:true});
  window.addEventListener('touchend', onTouchEnd, {passive:true});
})();
