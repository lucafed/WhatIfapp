// ask.js (client) – accanto a third.html e fourth.html, dominio Netlify
const ENDPOINT = "/.netlify/functions/ask";

const STORE_BASE = "whatf_base_v1";
const STORE_FINAL = "whatf_final_v1";

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.classList.contains("third")) initThird();
  if (document.body.classList.contains("fourth")) initFourth();
});

// ---------- Pagina 3 ----------
function initThird() {
  const form = document.getElementById("questionForm");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const base = {
      name: val("#name"),
      gender: val("#gender"),
      location: val("#location"),
      time: val("#time"),
      question: (val("#mainQuestion") || "").trim(),
      mode: localStorage.getItem("whatf_mode") || "sliding", // salvata in pagina 2
    };

    if (!base.gender || !base.question) {
      alert("Compila almeno Genere e Domanda.");
      return;
    }
    if (!/^what\?f/i.test(base.question)) {
      base.question = "What?f " + base.question;
    }

    sessionStorage.setItem(STORE_BASE, JSON.stringify(base));
    location.href = "fourth.html";
  });
}

// ---------- Pagina 4 ----------
async function initFourth() {
  const base = loadBase();
  if (!base) return (location.href = "third.html");

  const followDiv = el("#followUp");
  const respDiv = el("#aiResponse");
  const shareBtn = el("#shareBtn");

  // Step 1: follow-up
  setLoading(followDiv, "Sto preparando 2–3 domande di chiarimento…");
  let followups = [];
  try {
    const res = await callAsk({ step: "followups", question: base.question });
    followups = res.followups || [];
  } catch (e) {
    console.error(e);
    followups = [
      "Qual è l'orizzonte temporale (3, 6 o 12 mesi)?",
      "Qual è la priorità principale (tempo, budget, rischio)?",
    ];
  }
  renderFollowForm(followDiv, followups, async (answers) => {
    // Step 2: risposta finale
    setLoading(respDiv, "Sto generando la tua risposta…");
    try {
      const res = await callAsk({
        step: "final",
        mode: base.mode,
        user: { name: base.name, gender: base.gender, location: base.location, time: base.time },
        question: base.question,
        answers,
      });
      sessionStorage.setItem(STORE_FINAL, JSON.stringify(res));
      renderFinal(respDiv, res, base);
    } catch (e) {
      console.error(e);
      respDiv.innerHTML = `<p class="error">Errore: non riesco a generare la risposta.</p>`;
    }
  });

  // Condivisione
  shareBtn?.addEventListener("click", () => {
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

  // Se ricarichi la pagina e c'è già un risultato
  const final = loadFinal();
  if (final) renderFinal(respDiv, final, base);
}

// ---------- UI helpers ----------
function renderFollowForm(container, followups, onSubmit) {
  if (!container) return;
  if (!followups.length) {
    container.innerHTML = `<p class="muted">Nessuna domanda extra.</p>`;
    const btn = document.createElement("button");
    btn.textContent = "Genera risposta";
    btn.className = "primary";
    btn.onclick = () => onSubmit([]);
    container.appendChild(btn);
    return;
  }

  const form = document.createElement("form");
  form.className = "followup-form";

  followups.forEach((q, i) => {
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
  btn.textContent = "Genera risposta";

  form.appendChild(btn);
  container.innerHTML = "";
  container.appendChild(form);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const answers = Array.from(form.querySelectorAll("input")).map((i) => i.value.trim());
    onSubmit(answers);
  });
}

function renderFinal(container, res, base) {
  container.innerHTML = `
    <div class="result-head">
      <div><strong>Modalità:</strong> ${base.mode === "wtf" ? "What the F?!" : "Sliding Doors"}</div>
      <div><strong>Confidenza:</strong> ${Number(res.score || 0)}%</div>
    </div>
    <div class="response-text">${escapeHtml(res.answer).replace(/\n/g, "<br>")}</div>
    <div class="reason muted">Motivo: ${escapeHtml(res.reason || "")}</div>
  `;
}

function setLoading(elm, text) {
  if (!elm) return;
  elm.innerHTML = `<p class="loading">${text}</p>`;
}

// ---------- Data/API ----------
function loadBase() {
  try {
    const raw = sessionStorage.getItem(STORE_BASE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function loadFinal() {
  try {
    const raw = sessionStorage.getItem(STORE_FINAL);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
async function callAsk(payload) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

// ---------- Misc ----------
function el(sel) { return document.querySelector(sel); }
function val(sel) { const n = el(sel); return n ? n.value : ""; }
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch {}
  }
  try { await navigator.clipboard.writeText(text); alert("Testo copiato negli appunti!"); }
  catch { alert("Impossibile condividere automaticamente. Copia/incolla manuale."); }
}
