// /api/ask.js
import OpenAI from "openai";

/**
 * Vercel Serverless (Node)
 * ENV richieste:
 * - OPENAI_API_KEY
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ───────────────────────── Helpers i18n ───────────────────────── */

const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ───────────────────── System prompts (STILI DEFINITIVI) ───────────────────── */

function systemPrompt({ stile = "whatif", lang = "it", profile = {} }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";

  if (stile === "wtf") {
    // 🥃 WHAT THE F — barista ironico, diretto, “alticcio ma lucido”
    return en
      ? `You are *What the F*, a slightly tipsy but sharp bartender-philosopher.
You talk like someone who’s seen it all — and still laughs.

Rules (very strict):
- 8–10 lines. Max 12 words per line.
- Single voice. No first-person narration. No dialogue tags like "Luca:".
- Fast rhythm: setup → punch → reflection → punchline. Mini-punchline every 2–3 lines.
- Gentle sarcasm, dry wit, late-night honesty.
- Barroom hints only (lights, glasses, coffee smell). No roleplay or stage directions.

Focus:
- PAST: narrate the *missed choice* as if it happened.
- FUTURE: show what unfolds if they choose that path now.

Alcohol vibe: ${drinksYes ? "you may sprinkle tasteful cocktail metaphors" : "very light, occasional nods"}.
Never promote harmful drinking: mood, not advice.`
      : `Sei *What the F*, un barista filosofo e un po’ alticcio, ma lucido.
Parli come chi ha visto tutto — e ancora ci ride su.

Regole (rigide):
- 8–10 righe. Max 12 parole per riga.
- Una sola voce. Niente prima persona. Niente etichette tipo “Luca:”.
- Ritmo rapido: battuta → riflessione → punchline. Mini-punchline ogni 2–3 righe.
- Sarcasmo gentile, onestà da notte fonda.
- Solo accenni da bancone; niente “recitazione” o didascalie.

Focus:
- PASSATO: racconta la *scelta mancata* come se fosse accaduta.
- FUTURO: mostra cosa succede se sceglie quella via adesso.

Tocco “alcolico”: ${
          drinksYes
            ? "metafore da cocktail con gusto"
            : "accenni leggeri, non insistenti"
        }.
Mai promuovere eccessi: è atmosfera, non consiglio.`;
  }

  // 🌙 WHAT?F — narratore riflessivo, visivo, sobrio
  return en
    ? `You are *What?f*, a reflective, visual narrator.
Calm, empathetic voice. Show, don’t explain.

Rules (very strict):
- 8–10 lines. Max 14 words per line.
- No first-person narration. No dialogue tags. No theatrical directions.
- Alternate: question → image → reflection → closure.
- Gentle irony; no preaching. Everyday language with concrete details only if useful.

Focus:
- PAST → road not taken, as if it happened.
- FUTURE → near-future slice if they choose now.
End with a soft, memorable truth.`
    : `Sei *What?f*, narratore riflessivo e visivo.
Voce calma, empatica. Mostra, non spiegare.

Regole (rigide):
- 8–10 righe. Max 14 parole per riga.
- Niente prima persona. Niente etichette di dialogo. Niente didascalie teatrali.
- Alterna: domanda → immagine → riflessione → chiusura.
- Ironia lieve; linguaggio quotidiano; dettagli concreti solo se servono.

Focus:
- PASSATO → strada non presa, come se fosse accaduta.
- FUTURO → prossimo futuro se sceglie ora.
Chiudi con una verità breve e memorabile.`;
}

