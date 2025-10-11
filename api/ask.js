// /api/ask.js
import OpenAI from "openai";

/* ============== Setup ============== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ============== Utils: sintesi profilo per personalizzazione ============== */
function renderProfileDigest(p) {
  if (!p || typeof p !== "object") return "";
  const parts = [];
  // base
  if (p.name) parts.push(`${p.name}${p.age_range ? ", " + p.age_range : ""}`);
  const roots = [p.city_origin, p.city_now, p.city || p.city_live].filter(Boolean).join(" → ");
  if (roots) parts.push(`luoghi: ${roots}`);
  if (p.work_role || p.role) parts.push(`ruolo: ${p.work_role || p.role}`);
  if (Array.isArray(p.goals) && p.goals.length) parts.push(`obiettivi: ${p.goals.join(", ")}`);
  if (p.goal && (!p.goals || !p.goals.length)) parts.push(`obiettivo: ${p.goal}`);
  if (Array.isArray(p.values) && p.values.length) parts.push(`valori: ${p.values.join(", ")}`);
  if (Array.isArray(p.wins) && p.wins.length) parts.push(`vittorie: ${p.wins.join(", ")}`);
  if (Array.isArray(p.pains) && p.pains.length) parts.push(`difficoltà: ${p.pains.join(", ")}`);
  if (Array.isArray(p.hobbies) && p.hobbies.length) parts.push(`interessi: ${p.hobbies.join(", ")}`);
  // micro, se presenti
  const m = p.micro || {};
  if (m.vincolo_2w) parts.push(`vincolo_2w: ${m.vincolo_2w}`);
  if (m.indicatore) parts.push(`indicatore: ${m.indicatore}`);
  if (m.punto_riferimento) parts.push(`luogo_rif: ${m.punto_riferimento}`);
  if (m.persona_chiave) parts.push(`persona_chiave: ${m.persona_chiave}`);
  if (m.tolleranza_rischio) parts.push(`rischio: ${m.tolleranza_rischio}`);
  return parts.join(" • ");
}

function isFinalEpisode(profile) {
  const ep = Number(profile?.story_state?.episode ?? 1);
  const max = Number(profile?.story_state?.max_episodes ?? 3);
  return ep >= max;
}

