// /api/ask.js
import OpenAI from "openai";

/* ============== Setup ============== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ============== Utils: sintesi profilo per personalizzazione ============== */
function renderProfileDigest(p = {}) {
  if (!p || typeof p !== "object") return "";
  const parts = [];

  // Identità & contesto base
  if (p.name) parts.push(`${p.name}${p.age_range ? ", " + p.age_range : ""}`);
  const roots = [p.city_origin || p.city_from, p.city_now || p.city].filter(Boolean).join(" → ");
  if (roots) parts.push(`luoghi: ${roots}`);
  if (p.work_role || p.role) parts.push(`ruolo: ${p.work_role || p.role}`);
  if (Array.isArray(p.goals) && p.goals.length) parts.push(`obiettivi: ${p.goals.join(", ")}`);
  if (p.goal && (!parts.find(x => x.startsWith("obiettivi:")))) parts.push(`obiettivo: ${p.goal}`);
  if (Array.isArray(p.values) && p.values.length) parts.push(`valori: ${p.values.join(", ")}`);
  if (Array.isArray(p.wins) && p.wins.length) parts.push(`vittorie: ${p.wins.join(", ")}`);
  if (Array.isArray(p.pains) && p.pains.length) parts.push(`difficoltà: ${p.pains.join(", ")}`);

  // Interessi generali
  if (Array.isArray(p.hobbies) && p.hobbies.length) parts.push(`interessi: ${p.hobbies.join(", ")}`);

  // Preferenze “relax” / bar vibe
  if (typeof p.drinks_pref === "string") parts.push(`drinks_pref: ${p.drinks_pref}`);
  if (typeof p.unwind === "string") parts.push(`unwind: ${p.unwind}`);

  // Campi predittivi
  if (p.time_window) parts.push(`finestra: ${p.time_window}`);
  if (p.success_indicator) parts.push(`indicatore_successo: ${p.success_indicator}`);
  if (p.risk_tolerance) parts.push(`rischio: ${p.risk_tolerance}`);
  if (p.landmark) parts.push(`ancora: ${p.landmark}`);

  // Micro-dati giornalieri
  if (p.micro && typeof p.micro === "object") {
    const micro = p.micro;
    Object.entries(micro).forEach(([k, v]) => {
      if (v && typeof v === "string" && v.trim()) {
        parts.push(`${k}: ${v.trim()}`);
      }
    });
  }

  return parts.join(" • ");
}

function isFinalEpisode(profile = {}) {
  const ep = Number(profile?.story_state?.episode ?? 1);
  const max = Number(profile?.story_state?.max_episodes ?? 3);
  return ep >= max;
}

/* ============== Profiling adattivo: pesi di tono ============== */
function computeStyleWeights(profile = {}, clar = {}) {
  // Pesi base adattivi (0..1) — modulano sarcasmo, calore, ritmo, profondità
  const out = {
    warmth: 0.55,
    sarcasm: 0.35,
    riskBold: 0.45,
    tempo: 0.5,        // 0=più lento riflessivo, 1=più rapido/punchy
    concreteness: 0.7, // uso di dettagli e azioni piccole
  };

  const vals = (profile.values || []).join(" ").toLowerCase();
  const pains = (profile.pains || []).join(" ").toLowerCase();
  const goals = (profile.goals || []).join(" ").toLowerCase();
  const riskTol = String(profile.risk_tolerance || "").toLowerCase();

  if (vals.includes("famiglia") || vals.includes("cura") || vals.includes("equilibrio")) {
    out.warmth += 0.15;
    out.sarcasm -= 0.1;
  }
  if (vals.includes("ambizione") || goals.includes("scalare") || goals.includes("crescita")) {
    out.riskBold += 0.15;
    out.tempo += 0.1;
  }
  if (riskTol.includes("alta") || riskTol.includes("alta tolleranza")) {
    out.riskBold += 0.1;
    out.sarcasm += 0.05;
  }
  if (pains.includes("ansia") || pains.includes("burnout")) {
    out.tempo -= 0.1;
    out.sarcasm -= 0.1;
    out.warmth += 0.1;
  }

  // Clarifications possono spostare lo stile
  if (clar.time_window || clar.success_indicator || clar.real_constraint) {
    out.concreteness += 0.1;
  }

  // Clipping
  out.warmth = Math.max(0, Math.min(1, out.warmth));
  out.sarcasm = Math.max(0, Math.min(1, out.sarcasm));
  out.riskBold = Math.max(0, Math.min(1, out.riskBold));
  out.tempo = Math.max(0, Math.min(1, out.tempo));
  out.concreteness = Math.max(0, Math.min(1, out.concreteness));
  return out;
}