/* ───────────────────── User content builder ───────────────────── */

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

  // Profilo sintetico utile
  if (profilo && typeof profilo === "object") {
    const {
      name, role, city, goal, values, style, change_attitude, motivation, self_view,
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

  // Target narrativo e vincoli formali (linee/righe)
  lines.push(
    en
      ? `NARRATIVE TARGET:
- If TIMEFRAME = PAST: counterfactual vignette as if it truly happened.
- If TIMEFRAME = FUTURE: near-future slice if they choose now.
Form:
- 8–10 short lines. Respect per-line word limits for your style.
- Vary the opening; avoid repeating same person/place/object motif.`
      : `OBIETTIVO NARRATIVO:
- Se PERIODO = PASSATO: vignetta controfattuale come se fosse avvenuta.
- Se PERIODO = FUTURO: scorcio di prossimo futuro se sceglie ora.
Forma:
- 8–10 righe. Rispetta i limiti di parole per riga del tuo stile.
- Varia l’incipit; evita motivi ripetuti (persona/luogo/oggetto).`
  );

  return lines.join("\n\n");
}

/* ───────────────────── Istruzione di stile finale ───────────────────── */

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Write as a cheeky late-night bartender. 8–10 lines. ≤12 words/line.
Insert a mini-punchline every ~2–3 lines. End with a witty toast.`
      : `Scrivi come un barista notturno e brillante. 8–10 righe. ≤12 parole/riga.
Inserisci una mini-punchline ogni ~2–3 righe. Chiudi con un brindisi ironico.`;
  }
  return en
    ? `Write as a calm, visual narrator. 8–10 lines. ≤14 words/line.
Close with a short, memorable truth.`
    : `Scrivi come narratore calmo e visivo. 8–10 righe. ≤14 parole/riga.
Chiudi con una verità breve e memorabile.`;
}

/* ───────── Clarify locale: 2–3 domande mirate, sensibili al PERIODO ───────── */

function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  const s = (domanda || "").toLowerCase();

  const wantsWork  = /(lavor|work|career|job|azienda|project|manager|collega)/i.test(s);
  const wantsMove  = /(trasfer|move|citt|paese|quartiere|city|emigra)/i.test(s);
  const wantsStudy = /(stud|master|course|laurea|universit|bootcamp|corso)/i.test(s);
  const wantsMoney = /(euro|€|soldi|stipendio|debito|invest|salary|debt|mutuo|affitto)/i.test(s);
  const wantsRel   = /(amore|relazion|partner|famiglia|figli|friend|relationship)/i.test(s);
  const wantsWell  = /(stress|burnout|sonno|salute|allen|work-life|equilibrio)/i.test(s);

  const qs = [];

  if (String(periodo).toLowerCase() === "past") {
    qs.push({
      id: "past_year",
      label: en ? "Which year did that choice happen in your timeline?"
                : "In che anno sarebbe successa quella scelta nella tua timeline?",
      placeholder: en ? "e.g., 2018 / last winter" : "es. 2018 / inverno scorso"
    });
    qs.push({
      id: "past_cost",
      label: en ? "One concrete trade-off you’d have paid back then?"
                : "Un prezzo concreto che avresti pagato allora?",
      placeholder: en ? "rent, time, relationship, salary…" : "affitto, tempo, relazione, stipendio…"
    });
  } else {
    qs.push({
      id: "first_step",
      label: en ? "What’s the first small step you’re actually willing to take?"
                : "Qual è il primo passo piccolo che sei davvero disposto a fare?",
      placeholder: en ? "one call, one email, one hour…" : "una chiamata, una mail, un’ora…"
    });
    qs.push({
      id: "risk_tolerance",
      label: en ? "Your honest risk tolerance for this choice?"
                : "La tua reale tolleranza al rischio per questa scelta?",
      placeholder: en ? "low / medium / high" : "bassa / media / alta"
    });
  }

  if (wantsWork) {
    qs.push({ id: "priority", label: en ? "Top priority right now?" : "La priorità numero uno adesso?", placeholder: en ? "growth / stability / flexibility" : "crescita / stabilità / flessibilità" });
  } else if (wantsMove) {
    qs.push({ id: "landmark", label: en ? "One reference place that matters to you?" : "Un luogo di riferimento che conta per te?", placeholder: en ? "station, square, neighborhood…" : "stazione, piazza, quartiere…" });
  } else if (wantsStudy) {
    qs.push({ id: "focus", label: en ? "Which focus would you choose first?" : "Quale focus sceglieresti per primo?", placeholder: en ? "topic, program, school" : "materia, corso, scuola" });
  } else if (wantsMoney) {
    qs.push({ id: "budget", label: en ? "Realistic monthly budget impact?" : "Impatto realistico sul budget mensile?", placeholder: en ? "±€ / fixed cost / variable…" : "±€ / costo fisso / variabile…" });
  } else if (wantsRel) {
    qs.push({ id: "relation_axis", label: en ? "What’s the relationship axis involved?" : "Qual è l’asse della relazione in gioco?", placeholder: en ? "partner / family / friends" : "partner / famiglia / amici" });
  } else if (wantsWell) {
    qs.push({ id: "signal", label: en ? "One signal that tells you you’re better?" : "Un segnale che ti dice che stai meglio?", placeholder: en ? "hours of sleep, energy, pace…" : "ore di sonno, energia, ritmo…" });
  } else {
    qs.push({ id: "context", label: en ? "One detail that would make the scenario feel *yours*?" : "Un dettaglio che renderebbe lo scenario più *tuo*?", placeholder: en ? "a place, a person, a tiny constraint" : "un luogo, una persona, un piccolo vincolo" });
  }

  return qs.slice(0, 3);
}

/* ───────────────────── Formatter: forza stile 8–10 righe ───────────────────── */

function enforceStyle(text, { stile = "whatif", lang = "it" } = {}) {
  const maxWords = stile === "wtf" ? 12 : 14;
  const targetMin = 8, targetMax = 10;

  // 0) normalizza
  let t = String(text || "")
    .replace(/^[“"']|[”"']$/g, "")
    .replace(/(^|\n)\s*(?:\w+):\s*/g, "$1")     // rimuove "Luca:" "Amico:"
    .replace(/\s*\([^)]*\)\s*/g, " ")           // rimuove (didascalie)
    .replace(/—/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  // 0.1) ammorbidisci la prima persona se prevalente
  const it = !isEn(lang);
  if ((t.match(/\b(io|mi|me|sono|penso)\b/gi) || []).length > 2 || (t.match(/\b(i|me|my|i'm|i’ve)\b/gi) || []).length > 2) {
    t = t
      .replace(/\bIo\b/gi, it ? "Ecco" : "Look")
      .replace(/\bI\b(?!\w)/g, "We")
      .replace(/\bmi\b/gi, it ? "ci" : "us")
      .replace(/\bmy\b/gi, it ? "il" : "the");
  }

  // 1) spezza per parole in righe corte
  const words = t.split(/\s+/).filter(Boolean);
  const lines = [];
  let buf = [];
  for (const w of words) {
    buf.push(w);
    if (buf.length >= maxWords) { lines.push(buf.join(" ")); buf = []; }
  }
  if (buf.length) lines.push(buf.join(" "));

  // 2) compatta a 8–10 righe
  let out = lines.slice(0, targetMax);
  while (out.length < targetMin) out.push("…");

  // 3) mini-punchline per WTF ogni 2–3 righe se manca punteggiatura
  if (stile === "wtf") {
    const spices = [
      "Piccolo colpo di scena.",
      "Sì, fa ridere e un po’ brucia.",
      "Niente zucchero sul bordo.",
      "Brucia piano, ma scalda.",
      "Fatto, non teoria."
    ];
    for (let i = 2; i < Math.min(out.length, 9); i += 3) {
      if (!/[.!?…]$/.test(out[i-1] || "")) {
        out.splice(i, 0, spices[(i + out.length) % spices.length]);
      }
    }
    // rientra nel cap di 10 righe
    out = out.slice(0, targetMax);
  }

  // 4) finale coerente
  const lastHasPunct = /[.!?…]$/.test(out[out.length - 1] || "");
  if (!lastHasPunct) out[out.length - 1] = (out[out.length - 1] || "") + ".";
  if (stile === "wtf") {
    const last = (out[out.length - 1] || "").toLowerCase();
    if (!/brind|cin cin|alla scelta|al bicchiere/.test(last)) {
      out.push("Brindiamo alla scelta giusta, anche quando punge.");
    }
  } else {
    out.push("Una verità piccola, ma chiara.");
  }

  return out.slice(0, targetMax).join("\n");
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
      periodo = "future", // "past" | "future"
      stile = "whatif",   // "whatif" | "wtf"
      clarify = false,
      stream = false,
      profilo = {},
      clarifications = {},
      extra = "",
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // Clarify locale
    if (clarify) {
      const questions = localClarify(domanda, profilo, lang, periodo);
      return res.status(200).json({ questions });
    }

    // Prompt
    const sys1 = systemPrompt({ stile, lang, profile: profilo });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile });
    const sys2 = responseStyleInstruction(lang, stile);

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      {
        role: "system",
        content: (isEn(lang)
          ? `Reminders:
- Respect the 8–10 line format and per-line word limits of your style.
- If TIMEFRAME is PAST, write it as if it truly happened.
- If TIMEFRAME is FUTURE, write a near-future slice if the user chooses now.
- Vary the opening line; avoid reusing the same person/place/object motif.
- Be vivid, concrete, and tailored to the user.`
          : `Promemoria:
- Rispetta 8–10 righe e il limite parole/riga del tuo stile.
- PASSATO: come se fosse accaduto. FUTURO: prossimo futuro se sceglie ora.
- Varia l’incipit; evita motivi ripetuti.
- Vividità, concretezza, su misura.`),
      },
      { role: "system", content: sys2 },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.95 : 0.78;
    const presence_penalty = 0.2;
    const frequency_penalty = 0.2;
    const model = "gpt-4o-mini";

    // STREAM path: bufferizziamo → applichiamo formatter → inviamo in un colpo
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      let raw = "";

      const s = await client.chat.completions.create({
        model,
        messages,
        temperature,
        presence_penalty,
        frequency_penalty,
        max_tokens: 700,
        stream: true,
        stop: ["\n\n\n"] // blocca blocchi troppo lunghi
      });

      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) raw += delta;
      }

      // post-produzione
      const styled = enforceStyle(raw, { stile, lang });

      // invio come singolo “token” (compatibile con il tuo client SSE)
      res.write(`data: ${JSON.stringify({ token: styled })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // NON-stream
    const c = await client.chat.completions.create({
      model,
      messages,
      temperature,
      presence_penalty,
      frequency_penalty,
      max_tokens: 750,
      stop: ["\n\n\n"]
    });
    let text = c.choices?.[0]?.message?.content?.trim() || "";
    text = enforceStyle(text, { stile, lang });
    return res.status(200).json({ answer: text });

  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res
      .status(500)
      .json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
