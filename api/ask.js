// /api/ask.js
import OpenAI from "openai";

/**
 * Serverless handler per What?f
 * Env richiesto: OPENAI_API_KEY
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ───────────────────────── Util ───────────────────────── */

const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const MODEL_TEXT = "gpt-4o-mini";

/* ───────────────────────── Prompts personalità ───────────────────────── */

function systemPrompt({ stile = "whatif", lang = "it", profile = {} }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";

  if (stile === "wtf") {
    return en
      ? `You are What?f's late-night bartender-philosopher: witty, razor-sharp, joyfully tipsy.
Speak with high sarcasm, playful irony, and kind elegance. No insults, no slurs, no vulgarity.
Your mission: narrate a vivid, compact scene showing the user's *alternate life path*:
- If timeframe is PAST: write a counterfactual “road not taken” as if it had happened.
- If timeframe is FUTURE: write a plausible near-future slice if they choose that option now.
Style:
- Vary your openings (do NOT reuse the same). Hooks: “Picture this:”, “Plot twist:”, “Confession time:”, “Spoiler from another timeline:”, “Between us:”, “Small cosmic joke:”, “Okay, imagine this:”.
- Cinematic, tight, funny; philosophical but joyful, not preachy.
- Include specific details only when useful; don't force people/places every time.
- If advice is needed, end with 3 crisp bullet options.
“Alcoholic” flavor: ${drinksYes ? "add a tad more cocktail metaphors (still tasteful)" : "keep it light, occasional nod only"}.
Safety: never encourage harmful drinking; it's a mood, not a prescription.`
      : `Sei il barista-filosofo nottambulo di What?f: arguto, affilato, felicemente alticcio.
Parla con sarcasmo deciso, ironia giocosa ed eleganza gentile. Niente insulti o volgarità.
Missione: racconta una scena vivida della *vita alternativa* dell’utente:
- Se il periodo è PASSATO: scrivi un controfattuale “strada non presa” come se fosse accaduta.
- Se il periodo è FUTURO: uno scorcio plausibile del prossimo futuro se oggi sceglie quella via.
Stile:
- Varia SEMPRE l’incipit. Ganci: “Immagina la scena:”, “Colpo di scena:”, “Confessione:”, “Spoiler da una timeline parallela:”, “Tra noi:”, “Piccola beffa cosmica:”, “Ok, visualizza questo:”.
- Prosa cinematografica, asciutta, divertente. Filosofico ma allegro, mai pedante.
- Dettagli concreti solo se servono (non forzare persone/luoghi ogni volta).
- Se serve un consiglio, chiudi con 3 punti elenco incisivi.
“Tasso alcolico”: ${drinksYes ? "un filo più alto, con metafore da bancone (di buon gusto)" : "solo accenni leggeri"}.
Sicurezza: mai promuovere eccessi; è atmosfera, non prescrizione.`;
  }

  // WHATIF (amichevole, filosofico, pragmatico)
  return en
    ? `You are What?f, a warm, thoughtful scenario-designer and friend.
Narrate a plausible, personal scenario for the user’s *alternative path*:
- PAST → counterfactual “road not taken” as if it happened, with one enduring insight.
- FUTURE → near-future slice if they choose that option now, with 1–3 actionable steps.
Style:
- Gentle philosophy, natural conversation, varied openings.
- Use specific details only if relevant; avoid repeating the same person/place motif daily.
- Concise (≈150–220 words).`
    : `Sei What?f, un amico riflessivo e un designer di scenari.
Racconta uno scenario plausibile e personale della *strada alternativa* dell’utente:
- PASSATO → “strada non presa” come se fosse avvenuta, con un’idea che resta.
- FUTURO → uno scorcio di prossimo futuro se oggi sceglie quella via, con 1–3 passi concreti.
Stile:
- Filosofia gentile, conversazione naturale, incipit vari.
- Dettagli specifici solo se rilevanti; evita di ripetere ogni volta gli stessi motivi.
- Conciso (≈150–220 parole).`;
}

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Write as a cheeky, philosophical bartender. Cinematic prose, tight rhythm.
Aim for ~150–220 words. If advice is needed, end with 3 bullet points. Never be offensive or crude.`
      : `Scrivi come un barista filosofico e sfacciato. Prosa cinematografica, ritmo asciutto.
