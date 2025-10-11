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

  // Campi predittivi aggiuntivi
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
    ? `FINALE: Provide closure. No cliffhanger. Land a memorable final line. Invite in one line to start a new "what if".`
    : `MID-EPISODE: End with a subtle, personal hook inviting the next step (no paywall mention).`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero. Niente cliffhanger. Chiusa memorabile. Un invito in una riga a un nuovo “e se”.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile che inviti al seguito (senza menzionare paywall).`;

  const now = safeNow(nowIso, tz);
  const when_en = `Today is ${now.weekday_en}, ${now.date_en}. Season: ${now.season_en}. Local time ~${now.time24}.`;
  const when_it = `Oggi è ${now.weekday_it}, ${now.date_it}. Stagione: ${now.season_it}. Ora locale ~${now.time24}.`;

  if (stile === "wtf") {
    // 🥃 WHAT THE F — barista brillante, sarcastico-buono, ritmo da bancone
    return en
      ? `You are "What the F": a sharp, late-night bartender-philosopher — witty, tipsy vibe, never mean.
${when_en}
Voice:
- ONE voice, no script labels. 8–10 short lines. Quick inner banter.
- Strong sarcasm, playful wit, human warmth. At least 2 punchlines.
- Respect tense: FUTURE → speak in the future; PAST → narrate as if it happened.
- Each line ≤ 14 words; pauses like sips.
Alcohol flavor: ${drinksYes ? "tasteful bar metaphors allowed (no promotion)" : "very light nods"}.
Personalization:
- Ground the scene subtly in ${cityNow} and ${workRole}. Avoid info-dumps.
Ending:
- ${finaleInstr_en}`
      : `Sei “What the F”: barista brillante da notte fonda — ironico, frizzante, mai cattivo.
${when_it}
Voce:
- UNA sola voce, niente etichette. 8–10 righe corte. Botta-e-risposta interiore.
- Sarcasmo giocoso, battute intelligenti, calore umano. Almeno 2 punchline.
- Rispetta i tempi: FUTURO → parla al futuro; PASSATO → come se fosse accaduto.
- Ogni riga ≤ 14 parole; pause da sorso.
Tocco alcolico: ${drinksYes ? "metafore da bancone con gusto (mai promozione)" : "accenni lievi"}.
Personalizzazione:
- Ancora la scena in ${cityNow} e ${workRole}, senza elenchi.
Chiusura:
- ${finaleInstr_it}`;
  }

  // 🌙 WHAT?f — amico lucido, discorsivo, predittivo e concreto
  return en
    ? `You are "What?f": a candid, thoughtful friend — calm, current, slightly mystical, but concrete.
${when_en}
Voice:
- ONE steady inner voice. 8–12 concise sentences, flowing in 1–2 paragraphs.
- Respect tense: FUTURE → speak in the future; PAST → narrate as if it happened.
- Less sweet, more grounded: realistic timings, small risks, trade-offs, a first step.
Personalization:
- Use decision window, success indicator, risk tolerance, and place/person anchor if given.
- Weave profile signals (city, role, values, goal) implicitly — no bullet lists.
Predictive focus:
- FUTURE → near-term path if they choose now; include one concrete success signal.
- PAST → counterfactual slice; include a plausible cost and “it worked” signal.
Ending:
- ${finaleInstr_en}`
    : `Sei “What?f”: un amico lucido e diretto — calmo, attuale, un po’ mistico ma concreto.
