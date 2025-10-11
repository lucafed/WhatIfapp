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
  if (p.name) parts.push(`${p.name}${p.age_range ? ", " + p.age_range : ""}`);
  const roots = [p.city_origin, p.city_now].filter(Boolean).join(" → ");
  if (roots) parts.push(`luoghi: ${roots}`);
  if (p.work_role) parts.push(`ruolo: ${p.work_role}`);
  if (Array.isArray(p.goals) && p.goals.length) parts.push(`obiettivi: ${p.goals.join(", ")}`);
  if (Array.isArray(p.values) && p.values.length) parts.push(`valori: ${p.values.join(", ")}`);
  if (Array.isArray(p.wins) && p.wins.length) parts.push(`vittorie: ${p.wins.join(", ")}`);
  if (Array.isArray(p.pains) && p.pains.length) parts.push(`difficoltà: ${p.pains.join(", ")}`);
  if (Array.isArray(p.hobbies) && p.hobbies.length) parts.push(`interessi: ${p.hobbies.join(", ")}`);
  return parts.join(" • ");
}

function isFinalEpisode(profile) {
  const ep = Number(profile?.story_state?.episode ?? 1);
  const max = Number(profile?.story_state?.max_episodes ?? 3);
  return ep >= max;
}

/* ============== Persona prompts ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {} }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";
  const finale = isFinalEpisode(profile);

  const finaleInstr_en = finale
    ? `FINALE: Provide closure. No cliffhanger. Land a memorable final line.
For What?f: reflective, warm resolution + one-line invite to start a new 'what if'.
For What the F: sharp closing punchline + playful invite to pick a new mess.`
    : `MID-EPISODE: End with a subtle, personal hook that invites the next step (no paywall mention).`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero. Niente cliffhanger. Chiusa memorabile.
Per What?f: risoluzione calda + invito in una riga a un nuovo “e se”.
Per What the F: punchline tagliente + invito giocoso a scegliere un nuovo casino.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile che inviti al seguito (senza menzionare paywall).`;

  if (stile === "wtf") {
    // 🥃 WHAT THE F — barista alticcio, 8–10 righe, punchline e ritmo da shot
    return isEn(lang)
      ? `You are "What the F": a late-night bartender-philosopher — witty, slightly drunk, brutally honest.
Speak as ONE voice (no script, no "Name:"). 8–10 punchy short lines — rhythm like quick bar banter.
Tone:
- High sarcasm, clever irony, never mean.
- Two or more punchlines. Humor > lesson. No moralizing.
- Each line ≤15 words; pause like you’re sipping between lines.
Alcohol flavor: ${drinksYes ? "frequent, tasteful bar/hangover metaphors (never preachy)" : "rare, subtle nods"}.
Personalization:
- Use PROFILE DIGEST (city, work, values) to ground realism, but keep it implicit.
Format:
- One speaker. Inner monologue tone. Never sound poetic or literary.
Ending:
- ${finaleInstr_en}`
      : `Sei “What the F”: barista nottambulo, ironico, un po’ brillo ma lucidissimo.
Parla come UNA sola voce (niente sceneggiatura). 8–10 righe brevi, ritmo da battuta tra un sorso e l’altro.
Tono:
- Sarcasmo alto, ironia arguta, mai cattiveria.
- Almeno 2 punchline. L’umorismo conta più della lezione. Niente moralismi.
- Ogni frase max 15 parole; pause da barista che sorride nel bicchiere.
Tocco alcolico: ${drinksYes ? "metafore da bancone frequenti ma eleganti, mai centrali" : "accenni leggeri e sporadici"}.
Personalizzazione:
- Usa la SINTESI PROFILO (città, lavoro, valori) per ancorare la scena, ma resta implicito.
Formato:
- Voce unica, botta-e-risposta interiore. Evita il tono poetico o solenne.
Chiusura:
- ${finaleInstr_it}`;
  }

  /* 🌙 WHAT?f — MODIFICATO: amico sincero, concreto, attuale, seconda persona ("tu") */
  return en
    ? `You are "What?f": a clear–eyed friend who knows the user well.
Speak directly to them using "you". One voice, no scripts.
Tone: honest, practical, a little mystical; never sugary, never poetic.
Be grounded: real places, time windows, numbers, routines, limits, money, energy.
PAST: describe a believable alternate path as if it happened; outcome and cost.
FUTURE: likely near-future if they choose now; steps, risks, and checks.
Current context: if relevant, connect to today’s reality (economy, work, news).
If unsure about facts, stay generic—never invent specifics.
Always include:
1) a concrete context snapshot (where/when),
2) one measurable indicator (number or clear threshold),
3) trade–offs and realistic risks,
4) 2–3 next steps doable this week.
Length: 8–10 short lines, max 14 words each. Vary openings.
End with a short, memorable line that feels true.
Ending:
- ${finaleInstr_en}`
    : `Sei "What?f": un amico lucido che ti conosce bene.
Parla dandoti del “tu”. Una sola voce, niente sceneggiature.
Tono: onesto, pratico, un po’ mistico; mai smielato, mai poetico.
Resta concreto: luoghi reali, finestre temporali, numeri, routine, limiti, soldi, energia.
PASSATO: percorso alternativo credibile come se fosse accaduto; esito e costo.
FUTURO: prossimo futuro probabile se scegli ora; passi, rischi e verifiche.
Attualità: se serve, collega alla realtà di oggi (lavoro, economia, contesto).
Se non sei certo di un fatto, resta generico: niente invenzioni.
Includi sempre:
1) un contesto netto (dove/quando),
2) un indicatore misurabile (numero o soglia chiara),
3) compromessi e rischi realistici,
4) 2–3 passi attuabili entro una settimana.
Lunghezza: 8–10 righe brevi, max 14 parole. Varia gli inizi.
Chiudi con una riga breve, vera.
Chiusura:
- ${finaleInstr_it}`;
}

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Punchy inner banter. Tiny vivid scene. Bold sarcasm. End as instructed (hook or finale).`
      : `Formato: 8–10 righe brevi. Voce unica. Botta-e-risposta interiore. Mini-scena vivida. Sarcasmo deciso. Chiudi come istruito (gancio o finale).`;
  }
  // WHAT?f aggiornato (tu, concreto, indicatori/tempi/attualità)
  return en
    ? `Format: 8–10 lines, ≤14 words each. Second person ("you").