Circa 150–220 parole. Se serve un consiglio, chiudi con 3 punti elenco. Mai offensivo o volgare.`;
  }
  return en
    ? `Write as a warm, reflective friend. Realistic, actionable. 150–220 words.`
    : `Scrivi come un amico riflessivo. Realistico, con passi concreti. 150–220 parole.`;
}

/* ───────────────────────── Costruzione messaggi ───────────────────────── */

function buildUserContent({
  domanda,
  periodo,
  profilo,
  clarifications,
  lang,
  stile,
}) {
  const en = isEn(lang);
  const lines = [];
  lines.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  lines.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  lines.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);

  // Profilo minimo utile
  if (profilo && typeof profilo === "object") {
    const {
      name, role, city, goal, values, style,
      change_attitude, motivation, self_view,
      drinks_pref, unwind, micro,
    } = profilo;

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
      Object.entries(micro).forEach(([k, v]) => {
        if (v && typeof v === "string" && v.trim()) p.push(`${k}: ${v}`);
      });
    }
    if (p.length) lines.push((en ? "PROFILE:\n" : "PROFILO:\n") + p.join("\n"));
  }

  if (clarifications && Object.keys(clarifications).length) {
    const cLines = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    lines.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + cLines.join("\n"));
  }

  // Vincoli narrativi
  lines.push(
    en
      ? `NARRATIVE TARGET:
- If TIMEFRAME = "past": write a counterfactual vignette as if it truly happened; keep it plausible and specific to the user.
- If TIMEFRAME = "future": write a plausible near-future slice if they choose that path now.`
      : `OBIETTIVO NARRATIVO:
- Se PERIODO = "past": scrivi una vignetta controfattuale come se fosse davvero accaduta; plausibile e specifica.
- Se PERIODO = "future": scrivi uno scorcio di prossimo futuro se oggi prende quella strada.`
  );

  lines.push(
    en
      ? `CONSTRAINTS:
- Avoid repeating the same person/place/object motif every time. Use them only when they truly add value.
- Vary the opening line.`
      : `VINCOLI:
- Evita di ripetere ogni volta la stessa persona/lo stesso luogo/lo stesso oggetto; usali solo se aggiungono davvero valore.
- Varia la frase di apertura.`
  );

  return lines.join("\n\n");
}

/* ───────────────── Clarify generato dall’AI (+ fallback) ───────────────── */

function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  return en
    ? `You generate 2–3 short, focused clarifying questions to better answer the user's main question.
Constraints:
- Tailor questions to the QUESTION and to the PROFILE (role, city, goal, micro signals).
- Keep each question one line, concrete, non-generic.
- Prefer action, constraints, indicators, timing, or success criteria.
- Safety: avoid sensitive/PII or invasive info.
- Output MUST be a JSON array of { "id": string, "label": string, "placeholder": string } (2–3 items).`
    : `Generi 2–3 domande di chiarimento brevi e mirate per rispondere meglio alla domanda dell’utente.
