// === IMPORT per Auth e crediti ===
import { getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { bootCredits, getBalance, consumeCredit, addCredits, grantAdCredit } from "./store/credits.js";

// persistenza login (resti loggato)
const auth = getAuth();
setPersistence(auth, browserLocalPersistence).catch(()=>{});

// badge in pagina (aggiungi <span id="credits-badge">0</span> nel tuo HTML)
function updateCreditsBadge(n) {
  const el = document.querySelector("#credits-badge");
  if (el) el.textContent = String(n);
  console.log("Crediti attuali:", n);
}

// al login: crea doc se manca + ricarica se giorno nuovo + mostra saldo
onAuthStateChanged(auth, async (user) => {
  if (!user) { updateCreditsBadge(0); return; }
  try {
    await bootCredits();
    const bal = await getBalance();
    updateCreditsBadge(bal);
  } catch (e) {
    console.error("boot crediti:", e);
  }
});


// === IL TUO CODICE ESISTENTE ===
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
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();

      // 🔻 CONSUMA 1 CREDITO — se finiti, apri Store e non proseguire
      try {
        const ok = await consumeCredit();
        if (!ok) {
          openCreditStore();
          return;
        }
      } catch (err) {
        console.error("consumeCredit error:", err);
        alert("Per usare i crediti devi essere loggato.");
        return;
      }

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

      // 🔹 aggiorna il badge dopo il consumo
      try {
        const bal = await getBalance();
        updateCreditsBadge(bal);
      } catch {}

      out.scrollIntoView({behavior:'smooth', block:'start'});
    });
  }
})();


// === OVERLAY STORE: /store/credit-store.html ===
let overlayFrame = null;
function openCreditStore() {
  if (overlayFrame) return;
  const back = document.createElement("div");
  back.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);z-index:9998";
  back.addEventListener("click", close);

  overlayFrame = document.createElement("iframe");
  overlayFrame.src = "/store/credit-store.html?lang=it";   // <-- percorso del tuo file store
  overlayFrame.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(520px,92vw);height:360px;border:0;border-radius:16px;z-index:9999;box-shadow:0 20px 60px rgba(0,0,0,.6)";

  document.body.append(back, overlayFrame);

  function close(){
    window.removeEventListener("message", onMsg);
    overlayFrame?.remove(); overlayFrame=null; back.remove();
  }

  async function onMsg(ev){
    const data = ev.data || {};
    if (data.type === "close_overlay") {
      close();
    }
    else if (data.type === "purchase_completed") {
      // +N crediti (test: 5 di default)
      try {
        const amount = Number(data.amount || 5);
        await addCredits(amount);
        const bal = await getBalance();
        updateCreditsBadge(bal);
        alert(`+${amount} crediti aggiunti ✅`);
      } catch (e) {
        console.error("purchase_completed error:", e);
        alert("Errore nell'aggiunta crediti.");
      }
    }
    else if (data.type === "open_rewarded") {
      // per ora: +1 immediato; in futuro aggancia il vero SDK Ads
      try {
        const r = await grantAdCredit(); // rispetta il cap giornaliero
        if (r?.ok) {
          const bal = await getBalance();
          updateCreditsBadge(bal);
          alert("+1 credito ottenuto ✅");
        } else {
          alert("Limite video di oggi raggiunto.");
        }
      } catch (e) {
        console.error("reward error:", e);
        alert("Errore nel reward.");
      }
    }
  }

  window.addEventListener("message", onMsg);
}
