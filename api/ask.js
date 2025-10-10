// /api/ask.js
import OpenAI from "openai";

/* ============== Setup ============== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ============== Persona prompts ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {} }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";

  if (stile === "wtf") {
    return en
      ? `You are What?f's late-night bartender-philosopher: witty, razor-sharp, joyfully tipsy.
Speak with high sarcasm, playful irony, and kind elegance. No insults, no slurs, no vulgarity.
Your mission: narrate a vivid, compact scene showing the user's *alternate life path*:
- If TIMEFRAME is PAST: write a counterfactual “road not taken” as if it had happened.
- If TIMEFRAME is FUTURE: write a plausible near-future slice if they choose that option now.
Style:
- Vary openings (hooks: “Picture this:”, “Plot twist:”, “Confession time:”, “Spoiler from another timeline:”, “Between us:”, “Small cosmic joke:”, “Okay, imagine this:”).
- Cinematic, tight, funny; philosophical but joyful, not preachy.
- Use concrete details only if useful.
- If advice is needed, end with 3 crisp bullet options.
“Alcoholic” flavor: ${drinksYes ? "slightly stronger cocktail metaphors (tasteful)" : "light occasional nods"}.
Safety: never encourage harmful drinking; it's a mood, not a prescription.`
      : `Sei il barista-filosofo nottambulo di What?f: arguto, affilato, felicemente alticcio.
Parla con sarcasmo deciso, ironia giocosa ed eleganza gentile. Niente insulti o volgarità.
Missione: racconta una scena vivida della *vita alternativa* dell’utente:
- Se il PERIODO è PASSATO: scrivi un controfattuale “strada non presa” come se fosse accaduta.
- Se il PERIODO è FUTURO: uno scorcio plausibile del prossimo futuro se oggi sceglie quella via.
Stile:
- Varia sempre l’incipit (ganci: “Immagina la scena:”, “Colpo di scena:”, “Confessione:”, “Spoiler da una timeline parallela:”, “Tra noi:”, “Piccola beffa cosmica:”, “Ok, visualizza questo:”).
- Prosa cinematografica, asciutta, divertente; filosofia allegra, non pedante.
- Dettagli concreti solo se servono.
- Se serve un consiglio, chiudi con 3 punti elenco.
“Tasso alcolico”: ${drinksYes ? "un filo più alto, con metafore da bancone (di buon gusto)" : "accenni leggeri"}.
Sicurezza: mai promuovere eccessi; è atmosfera, non prescrizione.`;
  }

  return isEn(lang)
    ? `You are What?f, a warm, thoughtful scenario-designer and friend.
Narrate a plausible, personal scenario for the user’s *alternative path*:
- PAST → counterfactual “road not taken” as if it happened, with one enduring insight.
- FUTURE → near-future slice if they choose that option now, with 1–3 actionable steps.
Style: gentle philosophy, natural conversation, varied openings. Concise (~150–220 words).`
    : `Sei What?f, un amico riflessivo e designer di scenari.
Racconta uno scenario plausibile e personale della *strada alternativa*:
- PASSATO → controfattuale come se fosse avvenuto, con un’idea che resta.
- FUTURO → prossimo futuro se oggi sceglie quella via, con 1–3 passi concreti.
Stile: filosofia gentile, conversazione naturale, incipit vari. Conciso (150–220 parole).`;
}

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Write as a cheeky, philosophical bartender. Cinematic prose, tight rhythm. ~150–220 words. If advice is needed, end with 3 bullets. Never crude.`
      : `Scrivi come un barista filosofico e sfacciato. Prosa cinematografica, ritmo asciutto. ~150–220 parole. Se serve, 3 bullet finali. Mai volgare.`;
  }
  return en
    ? `Write as a warm, reflective friend. Realistic, actionable. 150–220 words.`
    : `Scrivi come un amico riflessivo. Realistico, con passi concreti. 150–220 parole.`;
}

/* ============== Costruzione messaggio utente ============== */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile }) {
  const en = isEn(lang);
  const L = [];
  L.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  L.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  L.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);

  if (profilo && typeof profilo === "object") {
    const { name, role, city, goal, values, style, change_attitude, motivation, self_view, drinks_pref, unwind, micro } = profilo;
    const p = [];
    if (name) p.push(`name: ${name}`);
    if (role) p.push(`role: ${role}`);
    if (city) p.push(`city: ${city}`);
    if (goal) p.push(`goal: ${goal}`);
    if (values?.length) p.push(`values: ${values.join(", ")}`);
    if (style) p.push(`style: ${style}`);
    if (change_attitude) p.push(`change_attitude: ${change_attitude}`);
    if (motivation) p.push(`motivation: ${motivation}`);
    if (self_view) p.push(`self_view: ${self_view}`);
    if (typeof drinks_pref === "string") p.push(`drinks_pref: ${drinks_pref}`);
    if (typeof unwind === "string") p.push(`unwind: ${unwind}`);
    if (micro && typeof micro === "object") {
      Object.entries(micro).forEach(([k, v]) => { if (v && typeof v === "string" && v.trim()) p.push(`${k}: ${v}`); });
    }
    if (p.length) L.push((en ? "PROFILE:\n" : "PROFILO:\n") + p.join("\n"));
  }

  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  L.push(
    en
      ? `NARRATIVE TARGET:
- If TIMEFRAME = "past": counterfactual vignette as if it truly happened.
- If TIMEFRAME = "future": near-future slice if they choose now.`
      : `OBIETTIVO NARRATIVO:
- PERIODO "past": vignetta controfattuale come se fosse successa.
- PERIODO "future": scorcio di prossimo futuro se sceglie ora.`
  );
  L.push(
    en
      ? `CONSTRAINTS:
- Avoid repeating the same person/place/object every time.
- Vary the opening line.`
      : `VINCOLI:
- Non ripetere sempre gli stessi motivi (persone/luoghi/oggetti).
- Varia l’incipit.`
  );
  return L.join("\n\n");
}

