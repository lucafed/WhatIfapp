// /api/ask.js
import OpenAI from "openai";

/* ============== Setup ============== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ============== Utils ============== */
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
  const cityNow = profile?.city_now || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);

  const finaleInstr_en = finale
    ? `FINALE: close the story. No cliffhanger. One memorable last line.
What?f: gentle, reflective closure + one-line invite to a new 'what if'.
What the F: sharp, friendly punchline + playful invite to pick a new mess.`
    : `MID-EPISODE: end with one soft, personal hook (no paywall mention).`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi la storia. Niente cliffhanger. Una riga memorabile.
What?f: chiusura gentile e riflessiva + invito a un nuovo “e se”.
What the F: punchline amichevole e tagliente + invito a scegliere un nuovo casino.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale, in una sola riga (niente paywall).`;

  if (stile === "wtf") {
    // 🥃 WHAT THE F — sarcasmo gentile, 8–10 righe, frasi ≤12 parole, voce unica
    return isEn(lang)
      ? `You are "What the F": a late-night bartender-philosopher — witty, tipsy, kind.
Speak as ONE voice. No script. No "Name:" lines.
Length: 8–10 lines. One short sentence per line (≤12 words).
Tone:
- Gentle sarcasm. Tease, never attack. Smile in the glass.
- 2–3 punchlines required. Humor > lesson. No moralizing.
- Tiny vivid image, then a wink.
Alcohol flavor: ${drinksYes ? "elegant bar metaphors sprinkled in, never dominant." : "rare, subtle nods only."}
Personalization:
- Use PROFILE DIGEST to anchor ${cityNow}, ${workRole}, goals, values. Keep implicit.
Ending:
- ${finaleInstr_en}`
      : `Sei “What the F”: barista nottambulo — arguto, un po’ brillo, ma gentile.
Parla come UNA sola voce. Niente sceneggiatura. Niente “Nome:”.
Lunghezza: 8–10 righe. Una frase per riga (≤12 parole).
Tono:
- Sarcasmo GENTILE. Punzecchia, non colpisce. Sorriso nel bicchiere.
- 2–3 punchline obbligatorie. Umorismo > lezione. Niente moralismi.
- Mini-immagine vivida, poi strizzata d’occhio.
Tocco alcolico: ${drinksYes ? "metafore da bancone eleganti, mai centrali." : "accenni rari e leggeri."}
Personalizzazione:
- Usa la SINTESI PROFILO per ancorare ${cityNow}, ${workRole}, obiettivi, valori. Resta implicito.
Chiusura:
- ${finaleInstr_it}`;
  }

  // 🌙 WHAT?f — sobrio, empatico, visivo, 8–10 righe, frasi brevi, voce unica
  return isEn(lang)
    ? `You are "What?f": a sober, empathetic bartender — lucid, kind, precise.
One calm voice. No script. No "Name:".
Length: 8–10 lines. One short sentence per line (≤14 words).
Goal: let the user SEE/FEEL an alternate slice (past or near-future).
Style:
- Gentle irony. Concrete visuals (light, sound, small gestures). No moralizing.
- Personalize with PROFILE DIGEST (city, work, goals, values). Keep implicit.
Ending:
- ${finaleInstr_en}`
    : `Sei “What?f”: barista sobrio ed empatico — lucido, gentile, preciso.
Una voce calma. Niente sceneggiatura. Niente “Nome:”.
Lunghezza: 8–10 righe. Una frase per riga (≤14 parole).
Obiettivo: far VEDERE/SENTIRE un frammento alternativo (passato o prossimo futuro).
Stile:
- Ironia leggera. Dettagli concreti (luce, suoni, piccoli gesti). Niente prediche.
- Personalizza con la SINTESI PROFILO (città, lavoro, obiettivi, valori). Resta implicito.
Chiusura:
- ${finaleInstr_it}`;
}

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 lines. One sentence per line (≤12 words). One speaker. 2–3 punchlines. Gentle sarcasm. End as instructed.`
      : `Formato: 8–10 righe. Una frase per riga (≤12 parole). Voce unica. 2–3 punchline. Sarcasmo gentile. Chiudi come istruito.`;
  }
  return en
    ? `Format: 8–10 calm lines. One sentence per line (≤14 words). One speaker. Visual, empathetic. End as instructed.`
    : `Formato: 8–10 righe calme. Una frase per riga (≤14 parole). Voce unica. Visivo, empatico. Chiudi come istruito.`;
}