Vincoli:
- Adatta le domande a DOMANDA e PROFILO (ruolo, città, obiettivo, micro-segnali).
- Ogni domanda su una riga, concreta, non generica.
- Preferisci azione, vincoli, indicatori, tempi, criteri di successo.
- Sicurezza: evita PII o richieste invasive.
- L’output DEVE essere un array JSON di { "id": string, "label": string, "placeholder": string } (2–3 elementi).`;
}

function clarifyUserContent({ domanda, profilo = {}, lang = "it" }) {
  const en = isEn(lang);
  const parts = [];
  parts.push((en ? "QUESTION: " : "DOMANDA: ") + (domanda || ""));
  if (profilo && typeof profilo === "object") {
    const { name, role, city, goal, unwind, drinks_pref, micro = {} } = profilo;
    const p = [];
    if (name) p.push(`name: ${name}`);
    if (role) p.push(`role: ${role}`);
    if (city) p.push(`city: ${city}`);
    if (goal) p.push(`goal: ${goal}`);
    if (unwind) p.push(`unwind: ${unwind}`);
    if (drinks_pref) p.push(`drinks_pref: ${drinks_pref}`);
    Object.entries(micro || {}).forEach(([k, v]) => {
      if (v && typeof v === "string") p.push(`${k}: ${v}`);
    });
    if (p.length) parts.push((en ? "PROFILE:\n" : "PROFILO:\n") + p.join("\n"));
  }
  parts.push(en
    ? "Return ONLY the JSON array as specified. No prose."
    : "Ritornare SOLO l’array JSON come specificato. Nessuna prosa.");
  return parts.join("\n\n");
}

/** Fallback locale semplice (in caso di errore rete/parsing) */
function localClarify(domanda = "", profilo = {}, lang = "it") {
  const en = isEn(lang);
  const s = (domanda || "").toLowerCase();
  const wantsWork = /(lavor|work|career|job|azienda|project)/i.test(s);
  const wantsMove = /(trasfer|move|citt|paese|quartiere|city)/i.test(s);
  const wantsStudy = /(stud|master|course|laurea)/i.test(s);
  const wantsMoney = /(euro|€|soldi|stipendio|debito|invest|salary|debt|invest)/i.test(s);
  const qs = [];
  if (wantsWork) {
    qs.push({
      id: "priority",
      label: en ? "What’s the #1 priority here?" : "Qual è la priorità numero uno qui?",
      placeholder: en ? "growth / stability / flexibility" : "crescita / stabilità / flessibilità",
    });
  }
  if (wantsMove) {
    qs.push({
      id: "landmark",
      label: en ? "A reference place that matters to you?" : "Un luogo di riferimento che conta per te?",
      placeholder: en ? "square / station / neighborhood" : "piazza / stazione / quartiere",
    });
  }
  if (wantsStudy || wantsMoney) {
    qs.push({
      id: "indicator",
      label: en ? "One indicator that tells you you’re on track?" : "Un indicatore che ti dice che sei sulla strada giusta?",
      placeholder: en ? "hours/week, € saved, clients" : "ore/settimana, € risparmiati, clienti",
    });
  }
  if (qs.length < 2) {
    qs.push({
      id: "constraint_2w",
      label: en ? "One realistic constraint in the next 2 weeks?" : "Un vincolo realistico nelle prossime 2 settimane?",
      placeholder: en ? "budget / time / energy" : "budget / tempo / energia",
    });
  }
  if (qs.length < 3) {
    qs.push({
      id: "context",
      label: en ? "What detail would make this scenario feel more *you*?" : "Quale dettaglio renderebbe questo scenario più *tuo*?",
      placeholder: en ? "a person, a place, a tiny constraint" : "una persona, un luogo, un piccolo vincolo",
    });
  }
  return qs.slice(0, 3);
}

/* ───────────────────────── HTTP Handler ───────────────────────── */

export default async function handler(req, res) {
  // CORS + preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      lang = "it",
      periodo = "future",   // "past" | "future"
      stile = "whatif",     // "whatif" | "wtf"
      clarify = false,      // se true → ritorna 2–3 domande
      stream = false,       // se true → text/event-stream
      profilo = {},         // { name, role, city, goal, unwind, drinks_pref, micro:{...} }
      clarifications = {},  // risposte utente ai chiarimenti
      extra = "",           // istruzioni extra (es. forza lingua)
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* === BRANCH: CHIARIMENTI === */
    if (clarify) {
      let questions = [];
      try {
        const sys = clarifySystemPrompt(lang);
        const usr = clarifyUserContent({ domanda, profilo, lang });
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
      } catch (_) { /* noop */ }

      if (!Array.isArray(questions) || questions.length === 0) {
        questions = localClarify(domanda, profilo, lang);
      }

      questions = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i + 1}`),
        label: String(q.label || q?.text || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));

      return res.status(200).json({ questions });
    }

    /* === BRANCH: GENERAZIONE RISPOSTA === */
    const sys1 = systemPrompt({ stile, lang, profile: profilo });
    const user = buildUserContent({
      domanda,
      periodo,
      profilo,
      clarifications,
      lang,
      stile,
    });
    const sys2 = responseStyleInstruction(lang, stile);

    const reminders = isEn(lang)
      ? `Reminders:
- Vary your opening line from a rotating mental list (hooks provided above).
- If TIMEFRAME is PAST, write it as if it truly happened (counterfactual vignette).
- If TIMEFRAME is FUTURE, write a near-future slice as if the user chooses now.
- Do not repeat the same person/place/object motif in every answer.
- Keep it compact; vivid images; no filler.`
      : `Promemoria:
- Varia l’incipit attingendo a una lista mentale di ganci.
- Se il PERIODO è PASSATO, scrivi come se fosse successo (vignetta controfattuale).
- Se il PERIODO è FUTURO, scrivi uno scorcio di prossimo futuro come se scegliesse ora.
- Non ripetere ogni volta gli stessi motivi (persona/luogo/oggetto).
- Compatto, immagini vivide, niente riempitivi.`;

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      { role: "system", content: reminders },
      { role: "system", content: sys2 },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.95 : 0.75;

    // STREAM: text/event-stream
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const streamResp = await client.chat.completions.create({
        model: MODEL_TEXT,
        messages,
        temperature,
        max_tokens: 700,
        stream: true,
      });

      for await (const chunk of streamResp) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // NON-stream
    const completion = await client.chat.completions.create({
      model: MODEL_TEXT,
      messages,
      temperature,
      max_tokens: 700,
    });
    const text = completion.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res
      .status(500)
      .json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
