// ask.js (client) – accanto a third.html e fourth.html
const ENDPOINT = "/.netlify/functions/ask";
const STORE_BASE  = "whatf_base_v1";
const STORE_FINAL = "whatf_final_v1";

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.classList.contains("third"))  setupThird();
  if (document.body.classList.contains("fourth")) setupFourth();
});

/* -------- Pagina 3 -------- */
function setupThird(){
  const form = document.getElementById("questionForm");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const base = {
      name:      get("#name"),
      gender:    get("#gender"),
      location:  get("#location"),
      time:      get("#time"),
      question:  ensureWhatf((get("#mainQuestion")||"").trim()),
      mode:      localStorage.getItem("whatf_mode") || "sliding", // impostata in pagina 2
    };
    if (!base.gender || !base.question) {
      alert("Compila almeno Genere e la tua Domanda.");
      return;
    }
    sessionStorage.setItem(STORE_BASE, JSON.stringify(base));
    location.href = "fourth.html";
  });
}

/* -------- Pagina 4 -------- */
async function setupFourth(){
  const base = loadBase();
  if (!base) { location.href = "third.html"; return; }

  const fuBox  = qs("#followUp");
  const outBox = qs("#aiResponse");
  const share  = qs("#shareBtn");

  // 1) chiedi follow-up dinamici all'AI
  setLoading(fuBox, "Sto preparando domande mirate sulla tua richiesta…");
  let followups = [];
  try {
    const r = await post({ step: "followups", user: base, mode: base.mode, question: base.question });
    followups = r.followups || [];
  } catch (e) {
    console.error(e);
    fuBox.innerHTML = `<p class="error">Non riesco a generare domande. Riprova.</p>`;
    return;
  }

  // 2) mostra form → invia le risposte e ottieni la risposta finale
  renderFollowForm(fuBox, followups, async (answers) => {
    setLoading(outBox, "Sto generando la tua risposta…");
    try {
      const res = await post({
        step: "final",
        mode: base.mode,
        user: { name: base.name, gender: base.gender, location: base.location, time: base.time },
        question: base.question,
        answers
      });
      sessionStorage.setItem(STORE_FINAL, JSON.stringify(res));
      renderFinal(outBox, res, base);
    } catch (e) {
      console.error(e);
      outBox.innerHTML = `<p class="error">Errore: non riesco a generare la risposta.<br><small>${e.message||""}</small></p>`;
    }
  });

  // 3) share
  share?.addEventListener("click", () => {
    const final = loadFinal();
    const text = final ? [
      "✨ Il mio What?f ✨",
      `Q: ${base.question}`,
      "",
      final.answer,
      "",
      `Confidenza: ${final.score}%`,
      final.reason && `Perché: ${final.reason}`,
      "",
      "#WhatIf #WhatfApp",
    ].filter(Boolean).join("\n") : "Prova anche tu What?f!";
    shareText(text);
  });

  // se ricarichi
  const final = loadFinal();
  if (final) renderFinal(outBox, final, base);
}

/* -------- UI helpers -------- */
function renderFollowForm(container, followups, onSubmit){
  container.innerHTML = "";
  const form = document.createElement("form");
  form.className = "followup-form";
  followups.slice(0,3).forEach((q, i) => {
    const wrap = document.createElement("div");
    wrap.className = "followup-item";
    const lab = document.createElement("label");
    lab.textContent = q;
    lab.htmlFor = `fu_${i}`;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.id = `fu_${i}`;
    inp.required = true;
    wrap.appendChild(lab);
    wrap.appendChild(inp);
    form.appendChild(wrap);
  });
  const btn = document.createElement("button");
  btn.type = "submit";
  btn.className = "primary";
  btn.textContent = "Chiedi alla IA";
  form.appendChild(btn);
  container.appendChild(form);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const answers = Array.from(form.querySelectorAll("input")).map(i => i.value.trim());
    onSubmit(answers);
  });
}

function renderFinal(container, res, base){
  container.innerHTML = `
    <div class="result-head">
      <div class="badge">${base.mode === "wtf" ? "What the F?!" : "Sliding Doors"}</div>
      <div class="score">Confidenza: <strong>${Number(res.score||0)}%</strong></div>
    </div>
    <div class="response-text">${escape(res.answer).replace(/\n/g,"<br>")}</div>
    <div class="reason muted">Motivo: ${escape(res.reason||"")}</div>
  `;
}

function setLoading(el, text){ el.innerHTML = `<p class="loading">${text}</p>`; }

/* -------- Data/API -------- */
function loadBase(){ try { return JSON.parse(sessionStorage.getItem(STORE_BASE)||"null"); } catch { return null; } }
function loadFinal(){ try { return JSON.parse(sessionStorage.getItem(STORE_FINAL)||"null"); } catch { return null; } }

async function post(payload){
  const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(payload) });
  const txt = await res.text();
  let json = {};
  try { json = JSON.parse(txt); } catch { throw new Error(`Bad JSON: ${txt.slice(0,120)}…`); }
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/* -------- Utils -------- */
function qs(s){ return document.querySelector(s); }
function get(s){ const n = qs(s); return n ? n.value : ""; }
function ensureWhatf(s=""){ return /^what\?f/i.test(s) ? s : ("What?f " + s); }
function escape(str=""){ return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
async function shareText(text){
  if (navigator.share) { try { await navigator.share({ text }); return; } catch{} }
  try { await navigator.clipboard.writeText(text); alert("Testo copiato negli appunti!"); }
  catch { alert("Copia/incolla manuale."); }
}