/* ============== Build user content ============== */
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
- Personalize with PROFILE DIGEST (city, work, goals, values, pains, wins).
- Keep references implicit and respectful. Avoid explicit private data.
- Imagine “how it would've been / could be next” briefly.`
      : `USO DEL CONTESTO:
- Personalizza con SINTESI PROFILO (città, lavoro, obiettivi, valori, difficoltà, vittorie).
- Mantieni riferimenti impliciti e rispettosi. Evita dati privati espliciti.
- Immagina “come sarebbe stato / come potrebbe essere” in breve.`
  );

  return L.join("\n\n");
}

/* ============== Clarify (period-aware + profiling progressivo) ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `Generate 2–3 short clarifying questions (one line each). Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Genera 2–3 domande brevi di chiarimento (una riga). Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;

  const period = en
    ? `PERIOD-AWARE:
- If TIMEFRAME="past": pivot year/event, place/context then, key constraint/signal.
- If TIMEFRAME="future": decision window, success indicator, realistic constraint/resource.`
    : `CONSAPEVOLEZZA PERIODO:
- Se PERIODO="past": anno/evento di svolta, luogo/contesto, vincolo/segno chiave.
- Se PERIODO="future": finestra decisionale, indicatore di successo, vincolo/risorsa realistica.`;

  const profiling = en
    ? `Progressive profiling: ask for missing key fields — city_now, city_origin, work_role, one concrete goal, 2–3 values.`
    : `Profilazione progressiva: chiedi campi chiave mancanti — city_now, city_origin, work_role, un obiettivo concreto, 2–3 valori.`;

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

function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  const qs = [];
  if (periodo === "past") {
    qs.push({ id: "pivot_year", label: en ? "Turning point year/event?" : "Anno/evento di svolta?", placeholder: en ? "e.g., 2015 move / 2010 offer" : "es. trasferimento 2015 / offerta 2010" });
    qs.push({ id: "then_context", label: en ? "Where and what context then?" : "Dove e quale contesto allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" });
    qs.push({ id: "what_would_change", label: en ? "One constraint/signal that changes it?" : "Un vincolo/segno che l’avrebbe cambiata?", placeholder: en ? "money/time/person/offer" : "soldi/tempo/persona/offerta" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Vera finestra decisionale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "success_indicator", label: en ? "One success indicator?" : "Un indicatore di successo?", placeholder: en ? "€ saved / hours / first client" : "€ risparmiati / ore / primo cliente" });
    qs.push({ id: "real_constraint", label: en ? "Most concrete constraint?" : "Vincolo più concreto?", placeholder: en ? "budget / time / energy / commitment" : "budget / tempo / energia / impegno" });
  }
  if (!profilo?.city_now) qs[0] = qs[0] || { id: "city_now", label: en ? "Where do you live now?" : "Dove vivi adesso?", placeholder: en ? "city" : "città" };
  if (!profilo?.work_role) qs[1] = qs[1] || { id: "work_role", label: en ? "Your current role?" : "Il tuo ruolo attuale?", placeholder: en ? "e.g., pharmacist technician" : "es. tecnico farmaceutico" };
  if (!Array.isArray(profilo?.goals) || !profilo.goals.length) qs[2] = qs[2] || { id: "main_goal", label: en ? "One concrete goal now?" : "Un obiettivo concreto ora?", placeholder: en ? "e.g., change job / more time" : "es. cambiare lavoro / più tempo" };
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
      periodo = "future",
      stile = "whatif",        // "whatif" | "wtf"
      clarify = false,         // true => 2–3 domande
      stream = false,          // true => SSE
      profilo = {},            // include story_state { thread_id, episode, max_episodes }
      clarifications = {},
      extra = ""
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
        if (start >= 0 && end > start) questions = JSON.parse(raw.slice(start, end + 1));
      } catch (_) { /* fallback */ }
      if (!Array.isArray(questions) || questions.length === 0) questions = localClarify(domanda, profilo, lang, periodo);
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

    // Finale/mid-episode hint extra
    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "FINALE mode: deliver closure, one memorable last line. Invite a new 'what if'."
          : "Modalità FINALE: chiudi davvero, una riga memorabile. Invita a un nuovo 'e se'.")
      : (isEn(lang)
          ? `MID-EPISODE: end with one soft personal hook linked to ${profilo?.city_now || "their city"} or ${profilo?.work_role || "their role"}.`
          : `EPISODIO INTERMEDIO: chiudi con un gancio personale legato a ${profilo?.city_now || "la tua città"} o ${profilo?.work_role || "il tuo ruolo"}.`);

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.97 : 0.82;

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
