// /api/ask.js
import OpenAI from "openai";

/* ============== Setup ============== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ============== Lang pick (fallback Accept-Language) ============== */
function pickLang(reqBody, headers) {
  const bodyLang = (reqBody?.lang || "").trim().toLowerCase();
  if (bodyLang) return bodyLang.startsWith("en") ? "en" : "it";
  const accept = String(headers["accept-language"] || "").toLowerCase();
  return accept.startsWith("en") ? "en" : "it";
}

/* ============== Cliché guard ============== */
const banned = [
  // IT
  /chiama(t[aeo]|re)?\b/i,
  /\btelefonat/i,
  /\bparlarne con un amico/i,
  /\bmand(a|are) (una )?mail/i,
  /\bimmagina di\b/i,
  /\bpotrebbe rappresentare una fuga\b/i,
  /\bbudget (deve|dovrebbe) rimanere sotto controllo\b/i,
  /\btranquillità (è|e) la tua bussola\b/i,
  /\bequilibrio (che ti rende|la tua) ?(seren[oa])?\b/i,
  // EN
  /\bcall (a|your) friend\b/i,
  /\bsend (an )?email\b/i,
  /\bimagine\b/i,
  /\bcould be an escape\b/i,
  /\bbudget must stay under control\b/i,
  /\btranquility is your compass\b/i,
  /\bbalance (is|be) your compass\b/i,
];

function looksCliche(text) {
  const bad = banned.some((rx) => rx.test(text));
  const metaphors = (text.match(/come | as if | come se /gi) || []).length; // rozzo ma utile
  return bad || metaphors > 2;
}

