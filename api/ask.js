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

  // Segnali predittivi se presenti
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

/* ============== Persona prompts (predittivi e chiari) ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz, hasNews }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);

  const finaleInstr_en = finale
    ? `FINALE: Provide closure. No cliffhanger. Land a memorable final line.
For What?f: reflective, warm resolution + one-line invite to start a new 'what if'.
For What the F: sharp closing punchline + playful invite to pick a new mess.`
    : `MID-EPISODE: End with a subtle, personal hook that invites the next step (no paywall mention).`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero. Niente cliffhanger. Chiusa memorabile.
Per What?f: risoluzione calda + invito in una riga a un nuovo “e se”.
Per What the F: punchline tagliente + invito giocoso a scegliere un nuovo casino.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile che inviti al seguito (senza menzionare paywall).`;

  const now = safeNow(nowIso, tz);
  const when_en = `Today is ${now.weekday_en}, ${now.date_en}. Season: ${now.season_en}. Local time ~${now.time24}.`;
  const when_it = `Oggi è ${now.weekday_it}, ${now.date_it}. Stagione: ${now.season_it}. Ora locale ~${now.time24}.`;

  if (stile === "wtf") {
    // 🥃 WHAT THE F — più predittivo, chiaro, ritmato
    return en
      ? `You are "What the F": a late-night bartender-philosopher — witty, slightly drunk, brutally honest.
${when_en}
Speak as ONE voice. 8–10 short lines. Predictive, clear, concrete.
Tone:
- Bold sarcasm, clever irony, never mean. No moralizing.
- 2–3 mini punchlines. Keep it human and sharp.
Structure:
- Each line ≤15 words. Show a tiny scene, then outcome and trade-off.
- Include a realistic first step and a constraint when FUTURE.
- When PAST, show the counterfactual outcome + one signal it worked.
Personalization:
- Subtly grounded in ${cityNow}, ${workRole}. No data dump.
Current events:
- ${hasNews ? "You MAY use the provided news context if relevant." : "Do NOT invent news; stay timeless unless user provided context."}
Ending:
- ${finaleInstr_en}`
      : `Sei “What the F”: barista nottambulo, ironico, un po’ brillo ma lucidissimo.
${when_it}
Parla come UNA voce. 8–10 righe. Predittivo, chiaro, concreto.
Tono:
- Sarcasmo deciso, ironia arguta, mai cattivo. Niente prediche.
- 2–3 mini punchline. Umano e tagliente.
Struttura:
- ≤15 parole per riga. Mini-scena, poi esito e trade-off.
- FUTURO: primo passo realistico + vincolo concreto.
- PASSATO: esito controfattuale + un segnale che stava funzionando.
Personalizzazione:
- Ancorato a ${cityNow}, ${workRole}. Niente elenco di dati.
Attualità:
- ${hasNews ? "PUOI usare il contesto notizie fornito, se pertinente." : "NON inventare notizie; resta senza tempo se non fornito."}
Chiusura:
- ${finaleInstr_it}`;
  }

  // 🌙 WHAT?f — amico lucido, sincero, un po’ mistico; meno smielato; predittivo
  return en
    ? `You are "What?f": a candid, slightly mystical friend — lucid, concrete, current.
${when_en}
One calm inner voice. 8–10 concise lines. Predict what would likely unfold.
Goal:
- PAST: write it as if it happened, including a plausible cost and the signal it worked.
- FUTURE: show a near-future fork with first small step, success indicator, realistic constraint.
Style:
- Less sweet, more grounded. Real timing windows. Short, visual details only when useful.
- Weave risk tolerance and place/person anchors naturally.
Personalization:
- Use profile digest implicitly (cities, role, goals, values).
Current events:
- ${hasNews ? "You MAY use the provided news context if relevant." : "Do NOT invent news; stay timeless unless context is provided."}
Ending:
- ${finaleInstr_en}`
    : `Sei “What?f”: un amico sincero, un po’ mistico — lucido e concreto.
${when_it}
Una sola voce calma. 8–10 righe incisive. Predici cosa è/può essere plausibile.
Obiettivo:
- PASSATO: scrivi come se fosse accaduto, con costo plausibile e segnale di riuscita.
- FUTURO: mostra una biforcazione di prossimo futuro con primo passo, indicatore di successo, vincolo realistico.
Stile:
- Meno smielato, più ancorato. Finestre temporali reali. Dettagli brevi solo se servono.
- Intreccia tolleranza al rischio e ancore di luogo/persona in modo naturale.
Personalizzazione:
- Usa la sintesi profilo in modo implicito (città, ruolo, obiettivi, valori).
Attualità:
- ${hasNews ? "PUOI usare il contesto notizie fornito, se pertinente." : "NON inventare attualità; resta senza tempo se non fornita."}
Chiusura:
- ${finaleInstr_it}`;
}

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Predictive mini-scene → outcome → trade-off. FUTURE includes first step + constraint. PAST includes "it worked" signal. Clear language.`
      : `Formato: 8–10 righe. Voce unica. Mini-scena predittiva → esito → trade-off. FUTURO include primo passo + vincolo. PASSATO include segnale di riuscita. Linguaggio chiaro.`;
  }
  return en
    ? `Format: 8–10 concise lines. One speaker. Visual, candid, predictive. Include time window, first step, and success indicator when relevant. End as instructed.`
    : `Formato: 8–10 righe concise. Voce unica. Visivo, sincero, predittivo. Includi finestra temporale, primo passo e indicatore di successo quando utile. Chiudi come istruito.`;
}

/* ============== Costruzione messaggio utente (profilo + attualità) ============== */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz, news_context }) {
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

  // Attualità (opzionale, fornita dal client)
  if (news_context && String(news_context).trim()) {
    L.push(en ? `NEWS CONTEXT (verbatim, user-provided):\n${news_context}` : `CONTESTO ATTUALITÀ (fornito dall’utente):\n${news_context}`);
  } else {
    L.push(en
      ? `NEWS CONSTRAINT: Do NOT invent news. Only use current events if they appear in NEWS CONTEXT.`
      : `VINCOLO ATTUALITÀ: NON inventare notizie. Usa attualità solo se presente nel CONTESTO ATTUALITÀ.`);
  }

  // Predittivo esplicito
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
  if (predBlock) L.push(en ? `PREDICTIVE SIGNALS:\n${predBlock}` : `SEGNALI PREDITTIVI:\n${predBlock}`);

  // Chiarimenti utente
  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  // Istruzioni per “predizione” concreta
  L.push(
    en
      ? `PREDICTIVE OBJECTIVE:
- PAST → counterfactual vignette as if it happened: include a plausible cost/trade-off and one signal that would've told them it worked.
- FUTURE → near-future path if they choose now: include first small step (1 call/email/hour), a concrete success indicator, and a realistic constraint.
- Weave decision window, risk tolerance, and the place/person anchor naturally (no bullet list).
- Use small specific details (time of day, neighborhood, texture) only when relevant.`
      : `OBIETTIVO PREDITTIVO:
- PASSATO → vignetta controfattuale come se fosse accaduta: inserisci un costo/trade-off plausibile e un segnale che avrebbe indicato che stava funzionando.
- FUTURO → percorso di prossimo futuro se sceglie ora: inserisci il primo passo piccolo (1 chiamata/email/ora), un indicatore di successo concreto e un vincolo realistico.
- Intreccia finestra decisionale, tolleranza al rischio e luogo/persona-ancora in modo naturale (no elenco puntato).
- Usa dettagli piccoli (orario, quartiere, “texture”) solo se servono.`
  );

  return L.join("\n\n");
}

