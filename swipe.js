<script>
/*
  Uso:
  <script src="swipe.js" data-prev="index.html" data-next="second.html"></script>

  - data-prev: URL per tornare indietro (facoltativo sulla home)
  - data-next: URL per andare avanti
*/
(function(){
  const s = document.currentScript;
  const PREV = s?.dataset?.prev || null;
  const NEXT = s?.dataset?.next || null;

  let sx=0, sy=0, t=0;
  const TH = 60;           // soglia distanza
  const MAX_ANGLE = 25;    // tolleranza gradi per distinguere orizz/vert

  function angle(dx,dy){
    const a = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180/Math.PI;
    return a; // 0=perfettamente orizz, 90=perfettamente verticale
  }

  window.addEventListener('touchstart', (e)=>{
    const p=e.touches[0]; sx=p.clientX; sy=p.clientY; t=Date.now();
  }, {passive:true});

  window.addEventListener('touchend', (e)=>{
    const dt=Date.now()-t;
    const p=e.changedTouches[0];
    const dx=p.clientX-sx, dy=p.clientY-sy;
    if (dt>900) return; // swipe breve
    const a = angle(dx,dy);

    // ← BACK
    if (dx > TH && a < MAX_ANGLE && PREV){
      window.location.href = PREV; return;
    }
    // → NEXT
    if (dx < -TH && a < MAX_ANGLE && NEXT){
      window.location.href = NEXT; return;
    }
    // ↑ NEXT (swipe su quasi verticale)
    if (-dy > TH && (90-a) < MAX_ANGLE && NEXT){
      window.location.href = NEXT; return;
    }
  }, {passive:true});
})();
</script>
