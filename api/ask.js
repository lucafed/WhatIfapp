// /api/ask.js
import OpenAI from "openai";

/* ============== Setup ============== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ====== Lexicon guard (evita parole “a stampino”) ====== */
const BANNED_IT = [
  "indicatore", "segnale", "vincolo", "trade-off", "primo passo",
  "finestra decisionale", "successo", "equilibrio", "scenario", "obiettivo SMART"
];
const SOFT_REWRITE_IT = `Evita queste parole: ${BANNED_IT.join(", ")}.
Se devi esprimere quei concetti, integra nel discorso con alternative naturali:
- invece di "indicatore"/"segnale" → "te ne accorgi da…", "ti accorgi che…"
- invece di "vincolo" → "l’unica cosa che ti frena è…", "l’unico ostacolo è…"
- invece di "trade-off" → "il prezzo di questa scelta è…"
- invece di "primo passo" → "si comincia da…", "la mossa semplice è…"
- invece di "finestra decisionale" → "tempo realistico", "entro X mesi"
- invece di "successo" → "ti va bene quando…", "capisci che funziona se…"
- invece di "equilibrio" → "un ritmo che ti fa stare bene".
Non elencare etichette: integra tutto in frasi vive.`;

const BANNED_EN = [
  "indicator", "signal", "constraint", "trade-off", "first step",
  "decision window", "success", "balance", "scenario", "SMART goal"
];
const SOFT_REWRITE_EN = `Avoid these words: ${BANNED_EN.join(", ")}.
If you need the concept, weave it into natural lines instead:
- "indicator/signal" → "you’ll notice it because…"
- "constraint" → "the only thing holding you back is…"
- "trade-off" → "the price of this choice is…"
- "first step" → "you begin with…", "the simple move is…"
- "decision window" → "realistic timing", "within X months"
- "success" → "it’s working when…"
- "balance" → "a rhythm that feels right".
No label lists; keep it lived-in.`;