/* ============== Clarify: più pertinente e period-aware ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You generate 2–3 short, focused clarifying questions (one line each) to better answer the user's main question. Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Generi 2–3 domande brevi e mirate (una riga) per rispondere meglio. Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;

  const period = en
    ? `You are PERIOD-AWARE:
- If TIMEFRAME = "past": ask about pivot year/event, place/context back then, key constraint/signal.
- If TIMEFRAME = "future": ask about decision window, success indicator, realistic constraint/resource.`
    : `Consapevolezza del PERIODO:
- PERIODO "past": chiedi anno/evento di svolta, luogo/contesto di allora, vincolo/segno chiave.
- PERIODO "future": chiedi finestra decisionale, indicatore di successo, vincolo/risorsa realistica.`;

  const profiling = en
    ? `Progressive profiling:
- If missing, ask one-liners for key profile fields: city_now/city_origin, work_role, main goal (concrete), 2–3 values.`
    : `Profilazione progressiva:
- Se mancano, chiedi in una riga i campi chiave: city_now/city_origin, work_role, obiettivo principale (concreto), 2–3 valori.`;

  const topical = en
    ? `Topical targeting:
- Infer topic tags (work, move, study, money, relationships, wellbeing, creative). Align questions to the detected topic.`
    : `Target tematico:
- Intuisci il tema (lavoro, trasferimento, studio, soldi, relazioni, benessere, creativo) e allinea le domande al tema.`;

  return `${base}\n${period}\n${profiling}\n${topical}`;
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

/* ============== Fallback clarify (mirato) ============== */
function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  const qs = [];
  const s = (domanda || "").toLowerCase();

  const isWork  = /\b(lavor|work|career|job|azienda|progetto|project|manager|collega)\b/i.test(s);
  const isMove  = /\b(trasfer|citt|quartier|move|city|neigh|country|emigra)\b/i.test(s);
  const isStudy = /\b(stud|master|laurea|course|study|bootcamp|corso)\b/i.test(s);
  const isMoney = /\b(euro|€|soldi|stipendio|debito|invest|salary|debt|rent|mutuo|mortgage)\b/i.test(s);
  const isRel   = /\b(amore|relazion|partner|famiglia|friend|relationship)\b/i.test(s);
  const isWell  = /\b(stress|burnout|sonno|salute|allen|work-life|equilibrio|sleep)\b/i.test(s);
  const isCreative = /\b(arte|artist|scriv|write|design|musica|music|film)\b/i.test(s);

  if (periodo === "past") {
    qs.push({ id: "pivot_year", label: en ? "Turning point year/event?" : "Anno/evento di svolta?", placeholder: en ? "e.g., 2018 offer / 2015 move" : "es. offerta 2018 / trasferimento 2015" });
    qs.push({ id: "then_context", label: en ? "Where and what context mattered then?" : "Dove e quale contesto contava allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" });
    qs.push({ id: "would_signal", label: en ? "One signal it would've worked?" : "Un segnale che avrebbe detto: funziona?", placeholder: en ? "first client / better sleep / budget" : "primo cliente / sonno migliore / budget" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Vera finestra decisionale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "success_indicator", label: en ? "One success indicator?" : "Un indicatore di successo?", placeholder: en ? "€ saved / hours / first client" : "€ risparmiati / ore / primo cliente" });
    qs.push({ id: "real_constraint", label: en ? "Most concrete constraint?" : "Vincolo più concreto?", placeholder: en ? "budget / time / energy / commitment" : "budget / tempo / energia / impegno" });
  }

  // Raffina per tema
  if (isWork) {
    qs.unshift({ id: "priority", label: en ? "Top work priority now?" : "Priorità #1 nel lavoro?", placeholder: en ? "growth / stability / flexibility" : "crescita / stabilità / flessibilità" });
  } else if (isMove) {
    qs.unshift({ id: "landmark", label: en ? "One place that matters there?" : "Un luogo che conta lì?", placeholder: en ? "square / station / neighborhood" : "piazza / stazione / quartiere" });
  } else if (isStudy) {
    qs.unshift({ id: "focus", label: en ? "Study focus first?" : "Focus di studio?", placeholder: en ? "topic / program / school" : "materia / corso / scuola" });
  } else if (isMoney) {
    qs.unshift({ id: "budget_delta", label: en ? "Realistic monthly budget impact?" : "Impatto realistico sul budget mensile?", placeholder: en ? "±€ / fixed / variable" : "±€ / fisso / variabile" });
  } else if (isRel) {
    qs.unshift({ id: "relation_axis", label: en ? "Relationship axis here?" : "Asse della relazione qui?", placeholder: en ? "partner / family / friends" : "partner / famiglia / amici" });
  } else if (isWell) {
    qs.unshift({ id: "well_signal", label: en ? "One wellbeing signal?" : "Un segnale di benessere?", placeholder: en ? "sleep hours / energy / pace" : "ore di sonno / energia / ritmo" });
  } else if (isCreative) {
    qs.unshift({ id: "creative_output", label: en ? "Concrete creative output?" : "Output creativo concreto?", placeholder: en ? "pages/week, tracks/month" : "pagine/settimana, brani/mese" });
  }

  // Profilazione progressiva (se mancano)
  if (!profilo?.city_now && !profilo?.city) {
    qs.push({ id: "city_now", label: en ? "Where do you live now?" : "Dove vivi adesso?", placeholder: en ? "city" : "città" });
  }
  if (!profilo?.work_role && !profilo?.role) {
    qs.push({ id: "work_role", label: en ? "Your current role in one line?" : "Il tuo ruolo attuale in una riga?", placeholder: en ? "e.g., pharmacist technician" : "es. tecnico farmaceutico" });
  }
  if (!Array.isArray(profilo?.goals) || !profilo.goals?.length) {
    qs.push({ id: "main_goal", label: en ? "One concrete goal now?" : "Un obiettivo concreto ora?", placeholder: en ? "e.g., change job / more time" : "es. cambiare lavoro / più tempo" });
  }

  // Primi 3 mirati
  const dedup = [];
  const used = new Set();
  for (const q of qs) {
    if (!used.has(q.id)) { dedup.push(q); used.add(q.id); }
    if (dedup.length >= 3) break;
  }
  return dedup;
}

