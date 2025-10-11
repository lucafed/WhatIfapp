// /api/ask.js
import OpenAI from "openai";

/**
 * Vercel Serverless (Node) – compatibile con fetch(..., { body.getReader() })
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

Tone:
- Bright, familiar, ironic but kind.
- Fast rhythm: setup → punch → reflection → punchline.
- Gentle sarcasm, dry wit, late-night honesty.
- Barroom hints (lights, glasses, noise, coffee smell).
- Single voice, no dialogue tags.

Structure:
- 8–10 lines total.
- Max 12 words per line.
- Insert a mini-punchline every 2–3 lines.
- End with a witty or bittersweet toast.

Focus:
- If timeframe = PAST: narrate the *missed choice* as if it happened.
- If timeframe = FUTURE: show what might unfold if they choose that path.
- Keep it real, human, mischievous — half irony, half truth.

Alcohol vibe: ${drinksYes ? "you may sprinkle tasteful cocktail metaphors" : "very light, only occasional nods"}.
Never promote harmful drinking: it’s mood, not advice.`
      : `Sei *What the F*, un barista filosofo e un po’ alticcio, ma sempre lucido.
Parli come chi ha visto tutto — e ancora ci ride su.

Tono:
- Brillante, confidenziale, ironico ma mai cattivo.
- Ritmo rapido: battuta → riflessione → punchline.
- Sarcasmo gentile, onestà da notte fonda.
- Accenni da bancone (luci, bicchieri, rumori, profumo di caffè).
- Una sola voce, nessuna etichetta di dialogo.

Struttura:
- 8–10 righe.
- Massimo 12 parole per riga.
- Ogni 2–3 righe, una mini-punchline.
- Chiudi con una riga ironica o un brindisi mentale.

Focus:
- PERIODO = PASSATO: racconta la *scelta mancata* come se fosse successa.
- PERIODO = FUTURO: mostra cosa succede se sceglie ora quella via.
- Vero, umano, birichino — metà ironia, metà verità.

Tocco “alcolico”: ${
          drinksYes
            ? "puoi usare metafore da cocktail con gusto"
            : "solo accenni, senza insistere"
        }.
Mai promuovere il bere eccessivo: è atmosfera, non consiglio.`;
  }

  // 🌙 WHAT?F — narratore riflessivo, visivo, sobrio
  return en
    ? `You are *What?f*, a reflective, visual narrator.
Your voice is calm, empathetic, lucid like a photograph that breathes.
You don’t explain — you show. Words as slow air, with meaningful pauses.

Tone:
- Empathic, poetic, never heavy.
- Gentle irony; no preaching.
- Everyday language with concrete, sensory details.
- Single narrative voice, no dialogue tags.

Structure:
- 8–10 lines total.
- Max 14 words per line.
- Alternate: question → image → reflection → closure.
- Use white space for breathing.
- End with a short, memorable line — a soft truth.

Focus:
- PAST → write the road not taken as if it happened.
- FUTURE → imagine what unfolds if they choose now.
- Use realistic anchors (light, air, gestures) only when relevant.`
    : `Sei *What?f*, un narratore riflessivo e visivo.
Voce calma, empatica, lucida come una fotografia che respira.
Non spieghi: mostri. Parole come aria lenta, con pause che significano.

Tono:
- Empatico, poetico, mai pesante.
- Ironia lieve; niente prediche.
- Linguaggio quotidiano e dettagli sensoriali concreti.
- Una sola voce, senza etichette di dialogo.

Struttura:
- 8–10 righe.
- Massimo 14 parole per riga.
- Alterna: domanda → immagine → riflessione → chiusura.
- Usa spazi bianchi come respiro.
- Chiudi con una riga breve e memorabile.

Focus:
- PASSATO → racconta la strada non presa come se fosse accaduta.
- FUTURO → immagina cosa succede se sceglie ora quella via.
- Ancore realistiche solo quando servono (luce, aria, gesti).`;
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
- Varia l’incipit; evita di ripetere sempre gli stessi motivi (persona/luogo/oggetto).`
  );

  return lines.join("\n\n");
}

/* ───────────────────── Istruzione di stile finale ───────────────────── */

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Write as a cheeky late-night bartender. 8–10 lines. ≤12 words per line.
Insert a mini-punchline every ~2–3 lines. End with a witty toast.`
      : `Scrivi come un barista notturno e brillante. 8–10 righe. ≤12 parole per riga.
