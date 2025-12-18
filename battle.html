<!doctype html>
<html lang="it" data-theme="whatif">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>What?f — Battle</title>
  <meta name="theme-color" content="#0A0F14"/>

  <style>
    :root{
      --bg:#0B1018; --bg2:#0E1724; --card:#141C22;
      --fg:#F4F7FB; --muted:#A7B3C2;
      --accent:#1C57A0; --accent2:#FFEC01; --ink:#11110A;
      --chip:#0F1820; --line:#1B2A34;
      --shadow:rgba(0,0,0,.35);
    }
    html[data-theme="wtf"]{
      --bg:#0B0B0C; --bg2:#101414; --card:#111713;
      --fg:#EEF5F0; --muted:#A6B6AD;
      --accent:#3A6B56; --accent2:#5A8C75; --ink:#06110B;
      --chip:#0F1714; --line:#21322A;
    }
    *{box-sizing:border-box}
    html,body{
      height:100%;margin:0;
      background:radial-gradient(900px 700px at 25% 20%, var(--bg2) 0%, var(--bg) 60%);
      color:var(--fg);
      font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
      -webkit-font-smoothing:antialiased;
    }

    .topbar{
      position:sticky;top:0;z-index:10;
      display:flex;align-items:center;justify-content:space-between;gap:10px;
      padding:8px 10px;
      background:rgba(10,15,20,.96);
      backdrop-filter:blur(6px);
      border-bottom:1px solid var(--line);
    }
    .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}

    .btn{
      appearance:none;border:1px solid var(--line);
      background:var(--chip);color:var(--fg);
      border-radius:12px;padding:8px 12px;font-weight:700;cursor:pointer;
    }
    .btn.primary{
      background:linear-gradient(180deg,var(--accent),var(--accent2));
      color:var(--ink);border:none;box-shadow:0 10px 26px var(--shadow);
    }
    .btn[disabled]{opacity:.4;cursor:not-allowed}

    .badge{
      background:var(--chip);border:1px solid var(--line);
      border-radius:999px;padding:6px 10px;font-size:12px;color:#d7e8ec;white-space:nowrap;
    }

    main{min-height:100%;display:flex;flex-direction:column;align-items:center;gap:14px;padding:10px 14px 26px}
    .wrap{width:min(100%,980px)}
    h1{margin:10px 0 6px;font-size:clamp(24px,6vw,36px);color:var(--accent)}
    .small{font-size:12px;color:var(--muted)}
    .card{
      background:var(--card);
      border:1px solid var(--line);
      border-radius:16px;
      padding:16px;
      margin:10px 0;
      backdrop-filter:blur(12px);
    }

    .chips{display:flex;flex-wrap:wrap;gap:8px}
    .chip{
      background:var(--chip);border:1px solid var(--line);
      color:#eaf3ee;border-radius:999px;padding:8px 12px;
      font-size:13px;cursor:pointer;
      white-space:normal;word-break:break-word;line-height:1.3;
    }
    .chip.sel{
      background:linear-gradient(180deg,var(--accent),var(--accent2));
      color:var(--ink);font-weight:800;
    }

    .input{
      width:100%;background:rgba(255,255,255,.06);color:#EAF3EE;
      border:1px solid var(--line);border-radius:12px;
      padding:14px;font-size:17px;
    }

    .result{
      border:1px solid var(--line);
      border-radius:14px;
      padding:14px;
      background:rgba(255,255,255,.04);
      margin-top:12px;
      display:none;
    }
    .winner{font-weight:900;font-size:18px}
    .reason{margin-top:8px;line-height:1.5}
    .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}

    .err{color:#ffb3b3;font-size:13px;font-weight:800;min-height:18px;margin-top:10px}
    a.link{color:var(--accent2);text-decoration:none;font-weight:800}
  </style>
</head>

<body>
  <div class="topbar">
    <div class="row">
      <button class="btn" id="backBtn" type="button">←</button>
      <button class="btn" id="homeBtn" type="button">🏠</button>
    </div>
    <div class="row">
      <span class="badge" id="styleBadge">🎭 —</span>
      <span class="badge" id="creditsBadge">Crediti: —</span>
      <button class="btn" id="buyBtn" type="button">🛒 Crediti</button>
    </div>
  </div>

  <main>
    <div class="wrap">
      <h1>⚔️ Battle</h1>
      <div class="small">Ogni giudizio scala 1 credito.</div>

      <div class="card">
        <div class="small" style="margin-bottom:8px;font-weight:900;color:var(--accent2)">Categoria</div>
        <div class="chips" id="catChips">
          <button class="chip sel" data-cat="persone">🧑‍🤝‍🧑 Persone</button>
          <button class="chip" data-cat="cose">🍕 Cose</button>
          <button class="chip" data-cat="scelte">🧠 Scelte</button>
        </div>
      </div>

      <div class="card">
        <div class="small" style="margin-bottom:6px;font-weight:900;color:var(--accent2)">A</div>
        <input class="input" id="aInput" placeholder="Es: Pizza / Io / Rischiare" autocomplete="off"/>

        <div style="height:10px"></div>

        <div class="small" style="margin-bottom:6px;font-weight:900;color:var(--accent2)">B</div>
        <input class="input" id="bInput" placeholder="Es: Sushi / Il mio amico / Accontentarsi" autocomplete="off"/>

        <div class="row" style="justify-content:space-between;margin-top:12px">
          <button class="btn primary" id="judgeBtn" type="button">✨ Giudica</button>
          <a class="link" href="store/credit-store.html" id="storeLink">Compra crediti</a>
        </div>

        <div class="err" id="err"></div>

        <div class="result" id="resultBox">
          <div class="winner" id="winnerLine"></div>
          <div class="reason" id="reasonLine"></div>
          <div class="small" id="tagLine" style="margin-top:8px;font-weight:800"></div>
          <div class="actions">
            <button class="btn" id="copyBtn" type="button">📋 Copia</button>
            <button class="btn" id="shareBtn" type="button">📤 Condividi</button>
            <button class="btn" id="againBtn" type="button">🔁 Ancora</button>
          </div>
        </div>
      </div>
    </div>
  </main>

  <script type="module">
    import { auth } from "./firebase.init.js";
    import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

    import {
      bootCredits,
      getBalance,
      consumeCredit
    } from "./store/credits.js";

    const LS = localStorage;
    const $ = (id)=>document.getElementById(id);

    const IS_ADMIN = !!LS.getItem("admin_token");
    let prefs = {};
    try{ prefs = JSON.parse(LS.getItem("whatif_prefs")||"{}") || {}; }catch{ prefs = {}; }

    // tema coerente
    document.documentElement.setAttribute("data-theme", (prefs.stile === "wtf") ? "wtf" : "whatif");
    $("styleBadge").textContent = "🎭 " + (prefs.stile === "wtf" ? "What the F" : "What if");

    // nav
    $("homeBtn").onclick = ()=> location.href = "index.html";
    $("backBtn").onclick = ()=>{
      if(history.length>1) history.back();
      else location.href = "index.html";
    };

    // store link con lang
    function getLang(){
      const l = (LS.getItem("lang") || document.documentElement.lang || "it").toLowerCase();
      return ["it","en","es","fr","de"].includes(l) ? l : "it";
    }
    function goStore(){
      const lang = encodeURIComponent(getLang());
      location.href = `store/credit-store.html?lang=${lang}`;
    }
    $("buyBtn").onclick = goStore;
    $("storeLink").onclick = (e)=>{ e.preventDefault(); goStore(); };

    // categorie
    let category = "persone";
    $("catChips").addEventListener("click",(e)=>{
      const b = e.target.closest(".chip");
      if(!b) return;
      document.querySelectorAll("#catChips .chip").forEach(x=>x.classList.remove("sel"));
      b.classList.add("sel");
      category = b.dataset.cat || "persone";
    });

    // credits state
    let currentBalance = 0;

    function setErr(t){ $("err").textContent = t || ""; }
    function renderCredits(){
      if(IS_ADMIN){
        $("creditsBadge").textContent = "Crediti: ∞ (admin)";
        return;
      }
      $("creditsBadge").textContent = "Crediti: " + currentBalance;
    }

    async function syncCredits(){
      if(IS_ADMIN){
        renderCredits();
        return;
      }
      if(!auth.currentUser){
        currentBalance = 0;
        renderCredits();
        return;
      }
      try{
        await bootCredits();
        currentBalance = await getBalance();
      }catch(e){
        console.error("syncCredits error:", e);
        currentBalance = 0;
      }
      renderCredits();
    }

    async function guardCredits(){
      if(IS_ADMIN) return true;

      if(!auth.currentUser){
        alert("Per usare i crediti devi essere loggato.");
        return false;
      }
      if(currentBalance <= 0){
        alert("Hai finito i crediti. Ricarica per continuare.");
        goStore();
        return false;
      }
      return true;
    }

    function shareText(d){
      return `⚔️ Battle\nA: ${d.a}\nB: ${d.b}\n🏆 Vince: ${d.winner}\n${d.reason}\n${d.tagline ? "— " + d.tagline : ""}`;
    }

    let last = null;

    async function runBattle(){
      setErr("");
      const a = ($("aInput").value||"").trim();
      const b = ($("bInput").value||"").trim();
      if(!a || !b){ setErr("Inserisci A e B."); return; }

      const ok = await guardCredits();
      if(!ok) return;

      // ✅ consuma 1 credito prima della richiesta
      if(!IS_ADMIN){
        try{
          const ok2 = await consumeCredit();
          if(!ok2){
            await syncCredits();
            alert("Hai finito i crediti. Ricarica per continuare.");
            goStore();
            return;
          }
          currentBalance = await getBalance().catch(()=>currentBalance);
          renderCredits();
        }catch(e){
          console.error("consumeCredit error:", e);
          setErr("Errore nell'utilizzo dei crediti. Riprova.");
          return;
        }
      }

      const btn = $("judgeBtn");
      btn.disabled = true;
      btn.textContent = "⏳...";

      try{
        const res = await fetch("/api/battle",{
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ a, b, category })
        });
        const data = await res.json().catch(()=>({}));

        if(!res.ok){
          // se vuoi: qui potresti rimborsare credito (server-side) ma serve endpoint apposito.
          setErr("Errore Battle. Riprova.");
          return;
        }

        last = { ...data, a, b };

        $("winnerLine").textContent = "🏆 Vince: " + (data.winner || "—");
        $("reasonLine").textContent  = data.reason || "";
        $("tagLine").textContent     = data.tagline ? `“${data.tagline}”` : "";
        $("resultBox").style.display = "block";
      }catch(e){
        console.error(e);
        setErr("Errore rete. Riprova.");
      }finally{
        btn.disabled = false;
        btn.textContent = "✨ Giudica";
      }
    }

    $("judgeBtn").onclick = runBattle;

    $("copyBtn").onclick = async ()=>{
      if(!last) return;
      try{
        await navigator.clipboard.writeText(shareText(last));
        setErr("Copiato!");
        setTimeout(()=>setErr(""),900);
      }catch{ setErr("Impossibile copiare."); }
    };

    $("shareBtn").onclick = async ()=>{
      if(!last) return;
      const text = shareText(last);
      if(navigator.share){
        try{ await navigator.share({ text }); }catch{}
      }else{
        try{
          await navigator.clipboard.writeText(text);
          setErr("Testo copiato (incolla dove vuoi).");
          setTimeout(()=>setErr(""),1200);
        }catch{ setErr("Condivisione non supportata."); }
      }
    };

    $("againBtn").onclick = ()=>{
      $("resultBox").style.display = "none";
      $("aInput").value = "";
      $("bInput").value = "";
      setErr("");
      $("aInput").focus();
    };

    onAuthStateChanged(auth, async ()=>{
      await syncCredits();
    });
    window.addEventListener("focus", syncCredits);
    window.addEventListener("pageshow", syncCredits);

    // init
    await syncCredits();
  </script>
</body>
</html>