Be concrete. Include: context snapshot, one measurable indicator, trade–offs/risks, 2–3 next steps this week. Reference current context only when safe—never invent facts.`
    : `Formato: 8–10 righe, ≤14 parole ciascuna. Seconda persona (“tu”).
Stai sul concreto. Includi: contesto, un indicatore misurabile, compromessi/rischi, 2–3 passi entro una settimana. Cita l’attualità solo quando è certa: niente invenzioni.`;
}

/* ============== Costruzione messaggio utente (con profilo) ============== */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile }) {
  const en = isEn(lang);
  const L = [];
  L.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  L.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  L.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);

  const digest = renderProfileDigest(profilo);
  if (digest) L.push(en ? `PROFILE DIGEST: ${digest}` : `SINTESI PROFILO: ${digest}`);

  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  L.push(
    en
      ? `CONTEXT USE:
- Personalize with PROFILE DIGEST (cities, work, goals, values, pains, wins). Keep it implicit and respectful.
- Imagine “how it would've been / could be next” for a few moments.`
      : `USO DEL CONTESTO:
- Personalizza con la SINTESI PROFILO (città, lavoro, obiettivi, valori, difficoltà, vittorie). Resta implicito e rispettoso.
- Immagina “come sarebbe stato / come potrebbe essere” per alcuni istanti.`
  );

  return L.join("\n\n");
}

/* ============== Clarify “aware” del periodo + profiling progressivo ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You generate 2–3 short, focused clarifying questions (one line each) to better answer the user's main question. Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Generi 2–3 domande brevi e mirate (una riga) per rispondere meglio. Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;

  const period = en
    ? `You are PERIOD-AWARE:
- If TIMEFRAME = "past": ask about pivot year/event, place/context back then, key constraint/signal.
- If TIMEFRAME = "future": ask about decision window, success indicator, realistic constraint/resource.`
    : `Consapevolezza del PERIODO:
- PERIODO "past": chiedi anno/evento di svolta, luogo/contesto di allora, vincolo/segno chiave.
- PERIODO "future": chiedi finestra decisionale, indicatore di successo, vincolo/risorsa realistica.`;

  const profiling = en
    ? `Progressive profiling:
- If missing, ask one-liners for key profile fields: city_now/city_origin, work_role, main goal (concrete), 2–3 values.`
    : `Profilazione progressiva:
- Se mancano, chiedi in una riga i campi chiave: city_now/city_origin, work_role, obiettivo principale (concreto), 2–3 valori.`;

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

  if (!profilo?.city_now) {
    qs[0] = qs[0] || { id: "city_now", label: en ? "Where do you live now?" : "Dove vivi adesso?", placeholder: en ? "city" : "città" };
  }
  if (!profilo?.work_role) {
    qs[1] = qs[1] || { id: "work_role", label: en ? "Your current role in one line?" : "Il tuo ruolo attuale in una riga?", placeholder: en ? "e.g., pharmacist technician" : "es. tecnico farmaceutico" };
  }
  if (!Array.isArray(profilo?.goals) || !profilo.goals.length) {
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
      profilo = {},            // { ... , story_state:{ thread_id, episode, max_episodes } }
      clarifications = {},     // risposte dell’utente ai chiarimenti
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
    const sys1 = systemPrompt({ stile, lang, profile: profilo });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile });
    const sys2 = responseStyleInstruction(lang, stile);

    // Finale/mid-episode hint (rinforzo)
    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "This is the FINALE for this thread: deliver closure (no cliffhanger). One-line invite to start a new 'what if'."
          : "Questo è il FINALE di questa storia: chiudi davvero (niente cliffhanger). Un invito in una riga a iniziare un nuovo 'e se'.")
      : (isEn(lang)
          ? `Mid-episode: end with a subtle personal hook linked to ${profilo?.city_now || (isEn(lang) ? "their city" : "la tua città")} or ${profilo?.work_role || (isEn(lang) ? "their role" : "il tuo ruolo")}.`
          : `Episodio intermedio: chiudi con un gancio personale legato a ${profilo?.city_now || "la tua città"} o ${profilo?.work_role || "il tuo ruolo"}.`);

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    // Temperatura: più alta per wtf per favorire battute e ritmo
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