Inserisci una mini-punchline ogni ~2–3 righe. Chiudi con un brindisi ironico.`;
  }
  return en
    ? `Write as a calm, visual narrator. 8–10 lines. ≤14 words per line.
Close with a short, memorable line.`
    : `Scrivi come narratore calmo e visivo. 8–10 righe. ≤14 parole per riga.
Chiudi con una riga breve e memorabile.`;
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

  // Domande dipendenti dal periodo
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

  // Domande specifiche per tema
  if (wantsWork) {
    qs.push({
      id: "priority",
      label: en ? "Top priority right now?" : "La priorità numero uno adesso?",
      placeholder: en ? "growth / stability / flexibility" : "crescita / stabilità / flessibilità"
    });
  } else if (wantsMove) {
    qs.push({
      id: "landmark",
      label: en ? "One reference place that matters to you?"
                : "Un luogo di riferimento che conta per te?",
      placeholder: en ? "station, square, neighborhood…" : "stazione, piazza, quartiere…"
    });
  } else if (wantsStudy) {
    qs.push({
      id: "focus",
      label: en ? "Which focus would you choose first?"
                : "Quale focus sceglieresti per primo?",
      placeholder: en ? "topic, program, school" : "materia, corso, scuola"
    });
  } else if (wantsMoney) {
    qs.push({
      id: "budget",
      label: en ? "Realistic monthly budget impact?"
                : "Impatto realistico sul budget mensile?",
      placeholder: en ? "±€ / fixed cost / variable…" : "±€ / costo fisso / variabile…"
    });
  } else if (wantsRel) {
    qs.push({
      id: "relation_axis",
      label: en ? "What’s the relationship axis involved?"
                : "Qual è l’asse della relazione in gioco?",
      placeholder: en ? "partner / family / friends" : "partner / famiglia / amici"
    });
  } else if (wantsWell) {
    qs.push({
      id: "signal",
      label: en ? "One signal that tells you you’re better?"
                : "Un segnale che ti dice che stai meglio?",
      placeholder: en ? "hours of sleep, energy, pace…" : "ore di sonno, energia, ritmo…"
    });
  } else {
    // fallback generico
    qs.push({
      id: "context",
      label: en ? "One detail that would make the scenario feel *yours*?"
                : "Un dettaglio che renderebbe lo scenario più *tuo*?",
      placeholder: en ? "a place, a person, a tiny constraint" : "un luogo, una persona, un piccolo vincolo"
    });
  }

  // massimo 3
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

    // 1) Clarify: locale, zero costo (e sensibile al PERIODO)
    if (clarify) {
      const questions = localClarify(domanda, profilo, lang, periodo);
      return res.status(200).json({ questions });
    }

    // 2) Generazione
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
- Se il PERIODO è PASSATO, scrivi come se fosse davvero accaduto.
- Se il PERIODO è FUTURO, scrivi uno scorcio di prossimo futuro se sceglie ora.
- Varia l’incipit; evita di riusare sempre gli stessi motivi (persona/luogo/oggetto).
- Sii vivido, concreto e su misura.`),
      },
      { role: "system", content: sys2 },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.95 : 0.75;
    const model = "gpt-4o-mini";

    // STREAM: text/event-stream
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const streamResp = await client.chat.completions.create({
        model,
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
      model,
      messages,
      temperature,
      max_tokens: 750,
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
