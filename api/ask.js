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

  // Preferenze relax / bar vibe
  if (typeof p.drinks_pref === "string") parts.push(`drinks_pref: ${p.drinks_pref}`);
  if (typeof p.unwind === "string") parts.push(`unwind: ${p.unwind}`);

  // Campi predittivi
  if (p.time_window) parts.push(`finestra: ${p.time_window}`);
  if (p.success_indicator) parts.push(`indicatore_successo: ${p.success_indicator}`);
  if (p.risk_tolerance) parts.push(`rischio: ${p.risk_tolerance}`);
  if (p.landmark) parts.push(`ancora: ${p.landmark}`);

  // Micro-dati giornalieri (solo stringhe utili)
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

/* ============== Persona prompts ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);

  const finaleInstr_en = finale
    ? `FINALE: Provide closure. No cliffhanger. Land a memorable final line.
For What?f: reflective, warm resolution + one-line invite to start a new 'what if'.
For What the F: sharp closing punchline + playful invite to pick a new mess.`
    : `MID-EPISODE: End with a subtle personal hook that invites returning TOMORROW. Add a light nudge: “leave two micro-answers” (no list, one short line).`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero. Niente cliffhanger. Chiusa memorabile.
Per What?f: risoluzione calda + invito in una riga a un nuovo “e se”.
Per What the F: punchline tagliente + invito giocoso a scegliere un nuovo casino.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale a tornare DOMANI. Aggiungi un invito leggero: “lascia due micro-risposte” (senza elenco, una sola riga).`;

  const now = safeNow(nowIso, tz);
  const when_en = `Today is ${now.weekday_en}, ${now.date_en}. Season: ${now.season_en}. Local time ~${now.time24}.`;
  const when_it = `Oggi è ${now.weekday_it}, ${now.date_it}. Stagione: ${now.season_it}. Ora locale ~${now.time24}.`;

  // Regola anti-boilerplate
  const antiBoiler_en = `Avoid repeating boilerplate words. Do NOT overuse "constraint", "trade-off", "indicator". If needed, paraphrase (e.g., "the price you pay", "other side of the choice", "sign you're on track").`;
  const antiBoiler_it = `Evita parole a stampino. NON ripetere “vincolo”, “trade-off”, “indicatore”. Se servono, parafrasa (es. “la parte da pagare”, “l’altra faccia della scelta”, “segno che stai andando bene”).`;

  if (stile === "wtf") {
    // WHAT THE F
    return en
      ? `You are "What the F": a late-night bartender-philosopher — witty, slightly drunk, brutally honest.
${when_en}
Speak as ONE voice. 8–10 punchy short lines — bar-banter rhythm.
Tone:
- High sarcasm, clever irony, never cruel. No slurs.
- At least 2 punchlines. Humor > lesson. No moralizing.
- Second person only ("you"); never "I".
- Each line ≤15 words; pause like you're sipping between lines.
Mirror:
- Open with 1–2 lines that reflect the user's likely mindset, implicitly using their profile (no list).
Tense control:
- TIMEFRAME="future": near-future (you will / you'll).
- TIMEFRAME="past": counterfactual (you would've).
Alcohol flavor: ${drinksYes ? "frequent, tasteful bar metaphors" : "rare, subtle nods"}.
Personalization:
- Ground hints in ${cityNow}, ${workRole} without enumerating facts.
${antiBoiler_en}
Ending:
- ${finaleInstr_en}`
      : `Sei “What the F”: barista nottambulo, ironico, un po’ brillo ma lucidissimo.
${when_it}
Parla come UNA sola voce. 8–10 righe brevi, ritmo da bancone.
Tono:
- Sarcasmo alto, ironia arguta, mai cattivo. Niente volgarità.
- Almeno 2 punchline. Umorismo > lezione. Zero moralismi.
- Solo seconda persona (“tu”); mai “io”.
- Ogni riga ≤15 parole; pause da sorso.
Specchio:
- Apri con 1–2 righe che riflettano la mente dell’utente, usando il profilo in modo implicito.
Controllo tempi:
- PERIODO="future": futuro vicino (“farai”, “ti ritroverai”).
- PERIODO="past": controfattuale (“avresti”, “saresti”).
Tocco alcolico: ${drinksYes ? "metafore da bancone eleganti" : "accenni rari e leggeri"}.
Personalizzazione:
- Ancorata a ${cityNow}, ${workRole}, senza elenchi.
${antiBoiler_it}
Chiusura:
- ${finaleInstr_it}`;
  }

  // WHAT?f — sobrio, predittivo
  return en
    ? `You are "What?f": a sober, candid, slightly mystical friend — lucid, concrete, current.
${when_en}
One calm inner voice. 8–10 short lines, firm and vivid.
- Second person only ("you"); never "I".
Mirror:
- Open with 1–2 lines that reflect their current motive/state (implicit profile).
Goal: make them SEE a near-future fork (FUTURE) or counterfactual slice (PAST).
Style:
- Real timings, small risks, practical costs, one concrete first step.
- Use decision window / success sign / risk tolerance / anchor only when useful.
- Personalize with subtle hints from their digest (city, role, goals, values).
Tense:
- FUTURE → near future. PAST → counterfactual.
${antiBoiler_en}
Ending:
- ${finaleInstr_en}`
    : `Sei “What?f”: un amico lucido, sincero, un po’ mistico — concreto e attuale.
${when_it}
Una sola voce interiore. 8–10 righe brevi, nette, visive.
- Solo seconda persona (“tu”); mai “io”.
Specchio:
- Apri con 1–2 righe che rispecchino il tuo perché del momento (profilo implicito).
Obiettivo: far VEDERE una biforcazione prossima (FUTURO) o un controfattuale (PASSATO).
Stile:
- Tempi reali, costi pratici, primo passo concreto.
- Usa finestra/segni/tolleranza/ancora solo se servono davvero.
- Personalizza con accenni a città/ruolo/valori senza elencare.
Controllo tempi:
- FUTURO → futuro vicino. PASSATO → controfattuale.
${antiBoiler_it}
Chiusura:
- ${finaleInstr_it}`;
}

/* ============== Few-shot di stile (esempi) ============== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  if (it) {
    if (style === "wtf") {
      // WTF — sarcasmo pulito con specchio + gancio domani
      return [
        {
          role: "system",
          content:
`ESEMPIO_WTF_1
DOMANDA: "Comprare la moto a marzo?"
RISPOSTA:
Ti conosco: vuoi vento in faccia, non solo aria condizionata.
Marzo? Perfetto. Piove. Impari subito il rispetto.
Fai un test ride. Cuore su, ego giù.
Il casco parla chiaro: o ti scegli, o ti scegli.
Problema vero? Il tempo. Il garage non si allunga.
Segnale buono: torni e non cerchi scuse.
Segnale pessimo: fai conti tutta sera.
Primo sorso: chiama, blocca un’ora. Niente amici cheerleader.
Poi decidi tu. Libertà o arredamento?
Domani passo io: lascia due micro-risposte e ti verso il prossimo giro di storia.`
        },
        {
          role: "system",
          content:
`ESEMPIO_WTF_2
DOMANDA: "Se avessi vinto 1.000.000 di euro?"
RISPOSTA:
Un milione, eh? Ottimo: ora puoi litigare con stile.
Niente sprint di shopping: compra spazio per respirare.
Attico a Bussolengo? Sì, con manutenzione a sorpresa.
La ricchezza compra opzioni, non abitudini.
Rischio? Più cose, meno te.
Segnale buono: sonno pieno, non garage pieno.
Primo sorso: battezzi una quota intoccabile.
Se i sorrisi salgono e gli scontrini scendono, stai vincendo.
Domani continuiamo: porta due micro-risposte e alziamo il sipario.`
        }
      ];
    }

    // WHAT?f — discorsivo, predittivo, con specchio + gancio domani
    return [
      {
        role: "system",
        content:
`ESEMPIO_WHATIF_1
DOMANDA: "Comprare la moto a marzo?"
RISPOSTA:
Sei uno che ha bisogno di aria addosso: negli ultimi mesi la routine ti sta stretta.
Per questo l’idea della moto ti punge proprio ora.
Sabato mattina, ore 10, test ride in zona; parli poco, ascolti il motore.
Il costo reale non è solo denaro: è tempo che togli ad altro.
Capisci che è la mossa giusta se rientri più leggero, non in colpa.
Primo passo: chiama oggi e blocca l’usato garantito per prova.
Dopo tre uscite: dormi meglio e non conti i graffi? Sei sulla strada buona.
Bussolengo resta base; la moto diventa spazio respirabile.
Domani continuiamo il capitolo: lascia due micro-risposte e vediamo dove porta.`
      },
      {
        role: "system",
        content:
`ESEMPIO_WHATIF_2
DOMANDA: "E se tornassi a vivere all’Aquila?"
RISPOSTA:
Ti attira l’idea di rimettere radici senza perdere autonomia.
Primo mese: una settimana “pilota” fissa, stessi giorni ogni volta.
La parte da pagare? Logistica doppia e qualche favore in più.
Segno che funziona: due sere leggere e sonno regolare.
Se regge, raddoppi a due settimane entro tre mesi.
Primo passo oggi: prenota i treni del mese test e avvisa due persone chiave.
Domani proseguiamo: lasciami due micro-risposte e costruiamo il seguito.`
      }
    ];
  }

  // EN (sintetico)
  if (style === "wtf") {
    return [
      { role: "system", content:
`WTF_EXAMPLE_1
QUESTION: "Buy a motorbike in March?"
ANSWER:
You want wind, not air-con.
March? Rain. Instant respect lesson.
Book a test ride. Heart up, ego down.
Real cost? Time, not chrome.
Good sign: you smile without excuses.
Bad sign: you spreadsheet the evening.
First sip: call, lock an hour.
Then choose: freedom or furniture.
Come back tomorrow; drop two micro-answers for the next round.` },
    ];
  }
  return [
    { role: "system", content:
`WHATIF_EXAMPLE_1
QUESTION: "Move back home?"
ANSWER:
Start with one fixed test week per month.
Price you pay: doubled logistics.
Good sign: two light evenings and steady sleep.
Step now: book dates, ping two key people.
Tomorrow we continue—leave two micro-answers to steer the story.` },
  ];
}

/* ============== Istruzioni di stile (rinforzo) ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  const anti = en
    ? `Avoid repeating boilerplate words; paraphrase them. Do not list bullets. Keep it flowing.`
    : `Evita parole a stampino; parafrasa. Niente elenchi. Tieni il flusso discorsivo.`;

  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One voice. Bold sarcasm, playful, never cruel. Second person only (no "I"). Respect tense by timeframe. Open with a mirror line. End with tomorrow-hook if not finale. ${anti}`
      : `Formato: 8–10 righe brevi. Voce unica. Sarcasmo brillante, giocoso, mai cattivo. Solo seconda persona. Rispetta i tempi. Apri con specchio. Chiudi con gancio a domani se non è finale. ${anti}`;
  }
  return en
    ? `Format: 8–10 concise lines. One voice. Visual, candid, current. Second person only. Include one concrete first step and one practical cost only if useful. Mirror in the first 1–2 lines. End with tomorrow-hook if not finale. ${anti}`
    : `Formato: 8–10 righe concise. Voce unica. Visivo, sincero, attuale. Solo seconda persona. Inserisci un primo passo concreto e un “costo” pratico solo se serve. Specchio nelle prime 1–2 righe. Chiudi con gancio a domani se non è finale. ${anti}`;
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

  // Predittivo esplicito — ma con anti-boilerplate
  L.push(
    en
      ? `PREDICTIVE OBJECTIVE:
- PAST → counterfactual as if it happened; add a plausible price-to-pay and one sign it worked.
- FUTURE → near-future path; add first small step and one practical cost only if helpful.
- Use decision window / anchor / tolerance implicitly; do NOT list them.
- ${`Avoid boilerplate words like "constraint/trade-off/indicator"; paraphrase.`}`
      : `OBIETTIVO PREDITTIVO:
- PASSATO → controfattuale come se fosse accaduto; inserisci una “parte da pagare” plausibile e un segno che avrebbe mostrato che funzionava.
- FUTURO → percorso di prossimo futuro; inserisci il primo passo piccolo e un costo pratico solo se utile.
- Usa finestra/ancora/tolleranza in modo implicito; NON fare elenchi.
- Evita parole a stampino come “vincolo/trade-off/indicatore”; parafrasa.`
  );

  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  return L.join("\n\n");
}

/* ============== Clarify (invariato, con fallback) ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You generate 2–3 short, focused clarifying questions (one line each) to better answer the user's main question. Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Generi 2–3 domande brevi e mirate (una riga) per rispondere meglio. Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;

  const period = en
    ? `You are PERIOD-AWARE:
- If TIMEFRAME = "past": ask about pivot year/event, place/context back then, key signal.
- If TIMEFRAME = "future": ask about decision window, a success sign, and a realistic resource.`
    : `Consapevolezza del PERIODO:
- PERIODO "past": chiedi anno/evento di svolta, luogo/contesto di allora, segno chiave.
- PERIODO "future": chiedi finestra decisionale, un segno di successo e una risorsa realistica.`;

  const profiling = en
    ? `Progressive profiling:
- If missing, ask for: city_now/city_origin, work_role, main goal (concrete), 2–3 values.`
    : `Profilazione progressiva:
- Se mancano: city_now/city_origin, work_role, obiettivo concreto, 2–3 valori.`;

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
    qs.push({ id: "key_signal", label: en ? "One sign it would've worked?" : "Un segno che avrebbe detto che funzionava?", placeholder: en ? "person/metric/result" : "persona/numero/risultato" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Vera finestra decisionale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "success_sign", label: en ? "One sign you're on track?" : "Un segno che sei sulla strada giusta?", placeholder: en ? "sleep, energy, first client" : "sonno, energia, primo cliente" });
    qs.push({ id: "practical_cost", label: en ? "Practical cost you accept?" : "Costo pratico che accetti?", placeholder: en ? "time, budget, focus" : "tempo, budget, focus" });
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
      clarifications = {},     // risposte dell’utente ai chiarimenti
      extra = "",              // input extra opzionale
      now: nowIso,             // opzionale: ISO dal client
      tz,                      // opzionale: timezone IANA dal client
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ---------- Clarify branch ---------- */
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
        if (start >= 0 && end > start) { questions = JSON.parse(raw.slice(start, end + 1)); }
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
        const clarHdr = { date: todayIso, used: (questions?.length || 0) };
        res.setHeader("X-Whatif-Clarify", JSON.stringify(clarHdr));
      } catch {}

      return res.status(200).json({ questions });
    }

    /* ---------- Generation branch ---------- */
    const sys1 = systemPrompt({ stile, lang, profile: profilo, nowIso, tz });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz });
    const sys2 = responseStyleInstruction(lang, stile);
    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "This is the FINALE for this thread: deliver closure (no cliffhanger). One-line invite to start a new 'what if'."
          : "Questo è il FINALE di questa storia: chiudi davvero (niente cliffhanger). Un invito in una riga a iniziare un nuovo 'e se'.")
      : (isEn(lang)
          ? `Mid-episode: end with a personal tomorrow-hook tied to ${profilo?.city_now || profilo?.city || (isEn(lang) ? "their city" : "la tua città")} or ${profilo?.work_role || profilo?.role || (isEn(lang) ? "their role" : "il tuo ruolo")}.`
          : `Episodio intermedio: chiudi con un gancio a domani legato a ${profilo?.city_now || profilo?.city || "la tua città"} o ${profilo?.work_role || profilo?.role || "il tuo ruolo"}.`);

    const fewshots = getFewShots(stile, lang);

    const messages = [
      { role: "system", content: sys1 },
      ...fewshots,
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.95 : 0.80;

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
