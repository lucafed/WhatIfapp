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
    ? `FINALE: close the story. No cliffhanger. End with ONE memorable line inviting a new 'what if'.`
    : `MID-EPISODE: end with ONE soft personal hook. No paywall mention.`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero. Niente cliffhanger. Chiudi con UNA riga memorabile e invito a un nuovo “e se”.`
    : `EPISODIO INTERMEDIO: chiudi con UN gancio personale. Niente paywall.`;

  // --- GUARD RIGIDO comune ai due stili ---
  const guard_en = `HARD RULES (MUST):
- Call-and-response style with NO labels. One single voice addressing the user.
- Do NOT write bartender monologue about yourself. No “I am the bartender…”.
- 8–10 lines TOTAL. Exactly ONE sentence per line.
- Max words per line: ${stile === "wtf" ? "12" : "14"} (count strictly).
- If any line exceeds the limit, REWRITE it shorter.
- Keep references implicit. Use PROFILE DIGEST subtly: ${cityNow}, ${workRole}, goals, values.
- Never preach. No long clauses. No poetry tone.`;

  const guard_it = `REGOLE FERREE (OBBLIGATORIE):
- Botta-e-risposta senza etichette. Una sola voce che parla all’utente.
- Vietato il monologo del barista su se stesso. No “io barista…”.
- 8–10 righe IN TOTALE. Esattamente UNA frase per riga.
- Parole massime per riga: ${stile === "wtf" ? "12" : "14"} (contale davvero).
- Se una riga supera il limite, RISCRIVILA più corta.
- Riferimenti impliciti. Usa SINTESI PROFILO con tatto: ${cityNow}, ${workRole}, obiettivi, valori.
- Niente prediche. Niente periodi lunghi. Niente tono poetico.`;

  if (stile === "wtf") {
    // 🥃 WHAT THE F — sarcasmo gentile, ritmo secco
    return isEn(lang)
      ? `You are "What the F": witty, tipsy, friendly; a midnight bar banter voice.
Tone:
- Gentle sarcasm. Tease, never attack. 2–3 punchlines required.
- Tiny vivid image, then a stinger. Alcohol flavor: ${drinksYes ? "tasteful bar metaphors sprinkled in." : "rare subtle nods."}
${guard_en}
Ending: ${finaleInstr_en}`
      : `Sei “What the F”: voce da bancone di mezzanotte, brillante e un po’ brilla.
Tono:
- Sarcasmo gentile. Punzecchia, non ferisce. 2–3 punchline obbligatorie.
- Piccola immagine concreta, poi stoccata. Tocco alcolico: ${drinksYes ? "metafore da bancone sobrie e gustose." : "accenni rari."}
${guard_it}
Chiusura: ${finaleInstr_it}`;
  }

  // 🌙 WHAT?f — sobrio, visivo, empatico
  return isEn(lang)
    ? `You are "What?f": sober, visual, kind; calm counter-voice.
Style:
- Light irony. Concrete visuals (light, sound, gestures). Actionable calm.
${guard_en}
Ending: ${finaleInstr_en}`
    : `Sei “What?f”: sobrio, visivo, gentile; controvoce calma.
Stile:
- Ironia leggera. Dettagli concreti (luce, suoni, gesti). Concretezza serena.
${guard_it}
Chiusura: ${finaleInstr_it}`;
}

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  const limit = stile === "wtf" ? 12 : 14;
  const common = en
    ? `Output EXACTLY 8–10 lines. ONE sentence per line. ≤${limit} words each. No labels. No first-person bartender monologue. If any line breaks rules, rewrite it.`
    : `Produci ESATTAMENTE 8–10 righe. UNA frase per riga. ≤${limit} parole ciascuna. Niente etichette. Niente monologo del barista in prima persona. Se una riga viola le regole, riscrivi.`;
  return common;
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
      ? `NARRATIVE TARGET:
- If TIMEFRAME="past": a counterfactual slice as if it happened.
- If TIMEFRAME="future": a near-future slice if they choose now.`
      : `OBIETTIVO:
- Se PERIODO="past": frammento controfattuale come se fosse accaduto.
- Se PERIODO="future": scorcio di prossimo futuro se sceglie ora.`
  );

  return L.join("\n\n");
}

/* ============== Clarify ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `Generate 2–3 short clarifying questions (one line). Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Genera 2–3 domande brevi (una riga). Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;
  const period = en
    ? `If past: pivot year/place/constraint. If future: decision window/success indicator/constraint.`
    : `Se past: anno/luogo/vincolo. Se future: finestra/indicatore/vincolo.`;
  const profiling = en
    ? `Ask missing profile: city_now, city_origin, work_role, one concrete goal, 2–3 values.`
    : `Chiedi profilo mancante: city_now, city_origin, work_role, un obiettivo concreto, 2–3 valori.`;
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
      clarify = false,
      stream = false,
      profilo = {},            // include story_state { episode, max_episodes }
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

    // Rinforzo finale/gancio
    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "FINALE mode: end with ONE memorable line. Offer a fresh new 'what if'."
          : "Modalità FINALE: chiudi con UNA riga memorabile. Invita a un nuovo 'e se'.")
      : (isEn(lang)
          ? `MID-EPISODE: finish with ONE subtle personal hook linked to ${profilo?.city_now || "their city"} or ${profilo?.work_role || "their role"}.`
          : `EPISODIO INTERMEDIO: chiudi con UN gancio personale legato a ${profilo?.city_now || "la tua città"} o ${profilo?.work_role || "il tuo ruolo"}.`);

    // Guardia finale “verificatore” (ridondante, ma utile)
    const hardGuard = isEn(lang)
      ? `VERIFY STYLE BEFORE SENDING:
- Exactly 8–10 lines. One sentence per line. No labels. No bartender-first-person monologue. Lines > limit? Shorten them.`
      : `VERIFICA STILE PRIMA DI INVIARE:
- Esattamente 8–10 righe. Una frase per riga. No etichette. No monologo del barista in prima persona. Righe oltre limite? Accorciale.`;

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      { role: "system", content: hardGuard },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.94 : 0.82;

    // Streaming
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        messages,
        temperature,
        max_tokens: 650,
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
      max_tokens: 650,
    });
    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res.status(500).json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
