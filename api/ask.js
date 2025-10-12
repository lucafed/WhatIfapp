// /api/ask.js
import OpenAI from "openai";

/* ==================== Setup ==================== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";

/* ==================== Utils lingua ==================== */
function pickLang(reqBody, headers) {
  const bodyLang = (reqBody?.lang || "").trim().toLowerCase();
  if (bodyLang) return bodyLang.startsWith("en") ? "en" : "it";
  const accept = String(headers["accept-language"] || "").toLowerCase();
  return accept.startsWith("en") ? "en" : "it";
}
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ==================== Profilo sintetico ==================== */
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
    for (const [k, v] of Object.entries(p.micro)) {
      if (typeof v === "string" && v.trim()) parts.push(`${k}: ${v.trim()}`);
    }
  }
  return parts.join(" • ");
}
function isFinalEpisode(profile = {}) {
  const ep = Number(profile?.story_state?.episode ?? 1);
  const max = Number(profile?.story_state?.max_episodes ?? 3);
  return ep >= max;
}

/* ==================== Specchio & Chiusura ==================== */
function makeMirrorLine({ profilo = {}, lang = "it" }) {
  const en = isEn(lang);
  const who = (profilo?.name ? profilo.name.split(" ")[0] : "").trim();
  const city = profilo?.city_now || profilo?.city || "";
  const role = profilo?.work_role || profilo?.role || "";
  const goal = Array.isArray(profilo?.goals) && profilo.goals[0] ? profilo.goals[0] : (profilo?.goal || "");
  const values = (Array.isArray(profilo?.values) ? profilo.values.slice(0, 2) : []).filter(Boolean);

  const itPool = [
    who ? `${who}, tendi a scegliere quando hai un segnale pulito, non quando tutti applaudono.` : `Tu scegli quando hai un segnale pulito, non quando tutti applaudono.`,
    city ? `${city} ti dà base; ogni tanto ti serve una porta socchiusa verso fuori.` : `Ti serve una base stabile e una porta socchiusa verso fuori.`,
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : `Nel lavoro reggi finché il perché resta acceso.`,
    goal ? `Da un po’ ruoti intorno a questo: ${goal}.` : `Da un po’ ruoti intorno a una direzione precisa.`,
    values.length ? `Quando rispetti ${values.join(" e ")}, il passo si fa semplice.` : `Quando ti senti rispettato, il passo si fa semplice.`,
  ];
  const enPool = [
    who ? `${who}, you move on clean signals, not applause.` : `You move on clean signals, not applause.`,
    city ? `${city} grounds you; you still need a half-open door.` : `You like a stable base and a half-open door.`,
    role ? `In (${role}) you keep pace while the why stays lit.` : `At work you keep pace while the why stays lit.`,
    goal ? `You’ve been orbiting this for a while: ${goal}.` : `You’ve been orbiting a clear direction for a while.`,
    values.length ? `When you honor ${values.join(" and ")}, your stride clicks.` : `When you feel respected, your stride clicks.`,
  ];
  const pool = en ? enPool : itPool;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickClosing({ lang = "it", stile = "whatif" }) {
  const it = !isEn(lang);
  const oniricSoftIT = [
    `Domani ti porto due micro-domande e continuiamo il filo.`,
    `Se torni domani, due dettagli in più e la storia scorre meglio.`,
    `Passa domani: due spunti rapidi e vediamo dove porta.`,
    `Ci fermiamo qui: domani due cue veloci e riprendiamo.`,
  ];
  const sharpIT = [
    `Stop qui. Domani due colpi secchi e si riparte.`,
    `Segnalibro messo: domani due domande furbe e alziamo il livello.`,
    `Ok, pausa. Domani due scosse brevi e vediamo chi sei davvero.`,
    `Chiudiamo: domani due righe chiare e avanti.`,
  ];
  const oniricSoftEN = [
    `Come back tomorrow: two micro-questions and we keep the thread alive.`,
    `Return tomorrow — two details sharper and the story flows.`,
    `Pause here; tomorrow two quick cues and we continue.`,
    `Let’s stop here; tomorrow two tiny prompts and we move on.`,
  ];
  const sharpEN = [
    `Cut here. Tomorrow: two clean shots and we go.`,
    `Bookmark this — tomorrow two sharp prompts, then action.`,
    `Okay, pause. Tomorrow two quick jolts and we level up.`,
    `Close it here; tomorrow two short lines and forward.`,
  ];
  if (it) return (stile === "wtf" ? sharpIT : oniricSoftIT)[Math.floor(Math.random() * 4)];
  return (stile === "wtf" ? sharpEN : oniricSoftEN)[Math.floor(Math.random() * 4)];
}

/* ==================== Tempo ==================== */
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

/* ==================== Prompt di sistema ==================== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz }) {
  const en = isEn(lang);
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);
  const now = safeNow(nowIso, tz);

  const epHint_en = finale
    ? `FINALE: give real closure (no cliffhanger). One clean, memorable final line inviting a new thread.`
    : `MID-EPISODE: end with a soft personal hook (no paywall mention).`;
  const epHint_it = finale
    ? `FINALE: chiudi davvero (niente cliffhanger). Una riga memorabile che invita a un nuovo filo.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile (senza paywall).`;

  const ban_en = `Never use literal labels like "constraint", "trade-off", "indicator", "first step". Weave these ideas naturally. No "I". Second person only.`;
  const ban_it = `Non usare etichette letterali tipo "vincolo", "trade-off", "indicatore", "primo passo". Intreccia quei concetti in modo naturale. Mai "io". Solo seconda persona.`;

  if (stile === "wtf") {
    return en
      ? `You are "What the F": witty late-night bartender — ironic, sharp, a bit drunk, yet lucid.
One voice. 8–10 short lines; bar rhythm; at least 2 clever punchlines; never cruel or vulgar.
Personalize subtly with ${cityNow}, ${workRole}. Keep it real; minimal imagery.
Use near future for FUTURE, counterfactual for PAST. ${ban_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint_en}`
      : `Sei "What the F": barista nottambulo brillante — ironico, tagliente, un po’ brillo ma lucido.
Una voce. 8–10 righe brevi; ritmo da bancone; almeno 2 punchline; mai cattivo o volgare.
Personalizza in modo implicito con ${cityNow}, ${workRole}. Realismo; immagini minime.
Futuro vicino per FUTURO, controfattuale per PASSATO. ${ban_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint_it}`;
  }

  // WHAT?f — onirico leggero (max 1 immagine concreta), empatico, predittivo
  return en
    ? `You are "What?f": lucid, warm, lightly oneiric.
One voice. 8–10 short vivid lines. Second person only.
Keep imagery minimal: at most 1 concrete, small image; avoid poetic clutter.
Be predictive and grounded: real timings, small costs, inner signals, plausible scenes.
Personalize implicitly with ${cityNow}, ${workRole}. ${ban_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint_en}`
    : `Sei "What?f": lucido, caldo, onirico leggero.
Una voce. 8–10 righe brevi e nitide. Solo seconda persona.
Immagini al minimo: al massimo 1 immagine concreta; niente fronzoli poetici.
Predittivo e realistico: tempi veri, piccoli costi, segnali interiori, scene plausibili.
Personalizza in modo implicito con ${cityNow}, ${workRole}. ${ban_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint_it}`;
}

/* ==================== Few-shot (IT + EN) ==================== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  if (style === "wtf") {
    return it
      ? [
          { role: "system", content:
`WTF_IT_1
DOMANDA: "E se comprassi una moto?"
RISPOSTA:
Una moto? Bello. Fino al primo tagliando.
Ti piace l’idea di sparire per un’ora senza avvisare.
Occhio: la libertà non paga l’assicurazione.
Se il lunedì è più leggero, stai vincendo.
Fai un giro corto e ascolta la testa dopo, non durante.
Ok, basta filosofia: domani due colpi secchi e si decide.` },
          { role: "system", content:
`WTF_IT_2
DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Rientri e ti chiedono tre favori entro il caffè.
Cuore su, agenda giù: pacchetto rientro.
Resta dove ti vogliono, ma ai tuoi orari.
Se il barista ti saluta per nome e ti pesa zero, forse è casa.
Pausa qui: domani due domande furbe e avanti.` },
        ]
      : [
          { role: "system", content:
`WTF_EN_1
QUESTION: "What if I bought a motorbike?"
ANSWER:
Nice idea — until the first service bill.
You love disappearing for an hour with no notice.
Freedom’s great; insurance isn’t.
If Monday feels lighter, you’re winning.
Take a short loop; listen after, not during.
Enough talk — tomorrow two clean shots and we decide.` },
          { role: "system", content:
`WTF_EN_2
QUESTION: "What if I moved back home?"
ANSWER:
You walk in; three favors walk with you.
Heart up, calendar down — classic return bundle.
Stay where you’re wanted, on your terms.
If the barista knows your name and it weighs zero, that’s home.
Bookmark this — tomorrow two sharp prompts and on we go.` },
        ];
  }

  // WHAT?f — onirico leggero
  return it
    ? [
        { role: "system", content:
`WHATIF_IT_1
DOMANDA: "E se cambiassi lavoro?"
RISPOSTA:
Quando capisci, non scatti: ti sposti di mezzo grado ogni giorno.
Il primo mese tieni poche conversazioni buone.
Una sera ti trovi più calmo: il corpo arriva prima della testa.
Se due volti nuovi ti danno energia, è la rotta giusta.
Tieni qui: domani due dettagli e continuiamo.` },
        { role: "system", content:
`WHATIF_IT_2
DOMANDA: "E se tornassi tra 3–6 mesi?"
RISPOSTA:
Ti serve una base, non una gabbia.
Provi settimane gemelle: stessi giorni, stesse persone.
Le sere diventano leggere, il telefono smette di urlare.
Se scegli tu gli inviti, stai tornando te.
Stop qui: domani due micro-domande e la trama scorre.` },
      ]
    : [
        { role: "system", content:
`WHATIF_EN_1
QUESTION: "What if I changed jobs?"
ANSWER:
You don’t leap; you tilt a few degrees.
Month one: fewer, better talks.
One night you’re calmer — the body arrives before the mind.
If two new faces give you energy, you’re on line.
Hold here; tomorrow two small details and we continue.` },
        { role: "system", content:
`WHATIF_EN_2
QUESTION: "What if I moved back in 3–6 months?"
ANSWER:
You need a base, not a cage.
Test twin weeks: same days, same people.
Evenings get lighter; the phone stops shouting.
If you’re choosing invitations, you’re back to you.
Pause here; tomorrow two micro-questions and the thread flows.` },
      ];
}

/* ==================== Istruzioni di stile finali ==================== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Bold sarcasm, playful, never cruel. Second person only. Minimal imagery. Respect timeframe. End with a snappy episodic line.`
      : `Formato: 8–10 righe brevi. Voce unica. Sarcasmo brillante, mai cattivo. Solo seconda persona. Immagini minime. Rispetta il periodo. Chiudi con una riga secca.`;
  }
  return en
    ? `Format: 8–10 concise lines. One speaker. Lightly oneiric but concrete; at most one small image. Second person only. Weave costs/signals/next moves naturally (no labels). End with a soft episodic hook.`
    : `Formato: 8–10 righe concise. Onirico leggero ma concreto; al massimo un’immagine piccola. Solo seconda persona. Intreccia costi/segnali/mosse senza etichette. Chiudi con gancio morbido.`;
}

/* ==================== User message builder ==================== */
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

  L.push(
    en
      ? `PREDICTIVE GOAL:
- PAST: counterfactual vignette as if it happened — include one small plausible cost and one sign it worked (but never label them).
- FUTURE: near-future fork if they choose now — suggest a tiny move and a natural sign to watch (no labels). Keep it timeless.`
      : `OBIETTIVO PREDITTIVO:
- PASSATO: vignetta controfattuale come se fosse accaduta — inserisci un costo plausibile e un segno che funzionava (senza etichette).
- FUTURO: biforcazione di prossimo futuro se sceglie ora — suggerisci una micro-mossa e un segno naturale da osservare (niente etichette). Tono senza tempo.`
  );

  return L.join("\n\n");
}

