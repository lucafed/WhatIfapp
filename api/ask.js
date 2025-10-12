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

  // Predittivi
  if (p.time_window) parts.push(`finestra: ${p.time_window}`);
  if (p.success_indicator) parts.push(`indicatore_successo: ${p.success_indicator}`);
  if (p.risk_tolerance) parts.push(`rischio: ${p.risk_tolerance}`);
  if (p.landmark) parts.push(`ancora: ${p.landmark}`);

  // Micro-dati (solo stringhe utili)
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

/* ===== Mirror (specchio) + closing predittivo ===== */
function makeMirrorLine({ domanda = "", profilo = {}, lang = "it" }) {
  const it = (String(lang || "it").toLowerCase().startsWith("it"));
  const who = (profilo?.name ? profilo.name.split(" ")[0] : "").trim();
  const city = profilo?.city_now || profilo?.city || "";
  const role = profilo?.work_role || profilo?.role || "";
  const goal = Array.isArray(profilo?.goals) && profilo.goals[0] ? profilo.goals[0] : (profilo?.goal || "");
  const values = (Array.isArray(profilo?.values) ? profilo.values.slice(0, 2) : []).filter(Boolean);

  const itLines = [
    who ? `${who}, quando decidi non è per capriccio: cerchi senso e coerenza.` : `Tu non cambi per capriccio: cerchi senso e coerenza.`,
    city ? `Ti vedo: ${city} ti dà base, ma ogni tanto vuoi aria nuova.` : `Ti serve una base solida e una finestra aperta.`,
    role ? `Nel lavoro (${role}) reggi il ritmo finché il “perché” resta acceso.` : `Reggi il ritmo finché il “perché” resta acceso.`,
    goal ? `In testa hai chiaro questo: ${goal}. Il resto deve allinearsi.` : `In testa hai un punto chiaro. Il resto deve allinearsi.`,
    values.length ? `Quando rispetti ${values.join(" e ")}, il passo ti si accende.` : `Quando qualcosa davvero ti rispetta, il passo ti si accende.`,
    `Non cerchi drammi: cerchi segnali puliti. E oggi ne stai ascoltando uno.`
  ];

  const enLines = [
    who ? `${who}, you don’t move on whims — you move for meaning.` : `You don’t move on whims — you move for meaning.`,
    city ? `I can see you: ${city} grounds you, but you still need an open window.` : `You like a solid base and one open window.`,
    role ? `In your role (${role}) you keep pace — while the “why” stays lit.` : `You keep pace — while the “why” stays lit.`,
    goal ? `There’s a clear target in your head: ${goal}. Everything else must align.` : `There’s a clear target in your head. Everything else must align.`,
    values.length ? `When you honor ${values.join(" and ")}, your stride clicks.` : `When something truly fits you, your stride clicks.`,
    `You don’t chase drama; you listen for clean signals. You’re hearing one now.`
  ];

  const pool = it ? itLines : enLines;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickClosing({ lang = "it", stile = "whatif" }) {
  const it = !String(lang || "it").toLowerCase().startsWith("en");
  const soft = [
    `Domani facciamo il prossimo passo: due micro-domande e vediamo dove porta.`,
    `Quando vuoi, continuiamo: ti preparo due domande corte per andare più preciso.`,
    `Se domani torni, ho una tappa nuova con due micro-domande furbe.`,
    `Passa domani: due dettagli in più e la storia continua pulita.`
  ];
  const sharp = [
    `Chiudi qui e respira. Domani due colpi secchi e si riparte.`,
    `Ok, stop al bancone. Domani due domande veloci e vediamo chi sei davvero.`,
    `Bello parlare: domani due spunti precisi e la trama si allunga bene.`,
    `Segnalibro messo: domani due cue rapidi e alziamo il livello.`
  ];
  const enSoft = [
    `Come back tomorrow: two tiny questions and we take the next step.`,
    `If you return tomorrow, I’ll bring two sharp prompts and we’ll go deeper.`,
    `Tomorrow we add two small details and the story continues cleanly.`,
    `Drop by tomorrow — two micro-questions and we keep the thread alive.`
  ];
  const enSharp = [
    `Pause here. Tomorrow: two quick shots and we move.`,
    `Nice talk. Tomorrow two clean prompts — then action.`,
    `Bookmark this. Tomorrow, two precise nudges and the plot thickens.`,
    `Close the tab. Tomorrow, two fast cues and we level up.`
  ];
  if (it) return (stile === "wtf" ? sharp : soft)[Math.floor(Math.random() * 4)];
  return (stile === "wtf" ? enSharp : enSoft)[Math.floor(Math.random() * 4)];
}

/* ============== Persona prompts (con divieto etichette) ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz }) {
  const en = isEn(lang);
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);
  const now = safeNow(nowIso, tz);

  const epHint_en = finale
    ? `FINALE: give real closure (no cliffhanger). One clean, memorable final line inviting a new thread.`
    : `MID-EPISODE: close with a soft personal hook (no paywall mention).`;
  const epHint_it = finale
    ? `FINALE: chiudi davvero (niente cliffhanger). Una riga memorabile che invita a un nuovo filo.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile (senza paywall).`;

  const ban_en = `Do NOT use literal labels like: "constraint", "trade-off", "indicator", "first step".
Weave those ideas naturally into the narrative (show, don’t label). Never use "I". Second person only.`;
  const ban_it = `NON usare etichette letterali tipo: "vincolo", "trade-off", "indicatore", "primo passo".
Intreccia quei concetti nel discorso (mostra, non etichettare). Mai "io". Solo seconda persona.`;

  if (stile === "wtf") {
    return en
      ? `You are "What the F": witty late-night bartender. One voice. 8–10 short lines, bar rhythm.
High sarcasm, playful, never cruel. Near-future for FUTURE; counterfactual for PAST.
Personalize subtly with ${cityNow}, ${workRole}. ${ban_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint_en}`
      : `Sei "What the F": barista nottambulo brillante. Una voce. 8–10 righe brevi, ritmo da bancone.
Sarcasmo alto ma pulito. Futuro vicino per FUTURO; controfattuale per PASSATO.
Personalizza in modo implicito con ${cityNow}, ${workRole}. ${ban_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint_it}`;
  }

  return en
    ? `You are "What?f": lucid, warm, predictive friend. One voice. 8–10 short vivid lines.
Second person only. Real timings, small realistic costs, inner signals, plausible scenes.
Personalize implicitly with ${cityNow}, ${workRole}. ${ban_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint_en}`
    : `Sei "What?f": amico lucido, caldo, predittivo. Una voce. 8–10 righe brevi e visive.
Solo seconda persona. Tempi reali, piccoli costi realistici, segnali interiori, scene plausibili.
Personalizza in modo implicito con ${cityNow}, ${workRole}. ${ban_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint_it}`;
}

/* ============== Few-shot (IT/EN) ============== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  if (style === "wtf") {
    return it
      ? [
          {
            role: "system",
            content: `WTF_IT_1
DOMANDA: "Se avessi vinto 1.000.000?"
RISPOSTA:
Un milione? Bene: ora puoi sbagliare con più classe.
L’attico a ${"${city}"}? Bellissimo. Anche le spese condominiali.
Comprare tutto? No. Comprare respiro, sì.
Ti fa bene dire più “no” che “wow”.
Se dormi meglio e litighi meno col portafogli, stai vincendo.
Il garage pieno non batte un cuore calmo.
Magari brindiamo — ma con la testa, non con lo scontrino.
Domani torni? Ho due domande veloci e allunghiamo il filo.`,
          },
          {
            role: "system",
            content: `WTF_IT_2
DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Ti vedo rientrare e già ti chiedono tre favori.
Il cuore ride, l’agenda piange: pacchetto rientro.
Stai dove ti vogliono, ma scegli tu quando.
Se il lunedì è leggero, è casa. Se pesa, è museo.
Fatti un giro corto e ascolta il passo.
Chiudi qui. Domani due domande secche e vediamo se resti.`,
          },
        ]
      : [
          {
            role: "system",
            content: `WTF_EN_1
QUESTION: "What if I won €1,000,000?"
ANSWER:
A million? Great — premium mistakes unlocked.
Penthouse? Gorgeous. So is maintenance.
Don’t buy trophies; buy breathing room.
If you sleep deeper and argue less, you’re winning.
Full garage < quiet heart.
We can toast — with sense, not receipts.
Bookmark this. Tomorrow two quick prompts and we stretch the thread.`,
          },
          {
            role: "system",
            content: `WTF_EN_2
QUESTION: "What if I moved back home?"
ANSWER:
You walk in and three favors walk with you.
Heart up, calendar down — the return bundle.
Stay where you’re wanted, on your terms.
If Monday feels light, that’s home; if heavy, it’s a museum.
Take a short loop and listen to your stride.
Pause here. Tomorrow two clean shots and we decide.`,
          },
        ];
  }

  // WHAT?f
  return it
    ? [
        {
          role: "system",
          content: `WHATIF_IT_1
DOMANDA: "E se cambiassi lavoro?"
RISPOSTA:
Non scatti per capriccio: ti muovi quando il perché si accende.
Il primo mese metti in fila poche conversazioni buone.
Una sera ti sorprendi sereno: il corpo ringrazia prima della testa.
L’onda giusta la senti nelle email corte e chiare.
Se due volti nuovi ti danno energia, sei sulla rotta.
Quando raddrizzi la schiena senza accorgerti, è un sì che cresce.
Tienila qui. Domani passo breve: due dettagli e continuiamo.`,
        },
        {
          role: "system",
          content: `WHATIF_IT_2
DOMANDA: "E se tornassi all’Aquila tra 3–6 mesi?"
RISPOSTA:
Ti piace avere una base: ${"${city}"} resta zattera, non gabbia.
Provi settimane gemelle: stessi giorni, stesse persone.
La sera senti il passo più leggero, il telefono meno urgente.
Se gli inviti scelti da te aumentano, la direzione è buona.
Quando sorridi piano sulla via di casa, la scelta sta prendendo forma.
Chiudiamo qui. Domani due note veloci e vediamo dove porta.`,
        },
      ]
    : [
        {
          role: "system",
          content: `WHATIF_EN_1
QUESTION: "What if I changed jobs?"
ANSWER:
You don’t jump on whims — you move when the why lights up.
Month one: fewer, better conversations.
One evening you’re calmer; the body nods before the mind.
The right wave shows in short, tidy emails.
If two new faces give you energy, you’re on line.
When your posture lifts by itself, that’s a yes forming.
Hold here. Tomorrow two tiny details and we continue.`,
        },
        {
          role: "system",
          content: `WHATIF_EN_2
QUESTION: "What if I moved back in 3–6 months?"
ANSWER:
You like a base: ${"${city}"} stays raft, not cage.
Test twin weeks: same days, same people.
Evenings grow lighter; the phone grows quiet.
If chosen invitations increase, direction’s good.
When you smile softly on the way home, the choice is forming.
Stop here. Tomorrow two small notes and we see where it goes.`,
        },
      ];
}

/* ============== Istruzioni di stile ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Bold sarcasm, playful, never cruel. Second person only (no "I"). Keep it punchy. Respect tense by timeframe. Do NOT use literal labels (constraint/trade-off/indicator/first step).`
      : `Formato: 8–10 righe brevi. Voce unica. Sarcasmo brillante, giocoso, mai cattivo. Solo seconda persona (niente “io”). Ritmo asciutto. Rispetta i tempi. NON usare etichette letterali (vincolo/trade-off/indicatore/primo passo).`;
  }
  return en
    ? `Format: 8–10 concise lines. One speaker. Visual, candid, current. Second person only (no "I"). Weave costs, signals, and next moves naturally without naming them. Respect timeframe.`
    : `Formato: 8–10 righe concise. Voce unica. Visivo, sincero, attuale. Solo seconda persona (niente “io”). Intreccia costi, segnali e mosse prossime senza etichette. Rispetta il periodo.`;
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

  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  // Istruzioni “senza etichette”: mostrare, non nominare
  L.push(
    en
      ? `PREDICTIVE OBJECTIVE:
- PAST → counterfactual vignette as if it happened: include a small plausible cost and one inner/outer sign it worked — but never label them.
- FUTURE → near-future fork if they choose now: suggest a tiny move (call/email/hour) and a natural sign to watch — woven in narrative.
- Keep details small and timeless.`
      : `OBIETTIVO PREDITTIVO:
- PASSATO → vignetta controfattuale come se fosse accaduta: inserisci un piccolo costo plausibile e un segnale che avrebbe indicato che funzionava — ma senza etichette.
- FUTURO → biforcazione di prossimo futuro se sceglie ora: suggerisci una micro-mossa (chiamata/email/ora) e un segnale naturale da osservare — intrecciati nel racconto.
- Dettagli piccoli e senza tempo.`
  );

  return L.join("\n\n");
}

/* ============== Clarify (domande mirate) ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You generate 2–3 short, focused clarifying questions (one line each) to better answer the user's main question. Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Generi 2–3 domande brevi e mirate (una riga) per rispondere meglio. Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;

  const period = en
    ? `You are PERIOD-AWARE:
- If TIMEFRAME="past": ask about pivot year/event, place/context back then, key signal.
- If TIMEFRAME="future": ask about decision window, personal sign of progress, concrete constraint/resource.`
    : `Consapevole del PERIODO:
- Se PERIODO="past": chiedi anno/evento di svolta, luogo/contesto di allora, segnale chiave.
- Se PERIODO="future": chiedi finestra decisionale, segno personale di progresso, vincolo/risorsa concreta.`;

  return `${base}\n${period}`;
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
    qs.push({ id: "then_context", label: en ? "Where and what context then?" : "Dove e quale contesto allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" });
    qs.push({ id: "key_signal", label: en ? "One sign it would’ve worked?" : "Un segno che avrebbe detto che funzionava?", placeholder: en ? "person/number/result" : "persona/numero/risultato" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Vera finestra decisionale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "personal_sign", label: en ? "Personal sign you’d watch?" : "Segno personale che osserveresti?", placeholder: en ? "sleep/energy/first reply" : "sonno/energia/prima risposta" });
    qs.push({ id: "concrete_limit", label: en ? "Most concrete limit?" : "Limite più concreto?", placeholder: en ? "budget/time/energy" : "budget/tempo/energia" });
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
      clarifications = {},     // risposte ai chiarimenti
      extra = "",              // input extra opzionale
      now: nowIso,             // opzionale: ISO dal client
      tz,                      // opzionale: timezone IANA
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
        // fallback
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
          : "Questo è il FINALE di questa storia: chiudi davvero (niente cliffhanger). Una riga che invita a un nuovo 'e se'.")
      : (isEn(lang)
          ? `Mid-episode: end with a subtle personal hook linked to ${profilo?.city_now || profilo?.city || (isEn(lang) ? "their city" : "la tua città")} or ${profilo?.work_role || profilo?.role || (isEn(lang) ? "their role" : "il tuo ruolo")}.`
          : `Episodio intermedio: chiudi con un gancio personale legato a ${profilo?.city_now || profilo?.city || "la tua città"} o ${profilo?.work_role || profilo?.role || "il tuo ruolo"}.`);

    // Few-shots + mirror + closing
    const fewshots = getFewShots(stile, lang);
    const mirror = makeMirrorLine({ domanda, profilo, lang });
    const closing = pickClosing({ lang, stile });

    const messages = [
      { role: "system", content: sys1 },
      ...fewshots,
      { role: "system", content: isEn(lang)
          ? `Open with one short "mirror" line like this (paraphrase naturally, don't copy): "${mirror}"`
          : `Apri con una breve riga di “specchio” (parafrasa, non copiare): "${mirror}"` },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      { role: "system", content: isEn(lang)
          ? `Close with a natural episodic line like: "${closing}" (vary phrasing each time).`
          : `Chiudi con una riga episodica naturale tipo: "${closing}" (varia la frase ogni volta).` },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.97 : 0.82;

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