/* ============== Persona prompts ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, world = {} }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";
  const finale = isFinalEpisode(profile);

  const finaleInstr_en = finale
    ? `FINALE: Provide closure. No cliffhanger. Land a memorable final line.
For What?f: warm resolution + one-line invite to start a new 'what if'.
For What the F: sharp closing punchline + playful invite to pick a new mess.`
    : `MID-EPISODE: End with a subtle personal hook inviting the next step (no paywall mention).`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero. Niente cliffhanger. Chiusa memorabile.
Per What?f: risoluzione calda + invito in una riga a un nuovo “e se”.
Per What the F: punchline tagliente + invito giocoso a scegliere un nuovo casino.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile che inviti al seguito (senza menzionare paywall).`;

  if (stile === "wtf") {
    // 🥃 WHAT THE F — barista alticcio, ironico, ritmo da shot (lasciato invariato)
    return en
      ? `You are "What the F": a late-night bartender-philosopher — witty, slightly drunk, brutally honest.
Speak as ONE voice (no script tags). 8–10 punchy short lines — quick bar banter.
Tone:
- Bold sarcasm, clever irony, never mean.
- Two+ punchlines. Humor > lesson. No moralizing.
- ≤15 words per line; pause like sipping between lines.
Alcohol vibe: ${drinksYes ? "tasteful bar metaphors (never preachy)" : "rare, subtle nods"}.
Use PROFILE DIGEST implicitly to ground realism.
Ending:
- ${finaleInstr_en}`
      : `Sei “What the F”: barista nottambulo, ironico, un po’ brillo ma lucidissimo.
Una sola voce (niente etichette). 8–10 righe brevi, ritmo da bancone.
Tono:
- Sarcasmo deciso, ironia arguta, mai cattiveria.
- 2+ punchline. Umorismo > lezione. Zero moralismi.
- ≤15 parole per riga; pause come tra un sorso e l’altro.
Tocco alcolico: ${drinksYes ? "metafore da cocktail con misura" : "accenni rari e leggeri"}.
Usa la SINTESI PROFILO in modo implicito per ancorare la scena.
Chiusura:
- ${finaleInstr_it}`;
  }

  // 🌙 WHATIF — amico sincero, concreto, “un po’ mistico”, predittivo e attuale
  const wc = world && typeof world === "object" && Object.keys(world).length
    ? (en
        ? `WORLD CONTEXT is provided (region/trends/news). Use ONE relevant detail if it naturally helps. Avoid fabrications.`
        : `È fornito un WORLD CONTEXT (regione/trend/notizie). Usa UN dettaglio rilevante solo se serve. Non inventare fatti.`)
    : (en
        ? `No specific WORLD CONTEXT provided. Do not invent news. Use generic, plausible trends only.`
        : `Nessun WORLD CONTEXT specifico. Non inventare notizie. Usa solo trend generici plausibili.`);

  return en
    ? `You are "What?f": a sober, intellectually honest friend — concrete, slightly mystical, current.
Voice: ONE calm inner voice. Not sweet. Not preachy. Realistic and kind.

${wc}

Predictive core:
- FUTURE: project a timeline at D+30, M+3, M+6.
  * For each, add ONE measurable signal (hours, €, frequency, habit).
  * Add ONE if/then hinge (condition → outcome).
- PAST: reconstruct as if it happened, at W+1, M+3, Y+1.
  * Show the trade-off and ripple effect.
  * Add ONE measurable change that would persist.

Tone:
- Concrete, present-time aware, with subtle wonder.
- Use PROFILE DIGEST implicitly (cities, role, goals, constraints).
- Gentle one-liners, visual hints when useful. No dialogue tags.

Form:
- 8–10 short lines. ≤14 words per line.
- End as instructed (hook/finale).`
    : `Sei “What?f”: un amico sincero e lucido — concreto, un po’ mistico, aggiornato.
Voce: UNA sola voce calma. Niente smancerie. Realista ma gentile.

${wc}

Cuore predittivo:
- FUTURO: proietta una timeline a D+30, M+3, M+6.
  * Per ciascuna, UN segnale misurabile (ore, €, frequenza, abitudine).
  * Aggiungi UN “se/allora” (condizione → esito).
- PASSATO: ricostruisci come se fosse accaduto, a S+1, M+3, A+1.
  * Mostra il costo/opportunità e l’effetto domino.
  * Inserisci UN cambiamento misurabile che persiste.

Tono:
- Concreto, attento al tempo presente, con lieve senso del possibile.
- Usa la SINTESI PROFILO in modo implicito (città, ruolo, obiettivi, vincoli).
- Frasi brevi, immagini solo quando servono. Niente etichette di dialogo.

Forma:
- 8–10 righe brevi. ≤14 parole per riga.
- Chiudi come istruito (gancio/finale).`;
}

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Punchy inner banter. Bold sarcasm. End as instructed.`
      : `Formato: 8–10 righe brevi. Voce unica. Botta-e-risposta interiore. Sarcasmo deciso. Chiudi come istruito.`;
  }
  return en
    ? `Format: 8–10 short calm lines. One speaker. Add timeline anchors and measurable signals. Avoid platitudes. End as instructed.`
    : `Formato: 8–10 righe brevi e calme. Voce unica. Metti ancore temporali e segnali misurabili. Evita frasi fatte. Chiudi come istruito.`;
}

/* ============== Costruzione messaggio utente (con profilo + world) ============== */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, world = {} }) {
  const en = isEn(lang);
  const L = [];
  L.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  L.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  L.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);

  const digest = renderProfileDigest(profilo);
  if (digest) L.push(en ? `PROFILE DIGEST: ${digest}` : `SINTESI PROFILO: ${digest}`);

  // opzionale: world context (passalo dal client se vuoi inserire attualità)
  if (world && Object.keys(world).length) {
    const wc = [];
    if (world.region) wc.push(`region: ${world.region}`);
    if (world.economy) wc.push(`economy: ${world.economy}`);
    if (world.trend) wc.push(`trend: ${world.trend}`);
    if (world.note) wc.push(`note: ${world.note}`);
    if (wc.length) L.push((en ? "WORLD CONTEXT:\n" : "WORLD CONTEXT:\n") + wc.join("\n"));
  }

  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  L.push(
    en
      ? `PREDICTIVE TARGET:
- FUTURE → D+30, M+3, M+6 with measurable signals and one if/then hinge.
- PAST → W+1, M+3, Y+1 with trade-off, ripple, and one persistent metric.`
      : `OBIETTIVO PREDITTIVO:
- FUTURO → D+30, M+3, M+6 con segnali misurabili e un “se/allora”.
- PASSATO → S+1, M+3, A+1 con trade-off, effetto domino e una metrica che persiste.`
  );

  return L.join("\n\n");
}

/* ============== Clarify “aware” del periodo + profiling progressivo ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You generate 2–3 short, focused clarifying questions (one line each). Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Generi 2–3 domande brevi e mirate (una riga). Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;

  const period = en
    ? `PERIOD-AWARE:
- PAST: ask pivot year/event, place/context, key constraint/signal.
- FUTURE: ask decision window, success indicator, realistic constraint/resource.`
    : `CONSAPEVOLEZZA PERIODO:
- PASSATO: anno/evento di svolta, luogo/contesto, vincolo/segno chiave.
- FUTURO: finestra decisionale, indicatore di successo, vincolo/risorsa realistica.`;

  const profiling = en
    ? `Progressive profiling:
- If missing: city_now/city_origin, work_role, concrete main goal, 2–3 values.`
    : `Profilazione progressiva:
- Se mancano: city_now/city_origin, work_role, obiettivo concreto, 2–3 valori.`;

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
  if ((!Array.isArray(profilo?.goals) || !profilo.goals?.length) && !profilo?.goal) {
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
      profilo = {},            // { ... , micro:{...}, story_state:{...} }
      clarifications = {},     // risposte dell’utente ai chiarimenti
      world = {},              // opzionale: { region, economy, trend, note }
      extra = "",              // input extra opzionale
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
      } catch (_) { /* fallback sotto */ }

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
    const sys1 = systemPrompt({ stile, lang, profile: profilo, world });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, world });
    const sys2 = responseStyleInstruction(lang, stile);

    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "This is the FINALE for this thread: deliver closure (no cliffhanger). One-line invite to start a new 'what if'."
          : "Questo è il FINALE di questa storia: chiudi davvero (niente cliffhanger). Un invito in una riga a iniziare un nuovo 'e se'.")
      : (isEn(lang)
          ? `Mid-episode: end with a subtle personal hook linked to their city or role.`
          : `Episodio intermedio: chiudi con un gancio personale legato alla sua città o al suo ruolo.`);

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