/* ============== Banca frasi e sinonimi per evitare “stampino” ============== */
const IT_VARIANTS = {
  stepSyn: ["primo gesto", "mossa piccola", "micro-azione", "passo iniziale", "azione di prova"],
  tradeOffSyn: ["scambio reale", "prezzo nascosto", "compromesso onesto", "costo vero", "contraccolpo probabile"],
  signalSyn: ["segnale che ti dice che funziona", "spia verde", "riscontro concreto", "spia sul cruscotto", "prova tangibile"],
  riskSyn: ["rischio", "incognita", "punto debole", "parte scoperta", "zona scivolosa"],
  inviteSyn: [
    "Se domani vuoi, continuiamo da qui.",
    "Torna domani: la storia va avanti.",
    "Quando torni, riprendiamo il filo.",
    "Se ti va, domani vediamo come si evolve.",
    "Domani facciamo il prossimo pezzo."
  ],
  microNudge: [
    "Compila le 3 micro-domande: mi aiuta a essere più preciso.",
    "Lasciami 3 dettagli domani e stringiamo il fuoco.",
    "Con 3 micro-risposte domani, la previsione diventa più tua.",
    "Tre dettagli domani e la scena si mette a fuoco."
  ]
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

/* ============== Eco-frasi dal profilo (fa sentire “visto”) ============== */
function buildEcho(profile = {}) {
  const lines = [];
  if (profile.city_now) lines.push(`Sei a ${profile.city_now}: lo sfondo conta.`);
  if (profile.role || profile.work_role) lines.push(`Hai il taglio di chi lavora da ${profile.role || profile.work_role}.`);
  if (profile.goal) lines.push(`Stai puntando a ${profile.goal}, e si sente.`);
  if (profile.values && profile.values.length) lines.push(`I tuoi valori tirano la linea: ${profile.values.slice(0,2).join(" & ")}.`);
  return lines.slice(0,2).join(" ");
}

/* ============== Persona prompts ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz, clar = {} }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);
  const echo = buildEcho(profile);
  const weights = computeStyleWeights(profile, clar);

  const finaleInstr_en = finale
    ? `FINALE: Provide closure. No cliffhanger. Land a memorable final line.
For What?f: reflective, warm resolution + one-line invite to start a new 'what if'.
For What the F: sharp closing punchline + playful invite to pick a new mess.`
    : `MID-EPISODE: End with a subtle, personal hook that invites the next step.`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero. Niente cliffhanger. Una chiusa memorabile.
Per What?f: risoluzione calda + invito in una riga a un nuovo “e se”.
Per What the F: punchline tagliente + invito giocoso al prossimo casino.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale che inviti a proseguire.`;

  const now = safeNow(nowIso, tz);
  const when_en = `Today is ${now.weekday_en}, ${now.date_en}. Season: ${now.season_en}. Local time ~${now.time24}.`;
  const when_it = `Oggi è ${now.weekday_it}, ${now.date_it}. Stagione: ${now.season_it}. Ora locale ~${now.time24}.`;

  const toneKnobs_it = `Manopole di tono (0..1):
calore=${weights.warmth.toFixed(2)}, sarcasmo=${weights.sarcasm.toFixed(2)}, rischio=${weights.riskBold.toFixed(2)}, ritmo=${weights.tempo.toFixed(2)}, concretezza=${weights.concreteness.toFixed(2)}.`;

  if (stile === "wtf") {
    // WHAT THE F — barista nottambulo, ma intelligente e adattivo
    return en
      ? `You are "What the F": a late-night bartender-philosopher — witty, slightly drunk, brutally honest, but caring.
${when_en}
Style knobs (0..1): warmth=${weights.warmth}, sarcasm=${weights.sarcasm}, risk=${weights.riskBold}, pace=${weights.tempo}, concreteness=${weights.concreteness}.
Speak as ONE voice. 8–10 short lines, bar-banter rhythm.
- Second person only ("you"); never "I".
- Respect tense: FUTURE uses near future; PAST uses counterfactual.
- Personalization is implicit (echo the user's world: ${cityNow}, ${workRole}). Echo-lines: ${echo || "—"}.
- No bullet labels like "constraint/indicator/first step". Weave ideas naturally with synonyms.
- Vary structure and synonyms; avoid templates.
Ending:
- ${finaleInstr_en}`
      : `Sei “What the F”: barista nottambulo, tagliente ma dalla tua parte.
${when_it}
${toneKnobs_it}
Parla come UNA sola voce. 8–10 righe brevi, ritmo da bancone.
- Solo seconda persona (“tu”); mai “io”.
- Tempi corretti: FUTURO in futuro vicino; PASSATO in controfattuale.
- Personalizza in modo implicito (richiami a ${cityNow}, ${workRole}). Eco: ${echo || "—"}.
- Evita etichette tipo “vincolo/indicatore/primo passo”: intessile nel discorso con sinonimi.
- Varia sinonimi e struttura; niente stampini.
Chiusura:
- ${finaleInstr_it}`;
  }

  // WHAT?f — amico lucido, predittivo, adattivo
  return en
    ? `You are "What?f": a lucid, candid friend — predictive, concrete, and adaptive.
${when_en}
Style knobs (0..1): warmth=${weights.warmth}, sarcasm=${weights.sarcasm}, risk=${weights.riskBold}, pace=${weights.tempo}, concreteness=${weights.concreteness}.
Speak as ONE calm inner voice. 8–10 concise lines, visual and current.
- Second person only ("you"); never "I".
Goal: let the user SEE a counterfactual slice (PAST) or a near-future fork (FUTURE).
- Use profile implicitly; echo-lines: ${echo || "—"}.
- Respect tense by timeframe.
- Do NOT print labels like “constraint/indicator/first step”; weave them with synonyms.
- Vary structure and synonyms; avoid templates.
Ending:
- ${finaleInstr_en}`
    : `Sei “What?f”: un amico lucido e predittivo — concreto e adattivo.
${when_it}
${toneKnobs_it}
Parla come UNA voce interiore calma. 8–10 righe brevi, visive e attuali.
- Solo seconda persona (“tu”); mai “io”.
Obiettivo: far VEDERE un controfattuale (PASSATO) o una biforcazione di prossimo futuro (FUTURO).
- Personalizza in modo implicito; eco: ${echo || "—"}.
- Rispetta i tempi in base al periodo.
- NON stampare etichette come “vincolo/indicatore/primo passo”: intessile nel discorso con sinonimi e immagini.
- Varia struttura e sinonimi; evita schemi ripetitivi.
Chiusura:
- ${finaleInstr_it}`;
}

/* ============== Few-shot di stile (brevi) ============== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  if (it) {
    if (style === "wtf") {
      return [
        { role: "system", content:
`ESEMPIO_WTF
DOMANDA: "Se avessi vinto 1.000.000 di euro?"
RISPOSTA (8–10 righe, 2a persona, sarcasmo pulito):
Un milione, eh? Ottimo: ora puoi litigare con stile.
Evita la maratona di shopping: compra respiro, non trofei.
Attico? Sì. Ma l’edera chiede manutenzione.
La ricchezza compra opzioni, non abitudini.
Rischio: più cose, meno te.
Misura il sonno, non il garage.
Fai una mossa piccola: dai un nome a ogni euro importante.
Se gli scontrini calano e i sorrisi restano, stai vincendo.
Quando finisce lo champagne, resta chi sei.
Punchline: tieni lo scontrino del sogno. Torni domani? Continuiamo.` }
      ];
    }
    return [
      { role: "system", content:
`ESEMPIO_WHATIF
DOMANDA: "E se tornassi all’Aquila tra 3–6 mesi?"
RISPOSTA (predittiva, discorsiva):
Nel primo mese disegni una settimana tipo: lavoro, piazza, due volti sicuri.
Lo scambio vero? Meno anonimato, più richieste.
La mossa piccola: una settimana pilota, sempre gli stessi giorni.
La spia sul cruscotto: due sere leggere e sonno regolare.
Se succede, estendi a due settimane e guarda come ti respira il lunedì.
Dopo 90 giorni capisci se è rientro o pendolarismo emotivo.
Intrecci affetti e routine senza farli urlare.
E se domani torni, fissiamo insieme i quattro giorni “pilota”.
Tre dettagli domani e metto a fuoco meglio il quadro.` }
    ];
  }

  // EN fallback (non usato di default)
  if (style === "wtf") {
    return [{ role: "system", content:
`WTF_EXAMPLE
QUESTION: "What if I won €1,000,000?"
ANSWER:
A million? Great. Now you can argue in premium.
Skip the shopping sprint; buy breathing room.
Wealth buys options, not habits.
Risk: more stuff, less you.
Measure sleep, not garage.
Small move: name each important euro.
If receipts fall and smiles hold, you're winning.
Punchline: keep the dream’s receipt. Come back tomorrow; the story continues.` }];
  }
  return [{ role: "system", content:
`WHATIF_EXAMPLE
QUESTION: "What if I moved back home?"
ANSWER:
Test one fixed week per month.
Real swap: less anonymity, more asks.
Dashboard light: two easy evenings + steady sleep.
If it works, extend to two weeks.
After 90 days you’ll know if it’s home or museum.
Return tomorrow and we’ll set the pilot days with finer detail.` }];
}

/* ============== Istruzioni di stile finali (anti-stampino) ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  const dontSay = en
    ? `Avoid literal words: "constraint", "indicator", "first step". Weave them implicitly. No bullet labels. No numbered lists unless essential. Never use "I".`
    : `Evita parole letterali come “vincolo”, “indicatore”, “primo passo”. Intessile in modo implicito. Niente etichette. Evita liste numerate salvo necessità. Mai usare “io”.`;

  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Bold, playful sarcasm, never cruel. Second person only. Respect tense by timeframe. Vary synonyms and sentence shapes; no templates. ${dontSay}`
      : `Formato: 8–10 righe brevi. Voce unica. Sarcasmo brillante, mai cattivo. Solo seconda persona. Tempi coerenti con il periodo. Varia sinonimi e forme; niente stampini. ${dontSay}`;
  }
  return en
    ? `Format: 8–10 concise lines. One speaker. Visual, candid, current. Second person only. Include small, realistic actions and trade-offs implicitly. Vary wording; no templates. Respect tense by timeframe. ${dontSay}`
    : `Formato: 8–10 righe concise. Voce unica. Visivo, sincero, attuale. Solo seconda persona. Azioni piccole e scambi reali, ma impliciti. Varia il lessico; niente stampini. Rispetta i tempi. ${dontSay}`;
}

/* ============== Costruzione messaggio utente (con profilo) ============== */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz }) {
  const en = isEn(lang);
  const L = [];
  L.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  L.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  L.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);

  // Now/locale hints
  const now = safeNow(nowIso, tz);
  L.push(
    en
      ? `NOW:
weekday=${now.weekday_en}; season=${now.season_en}; month=${now.month_en}; local_time≈${now.time24};`
      : `ADESSO:
giorno=${now.weekday_it}; stagione=${now.season_it}; mese=${now.month_it}; ora_locale≈${now.time24};`
  );

  // Digest
  const digest = renderProfileDigest(profilo);
  if (digest) L.push(en ? `PROFILE DIGEST: ${digest}` : `SINTESI PROFILO: ${digest}`);

  // Predittivo esplicito (SOLO come istruzione al modello)
  const p = profilo || {};
  const pred = {
    time_window: p.time_window || "",
    success_indicator: p.success_indicator || "",
    risk_tolerance: p.risk_tolerance || "",
    landmark: p.landmark || "",
  };
  const predBlock = Object.entries(pred)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  if (predBlock) L.push(en ? `PREDICTIVE SIGNALS (for reasoning, do not print labels):\n${predBlock}`
                           : `SEGNALI PREDITTIVI (per ragionare, non stampare etichette):\n${predBlock}`);

  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS (for reasoning):\n" : "CHIARIMENTI (per ragionare):\n") + c.join("\n"));
  }

  // Istruzioni discorsive/predittive senza parole-chiave fisse
  const step = pick(IT_VARIANTS.stepSyn);
  const swap = pick(IT_VARIANTS.tradeOffSyn);
  const sig  = pick(IT_VARIANTS.signalSyn);
  const invite = pick(IT_VARIANTS.inviteSyn);
  const nudge = pick(IT_VARIANTS.microNudge);

  L.push(
    en
      ? `PREDICTIVE OBJECTIVE:
- PAST → counterfactual vignette as if it happened; include a plausible trade-off and a ${sig}.
- FUTURE → near-future fork if they choose now; include one ${step} and a ${sig} the user can notice in ~30 days.
- Personalize implicitly using profile and clarifications (echo-lines allowed).
- Keep it human, adaptive, varied. No rigid labels. End with a soft hook to continue tomorrow and a light nudge to fill next-day micro-questions. Hook idea: "${invite}". Nudge idea: "${nudge}".`
      : `OBIETTIVO PREDITTIVO:
- PASSATO → vignetta controfattuale come se fosse accaduta; inserisci uno ${swap} credibile e una ${sig}.
- FUTURO → biforcazione di prossimo futuro se sceglie ora; inserisci una ${step} e una ${sig} osservabile entro ~30 giorni.
- Personalizza in modo implicito usando profilo e chiarimenti (eco consentite).
- Tono umano, adattivo, vario. Niente etichette rigide. Chiudi con un gancio a proseguire domani e un invito leggero a compilare le micro-domande. Gancio: "${invite}". Invito: "${nudge}".`
  );

  return L.join("\n\n");
}

