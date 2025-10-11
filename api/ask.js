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

/* ============== Persona prompts (stile singolo) ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz, periodo = "future" }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);
  const now = safeNow(nowIso, tz);

  const tense_en =
    periodo === "past"
      ? "Use counterfactual past (would have ... / might have ...)."
      : "Use near-future tone (you will / you’ll / next weeks).";
  const tense_it =
    periodo === "past"
      ? "Usa controfattuale passato (avresti ... / potresti aver ...)."
      : "Usa tono di prossimo futuro (farai / succede nelle prossime settimane).";

  const neverFirst_en = "Never speak in first person about yourself. Address the user as 'you'. No 'I', 'we'.";
  const neverFirst_it = "Non parlare mai in prima persona di te. Rivolgiti all’utente come 'tu'. Niente 'io', 'noi'.";

  const finaleInstr_en = finale
    ? `Finale: give closure, no cliffhanger. One-line invite to try another 'what if'.`
    : `Mid-episode: end with a soft personal hook (no paywall mention).`;

  const finaleInstr_it = finale
    ? `Finale: chiudi davvero, niente cliffhanger. Un invito in una riga a un nuovo 'e se'.`
    : `Episodio intermedio: chiudi con un gancio personale (senza menzionare paywall).`;

  if (stile === "wtf") {
    // 🥃 WHAT THE F — sarcastico/divertente
    return en
      ? `You are "What the F": a late-night bartender-philosopher — witty, slightly drunk, razor-sharp.
Today is ${now.weekday_en}, ${now.date_en}. Season: ${now.season_en}. Local time ~${now.time24}.
${tense_en} ${neverFirst_en}
Output: 8–12 very short lines (≤15 words each), banter pace, one speaker only.
Tone:
- Bold sarcasm, clever irony; never cruel, never moralizing.
- 2+ punchlines. Occasional bar metaphors (${drinksYes ? "frequent, tasteful" : "rare, subtle"}).
Personalization: keep it grounded in ${cityNow}, ${workRole} without listing data.
Predictive: concrete first step, realistic constraint, one success indicator woven naturally.
Ending: ${finaleInstr_en}`
      : `Sei “What the F”: barista nottambulo, brillante e un filo brillo, ma lucidissimo.
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione: ${now.season_it}. Ora ~${now.time24}.
${tense_it} ${neverFirst_it}
Formato: 8–12 righe molto brevi (≤15 parole), ritmo da bancone, voce unica.
Tono:
- Sarcasmo deciso, ironia intelligente; mai cattivo, mai moralista.
- 2+ punchline. Metafore da bar ${drinksYes ? "frequenti ma eleganti" : "rare e leggere"}.
Personalizzazione: realismo ancorato a ${cityNow}, ${workRole} senza elenchi.
Predittivo: primo passo concreto, vincolo realistico, un indicatore di successo integrato nel racconto.
Chiusura: ${finaleInstr_it}`;
  }

  // 🌙 WHAT?f — amico sobrio, immaginativo ma concreto
  return en
    ? `You are "What?f": a lucid, calm friend — visual, concrete, empathetic.
Today is ${now.weekday_en}, ${now.date_en}. Season: ${now.season_en}. Local time ~${now.time24}.
${tense_en} ${neverFirst_en}
Output: 8–10 short lines, cinematic and grounded, one voice.
Predictive goal:
- PAST → counterfactual vignette as if it had happened: include a plausible trade-off and a sign of success.
- FUTURE → near-future path if chosen now: include the first small step (1 call/email/hour), a success indicator, and a realistic constraint.
Personalization: weave city/role/goals implicitly (no lists). Keep timeless unless the prompt mentions current events.
Ending: ${finaleInstr_en}`
    : `Sei “What?f”: un amico lucido e calmo — visivo, concreto, empatico.
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione: ${now.season_it}. Ora ~${now.time24}.
${tense_it} ${neverFirst_it}
Formato: 8–10 righe brevi, cinematografiche e ancorate, voce unica.
Obiettivo predittivo:
- PASSATO → vignetta controfattuale come se fosse accaduta: un trade-off plausibile e un segnale che indicava successo.
- FUTURO → percorso di prossimo futuro se scegli ora: primo passo (1 chiamata/email/ora), un indicatore di successo e un vincolo realistico.
Personalizzazione: intreccia città/ruolo/obiettivi in modo implicito (no elenchi). Resta “senza tempo” se l’utente non cita attualità.
Chiusura: ${finaleInstr_it}`;
}

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Formatting contract: one speaker; 8–12 very short lines; vivid micro-scene; at least two punchlines; no first person narrator; no moral lessons.`
      : `Contratto di formato: voce unica; 8–12 righe molto brevi; micro-scena vivida; almeno due punchline; niente prima persona; niente lezioncine.`;
  }
  return en
    ? `Formatting contract: one speaker; 8–10 short lines; visual and grounded; include a concrete first step and a realistic trade-off if relevant; no first person narrator.`
    : `Contratto di formato: voce unica; 8–10 righe brevi; visivo e ancorato; includi un primo passo concreto e un trade-off realistico se serve; niente prima persona.`;
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

  // Segnali predittivi espliciti
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

  // Chiarimenti dell’utente
  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  // Istruzioni operative riassuntive
  L.push(
    en
      ? `WRITE RULES:
- Address the user as "you", not "I".
- Keep the whole answer in one block (no headings), 8–12 short lines as specified by style.
- Weave in one small local detail (place/person) only if provided.
- Include one concrete first step and one success indicator (future) OR a sign that it worked (past).
- Stay timeless unless the prompt mentions current events.`
      : `REGOLE DI SCRITTURA:
- Rivolgiti all’utente come "tu", mai "io".
- Un blocco unico (senza titoli), 8–12 righe brevi secondo lo stile scelto.
- Inserisci un piccolo dettaglio locale (luogo/persona) solo se presente.
- FUTURO: un primo passo concreto e un indicatore di successo. PASSATO: un segnale che avrebbe indicato che funzionava.
- Resta senza tempo se l’utente non cita l’attualità.`
  );

  return L.join("\n\n");
}

/* ============== Clarify mirato alla domanda ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You will craft 2–3 short clarification questions tailored to the user's main question. Each must be specific, non-generic, and obviously connected to the key nouns/verbs in the question. Output ONLY a JSON array of {"id","label","placeholder"}.`
    : `Devi creare 2–3 domande di chiarimento corte e mirate sulla domanda principale. Ognuna deve essere specifica, non generica, e chiaramente collegata ai nomi/verbi chiave della domanda. Restituisci SOLO un array JSON di {"id","label","placeholder"}.`;

  const period = en
    ? `Be TIMEFRAME-AWARE:
- If TIMEFRAME="past": ask pivot year/event, place/context back then, one constraint/signal.
- If TIMEFRAME="future": ask decision window, success indicator, one realistic constraint/resource.`
    : `Attenzione al PERIODO:
- Se PERIODO="past": anno/evento svolta, luogo/contesto di allora, un vincolo/segno.
- Se PERIODO="future": finestra decisionale, indicatore di successo, un vincolo/risorsa realistica.`;

  const profiling = en
    ? `Progressive profiling only if missing: city_now/city_origin, work_role, one concrete goal.`
    : `Profilazione progressiva solo se mancano: city_now/city_origin, work_role, un obiettivo concreto.`;

  const dedup = en
    ? `Avoid repeating types you've already asked in this call. Prefer variety that reduces ambiguity.`
    : `Evita di ripetere tipi già chiesti in questa chiamata. Preferisci varietà che riduca l’ambiguità.`;

  return `${base}\n${period}\n${profiling}\n${dedup}`;
}

function clarifyUserContent({ domanda, periodo = "future", profilo = {}, lang = "it" }) {
  const en = isEn(lang);
  const parts = [];
  parts.push((en ? "QUESTION: " : "DOMANDA: ") + (domanda || ""));
  parts.push((en ? "TIMEFRAME: " : "PERIODO: ") + periodo);

  const digest = renderProfileDigest(profilo);
  if (digest) parts.push(en ? "PROFILE DIGEST: " + digest : "SINTESI PROFILO: " + digest);

  parts.push(
    en
      ? "Return ONLY the JSON array. Use the nouns/verbs in the question to anchor each ask."
      : "Ritorna SOLO l’array JSON. Usa i nomi/verbi della domanda per ancorare ogni domanda."
  );
  return parts.join("\n\n");
}

/* ============== Fallback clarify ============== */
function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  const qs = [];

  if (periodo === "past") {
    qs.push({ id: "pivot_year", label: en ? "Turning point year/event?" : "Anno/evento di svolta?", placeholder: en ? "e.g., 2015 move / 2010 offer" : "es. trasferimento 2015 / offerta 2010" });
    qs.push({ id: "then_context", label: en ? "Where and what context mattered then?" : "Dove e quale contesto contava allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" });
    qs.push({ id: "what_would_change", label: en ? "One constraint/signal that would've changed it?" : "Un vincolo/segno che l’avrebbe cambiata?", placeholder: en ? "money/time/person/offer" : "soldi/tempo/persona/offerta" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Vera finestra decisionale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "success_indicator", label: en ? "One success indicator?" : "Un indicatore di successo?", placeholder: en ? "€ saved / hours / first client" : "€ risparmiati / ore / primo cliente" });
    qs.push({ id: "real_constraint", label: en ? "Most concrete constraint?" : "Vincolo più concreto?", placeholder: en ? "budget / time / energy / commitment" : "budget / tempo / energia / impegno" });
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
          temperature: 0.5,
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

    /* ---------- Generation branch (singolo stile) ---------- */
    const sys1 = systemPrompt({ stile, lang, profile: profilo, nowIso, tz, periodo });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz });
    const sys2 = responseStyleInstruction(lang, stile);

    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "Finale for this thread: deliver closure, no cliffhanger."
          : "Finale per questa storia: chiudi davvero, niente cliffhanger.")
      : (isEn(lang)
          ? `Mid-episode: end with a subtle personal hook.`
          : `Episodio intermedio: chiudi con un gancio personale.`);

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

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