${when_it}
Voce:
- UNA voce ferma. 8–12 frasi nette in 1–2 paragrafi.
- Rispetta i tempi: FUTURO → parla al futuro; PASSATO → come se fosse accaduto.
- Meno smielato, più terreno: tempi realistici, piccoli rischi, trade-off, primo passo concreto.
Personalizzazione:
- Usa finestra decisionale, indicatore di successo, tolleranza al rischio, e un’ancora luogo/persona se presenti.
- Intreccia segnali del profilo (città, ruolo, valori, obiettivo) in modo implicito — niente elenchi.
Asse predittivo:
- FUTURO → percorso di breve periodo se sceglie ora; includi un segnale concreto di riuscita.
- PASSATO → controfattuale credibile; inserisci un costo plausibile e un segnale “stava funzionando”.
Chiusura:
- ${finaleInstr_it}`;
}

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines, one speaker, quick inner banter. Keep it funny and sharp, never mean. Respect FUTURE/PAST tense. Add at least two punchlines. End as instructed.`
      : `Formato: 8–10 righe corte, voce unica, botta-e-risposta veloce. Divertente e tagliente, mai cattivo. Rispetta i tempi FUTURO/PASSATO. Inserisci almeno due punchline. Chiudi come istruito.`;
  }
  return en
    ? `Format: 1–2 paragraphs, 8–12 concise sentences. Friendly, clear, predictive. Include one realistic trade-off, one success signal, and one first step (15–60 min). Respect FUTURE/PAST tense. End as instructed.`
    : `Formato: 1–2 paragrafi, 8–12 frasi. Amichevole, chiaro, predittivo. Inserisci un trade-off realistico, un segnale di riuscita e un primo passo (15–60 min). Rispetta FUTURO/PASSATO. Chiudi come istruito.`;
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

  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  // Istruzioni predittive (senza “notizie inventate”)
  L.push(
    en
      ? `PREDICTIVE OBJECTIVE:
- PAST → counterfactual as if it truly happened: include a plausible cost and an early “it worked” signal.
- FUTURE → near-future path if they choose now: include first small step (one call/email/hour), one concrete success indicator, and one realistic constraint.
- Weave decision window, risk tolerance, and anchor (place/person) naturally. Avoid specific current-events claims unless the user mentions them.`
      : `OBIETTIVO PREDITTIVO:
- PASSATO → controfattuale come se fosse avvenuto: inserisci un costo plausibile e un segnale precoce “stava funzionando”.
- FUTURO → percorso di prossimo futuro se sceglie ora: inserisci un primo passo piccolo (una chiamata/email/ora), un indicatore di successo concreto e un vincolo realistico.
- Intreccia finestra decisionale, tolleranza al rischio e ancora (luogo/persona) in modo naturale. Evita affermazioni di attualità specifiche se l’utente non le cita.`
  );

  return L.join("\n\n");
}

