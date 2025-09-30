// ask.js (client) – accanto a third.html e fourth.html
// Sito ospitato su Netlify: usiamo l'endpoint relativo
const ENDPOINT = "/.netlify/functions/ask";

const STORE_BASE  = "whatf_base_v1";
const STORE_FINAL = "whatf_final_v1";

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.classList.contains("third"))  initThird();
  if (document.body.classList.contains("fourth")) initFourth();
});

/* -------- Pagina 3 -------- */
function initThird() {
  const form = document.getElementById("questionForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const base = {
      name:      getVal("#name"),
      gender:    getVal("#gender"),
      location:  getVal("#location"),
      time:      getVal("#time"),
      question:  (getVal("#mainQuestion") || "").trim(),
      // salvata nella pagina 2. fallback = "sliding"
      mode:      localStorage.getItem("whatf_mode") || "sliding",
    };

    if (!base.gender || !base.question) {
      alert("Compila almeno Genere e la tua Domanda.");
      return;
    }
    // assicurati del prefisso
    base.question = ensureWhatf(base.question);

    sessionStorage.setItem(STORE_BASE, JSON.stringify(base));
    location.href = "fourth.html";
  });
}

/* -------- Pagina 4 -------- */
async function initFourth() {
  const base = loadBase();
  if (!base) return (location.href = "third.html");

  const fuDiv   = qs("#followUp");
  const resDiv  = qs("#aiResponse");
  const shareBt = qs("#shareBtn");

  // 1) genera 2–3 follow-up
  setLoading(fuDiv, "Sto preparando 2–3 domande di chiarimento…");
  let followups = [];
  try {
    const r = await callAsk({ step: "followups", question: base.question });
    followups = r.followups || [];
  } catch {
    followups = [
      "Qual è l'orizzonte temporale (3, 6 o 12 mesi)?",
      "Qual è la priorità principale (tempo, budget, rischio)?",
      "Quale vincolo o risorsa incide di più?",
    ];
  }

  // 2) mostra form follow-up → poi chiedi la risposta finale
  renderFollowForm(fuDiv, followups, async (answers) => {
    setLoading(resDiv, "Sto generando la tua risposta…");
    try {
      const final = await callAsk({
        step: "final",
        mode: base.mode, // "sliding" | "wtf"
        user: {
          name: base.name,
          gender: base.gender,
          location: base.location,
          time: base.time,
        },
        question: base.question,
        answers,
      });
      sessionStorage.setItem(STORE_FINAL, JSON.stringify(final));
      renderFinal(resDiv, final, base);
    } catch (e) {
      console.error(e);
      resDiv.innerHTML = `<p class="error">Errore: non riesco a generare la risposta.</p>`;
    }
  });

  // 3) share
  shareBt?.addEventListener("click", () => {
    const final = loadFinal();
    const text = final
      ? [
          "✨ Il mio What?f ✨",
          `Q: ${base.question}`,
          "",
          final.answer,
          "",
          `Confidenza: ${final.score}%`,
          final.reason ? `Perché: ${final.reason}` : "",
          "",
          "#WhatIf #WhatfApp",
        ].join("\n")
      : "Prova anche tu What?f!";
    shareText(text);
  });

  // se ricarichi e c'è già una risposta
  const final = loadFinal();
  if (final) renderFinal(resDiv, final, base);
}

/* -------- UI helpers -------- */
function renderFollowForm(container, followups, onSubmit) {
  if (!container) return;

  if (!followups.length) {
    container.innerHTML = `<p class="muted">Nessuna domanda extra.</p>`;
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Genera risposta";
    btn.onclick = () => onSubmit([]);
    container.appendChild(btn);
    return;
  }

  const form = document.createElement("form");
  form.className = "followup-form";

  followups.slice(0,3).forEach((q, i) => {
    const wrap = document.createElement("div");
    wrap.className = "followup-item";

    const label = document.createElement("label");
    label.textContent = q;
    label.htmlFor = `fu_${i}`;

    const input = document.createElement("input");
    input.type = "text";
    input.id = `fu_${i}`;
    input.placeholder = "Rispondi…";
    input.required = true;

    wrap.appendChild(label);
    wrap.appendChild(input);
    form.appendChild(wrap);
  });

  const btn = document.createElement("button");
  btn.type = "submit";
  btn.className = "primary";
  btn.textContent = "Chiedi alla IA";
  form.appendChild(btn);

  container.innerHTML = "";
  container.appendChild(form);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const answers = Array.from(form.querySelectorAll("input")).map(i => i.value.trim());
    onSubmit(answers);
  });
}

function renderFinal(container, res, base) {
  container.innerHTML = `
    <div class="result-head">
      <div class="badge">${base.mode === "wtf" ? "What the F?!" : "Sliding Doors"}</div>
      <div class="score">Confidenza: <strong>${Number(res.score || 0)}%</strong></div>
    </div>
    <div class="response-text">${escapeHtml(res.answer).replace(/\n/g,"<br>")}</div>
    <div class="reason muted">Motivo: ${escapeHtml(res.reason || "")}</div>
  `;
}

function setLoading(el, text) {
  if (!el) return;
  el.innerHTML = `<p class="loading">${text}</p>`;
}

/* -------- Data/API -------- */
function loadBase() {
  try { const raw = sessionStorage.getItem(STORE_BASE);  return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function loadFinal() {
  try { const raw = sessionStorage.getItem(STORE_FINAL); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
async function callAsk(payload) {
  const res  = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(payload) });
  const json = await res.json().catch(()=> ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/* -------- Utils -------- */
function qs(s) { return document.querySelector(s); }
function getVal(s) { const n = qs(s); return n ? n.value : ""; }
function ensureWhatf(s=""){ return /^what\?f/i.test(s) ? s : ("What?f " + s); }
function escapeHtml(str=""){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
async function shareText(text){
  if (navigator.share) { try { await navigator.share({ text }); return; } catch {} }
  try { await navigator.clipboard.writeText(text); alert("Testo copiato negli appunti!"); }
  catch { alert("Non riesco a condividere automaticamente. Copia/incolla manuale."); }
}