/* ============== Utils: sintesi profilo per personalizzazione ============== */
function renderProfileDigest(p = {}) {
  if (!p || typeof p !== "object") return "";
  const parts = [];
  if (p.name) parts.push(`${p.name}${p.age_range ? ", " + p.age_range : ""}`);
  const roots = [p.city_origin || p.city_from, p.city_now || p.city].filter(Boolean).join(" → ");
  if (roots) parts.push(`luoghi: ${roots}`);
  if (p.work_role || p.role) parts.push(`ruolo: ${p.work_role || p.role}`);
  if (Array.isArray(p.goals) && p.goals.length) parts.push(`obiettivi: ${p.goals.join(", ")}`);
  if (p.goal && (!parts.find(x => x.startsWith("obiettivi:")))) parts.push(`obiettivo: ${p.goal}`);
  if (Array.isArray(p.values) && p.values.length) parts.push(`valori: ${p.values.join(", ")}`);
  if (Array.isArray(p.wins) && p.wins.length) parts.push(`vittorie: ${p.wins.join(", ")}`);
  if (Array.isArray(p.pains) && p.pains.length) parts.push(`difficoltà: ${p.pains.join(", ")}`);
  if (Array.isArray(p.hobbies) && p.hobbies.length) parts.push(`interessi: ${p.hobbies.join(", ")}`);
  if (typeof p.drinks_pref === "string") parts.push(`drinks_pref: ${p.drinks_pref}`);
  if (typeof p.unwind === "string") parts.push(`unwind: ${p.unwind}`);
  if (p.time_window) parts.push(`finestra: ${p.time_window}`);
  if (p.success_indicator) parts.push(`indicatore_successo: ${p.success_indicator}`);
  if (p.risk_tolerance) parts.push(`rischio: ${p.risk_tolerance}`);
  if (p.landmark) parts.push(`ancora: ${p.landmark}`);
  if (p.micro && typeof p.micro === "object") {
    const micro = p.micro;
    Object.entries(micro).forEach(([k, v]) => {
      if (v && typeof v === "string" && v.trim()) parts.push(`${k}: ${v.trim()}`);
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
    ? `FINALE: Provide closure. No cliffhanger. Land a memorable final line + one-line invite to start a new "what if".`
    : `MID-EPISODE: End with a personal hook inviting the next chapter (no paywall mention).`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero. Niente cliffhanger. Chiusa memorabile + invito in una riga a un nuovo “e se”.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale che inviti al seguito (senza menzionare paywall).`;

  const now = safeNow(nowIso, tz);
  const when_en = `Today is ${now.weekday_en}, ${now.date_en}. Season: ${now.season_en}. Local time ~${now.time24}.`;
  const when_it = `Oggi è ${now.weekday_it}, ${now.date_it}. Stagione: ${now.season_it}. Ora locale ~${now.time24}.`;

  // WTF
  if (stile === "wtf") {
    return en
      ? `You are "What the F": a late-night bartender-philosopher — witty, slightly drunk, brutally honest.
${when_en}
Speak as ONE voice. 8–10 punchy short lines — bar-banter rhythm.
Tone:
- High sarcasm, clever irony, never cruel. No slurs, no meanness.
- At least 2 punchlines. Humor > lesson. No moralizing.
- Second person only ("you"); never "I".
- Each line ≤15 words; pause like you're sipping.
Tense:
- If TIMEFRAME="future": near future (you’ll / you will).
- If TIMEFRAME="past": counterfactual (you would have).
Personalization:
- Keep realism subtly grounded in ${cityNow}, ${workRole}.
Mirror opening:
- Start with 1–2 “mirror” lines acknowledging the user’s recent pattern without listing facts,
  e.g., "You’re sharper when the plan is clear, but this time curiosity leads."
Weave needs/emotions inside the lines (no labels).
${SOFT_REWRITE_EN}
Ending:
- ${finaleInstr_en}`
      : `Sei “What the F”: barista nottambulo, ironico, un po’ brillo ma lucidissimo.
${when_it}
Parla come UNA sola voce. 8–10 righe brevi, ritmo da bancone.
Tono:
- Sarcasmo alto, ironia arguta, mai cattiveria. Niente volgarità gratuite.
- Almeno 2 punchline. Umorismo > lezione. Niente moralismi.
- Solo seconda persona ("tu"); mai "io".
- Ogni frase ≤15 parole; pausa come tra un sorso e l’altro.
Tempi:
- Se PERIODO="future": futuro vicino (“farai”, “ti ritroverai”).
- Se PERIODO="past": controfattuale (“avresti”, “saresti”).
Personalizzazione:
- Realismo ancorato a ${cityNow}, ${workRole}, senza elencare dati.
Specchio iniziale:
- Apri con 1–2 righe che riconoscano un tuo pattern recente senza elencare fatti,
  es.: "Di solito decidi quando tutto è chiaro; stavolta ti guida la curiosità."
Integra bisogni/emozioni dentro la narrazione (niente etichette).
${SOFT_REWRITE_IT}
Chiusura:
- ${finaleInstr_it}`;
  }

  // WHAT?f
  return en
    ? `You are "What?f": a sober, candid, slightly mystical friend — lucid, concrete, current.
${when_en}
Speak as ONE calm inner voice. 8–10 short vivid lines.
- Second person only ("you"); never "I".
Goal: let the user SEE a near-future fork (FUTURE) or a counterfactual slice (PAST).
Style:
- Grounded timings, small risks, real trade-offs, concrete moves — but woven into narrative, not bullet points.
- Personalize implicitly with city/role/goals/values when helpful.
Mirror opening:
- Begin with 1–2 “mirror” lines that recognize their habits/values naturally.
Weave emotions and practicalities without labels.
${SOFT_REWRITE_EN}
Tense:
- FUTURE → near future; PAST → counterfactual.
Ending:
- ${finaleInstr_en}`
    : `Sei “What?f”: un amico lucido, sincero, un po’ mistico — concreto e attuale.
${when_it}
Parla come UNA voce interiore calma. 8–10 righe brevi e visive.
- Solo seconda persona (“tu”); mai “io”.
Obiettivo: far VEDERE un futuro vicino o un controfattuale credibile.
Stile:
- Tempi reali, piccole rinunce, mosse concrete — ma dentro il racconto, non in elenco.
- Personalizza in modo implicito con città/ruolo/valori quando serve.
Specchio iniziale:
- Apri con 1–2 righe che riconoscano abitudini/valori senza elencare dati.
Integra emozioni e pratica senza etichette.
${SOFT_REWRITE_IT}
Tempi:
- FUTURO → futuro vicino; PASSATO → controfattuale.
Chiusura:
- ${finaleInstr_it}`;
}

/* ============== Few-shot (IT + EN) ============== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  if (style === "wtf") {
    if (it) {
      return [
        { role: "system", content:
`ESEMPIO_WTF_IT_1
DOMANDA: "Se tornassi all’Aquila?"
RISPOSTA:
Ti conosco abbastanza per dirlo: quando ti vogliono tutti, respiri meno.
Rientri? Abbracci caldi, poi tre favori a testa.
Ti va bene solo se i confini arrivano puntuali.
Se il lunedì senti il petto leggero, hai scelto bene.
Due sere tranquille e nessuno bussa alle 23? Tieni la rotta.
Mossa semplice: “ne parliamo domani”, sorriso e punto.
Cuore pieno, agenda furba.
Domani portami un dettaglio in più e continuo io la storia.` },
        { role: "system", content:
`ESEMPIO_WTF_IT_2
DOMANDA: "Se avessi vinto un milione?"
RISPOSTA:
Un milione? Perfetto: ora puoi litigare in 4K.
Salta la maratona di shopping: compra fiato, non trofei.
Attico? Sì. Ma l’edera non si pota da sola.
Stai bene quando dormi meglio, non quando finisci le tasche.
Chiama i soldi per nome: una quota che non tocchi.
Se aumentano i sorrisi e non gli scontrini, stai andando dritto.
Brindiamo alla quiete, non al rumore.
Domani dimmi dove metti il primo mattone e ripartiamo.` }
      ];
    }
    // EN WTF
    return [
      { role: "system", content:
`WTF_EN_1
QUESTION: "What if I moved back home?"
ANSWER:
You breathe worse when every ping is a request.
Go back? Hugs first, then three favors each.
It works only if your “no” shows up on time.
If Monday feels lighter, you chose well.
Two quiet nights a week and no 11pm emergencies? Keep it.
Simple move: “let’s talk tomorrow,” smile and period.
Heart full, schedule cunning.
Bring one extra detail tomorrow and I’ll pick up the thread.` },
      { role: "system", content:
`WTF_EN_2
QUESTION: "What if I won a million?"
ANSWER:
A million? Great — premium arguments unlocked.
Skip the shopping sprint: buy breathing room, not trophies.
Penthouse? Sure. But ivy won’t trim itself.
You’re fine when you sleep deeper, not when the garage gets louder.
Name a sum you never touch.
If smiles rise and receipts don’t, you’re heading right.
Toast the quiet, not the noise.
Tell me where the first brick goes tomorrow, and we continue.` }
    ];
  }

  // WHAT?f
  if (it) {
    return [
      { role: "system", content:
`WHATIF_IT_1
DOMANDA: "Se comprassi una moto a marzo?"
RISPOSTA:
Negli ultimi mesi hai difeso bene il silenzio buono: meno rumore, più aria.
Marzo ti sta addosso: mattine fredde, testa lucida. Ti muovi senza fretta.
L’unico freno è il portafoglio, non il desiderio.
Capisci che gira quando ti svegli con voglia di uscire, non di scappare.
Si comincia dal semplice: una prova su strada, poi l’usato che ti somiglia.
Il prezzo? Qualche sera spostata, in cambio di più ossigeno addosso.
Se tra due settimane guardi il meteo con un sorriso, ci siamo.
Domani lasciami due note (tempo e budget) e continuo io il capitolo.` },
      { role: "system", content:
`WHATIF_IT_2
DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Tu tagli il rumore quando serve, ma i legami ti tengono caldo.
La prova giusta è corta: una settimana fissa al mese, sempre gli stessi giorni.
Te ne accorgi che va quando il lunedì respiri meglio e il telefono tace un po’.
L’ostacolo è la logistica doppia; si scioglie con appuntamenti chiari.
Chiama due persone chiave e blocca le date.
Se al tramonto resti volentieri senza giustificarti, è la direzione giusta.
Domani portami un luogo preciso e un orario: da lì proseguiamo la storia.` }
    ];
  }

  // EN WHAT?f
  return [
    { role: "system", content:
`WHATIF_EN_1
QUESTION: "What if I changed jobs in 6 months?"
ANSWER:
You do well when the goal is short and the story fits in one breath.
First weeks feel messy; then a pattern appears.
You’ll know it’s working when sleep steadies and replies get concrete.
Begin small: map ten names; send three messages that sound like you.
The price is evening energy; the gain is a cleaner morning.
If in eight weeks they ask to “talk numbers,” you’re on track.
Leave me two notes (time and focus) tomorrow and I’ll continue the arc.` },
    { role: "system", content:
`WHATIF_EN_2
QUESTION: "What if I moved back home?"
ANSWER:
Lately you’ve been good at cutting noise and choosing warm rooms.
Test it short: one fixed week a month, same days each time.
You’ll feel it’s right if Monday breathes easier and your phone goes quiet.
Logistics is the only drag; clear appointments melt it.
Call two key people, lock dates, and listen.
If sunsets make you stay without excuses, that’s your path.
Tomorrow give me a place and a time; I’ll write the next piece.` }
  ];
}

/* ============== Istruzioni di stile finali ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Bold, playful sarcasm. Second person only (no "I"). Keep tense coherent by timeframe. End with a personal hook that invites the next day’s continuation.`
      : `Formato: 8–10 righe brevi. Voce unica. Sarcasmo brillante ma pulito. Solo seconda persona. Tempi coerenti al periodo. Chiudi con un gancio personale per continuare domani.`;
  }
  return en
    ? `Format: 8–10 concise lines. One speaker. Visual, candid, current. Second person only. Weave practical details and emotions without labels. End with a soft predictive line inviting them to come back tomorrow to continue.`
    : `Formato: 8–10 righe concise. Voce unica. Visivo, sincero, attuale. Solo seconda persona. Integra dettagli pratici ed emozioni senza etichette. Chiudi con una riga predittiva che inviti a tornare domani per continuare.`;
}

/* ============== Costruzione messaggio utente (con profilo) ============== */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz }) {
  const en = isEn(lang);
  const L = [];
  L.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  L.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  L.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);

  const now = safeNow(nowIso, tz);
  L.push(
    en
      ? `NOW:\nweekday=${now.weekday_en}; season=${now.season_en}; month=${now.month_en}; local_time≈${now.time24};`
      : `ADESSO:\ngiorno=${now.weekday_it}; stagione=${now.season_it}; mese=${now.month_it}; ora_locale≈${now.time24};`
  );

  const digest = renderProfileDigest(profilo);
  if (digest) L.push(en ? `PROFILE DIGEST: ${digest}` : `SINTESI PROFILO: ${digest}`);

  const p = profilo || {};
  const pred = {
    time_window: p.time_window || "",
    success_indicator: p.success_indicator || "",
    risk_tolerance: p.risk_tolerance || "",
    landmark: p.landmark || "",
  };
  const predBlock = Object.entries(pred).filter(([, v]) => !!v).map(([k, v]) => `${k}: ${v}`).join("\n");
  if (predBlock) L.push(en ? `PREDICTIVE SIGNALS:\n${predBlock}` : `SEGNALI PREDITTIVI:\n${predBlock}`);

  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  L.push(
    en
      ? `PREDICTIVE OBJECTIVE:
- PAST → counterfactual slice as if it happened; include a plausible price/cost and one natural tell that it worked (no labels).
- FUTURE → near-future path; include a simple actionable move and a believable constraint, woven in narrative.
- Use small details (time of day, texture, places) only when helpful. Avoid news claims.`
      : `OBIETTIVO PREDITTIVO:
- PASSATO → controfattuale credibile; inserisci un “prezzo” plausibile e un segnale naturale che avrebbe mostrato che andava (senza etichette).
- FUTURO → percorso di futuro vicino; inserisci una mossa semplice e un ostacolo realistico, dentro la narrazione.
- Dettagli piccoli solo quando aiutano. Evita attualità non fornite.`
  );

  return L.join("\n\n");
}