/* ============== Profilo & helpers ============== */
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
function safeNow(nowIso, tz) {
  const d = nowIso ? new Date(nowIso) : new Date();
  const w = d.toLocaleDateString("en-GB", { weekday: "long" });
  const wd_it = d.toLocaleDateString("it-IT", { weekday: "long" });
  const date_it = d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
  const date_en = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const month = d.getMonth() + 1;
  const season_it = ["inverno","inverno","primavera","primavera","primavera","estate","estate","estate","autunno","autunno","autunno","inverno"][(month-1)%12];
  const season_en = ["winter","winter","spring","spring","spring","summer","summer","summer","autumn","autumn","autumn","winter"][(month-1)%12];
  const month_it = d.toLocaleDateString("it-IT", { month: "long" });
  const month_en = d.toLocaleDateString("en-GB", { month: "long" });
  return { time24:`${hh}:${mm}`,weekday_en:w,weekday_it:wd_it,date_it,date_en,season_it,season_en,month_it,month_en,tz: tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
}

/* ============== Mirror & Closing ============== */
function makeMirrorLine({ profilo = {}, lang = "it" }) {
  const en = isEn(lang);
  const who = (profilo?.name ? profilo.name.split(" ")[0] : "").trim();
  const city = profilo?.city_now || profilo?.city || "";
  const role = profilo?.work_role || profilo?.role || "";
  const goal = Array.isArray(profilo?.goals) && profilo.goals[0] ? profilo.goals[0] : (profilo?.goal || "");
  const values = (Array.isArray(profilo?.values) ? profilo.values.slice(0, 2) : []).filter(Boolean);
  const itPool = [
    who ? `${who}, ti muovi quando il segnale è pulito, non quando tutti applaudono.` : `Ti muovi quando il segnale è pulito, non quando tutti applaudono.`,
    city ? `${city} ti fa da base; ogni tanto ti serve aria nuova.` : `Ti serve una base stabile e un varco verso fuori.`,
    role ? `Nel lavoro (${role}) reggi finché il “perché” resta acceso.` : `Nel lavoro reggi finché il “perché” resta acceso.`,
    goal ? `Da un po’ ruoti intorno a questo: ${goal}.` : `Da un po’ ruoti intorno a una direzione precisa.`,
    values.length ? `Quando rispetti ${values.join(" e ")}, cammini dritto.` : `Quando ti senti rispettato, cammini dritto.`,
  ];
  const enPool = [
    who ? `${who}, you move on clean signals, not applause.` : `You move on clean signals, not applause.`,
    city ? `${city} grounds you; you still need fresh air now and then.` : `You like a stable base with a way out.`,
    role ? `In (${role}) you keep pace while the why stays lit.` : `At work you keep pace while the why stays lit.`,
    goal ? `You’ve been orbiting this: ${goal}.` : `You’ve been orbiting a clear direction.`,
    values.length ? `When you honor ${values.join(" and ")}, you go straight.` : `When you feel respected, you go straight.`,
  ];
  const pool = en ? enPool : itPool;
  return pool[Math.floor(Math.random() * pool.length)];
}
function pickClosing({ lang = "it", stile = "whatif" }) {
  const it = !isEn(lang);
  const softIT = [
    `Domani due micro-domande e continuiamo il filo.`,
    `Se torni domani, aggiungiamo due dettagli e andiamo più a fuoco.`,
    `Passa domani: due spunti rapidi e si riparte.`,
    `Stop qui: domani due cue veloci e avanti.`,
  ];
  const sharpIT = [
    `Basta così. Domani due colpi secchi e si decide.`,
    `Segnalibro messo: domani due domande furbe e alziamo il livello.`,
    `Ok, pausa: domani due scosse brevi e ripartiamo.`,
    `Chiudiamo qui. Domani due righe chiare e via.`,
  ];
  const softEN = [
    `Come back tomorrow: two micro-questions and we keep the thread alive.`,
    `Return tomorrow — two sharper details and we move.`,
    `Pause here; tomorrow two quick cues and we continue.`,
    `Stop here; tomorrow two tiny prompts and forward.`,
  ];
  const sharpEN = [
    `Cut here. Tomorrow two clean shots and we go.`,
    `Bookmark this — tomorrow two sharp prompts, then action.`,
    `Okay, pause. Tomorrow two quick jolts and we level up.`,
    `Close it here; tomorrow two short lines and forward.`,
  ];
  if (it) return (stile === "wtf" ? sharpIT : softIT)[Math.floor(Math.random()*4)];
  return (stile === "wtf" ? sharpEN : softEN)[Math.floor(Math.random()*4)];
}

/* ============== Persona prompts (con anti-cliché) ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz }) {
  const en = isEn(lang);
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);
  const now = safeNow(nowIso, tz);

  const epHint_en = finale
    ? `FINALE: real closure (no cliffhanger). One memorable final line inviting a new thread.`
    : `MID-EPISODE: end with a soft personal hook (no paywall mention).`;
  const epHint_it = finale
    ? `FINALE: chiudi davvero (niente cliffhanger). Una riga memorabile che invita a un nuovo filo.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile (senza paywall).`;

  const bans_it =
`Regole anti-cliché (obbligatorie):
- NON proporre telefonate, email, “parlarne con un amico”, “chiedi a qualcuno”, a meno che l’utente lo chieda esplicitamente.
- NON usare etichette: “indicatore”, “vincolo”, “trade-off”, “primo passo”.
- Evita “immagina di…”, “potrebbe rappresentare una fuga…”, “bussola/equilibrio/budget sotto controllo”.
- Solo seconda persona; niente “io”.`;
  const bans_en =
`Anti-cliché rules (mandatory):
- Do NOT suggest calls/emails/talk to a friend unless the user asked for it.
- Do NOT use labels: “indicator”, “constraint”, “trade-off”, “first step”.
- Avoid “imagine…”, “could be an escape…”, “compass/balance/budget under control”.
- Second person only; never “I”.`;

  if (stile === "wtf") {
    return en
      ? `You are "What the F": witty late-night bartender — sharp, playful, slightly drunk, never cruel.
One voice. 8–10 short lines; bar rhythm; ≥2 clever punchlines; minimal imagery.
Personalize subtly with ${cityNow}, ${workRole}. Use near future for FUTURE; counterfactual for PAST.
${bans_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint_en}`
      : `Sei "What the F": barista nottambulo brillante — tagliente, giocoso, un po’ brillo, mai cattivo.
Una voce. 8–10 righe brevi; ritmo da bancone; ≥2 punchline; immagini minime.
Personalizza in modo implicito con ${cityNow}, ${workRole}. Futuro vicino per FUTURO; controfattuale per PASSATO.
${bans_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint_it}`;
  }

  return en
    ? `You are "What?f": lucid, warm, lightly oneiric (max one small image).
One voice. 8–10 concise lines. Predictive and grounded; real timings; inner signals.
Personalize implicitly with ${cityNow}, ${workRole}.
${bans_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint_en}`
    : `Sei "What?f": lucido, caldo, onirico leggero (massimo un’immagine piccola).
Una voce. 8–10 righe concise. Predittivo e concreto; tempi reali; segnali interiori.
Personalizza in modo implicito con ${cityNow}, ${workRole}.
${bans_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint_it}`;
}

/* ============== Few-shots (compatti, stessi toni) ============== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);
  if (style === "wtf") {
    return it ? [
      { role: "system", content:
`WTF_IT_1
DOMANDA: "E se comprassi una moto?"
RISPOSTA:
Una moto? Bello. Fino al primo tagliando.
Ti piace sparire un’ora ogni tanto.
La libertà è forte; l’assicurazione ride meno.
Se il lunedì pesa meno, ci sei.
Fai un giro corto e ascolta dopo, non durante.
Ok, stop: domani due colpi secchi e via.` },
      { role: "system", content:
`WTF_IT_2
DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Rientri e arrivano i favori a grappolo.
Cuore su, agenda giù: pacchetto rientro.
Stai dove ti vogliono, ma ai tuoi orari.
Se il barista ti pesa zero, è casa.
Basta così: domani due domande furbe e si riparte.` },
    ] : [
      { role: "system", content:
`WTF_EN_1
QUESTION: "What if I bought a motorbike?"
ANSWER:
Great idea — until the first service bill.
You love vanishing for an hour.
Freedom’s loud; invoices louder.
If Monday feels lighter, you’re winning.
Take a short loop; listen after, not during.
Cut here — tomorrow two clean shots.` },
      { role: "system", content:
`WTF_EN_2
QUESTION: "What if I moved back?"
ANSWER:
You walk in; three favors follow.
Heart up, calendar down — classic.
Stay where you’re wanted, on your terms.
If the barista weighs zero, that’s home.
Bookmark this — tomorrow two sharp prompts.` },
    ];
  }
  // WHAT?f
  return it ? [
    { role: "system", content:
`WHATIF_IT_1
DOMANDA: "E se cambiassi lavoro?"
RISPOSTA:
Tu non cambi per scena: sposti l’ago quando il perché è chiaro.
Mese uno: poche conversazioni buone.
Una sera respiri meglio: il corpo arriva prima della testa.
Se due volti nuovi ti danno energia, è la rotta.
Stop qui: domani due dettagli e continuiamo.` },
    { role: "system", content:
`WHATIF_IT_2
DOMANDA: "E se tornassi tra 3–6 mesi?"
RISPOSTA:
Ti serve base, non gabbia.
Provi settimane gemelle; stessi giorni, stesse persone.
Le sere si alleggeriscono; il telefono smette di urlare.
Se scegli tu gli inviti, stai tornando te.
Domani due micro-domande e si va.` },
  ] : [
    { role: "system", content:
`WHATIF_EN_1
QUESTION: "What if I changed jobs?"
ANSWER:
You don’t leap; you tilt a few degrees.
Month one: fewer, better talks.
One night you’re calmer; the body gets there first.
If two new faces give you energy, you’re aligned.
Hold here; tomorrow two small details.` },
    { role: "system", content:
`WHATIF_EN_2
QUESTION: "What if I moved back in 3–6 months?"
ANSWER:
You need a base, not a cage.
Test twin weeks: same days, same people.
Evenings lighten; the phone stops shouting.
If you’re choosing invitations, you’re back to you.
Tomorrow two micro-questions and on we go.` },
  ];
}

/* ============== Style instruction ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `8–10 short lines. One speaker. Bold sarcasm, playful, never cruel. Minimal imagery. No labels.`
      : `8–10 righe brevi. Voce unica. Sarcasmo brillante, mai cattivo. Immagini minime. Niente etichette.`;
  }
  return en
    ? `8–10 concise lines. Lightly oneiric (max one small image), concrete. No labels.`
    : `8–10 righe concise. Onirico leggero (max un’immagine piccola), concreto. Niente etichette.`;
}

/* ============== Build user content ============== */
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
- PAST: show a plausible small cost and one sign it worked — never label them.
- FUTURE: suggest a tiny move and a natural sign to watch — woven into the scene.`
      : `OBIETTIVO PREDITTIVO:
- PASSATO: mostra un piccolo costo plausibile e un segno che funzionava — senza etichette.
- FUTURO: suggerisci una micro-mossa e un segno naturale da osservare — intrecciati nella scena.`
  );
  return L.join("\n\n");
}

/* ============== Clarify ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  return en
    ? `Generate 2–3 short, focused clarifying questions (one line each) strictly tied to the user's question. Return ONLY a JSON array of {"id","label","placeholder"}.`
    : `Genera 2–3 domande brevi e mirate, strettamente legate alla domanda. Restituisci SOLO un array JSON di {"id","label","placeholder"}.`;
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
    qs.push({ id: "pivot_year", label: en ? "Turning point year/event?" : "Anno/evento di svolta?", placeholder: en ? "year/event" : "anno/evento" });
    qs.push({ id: "then_place", label: en ? "Where & who mattered then?" : "Dove e chi contava allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" });
    qs.push({ id: "key_sign", label: en ? "One sign it would’ve worked?" : "Un segno che avrebbe detto che funzionava?", placeholder: en ? "person/number/result" : "persona/numero/risultato" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Vera finestra decisionale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "personal_sign", label: en ? "Personal sign you’d watch?" : "Segno personale che osserveresti?", placeholder: en ? "sleep/energy/first reply" : "sonno/energia/prima risposta" });
    qs.push({ id: "concrete_limit", label: en ? "Most concrete limit?" : "Limite più concreto?", placeholder: en ? "budget/time/energy" : "budget/tempo/energia" });
  }
  return qs.slice(0, 3);
}