/* ============== Clarify “aware” del periodo ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  return en
    ? `You generate 2–3 short, focused clarifying questions to better answer the user's main question.
You are PERIOD-AWARE:
- If TIMEFRAME = "past": ask about the pivot year/event, location/context at that time, what constraint or signal would have changed the path.
- If TIMEFRAME = "future": ask about next decision window/timing, success indicator, realistic constraint or resource.
Constraints:
- Tailor questions to QUESTION, TIMEFRAME and PROFILE (role, city, goal, micro signals).
- Each question must be one line, concrete, non-generic.
- Prefer action, constraints, indicators, timing, or success criteria.
- Safety: avoid PII/invasive asks.
- Output MUST be ONLY a JSON array of { "id": string, "label": string, "placeholder": string } (2–3 items).`
    : `Generi 2–3 domande di chiarimento brevi e mirate per rispondere meglio.
Sei CONSAPEVOLE DEL PERIODO:
- Se PERIODO = "past": chiedi anno/evento di snodo, luogo/contesto di allora, quale vincolo o segnale avrebbe cambiato strada.
- Se PERIODO = "future": chiedi finestra temporale/decisione, indicatore di successo, vincolo o risorsa realistica.
Vincoli:
- Adatta le domande a DOMANDA, PERIODO e PROFILO (ruolo, città, obiettivo, micro-segnali).
- Una riga per domanda, concreta e non generica.
- Privilegia azione, vincoli, indicatori, tempi, criteri di successo.
- Sicurezza: evita PII/richieste invasive.
- Output SOLO come array JSON di { "id": string, "label": string, "placeholder": string } (2–3 elementi).`;
}

function clarifyUserContent({ domanda, periodo = "future", profilo = {}, lang = "it" }) {
  const en = isEn(lang);
  const parts = [];
  parts.push((en ? "QUESTION: " : "DOMANDA: ") + (domanda || ""));
  parts.push((en ? "TIMEFRAME: " : "PERIODO: ") + periodo);
  if (profilo && typeof profilo === "object") {
    const { name, role, city, goal, unwind, drinks_pref, micro = {} } = profilo;
    const p = [];
    if (name) p.push(`name: ${name}`);
    if (role) p.push(`role: ${role}`);
    if (city) p.push(`city: ${city}`);
    if (goal) p.push(`goal: ${goal}`);
    if (unwind) p.push(`unwind: ${unwind}`);
    if (drinks_pref) p.push(`drinks_pref: ${drinks_pref}`);
    Object.entries(micro || {}).forEach(([k, v]) => { if (v && typeof v === "string") p.push(`${k}: ${v}`); });
    if (p.length) parts.push((en ? "PROFILE:\n" : "PROFILO:\n") + p.join("\n"));
  }
  parts.push(en ? "Return ONLY the JSON array." : "Ritornare SOLO l’array JSON.");
  return parts.join("\n\n");
}

/* ============== Fallback locale (period-aware) ============== */
function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  const s = (domanda || "").toLowerCase();

  const qs = [];
  if (periodo === "past") {
    qs.push({
      id: "pivot_year",
      label: en ? "Which year/event is the real turning point?" : "Quale anno/evento è stato il vero punto di svolta?",
      placeholder: en ? "e.g., 2010 job offer / 2015 move" : "es. offerta lavoro 2010 / trasferimento 2015",
    });
    qs.push({
      id: "then_context",
      label: en ? "Where were you and what context mattered most back then?" : "Dove eri e quale contesto contava di più allora?",
      placeholder: en ? "city / team / family situation" : "città / team / situazione familiare",
    });
    qs.push({
      id: "what_would_change",
      label: en ? "What constraint or signal would have changed your choice?" : "Quale vincolo o segnale avrebbe cambiato la tua scelta?",
      placeholder: en ? "money / time / a person / an offer" : "soldi / tempo / una persona / un’offerta",
    });
  } else {
    // future
    qs.push({
      id: "time_window",
      label: en ? "What’s the real decision window?" : "Qual è la vera finestra decisionale?",
      placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi",
    });
    qs.push({
      id: "success_indicator",
      label: en ? "One indicator that tells you you’re on track?" : "Un indicatore che ti dice che sei sulla strada giusta?",
      placeholder: en ? "€ saved, hours/week, first client" : "€ risparmiati, ore/settimana, primo cliente",
    });
    qs.push({
      id: "real_constraint",
      label: en ? "What’s the most concrete constraint?" : "Qual è il vincolo più concreto?",
      placeholder: en ? "budget / time / energy / commitment" : "budget / tempo / energia / impegno",
    });
  }

  // Micro-heuristics extra sul testo della domanda
  if (/\b(move|trasfer|city|quartiere)\b/i.test(s)) {
    qs[1] = qs[1] || {
      id: "landmark",
      label: en ? "One place that matters in this scenario?" : "Un luogo di riferimento che conta in questo scenario?",
      placeholder: en ? "station / square / office area" : "stazione / piazza / zona ufficio",
    };
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
      profilo = {},            // { ... , micro:{...} }
      clarifications = {},     // risposte dell’utente ai chiarimenti
      extra = "",              // forza lingua ecc.
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
          temperature: 0.4,
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
      } catch (_) { /* se fallisce, fallback */ }

      if (!Array.isArray(questions) || questions.length === 0) {
        questions = localClarify(domanda, profilo, lang, periodo);
      }

      questions = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i + 1}`),
        label: String(q.label || q?.text || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));

      return res.status(200).json({ questions });
    }

    /* ---------- Generation branch ---------- */
    const sys1 = systemPrompt({ stile, lang, profile: profilo });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile });
    const sys2 = responseStyleInstruction(lang, stile);

    const reminders = isEn(lang)
      ? `Reminders:
- TIMEFRAME awareness: if PAST → counterfactual as if it happened; if FUTURE → near-future slice if they choose now.
- Vary the opening line; avoid repeating the same person/place/object motif.
- Compact, vivid images.`
      : `Promemoria:
- Consapevolezza del PERIODO: PASSATO → come se fosse successo; FUTURO → scorcio di prossimo futuro se sceglie ora.
- Varia l’incipit; non ripetere sempre gli stessi motivi (persona/luogo/oggetto).
- Compatto, immagini vivide.`;

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      { role: "system", content: reminders },
      { role: "system", content: sys2 },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.95 : 0.75;

    // Streaming
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
    return res.status(500).json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
