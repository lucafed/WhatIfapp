// ask.js (client) – da mettere accanto a third.html e fourth.html

const ENDPOINT = "/.netlify/functions/ask";
const STORE_KEY_BASE = "whatf_base_v1";
const STORE_KEY_FINAL = "whatf_final_v1";

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.classList.contains("third")) initThirdPage();
  if (document.body.classList.contains("fourth")) initFourthPage();
});

// --- Pagina 3 ---
function initThirdPage() {
  const form = document.getElementById("questionForm");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const base = {
      name: document.getElementById("name")?.value || "",
      gender: document.getElementById("gender")?.value || "",
      location: document.getElementById("location")?.value || "",
      time: document.getElementById("time")?.value || "",
      question: document.getElementById("mainQuestion")?.value || "",
      mode: localStorage.getItem("whatf_mode") || "sliding",
    };
    if (!base.gender || !base.question) {
      alert("Compila i campi obbligatori!");
      return;
    }
    if (!base.question.startsWith("What?f")) {
      base.question = "What?f " + base.question;
    }
    sessionStorage.setItem(STORE_KEY_BASE, JSON.stringify(base));
    location.href = "fourth.html";
  });
}

// --- Pagina 4 ---
async function initFourthPage() {
  const base = loadBase();
  if (!base) return (location.href = "third.html");

  const followUpDiv = document.getElementById("followUp");
  const responseDiv = document.getElementById("aiResponse");
  const shareBtn = document.getElementById("shareBtn");

  followUpDiv.innerHTML = "<p>Sto preparando 2–3 domande di chiarimento…</p>";
  let followups = [];
  try {
    const res = await callAsk({ step: "followups", question: base.question });
    followups = res.followups || [];
  } catch {
    followups = [
      "Qual è l'orizzonte temporale (3, 6 o 12 mesi)?",
      "Qual è la priorità principale (tempo, budget, rischio)?",
    ];
  }

  renderFollowupForm(followUpDiv, followups, async (answers) => {
    responseDiv.innerHTML = "<p>Sto generando la tua risposta...</p>";
    try {
      const res = await callAsk({
        step: "final",
        mode: base.mode,
        user: { name: base.name, gender: base.gender, location: base.location, time: base.time },
        question: base.question,
        answers,
      });
      sessionStorage.setItem(STORE_KEY_FINAL, JSON.stringify(res));
      renderFinal(responseDiv, res, base);
    } catch {
      responseDiv.innerHTML = "<p class='error'>Errore: non riesco a generare la risposta.</p>";
    }
  });

  shareBtn?.addEventListener("click", () => {
    const final = loadFinal();
    const text = final
      ? `✨ Il mio What?f ✨\\nQ: ${base.question}\\n${final.answer}\\nConfidenza: ${final.score}%\\n${final.reason}`
      : "Prova anche tu What?f!";
    shareText(text);
  });

  const final = loadFinal();
  if (final) renderFinal(responseDiv, final, base);
}

// --- Helpers ---
function loadBase() {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY_BASE)) || null; } catch { return null; }
}
function loadFinal() {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY_FINAL)) || null; } catch { return null; }
}
async function callAsk(payload) {
  const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Errore");
  return json;
}
function renderFollowupForm(container, followups, onSubmit) {
  if (!followups.length) {
    container.innerHTML = "<p>Nessuna domanda extra.</p><button>Genera risposta</button>";
    container.querySelector("button").onclick = () => onSubmit([]);
    return;
  }
  const form = document.createElement("form");
  followups.forEach((q, i) => {
    const label = document.createElement("label"); label.textContent = q;
    const input = document.createElement("input"); input.type = "text"; input.required = true;
    form.appendChild(label); form.appendChild(input);
  });
  const btn = document.createElement("button"); btn.type = "submit"; btn.textContent = "Genera risposta";
  form.appendChild(btn); container.innerHTML = ""; container.appendChild(form);
  form.onsubmit = (e) => { e.preventDefault(); const answers = Array.from(form.querySelectorAll("input")).map(i=>i.value); onSubmit(answers); };
}
function renderFinal(container, res, base) {
  container.innerHTML = `<div><strong>Modalità:</strong> ${base.mode === "wtf" ? "What the F?!" : "Sliding Doors"}</div>
    <div><strong>Confidenza:</strong> ${res.score}%</div>
    <div>${res.answer}</div>
    <div>Motivo: ${res.reason}</div>`;
}
async function shareText(text) {
  if (navigator.share) { try { await navigator.share({ text }); return; } catch {} }
  await navigator.clipboard.writeText(text); alert("Testo copiato negli appunti!");
}