/* ============== HTTP handler ============== */
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
      lang: bodyLang,
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
          model: MODEL_TEXT, temperature: 0.6,
          messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        });
        const raw = resp.choices?.[0]?.message?.content?.trim() || "[]";
        const s = raw.indexOf("["); const e = raw.lastIndexOf("]");
        if (s >= 0 && e > s) questions = JSON.parse(raw.slice(s, e + 1));
      } catch {}
      if (!Array.isArray(questions) || questions.length === 0) questions = localClarify(domanda, profilo, lang, periodo);
      const normalized = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i+1}`),
        label: String(q.label || q?.text || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));
      res.setHeader("X-Whatif-Clarify", JSON.stringify({ lang, count: normalized.length }));
      return res.status(200).json({ questions: normalized, lang });
    }

    /* ---------- Generation prompts ---------- */
    const sys1 = systemPrompt({ stile, lang, profile: profilo, nowIso, tz });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz });
    const sys2 = responseStyleInstruction(lang, stile);

    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang) ? "FINALE: deliver closure; invite a fresh what-if." : "FINALE: chiudi davvero; invita a un nuovo what-if.")
      : (isEn(lang)
          ? `Mid-episode: end with a subtle hook linked to ${profilo?.city_now || profilo?.city || "their city"} or ${profilo?.work_role || profilo?.role || "their role"}.`
          : `Episodio intermedio: chiudi con un gancio legato a ${profilo?.city_now || profilo?.city || "la tua città"} o ${profilo?.work_role || profilo?.role || "il tuo ruolo"}.`);

    const fewshots = getFewShots(stile, lang);
    const mirror = makeMirrorLine({ profilo, lang });
    const closing = pickClosing({ lang, stile });

    const messages = [
      { role: "system", content: sys1 },
      ...fewshots,
      { role: "system", content: isEn(lang)
          ? `Open with one short mirror line paraphrasing: "${mirror}".`
          : `Apri con una breve riga-specchio parafrasando: "${mirror}".` },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      { role: "system", content: isEn(lang)
          ? `Close with: "${closing}" (vary phrasing).`
          : `Chiudi con: "${closing}" (varia la frase).` },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.97 : 0.82;

    // Helper to possibly post-edit if cliché detected
    async function maybePolish(text) {
      if (!looksCliche(text)) return text;
      const polishPrompt = isEn(lang)
        ? `Rewrite the following answer in the SAME tone and language (${lang.toUpperCase()}), keeping meaning, but STRICTLY removing clichés such as phone/email/friend advice, "budget under control", "compass/balance" metaphors, and excessive "imagine...". Keep 8–10 short lines, second person only, minimal imagery.\n\nTEXT:\n${text}`
        : `Riscrivi il testo NELLO STESSO tono e lingua (${lang.toUpperCase()}), mantenendo il senso, ma ELIMINANDO i cliché: telefonate/email/amico, “budget sotto controllo”, metafore “bussola/equilibrio”, e troppi “immagina…”. Mantieni 8–10 righe brevi, seconda persona, immagini minime.\n\nTESTO:\n${text}`;
      const r = await client.chat.completions.create({
        model: MODEL_TEXT, temperature: 0.5,
        messages: [{ role: "user", content: polishPrompt }],
      });
      const fixed = r.choices?.[0]?.message?.content?.trim() || text;
      return looksCliche(fixed) ? text : fixed;
    }

    // Streaming
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      let raw = "";
      const s = await client.chat.completions.create({ model: MODEL_TEXT, messages, temperature, max_tokens: 700, stream: true });
      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) { raw += delta; res.write(`data: ${JSON.stringify({ token: delta })}\n\n`); }
      }
      // post-polish (send as final patch token if needed)
      const polished = await maybePolish(raw);
      if (polished !== raw) res.write(`data: ${JSON.stringify({ token: "\n", patched: true })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, lang })}\n\n`);
      return res.end();
    }

    // Non-stream: single shot + polish
    const c = await client.chat.completions.create({ model: MODEL_TEXT, messages, temperature, max_tokens: 700 });
    let text = c.choices?.[0]?.message?.content?.trim() || "";
    text = await maybePolish(text);
    return res.status(200).json({ answer: text, lang });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res.status(500).json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
        }