/* ============== Clarify “aware” del periodo + profiling progressivo ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You generate 2–3 short, focused clarifying questions (one line each) tightly tied to the user's main question. Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Generi 2–3 domande brevi e mirate, collegate strettamente alla domanda principale. Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;

  const period = en
    ? `PERIOD AWARE:
- If TIMEFRAME = "past": ask about pivot year/event, place/context back then, key constraint/signal.
- If TIMEFRAME = "future": ask about decision window, success indicator, realistic constraint/resource.`
    : `Consapevole del PERIODO:
- "past": anno/evento di svolta, luogo/contesto di allora, segnale o limite chiave.
- "future": finestra decisionale, riscontro concreto che noterà, ostacolo realistico o risorsa.`;

  const profiling = en
    ? `Progressive profiling (only if missing): city_now/city_origin, work_role, main goal, 2–3 values.`
    : `Profilazione progressiva (solo se mancano): città attuale/origine, ruolo, obiettivo concreto, 2–3 valori.`;

  return `${base}\n${period}\n${profiling}`;
}

function clarifyUserContent({ domanda, periodo = "future", profilo = {}, lang = "it" }) {
  const en = isEn(lang);
  const parts = [];
  parts.push((en ? "QUESTION: " : "DOMANDA: ") + (domanda || ""));
  parts.push((en ? "TIMEFRAME: " : "PERIODO: ") + periodo);
  const digest = renderProfileDigest(profilo);
  if (digest) parts.push(en ? "PROFILE DIGEST: " + digest : "SINTESI PROFILO: " + digest);
  parts.push(en ? "Return ONLY the JSON array." : "Ritornare SOLO l’array JSON.");
  return parts.join("\n\n");
}

/* ============== Fallback clarify ============== */
function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  const qs = [];

  if (periodo === "past") {
    qs.push({ id: "pivot_year", label: en ? "Turning point year/event?" : "Anno/evento di svolta?", placeholder: en ? "e.g., 2015 move / 2010 offer" : "es. trasferimento 2015 / offerta 2010" });
    qs.push({ id: "then_context", label: en ? "Where and what context mattered then?" : "Dove e quale contesto contava allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" });
    qs.push({ id: "what_would_change", label: en ? "One constraint/signal that would've changed it?" : "Un segno/limite che l’avrebbe cambiata?", placeholder: en ? "money/time/person/offer" : "soldi/tempo/persona/offerta" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Finestra decisionale reale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "success_indicator", label: en ? "What would tell you it's working?" : "Cosa ti direbbe che sta funzionando?", placeholder: en ? "sleep, 1 client, hours" : "sonno, 1 cliente, ore" });
    qs.push({ id: "real_constraint", label: en ? "Most concrete obstacle?" : "Ostacolo più concreto?", placeholder: en ? "budget/time/energy" : "budget/tempo/energia" });
  }

  if (!profilo?.city_now && !profilo?.city) {
    qs[0] = qs[0] || { id: "city_now", label: en ? "Where do you live now?" : "Dove vivi adesso?", placeholder: en ? "city" : "città" };
  }
  if (!profilo?.work_role && !profilo?.role) {
    qs[1] = qs[1] || { id: "work_role", label: en ? "Your current role in one line?" : "Il tuo ruolo attuale in una riga?", placeholder: en ? "e.g., pharmacist technician" : "es. tecnico farmaceutico" };
  }
  if (!Array.isArray(profilo?.goals) || !profilo.goals?.length) {
    qs[2] = qs[2] || { id: "main_goal", label: en ? "One concrete goal now?" : "Un obiettivo concreto ora?", placeholder: en ? "e.g., change job / more time" : "es. cambiare lavoro / più tempo" };
  }

  return qs.slice(0, 3);
}