/* ============== Helpers tempo ============== */
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
      clarifications = {},     // risposte dell’utente ai chiarimenti
      extra = "",              // input extra opzionale (es. "answer strictly in ...")
      news_context = "",       // *** nuovo: blocco attualità dal client (opzionale)
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
          temperature: 0.3,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: usr },
          ],
        });
        const raw = resp.choices?.[0]?.message?.content?.trim() || "[]";
        const start = raw.indexOf("[");
        const end = raw.lastIndexOf("]");
        if (start >= 0 && end > start) {
          questions = JSON.parse(raw.slice(start, end + 1));
        }
      } catch (_) { /* fallback sotto */ }

      if (!Array.isArray(questions) || questions.length === 0) {
        questions = localClarify(domanda, profilo, lang, periodo);
      }

      questions = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i + 1}`),
        label: String(q.label || q?.text || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));

      // Header diagnostico (facoltativo)
      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        const clar = { date: todayIso, used: (questions?.length || 0) };
        res.setHeader("X-Whatif-Clarify", JSON.stringify(clar));
      } catch {}

      return res.status(200).json({ questions });
    }

    /* ---------- Generation branch ---------- */
    const hasNews = !!(news_context && String(news_context).trim());
    const sys1 = systemPrompt({ stile, lang, profile: profilo, nowIso, tz, hasNews });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz, news_context });
    const sys2 = responseStyleInstruction(lang, stile);

    // Finale/mid-episode hint (rinforzo)
    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "This is the FINALE for this thread: deliver closure (no cliffhanger). One-line invite to start a new 'what if'."
          : "Questo è il FINALE di questa storia: chiudi davvero (niente cliffhanger). Un invito in una riga a iniziare un nuovo 'e se'.")
      : (isEn(lang)
          ? `Mid-episode: end with a subtle personal hook linked to ${profilo?.city_now || profilo?.city || (isEn(lang) ? "their city" : "la tua città")} or ${profilo?.work_role || profilo?.role || (isEn(lang) ? "their role" : "il tuo ruolo")}.`
          : `Episodio intermedio: chiudi con un gancio personale legato a ${profilo?.city_now || profilo?.city || "la tua città"} o ${profilo?.work_role || profilo?.role || "il tuo ruolo"}.`);

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    // Temperatura: più alta per wtf per favorire battute e ritmo
    const temperature = stile === "wtf" ? 0.95 : 0.78;

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