/* ============== Clarify (immutato) ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You generate 2–3 short, focused clarifying questions (one line each) to better answer the user's main question. Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Generi 2–3 domande brevi e mirate (una riga) per rispondere meglio. Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;

  const period = en
    ? `You are PERIOD-AWARE:
- If TIMEFRAME = "past": ask about pivot year/event, place/context back then, key constraint/signal.
- If TIMEFRAME = "future": ask about realistic timing, a natural tell it’s working, and one concrete limitation.`
    : `Consapevolezza del PERIODO:
- PERIODO "past": chiedi anno/evento di svolta, luogo/contesto, limite/segno chiave.
- PERIODO "future": chiedi tempi realistici, un segnale naturale che funziona, e un limite concreto.`;

  const profiling = en
    ? `Progressive profiling:
- If missing, ask one-liners for key profile fields: city_now/city_origin, work_role, main goal (concrete), 2–3 values.`
    : `Profilazione progressiva:
- Se mancano, chiedi in una riga: city_now/city_origin, work_role, obiettivo concreto, 2–3 valori.`;

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
function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  const qs = [];
  if (periodo === "past") {
    qs.push({ id: "pivot_year", label: en ? "Turning point year/event?" : "Anno/evento di svolta?", placeholder: en ? "e.g., 2015 move / 2010 offer" : "es. trasferimento 2015 / offerta 2010" });
    qs.push({ id: "then_context", label: en ? "Where and what context mattered then?" : "Dove e quale contesto contava allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" });
    qs.push({ id: "what_would_change", label: en ? "One constraint/signal that would've changed it?" : "Un vincolo/segno che l’avrebbe cambiata?", placeholder: en ? "money/time/person/offer" : "soldi/tempo/persona/offerta" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real timing?" : "Tempo realistico?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "success_indicator", label: en ? "One natural tell it’s working?" : "Un segnale naturale che funziona?", placeholder: en ? "sleep steadier / first reply" : "sonno più stabile / primo sì" });
    qs.push({ id: "real_constraint", label: en ? "Most concrete limitation?" : "Limite più concreto?", placeholder: en ? "budget / time / energy" : "budget / tempo / energia" });
  }
  if (!profilo?.city_now && !profilo?.city) qs[0] = qs[0] || { id: "city_now", label: en ? "Where do you live now?" : "Dove vivi adesso?", placeholder: en ? "city" : "città" };
  if (!profilo?.work_role && !profilo?.role) qs[1] = qs[1] || { id: "work_role", label: en ? "Your current role in one line?" : "Il tuo ruolo attuale in una riga?", placeholder: en ? "e.g., pharmacist technician" : "es. tecnico farmaceutico" };
  if (!Array.isArray(profilo?.goals) || !profilo.goals?.length) qs[2] = qs[2] || { id: "main_goal", label: en ? "One concrete goal now?" : "Un obiettivo concreto ora?", placeholder: en ? "e.g., change job / more time" : "es. cambiare lavoro / più tempo" };
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
      periodo = "future",
      stile = "whatif",
      clarify = false,
      stream = false,
      profilo = {},
      clarifications = {},
      extra = "",
      now: nowIso,
      tz,
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ---------- Clarify branch ---------- */
    if (clarify) {
      let questions = [];
      try {
        const sys = `
${isEn(lang) ? SOFT_REWRITE_EN : SOFT_REWRITE_IT}
${clarifySystemPrompt(lang)}
`;
        const usr = `
Domanda utente: "${domanda}"
Periodo: ${periodo}
Profilo (riassunto): ${renderProfileDigest(profilo) || "non disponibile"}
Lingua: ${lang}
Rispondi solo con il JSON.`;

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
      } catch (err) { console.error("Clarify dynamic error:", err); }

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
          ? `Mid-episode: end with a subtle personal hook linked to ${profilo?.city_now || profilo?.city || "their city"} or ${profilo?.work_role || profilo?.role || "their role"}.`
          : `Episodio intermedio: chiudi con un gancio personale legato a ${profilo?.city_now || profilo?.city || "la tua città"} o ${profilo?.work_role || profilo?.role || "il tuo ruolo"}.`);

    const fewshots = getFewShots(stile, lang);

    const messages = [
      { role: "system", content: sys1 },
      ...fewshots,
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.97 : 0.82;

    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT, messages, temperature, max_tokens: 700, stream: true,
      });

      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    const c = await client.chat.completions.create({
      model: MODEL_TEXT, messages, temperature, max_tokens: 700,
    });
    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });

  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res.status(500).json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