/* ============== Helpers ============== */
function safeNow(nowIso, tz) {
  const d = nowIso ? new Date(nowIso) : new Date();
  const w = d.toLocaleDateString("en-GB", { weekday: "long" });
  const wd_it = d.toLocaleDateString("it-IT", { weekday: "long" });
  const date_it = d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
  const date_en = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const month = d.getMonth() + 1;
  const season_it = seasonForMonth(month, "it");
  const season_en = seasonForMonth(month, "en");
  const month_it = d.toLocaleDateString("it-IT", { month: "long" });
  const month_en = d.toLocaleDateString("en-GB", { month: "long" });
  return {
    time24: `${hh}:${mm}`,
    weekday_en: w,
    weekday_it: wd_it,
    date_it, date_en,
    season_it, season_en,
    month_it, month_en,
    tz: tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}
function seasonForMonth(m, lang) {
  // Emisfero nord
  const it = ["inverno","inverno","primavera","primavera","primavera","estate","estate","estate","autunno","autunno","autunno","inverno"];
  const en = ["winter","winter","spring","spring","spring","summer","summer","summer","autumn","autumn","autumn","winter"];
  return (lang === "en" ? en : it)[(m-1)%12];
}

/* ============== HTTP handler ============== */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      lang = "it",
      periodo = "future",      // "past" | "future"
      stile = "whatif",        // "whatif" | "wtf"
      clarify = false,         // true => genera 2–3 domande
      stream = false,          // true => text/event-stream
      profilo = {},            // { ... , story_state:{ thread_id, episode, max_episodes } }
      clarifications = {},     // risposte ai chiarimenti
      extra = "",              // input extra opzionale
      now: nowIso,             // opzionale: ISO dal client
      tz,                      // opzionale: timezone IANA dal client
      tags = [],               // opzionale: parole chiave lato client
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ---------- Clarify branch (dinamico) ---------- */
    if (clarify) {
      let questions = [];
      try {
        const sys = clarifySystemPrompt(lang);
        const usr = clarifyUserContent({ domanda, periodo, profilo, lang });
        const resp = await client.chat.completions.create({
          model: MODEL_TEXT,
          temperature: 0.7,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: usr },
          ],
        });
        const raw = resp.choices?.[0]?.message?.content?.trim() || "[]";
        const start = raw.indexOf("[");
        const end = raw.lastIndexOf("]");
        if (start >= 0 && end > start) questions = JSON.parse(raw.slice(start, end + 1));
      } catch (err) {
        console.error("Clarify dynamic error:", err);
      }

      if (!Array.isArray(questions) || questions.length === 0) {
        questions = localClarify(domanda, profilo, lang, periodo);
      }

      questions = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i + 1}`),
        label: String(q.label || q?.text || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));

      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        const clarHdr = { date: todayIso, used: (questions?.length || 0), tags };
        res.setHeader("X-Whatif-Clarify", JSON.stringify(clarHdr));
      } catch {}

      return res.status(200).json({ questions });
    }

    /* ---------- Generation branch ---------- */
    const sys1 = systemPrompt({ stile, lang, profile: profilo, nowIso, tz, clar: clarifications });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz });
    const sys2 = responseStyleInstruction(lang, stile);
    const fewshots = getFewShots(stile, lang);

    // Finale/mid-episode hint (rinforzo)
    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "This is the FINALE of this thread: deliver closure (no cliffhanger). One-line invite to continue with a new 'what if' tomorrow."
          : "Questo è il FINALE di questa storia: chiudi davvero (niente cliffhanger). Un invito in una riga a proseguire domani con un nuovo 'e se'.")
      : (isEn(lang)
          ? `Mid-episode: end with a soft personal hook tied to ${profilo?.city_now || profilo?.city || (isEn(lang) ? "their city" : "la tua città")} or ${profilo?.work_role || profilo?.role || (isEn(lang) ? "their role" : "il tuo ruolo")}.`
          : `Episodio intermedio: chiudi con un gancio personale legato a ${profilo?.city_now || profilo?.city || "la tua città"} o ${profilo?.work_role || profilo?.role || "il tuo ruolo"}.`);

    const messages = [
      { role: "system", content: sys1 },
      ...fewshots,
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    // Temperatura: più alta per wtf per favorire battute e ritmo
    const temperature = stile === "wtf" ? 0.97 : 0.82;

    // Streaming (SSE)
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        messages,
        temperature,
        max_tokens: 700,
        stream: true,
      });

      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // Non-stream
    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      messages,
      temperature,
      max_tokens: 700,
    });
    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res
      .status(500)
      .json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
        }
