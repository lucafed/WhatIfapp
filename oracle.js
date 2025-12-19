// FILE: /oracle.js
import { auth } from "./firebase.init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { bootCredits, getBalance, consumeCredit } from "./store/credits.js";

const LS = localStorage;
const $ = (id) => document.getElementById(id);
const readJSON = (k, def) => { try { return JSON.parse(LS.getItem(k) || JSON.stringify(def)); } catch { return def; } };
const writeJSON = (k, v) => LS.setItem(k, JSON.stringify(v));

const IS_ADMIN = (() => { try { return !!LS.getItem("admin_token"); } catch { return false; } })();

let currentBalance = 0;
let lang = (LS.getItem("lang") || "it").toLowerCase().slice(0,2);

function renderCredits(){
  const badge = $("creditsBadge");
  if (!badge) return;
  if (IS_ADMIN) badge.textContent = "Crediti: ∞ (admin)";
  else badge.textContent = `Crediti: ${currentBalance}`;
}

async function syncCredits(){
  if (IS_ADMIN){ currentBalance = Infinity; renderCredits(); return; }
  if (!auth.currentUser){ currentBalance = 0; renderCredits(); return; }
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
  if (IS_ADMIN) return true;
  if (!auth.currentUser){
    alert("Per usare l’Oracolo devi essere loggato.");
    location.href = "index.html";
    return false;
  }
  if (currentBalance <= 0){
    alert("Hai finito i crediti. Ricarica per continuare.");
    location.href = `store/credit-store.html?lang=${encodeURIComponent(lang)}`;
    return false;
  }
  return true;
}

// Stato scelta (4 click)
const state = {
  topic: null,     // "money" | "work" | "life" | "relationships" | "mind" | "world"
  effect: null,    // "fast" | "solid" | "risky" | "radical"
  channel: null,   // "online" | "people" | "app" | "cut" | "environment"
  tone: null       // "kind" | "no_mercy" | "chaos" | "zen"
};

function pick(group, value){
  state[group] = value;
  // evidenzia selezione
  document.querySelectorAll(`[data-group="${group}"] .chip`).forEach(b=>{
    b.classList.toggle("sel", b.dataset.val === value);
  });

  // abilita bottone finale se tutto scelto
  const ready = state.topic && state.effect && state.channel && state.tone;
  const btn = $("goOracle");
  if (btn) btn.disabled = !ready;
}

function wire(){
  // lingua
  try{
    lang = (LS.getItem("lang") || "it").toLowerCase().slice(0,2);
  }catch{}

  // voce: usa le prefs della tua app
  const prefs = readJSON("whatif_prefs", { stile:"whatif" });
  const voice = (prefs.stile === "wtf") ? "wtf" : "whatif";
  if ($("voiceBadge")) $("voiceBadge").textContent = voice === "wtf" ? "🎭 What the F" : "🎭 What if";

  // listeners chip
  ["topic","effect","channel","tone"].forEach(g=>{
    const box = $(`${g}Group`);
    if(!box) return;
    box.addEventListener("click", (e)=>{
      const btn = e.target.closest(".chip");
      if(!btn) return;
      pick(g, btn.dataset.val);
    });
  });

  // back/home
  const homeBtn = $("homeBtn"); if(homeBtn) homeBtn.onclick = ()=>location.href="index.html";
  const backBtn = $("backBtn"); if(backBtn) backBtn.onclick = ()=>history.length>1 ? history.back() : (location.href="index.html");

  // GO
  const go = $("goOracle");
  if(go){
    go.onclick = async ()=>{
      const ok = await guardCredits();
      if(!ok) return;

      // scala 1 credito
      if(!IS_ADMIN){
        const ok2 = await consumeCredit();
        if(!ok2){
          await syncCredits();
          alert("Crediti insufficienti.");
          return;
        }
        currentBalance = await getBalance().catch(()=>currentBalance);
        renderCredits();
      }

      go.disabled = true;
      go.textContent = "⏳...";

      try{
        const prefs = readJSON("whatif_prefs", { stile:"whatif" });
        const voiceNow = (prefs.stile === "wtf") ? "wtf" : "whatif";

        const res = await fetch("/api/suggest", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({
            mode: "oracle",
            ...state,
            voice: voiceNow,
            lang
          })
        });

        if(!res.ok) throw new Error("HTTP "+res.status);
        const data = await res.json();

        // salva risultato e vai in pagina risultato (riuso fifth)
        // (se vuoi una pagina dedicata, dimmelo e la facciamo)
        writeJSON("oracle_result", data);
        location.href = "oracle-result.html"; // <- se non la hai, leggi nota sotto
      }catch(err){
        console.error(err);
        alert("Errore nel responso. Riprova.");
      }finally{
        go.disabled = false;
        go.textContent = "🔮 Dimmi cosa fare";
      }
    };
  }
}

// bootstrap
onAuthStateChanged(auth, async ()=>{
  await syncCredits();
});

window.addEventListener("focus", syncCredits);
window.addEventListener("pageshow", syncCredits);

wire();