/* ============== Clarify “aware” del periodo + tema domanda (migliorato) ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  return en
    ? `You will create 3 SHORT, TARGETED clarifying questions tied to the user’s main question.
Rules:
- Base the questions on the QUESTION’s topic (work/money/move/study/relationships/wellbeing) and the TIMEFRAME (past/future).
- If key profile fields are missing, ask exactly one of them (city_now, work_role, main_goal) but only if it improves the prediction.
- Do NOT repeat generic prompts. Each question must reduce uncertainty for a predictive answer.
- Keep one line per question. Provide a helpful example in the placeholder.
Output ONLY a JSON array of objects: [{ "id","label","placeholder" }].`
    : `Crea 3 domande CHIARE e MIRATE collegate alla domanda principale.
Regole:
- Basi le domande sul TEMA della DOMANDA (lavoro/soldi/trasferimento/studio/relazioni/benessere) e sul PERIODO (passato/futuro).
- Se mancano dati di profilo fondamentali, chiedine al massimo UNO (city_now, work_role, main_goal) solo se migliora la predizione.
- Niente domande generiche o ripetute. Ogni domanda deve ridurre l’incertezza per la risposta predittiva.
- Una riga per domanda. Nel placeholder dai un esempio utile.
Restituisci SOLO un array JSON di oggetti: [{ "id","label","placeholder" }].`;
}

function clarifyUserContent({ domanda, periodo = "future", profilo = {}, lang = "it" }) {
  const en = isEn(lang);
  const parts = [];
  parts.push((en ? "QUESTION: " : "DOMANDA: ") + (domanda || ""));
  parts.push((en ? "TIMEFRAME: " : "PERIODO: ") + periodo);
  const digest = renderProfileDigest(profilo);
  if (digest) parts.push(en ? "PROFILE DIGEST: " + digest : "SINTESI PROFILO: " + digest);

  // Hint: aiuta il modello ad “agganciarsi” al tema
  parts.push(
    en
      ? `HINT: derive the theme from the question text itself; avoid boilerplate. Return ONLY the JSON array.`
      : `INDIZIO: ricava il tema dal testo della domanda; evita frasi fotocopia. Restituisci SOLO l’array JSON.`
  );
  return parts.join("\n\n");
}

/* ============== Fallback clarify (tematico) ============== */
function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  const qs = [];
  const s = (domanda || "").toLowerCase();

  const isWork = /\b(lavor|work|career|job|azienda|progetto|project)\b/i.test(s);
  const isMove = /\b(trasfer|citt|quartiere|move|city|neigh|country)\b/i.test(s);
  const isStudy= /\b(stud|master|laurea|corso|course|study)\b/i.test(s);
  const isMoney= /\b(euro|€|soldi|stipendio|debito|invest|salary|debt|rent|mutuo|mortgage)\b/i.test(s);
  const isRel  = /\b(relazion|partner|famiglia|friend|relationship)\b/i.test(s);
  const isWell = /\b(stress|sonno|salute|burnout|sleep|anxiety)\b/i.test(s);

  function push(id,label,ph){ qs.push({ id, label: en?label.it:label.it, placeholder: en?ph.en:ph.it }); }

  if (periodo === "past") {
    if (isWork) qs.push({ id:"pivot_year", label: en?"Which was the pivot year/event back then?":"Qual era l’anno/evento di svolta allora?", placeholder: en?"e.g., 2019 acquisition":"es. acquisizione 2019" });
    else qs.push({ id:"then_context", label: en?"Where and what context mattered then?":"Dove e quale contesto contava allora?", placeholder: en?"city/team/family":"città/team/famiglia" });

    qs.push({ id:"what_would_change", label: en?"One constraint/signal that would've changed it?":"Un vincolo/segno che l’avrebbe cambiata?", placeholder: en?"money/time/person/offer":"soldi/tempo/persona/offerta" });
  } else {
    if (isWork) qs.push({ id:"priority", label: en?"What’s the #1 priority here?":"Qual è la priorità numero uno qui?", placeholder: en?"growth/stability/flexibility":"crescita/stabilità/flessibilità" });
    if (isMove) qs.push({ id:"landmark", label: en?"One place that matters near the new area?":"Un luogo che conta vicino alla nuova zona?", placeholder: en:"square/station/neighborhood", it:"piazza/stazione/quartiere" });
    if (isStudy || isMoney) qs.push({ id:"indicator", label: en?"One success indicator you’ll track?":"Un indicatore di successo che terrai d’occhio?", placeholder: en:"hours/week, € saved, retainer", it:"ore/settimana, € risparmiati, retainer" });
    qs.push({ id:"time_window", label: en?"Real decision window?":"Vera finestra decisionale?", placeholder: en:"this month / 3–6 months / 12 months", it:"questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id:"real_constraint", label: en?"Most concrete constraint?":"Vincolo più concreto?", placeholder: en:"budget/time/energy/commitment", it:"budget/tempo/energia/impegno" });
  }

  if (!profilo?.city_now && !profilo?.city && qs.length < 3) {
    qs.push({ id: "city_now", label: en ? "Where do you live now?" : "Dove vivi adesso?", placeholder: en ? "city" : "città" });
  }
  if (!profilo?.work_role && !profilo?.role && qs.length < 3) {
    qs.push({ id: "work_role", label: en ? "Your current role in one line?" : "Il tuo ruolo attuale in una riga?", placeholder: en ? "e.g., pharmacist technician" : "es. tecnico farmaceutico" });
  }
  if ((!Array.isArray(profilo?.goals) || !profilo.goals?.length) && qs.length < 3) {
    qs.push({ id: "main_goal", label: en ? "One concrete goal now?" : "Un obiettivo concreto ora?", placeholder: en ? "e.g., change job / more time" : "es. cambiare lavoro / più tempo" });
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
  // Emisfero nord, semplice
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

    /* ---------- Clarify branch (dinamico, legato al tema della domanda) ---------- */
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
        if (start >= 0 && end > start) {
          questions = JSON.parse(raw.slice(start, end + 1));
        }
      } catch (err) {
        // lascia al fallback
        console.error("Clarify dynamic error:", err?.message || err);
      }

      if (!Array.isArray(questions) || questions.length === 0) {
        questions = localClarify(domanda, profilo, lang, periodo);
      }

      questions = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i + 1}`),
        label: String(q.label || q?.text || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));

      // Header di supporto (opzionale per il client)
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
          ? `Mid-episode: end with a subtle personal hook linked to ${profilo?.city_now || profilo?.city || (isEn(lang) ? "their city" : "la tua città")} or ${profilo?.work_role || profilo?.role || (isEn(lang) ? "their role" : "il tuo ruolo")}.`
          : `Episodio intermedio: chiudi con un gancio personale legato a ${profilo?.city_now || profilo?.city || "la tua città"} o ${profilo?.work_role || profilo?.role || "il tuo ruolo"}.`);

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    // Temperatura: più alta per wtf per favorire ritmo/battute
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