/* ==================== Clarify (2–3 domande) ==================== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  return en
    ? `Generate 2–3 short, focused clarifying questions (one line each) to answer better. Keep them tied to the user's question. Return ONLY a JSON array of {"id","label","placeholder"}.`
    : `Genera 2–3 domande brevi e mirate (una riga) legate alla domanda. Restituisci SOLO un array JSON di {"id","label","placeholder"}.`;
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
    qs.push({ id: "pivot_year", label: en ? "When/what was the turning point?" : "Quando/cosa è stato il punto di svolta?", placeholder: en ? "year/event" : "anno/evento" });
    qs.push({ id: "then_place", label: en ? "Where and who mattered then?" : "Dove e chi contava allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" });
    qs.push({ id: "key_sign", label: en ? "One sign it would’ve worked?" : "Un segno che avrebbe detto che funzionava?", placeholder: en ? "person/number/result" : "persona/numero/risultato" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Vera finestra decisionale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "personal_sign", label: en ? "Personal sign you’d watch?" : "Segno personale che osserveresti?", placeholder: en ? "sleep/energy/first reply" : "sonno/energia/prima risposta" });
    qs.push({ id: "concrete_limit", label: en ? "Most concrete limit?" : "Limite più concreto?", placeholder: en ? "budget/time/energy" : "budget/tempo/energia" });
  }
  return qs.slice(0, 3);
}

/* ==================== HTTP handler ==================== */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream, Accept-Language");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      // lang può arrivare mancante: fallback su header
      lang: bodyLang,
      periodo = "future",          // "past" | "future"
      stile = "whatif",            // "whatif" | "wtf"
      clarify = false,             // true => genera 2–3 domande
      stream = false,              // true => text/event-stream
      profilo = {},                // profilo utente
      clarifications = {},         // risposte ai chiarimenti
      extra = "",                  // input extra opzionale
      now: nowIso,                 // ISO dal client (opz.)
      tz,                          // timezone IANA (opz.)
    } = req.body || {};

    const lang = pickLang({ lang: bodyLang }, req.headers);

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
          temperature: 0.6,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: usr },
          ],
        });
        const raw = resp.choices?.[0]?.message?.content?.trim() || "[]";
        const start = raw.indexOf("[");
        const end = raw.lastIndexOf("]");
        if (start >= 0 && end > start) questions = JSON.parse(raw.slice(start, end + 1));
      } catch {}
      if (!Array.isArray(questions) || questions.length === 0) {
        questions = localClarify(domanda, profilo, lang, periodo);
      }
      const normalized = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i + 1}`),
        label: String(q.label || q?.text || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));
      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        res.setHeader("X-Whatif-Clarify", JSON.stringify({ date: todayIso, used: normalized.length, lang }));
      } catch {}
      return res.status(200).json({ questions: normalized, lang });
    }

    /* ---------- Generation branch ---------- */
    const sys1 = systemPrompt({ stile, lang, profile: profilo, nowIso, tz });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz });
    const sys2 = responseStyleInstruction(lang, stile);

    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "This is the FINALE for this thread: deliver closure (no cliffhanger). Invite a fresh 'what if' in one line."
          : "Questo è il FINALE di questa storia: chiudi davvero (niente cliffhanger). Invita a un nuovo 'e se' in una riga.")
      : (isEn(lang)
          ? `Mid-episode: end with a subtle personal hook linked to ${profilo?.city_now || profilo?.city || "their city"} or ${profilo?.work_role || profilo?.role || "their role"}.`
          : `Episodio intermedio: chiudi con un gancio personale legato a ${profilo?.city_now || profilo?.city || "la tua città"} o ${profilo?.work_role || profilo?.role || "il tuo ruolo"}.`);

    const fewshots = getFewShots(stile, lang);
    const mirror = makeMirrorLine({ profilo, lang });
    const closing = pickClosing({ lang, stile });

    const messages = [
      { role: "system", content: sys1 },
      ...fewshots,
      { role: "system", content: isEn(lang)
          ? `Open with one short "mirror" line like this (paraphrase, do not quote): "${mirror}"`
          : `Apri con una breve riga di “specchio” (parafrasa, non citare): "${mirror}"` },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      { role: "system", content: isEn(lang)
          ? `Close with a natural episodic line like: "${closing}" (vary phrasing).`
          : `Chiudi con una riga episodica naturale tipo: "${closing}" (varia la frase).` },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.97 : 0.82;

    // Streaming SSE
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
      res.write(`data: ${JSON.stringify({ done: true, lang })}\n\n`);
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
    return res.status(200).json({ answer: text, lang });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res.status(500).json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
          }
