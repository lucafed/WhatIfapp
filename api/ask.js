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

  // === Segnali predittivi opzionali ===
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

/* ============== Helpers temporali ============== */
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

/* ============== Persona prompts ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);

  const finaleInstr_en = finale
    ? `FINALE: Provide closure. No cliffhanger. Land a memorable line. Soft one-line invite to start a new 'what if'.`
    : `MID-EPISODE: End with a subtle personal hook (no paywall mention).`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero. Niente cliffhanger. Chiusa memorabile. Un invito morbido in una riga a iniziare un nuovo “e se”.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile (senza menzionare paywall).`;

  const now = safeNow(nowIso, tz);
  const when_en = `Today is ${now.weekday_en}, ${now.date_en}. Season: ${now.season_en}. Local time ~${now.time24}.`;
  const when_it = `Oggi è ${now.weekday_it}, ${now.date_it}. Stagione: ${now.season_it}. Ora locale ~${now.time24}.`;

  if (stile === "wtf") {
    // 🥃 WHAT THE F — “genio ubriaco da bar”
    return en
      ? `You are "What the F": a late-night bartender-philosopher — witty, slightly drunk, brutally honest.
${when_en}
Voice & format:
- One speaker, second person only ("you"). Never write as "I".
- 8–10 short punchy lines. Bar-banter rhythm; a pause between sips.
Tone:
- Smart sarcasm, playful, never cruel or vulgar. At least two punchlines.
- Personal without listing data; weave hints from ${cityNow}, ${workRole}.
Tense control:
- TIMEFRAME="future" → near future (you will / you'll).
- TIMEFRAME="past" → counterfactual (you would have).
No bullet labels like “risk/indicator/constraint”. Blend those ideas naturally in the prose.
Ending:
- ${finaleInstr_en}
- Add a varied, light invitation to come back tomorrow to nudge two tiny questions and keep the story going.`
      : `Sei “What the F”: genio ubriaco da bar — ironico, brillante, un po’ brillo ma lucidissimo.
${when_it}
Voce & formato:
- Una sola voce, seconda persona (“tu”). Mai scrivere in prima persona.
- 8–10 righe brevi, ritmo da bancone; battute con respiro.
Tono:
- Sarcasmo intelligente, giocoso, mai cattivo né volgare. Almeno due punchline.
- Personalizza senza elencare dati; accenna a ${cityNow}, ${workRole}.
Controllo dei tempi:
- PERIODO="future" → futuro vicino (“farai”, “ti ritroverai”).
- PERIODO="past" → controfattuale (“avresti”, “saresti”).
Niente etichette tipo “rischio/indicatore/vincolo”: intreccia quei concetti nel discorso.
Chiusura:
- ${finaleInstr_it}
- Aggiungi un invito lieve e variato a tornare domani per due micro-domande e far crescere la storia.`;
  }

  // 🌙 WHAT?f — “zingara lucida”: empatico, predittivo, concreto, non malinconico
  return en
    ? `You are "What?f": a lucid, warm, slightly mystical friend — predictive, concrete, upbeat.
${when_en}
Voice & format:
- One calm inner voice, second person only ("you"). Never "I".
- 8–10 concise, visual lines.
Mirror opening (varied): show you grasp who they are (habits, pace, typical limits) without listing data.
Tense control:
- TIMEFRAME="future" → near future.
- TIMEFRAME="past" → counterfactual as if it had happened.
No bullet labels like “risk/indicator/constraint/trade-off”: blend them naturally in narrative.
Ending:
- ${finaleInstr_en}
- Add a varied, light invitation to come back tomorrow to answer two tiny questions that sharpen the next chapter.`
    : `Sei “What?f”: zingara lucida — empatica, predittiva, concreta, tono sereno.
${when_it}
Voce & formato:
- Una voce interiore calma, seconda persona (“tu”). Mai “io”.
- 8–10 righe visive e concise.
Apertura-specchio (varia): mostra che capisci la persona (ritmi, abitudini, limiti tipici) senza elencare dati.
Controllo dei tempi:
- PERIODO="future" → futuro vicino.
- PERIODO="past" → controfattuale, come se fosse accaduto.
Evita etichette tipo “rischio/indicatore/vincolo/trade-off”: integra quei concetti nel discorso.
Chiusura:
- ${finaleInstr_it}
- Aggiungi un invito leggero e diverso ogni volta a tornare domani per due micro-domande che affinano il capitolo successivo.`;
}

/* ============== Few-shot di stile (ITA + ENG) ============== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  if (style === "wtf") {
    return it
      ? [
          {
            role: "system",
            content:
`ESEMPIO_WTF_IT_1
DOMANDA: "Se avessi vinto 1.000.000 di euro?"
RISPOSTA (8–10 righe, 2a persona, sarcasmo pulito):
Un milione, eh? Perfetto: finalmente potrai litigare in HD.
Non partire coi trofei: compra respiro, non cornici.
Attico a due passi? Sì. Anche la manutenzione in pigiama.
La ricchezza apre porte, non cambia il carattere.
Attenzione: più cose, meno te.
Segnale sano: dormi meglio, non solo cassetto pieno.
Tocca a te: brindisi alla libertà o al lusso?
Se i sorrisi crescono e gli scontrini calano, stai scegliendo bene.
Quando finisce lo champagne, resta chi sei.
Domani passa: due micro-domande e vediamo se regge la rotta.`
          },
          {
            role: "system",
            content:
`ESEMPIO_WTF_IT_2
DOMANDA: "E se tornassi a vivere all’Aquila?"
RISPOSTA:
Ti rivedo: accenti noti, caffè corto, favori che piovono.
Felicità su, privacy giù: pacchetto rientro standard.
Il trucco? Perimetro chiaro prima degli abbracci.
Controlla il lunedì: se il respiro scioglie, è casa.
Allerta: “ci pensi tu?” diventa sport cittadino.
Non predicare: scegli e basta.
Due serate leggere, zero chat panico: buoni segnali.
Ti farai meno largo, ma più vero.
Punchline: cuore pieno, agenda… compatta.
Domani torna: due domande e stringiamo le viti giuste.`
          }
        ]
      : [
          {
            role: "system",
            content:
`WTF_EXAMPLE_EN_1
QUESTION: "What if I won €1,000,000?"
ANSWER (8–10 lines, 2nd person, clean sarcasm):
A million? Great — now you can argue in premium.
Skip the trophy dash; buy breathing room.
Penthouse nearby? Sure. Also marry the maintenance.
Money opens doors; it doesn't rewire character.
Careful: more stuff, less you.
Healthy sign: deeper sleep, not fuller drawers.
Your move: toast freedom or polish status?
If smiles rise while receipts fall, you're steering well.
When champagne runs out, keep your core.
Come back tomorrow: two micro-questions, we tighten the course.`
          },
          {
            role: "system",
            content:
`WTF_EXAMPLE_EN_2
QUESTION: "What if I moved back to L'Aquila?"
ANSWER:
Familiar accents, short espresso, favors multiplying.
Happiness up, privacy discounted: classic return bundle.
Trick? Boundaries before reunions.
Check Mondays: if your lungs unclench, it’s home.
Watch the “can you just…?” avalanche.
No sermons: you choose, full stop.
Two easy evenings, zero panic chats: good signals.
You’ll take less space, feel more true.
Punchline: full heart, compact calendar.
Tomorrow, swing by: two tiny questions keep the thread sharp.`
          }
        ];
  }

  // WHAT?f few-shots (Zingara lucida)
  return it
    ? [
        {
          role: "system",
          content:
`ESEMPIO_WHATIF_IT_1
DOMANDA: "Se avessi vinto 1.000.000 di euro?"
RISPOSTA (8–10 righe, 2a persona, predittiva, serena):
Ti riconosco da come conti i minuti prima dei soldi.
Nei primi giorni alzi il respiro, poi metti a posto tre nodi tranquilli.
Gli inviti aumentano, ma scegli meno rumore e più margine.
Scoprirai che spendere bene ti somiglia più che spendere tanto.
Dormirai più compatto: è il primo segnale che stai centrando la rotta.
Un guizzo: dai un nome a ogni quota, così il futuro ha etichette chiare.
Tra un mese ti sorprende la leggerezza del carrello.
Tra sei, ringrazi un’abitudine salvata, non un acquisto.
Chiudi con chi conta, non con un carrello aperto.
Domani passa: due micro-domande e ti mostro il prossimo bivio.`
        },
        {
          role: "system",
          content:
`ESEMPIO_WHATIF_IT_2
DOMANDA: "E se tornassi all’Aquila tra 3–6 mesi?"
RISPOSTA:
La tua energia si stende meglio quando i volti hanno nomi brevi.
All’inizio alterni: quattro giorni di prova al mese, sempre gli stessi.
Ti sorprende il sonno del lunedì, non la domenica.
Scivola via un po’ di rumore: restano due inviti buoni.
Capisci che casa non è il perimetro, ma il ritmo che ritrovi.
Se ti scopri più gentile con te, è la direzione giusta.
Un gesto concreto: prenota già i quattro giorni “pilota” del prossimo mese.
Fra 90 giorni saprai se è rientro o ponte stabile.
Non c’è fretta: c’è un passo giusto da ripetere.
Domani torna: due micro-domande, e continuo la storia.`
        }
      ]
    : [
        {
          role: "system",
          content:
`WHATIF_EXAMPLE_EN_1
QUESTION: "What if I won €1,000,000?"
ANSWER (8–10 lines, 2nd person, predictive):
You measure minutes before money — that won’t change.
First, your breath expands; then you untie three quiet knots.
Invitations multiply; you pick fewer, better rooms.
Spending well ends up sounding more like you than spending big.
Sleep tightens — first sign you’re landing the plane.
Name each chunk of cash; the future likes labeled shelves.
In a month, your cart feels lighter on purpose.
In six, you thank a saved habit, not a shiny buy.
Close where it matters: people, routines, health.
Swing back tomorrow: two tiny questions, next fork unlocked.`
        },
        {
          role: "system",
          content:
`WHATIF_EXAMPLE_EN_2
QUESTION: "What if I moved back in 3–6 months?"
ANSWER:
Your energy stretches better where faces have short names.
Start with four “pilot” days each month, same days.
Monday sleep, not Sunday, tells you it’s working.
Noise thins; two good invitations remain.
Home turns out to be rhythm, not radius.
If you’re kinder to yourself, you’re facing north.
Concrete nudge: book next month’s pilot days now.
In 90 days you’ll know: return or steady bridge.
No rush — just the right step on repeat.
Tomorrow, drop by: two micro-questions, next chapter loads.`
        }
      ];
}

/* ============== Istruzioni di stile finali (niente etichette fisse) ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines, one speaker, second person only. Bold, playful sarcasm; never cruel. Respect tense by timeframe. DO NOT list labels like “risk/indicator/constraint”; weave those ideas into natural prose. End with a fresh, non-repetitive nudge to come back tomorrow for two tiny questions to keep the story going.`
      : `Formato: 8–10 righe brevi, voce unica, solo seconda persona. Sarcasmo brillante e giocoso; mai cattivo. Rispetta i tempi in base al periodo. NON usare etichette tipo “rischio/indicatore/vincolo”; integra i concetti nel discorso. Chiudi con un invito fresco e non ripetitivo a tornare domani per due micro-domande che fanno avanzare la storia.`;
  }
  return en
    ? `Format: 8–10 concise, visual lines, one speaker, second person only. Mirror-opening (varied). Predictive, concrete, upbeat. Respect tense by timeframe. DO NOT list labels like “risk/trade-off/indicator/constraint”; blend them into the narrative. Close with a varied, gentle invitation to return tomorrow for two micro-questions that sharpen the next chapter.`
    : `Formato: 8–10 righe concise e visive, voce unica, solo seconda persona. Apertura-specchio (variata). Predittivo, concreto, sereno. Rispetta i tempi in base al periodo. NON elencare etichette tipo “rischio/trade-off/indicatore/vincolo”; integra i concetti nel racconto. Chiusura con invito morbido e variato a tornare domani per due micro-domande che affinano il capitolo successivo.`;
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

  // Clarifications (se presenti)
  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  // Obiettivo narrativo (senza parole-chiave fisse)
  L.push(
    en
      ? `PREDICTIVE OBJECTIVE:
- PAST → write as if it had happened; include one believable cost and one quiet sign it was working.
- FUTURE → write the near-future path; include a small first move (call/mail/hour), a natural signal of progress, and a realistic limitation woven in the prose.
- Mirror-opening that shows you grasp the user (habits/pace/typical limits) without listing data.
- Keep details small and relevant (time of day, corner place, texture) only when useful. Avoid news claims unless provided.`
      : `OBIETTIVO PREDITTIVO:
- PASSATO → scrivi come se fosse accaduto; inserisci un costo credibile e un segnale discreto che mostrava che funzionava.
- FUTURO → scrivi il percorso di futuro prossimo; inserisci un primo gesto piccolo (chiamata/mail/ora), un segnale di avanzamento naturale e un limite realistico intrecciato nel testo.
- Apertura-specchio che mostra che capisci l’utente (ritmi/abitudini/limiti tipici) senza elencare dati.
- Dettagli piccoli e utili (orario, angolo, “texture”) solo quando aiutano. Evita riferimenti di attualità non forniti.`
  );

  return L.join("\n\n");
}

/* ============== Clarify “aware” + profiling progressivo ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You generate 2–3 short, focused clarifying questions (one line each) that directly relate to the user's main question. Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Generi 2–3 domande brevi e mirate (una riga) direttamente collegate alla domanda principale. Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;

  const period = en
    ? `PERIOD AWARENESS:
- If TIMEFRAME = "past": ask about turning point year/event, place/context back then, one key factor.
- If TIMEFRAME = "future": ask about decision window, a natural progress signal, a concrete limitation or resource.`
    : `CONSAPEVOLEZZA DEL PERIODO:
- PERIODO "past": chiedi anno/evento di svolta, luogo/contesto di allora, un fattore chiave.
- PERIODO "future": chiedi finestra decisionale, un segnale naturale di avanzamento, un limite o una risorsa concreta.`;

  const profiling = en
    ? `Progressive profiling (ONLY if missing): city_now/city_origin, work_role, one concrete goal, 2–3 values (one-liners).`
    : `Profilazione progressiva (SOLO se mancano): city_now/city_origin, work_role, un obiettivo concreto, 2–3 valori (una riga).`;

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
    qs.push({ id: "key_factor", label: en ? "One factor that would've changed it?" : "Un fattore che l’avrebbe cambiata?", placeholder: en ? "money/time/person/offer" : "soldi/tempo/persona/offerta" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Finestra decisionale reale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "progress_signal", label: en ? "One natural progress signal?" : "Un segnale naturale di avanzamento?", placeholder: en ? "better sleep / 1 new client" : "sonno migliore / 1 nuovo cliente" });
    qs.push({ id: "concrete_limit", label: en ? "Most concrete limit now?" : "Il limite più concreto adesso?", placeholder: en ? "budget / time / energy" : "budget / tempo / energia" });
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
        if (start >= 0 && end > start) {
          questions = JSON.parse(raw.slice(start, end + 1));
        }
      } catch (err) {
        // fallback sotto
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
          ? "This is the FINALE for this thread: closure, then a one-line soft invite to start a new ‘what if’."
          : "Questo è il FINALE di questa storia: chiudi davvero, poi un invito in una riga a iniziare un nuovo ‘e se’.")
      : (isEn(lang)
          ? `Mid-episode: end with a subtle personal hook tied to ${profilo?.city_now || profilo?.city || "their city"} or ${profilo?.work_role || profilo?.role || "their role"}.`
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

    const temperature = stile === "wtf" ? 0.98 : 0.85;

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
