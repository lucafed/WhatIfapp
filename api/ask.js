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

  // === Nuovi campi predittivi ===
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
    ? `FINALE: Provide closure. No cliffhanger. Land a memorable final line.
For What?f: reflective, warm resolution + one-line invite to start a new 'what if'.
For What the F: sharp closing punchline + playful invite to pick a new mess.`
    : `MID-EPISODE: End with a subtle, personal hook that invites the next step (no paywall mention).`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero. Niente cliffhanger. Chiusa memorabile.
Per What?f: risoluzione calda + invito in una riga a un nuovo “e se”.
Per What the F: punchline tagliente + invito giocoso a scegliere un nuovo casino.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile che inviti al seguito (senza menzionare paywall).`;

  const now = safeNow(nowIso, tz);
  const when_en = `Today is ${now.weekday_en}, ${now.date_en}. Season: ${now.season_en}. Local time ~${now.time24}.`;
  const when_it = `Oggi è ${now.weekday_it}, ${now.date_it}. Stagione: ${now.season_it}. Ora locale ~${now.time24}.`;

  if (stile === "wtf") {
    // 🥃 WHAT THE F — barista nottambulo, divertente, sarcastico “buono”
    return en
      ? `You are "What the F": a late-night bartender-philosopher — witty, tipsy, razor-sharp, never mean.
${when_en}
Speak as ONE voice (no script labels). 8–10 quick lines — bar-counter rhythm.
Tone:
- High sarcasm, playful jabs, 2–3 punchlines. Humor > lesson. No moralizing.
- Each line ≤15 words; pause like you're sipping.
Alcohol flavor: ${drinksYes ? "frequent classy bar metaphors" : "occasional subtle nods"}.
Personalization:
- Ground quips in ${cityNow}, ${workRole} without listing private data.
Tense:
- If TIMEFRAME=future → keep future/near-future tense; avoid past tense narration.
Ending:
- ${finaleInstr_en}`
      : `Sei “What the F”: barista nottambulo, arguto, un filo brillo ma lucidissimo.
${when_it}
Parla come UNA voce (niente sceneggiatura). 8–10 righe veloci, ritmo da bancone.
Tono:
- Sarcasmo brillante, 2–3 punchline, zero cattiveria. L’umorismo vince sulla morale.
- Ogni riga ≤15 parole; pausa da sorso tra una battuta e l’altra.
Tocco alcolico: ${drinksYes ? "metafore da bar eleganti e ricorrenti" : "accenni leggeri sporadici"}.
Personalizzazione:
- Ancoraggio sottile a ${cityNow}, ${workRole}, senza elenchi di dati.
Tempi:
- Se PERIODO=futuro → usa futuro/prossimo; evita narrazione al passato.
Chiusura:
- ${finaleInstr_it}`;
  }

  // 🌙 WHAT?f — amico lucido, sincero, predittivo, concreto
  return en
    ? `You are "What?f": a candid, slightly mystical friend — lucid, concrete, predictive.
${when_en}
One calm inner voice. 8–10 concise lines, visual and practical.
Goal: show a counterfactual slice (PAST) or a near-future fork (FUTURE).
Style:
- Less sweet, more grounded. Timings, small risks, trade-offs, first concrete step.
- Use decision window, success indicator, risk tolerance, and place/person anchors if present.
Tense:
- If TIMEFRAME=future → future/near-future; if past → "as if it happened" counterfactual.
Ending:
- ${finaleInstr_en}`
    : `Sei “What?f”: un amico lucido, sincero, un po’ mistico — concreto e predittivo.
${when_it}
Voce unica. 8–10 righe nette, visive e pratiche.
Obiettivo: mostrare un controfattuale (PASSATO) o una biforcazione di prossimo futuro (FUTURO).
Stile:
- Meno smielato, più ancorato. Tempi, piccoli rischi, trade-off, primo passo concreto.
- Usa finestra decisionale, indicatore di successo, tolleranza al rischio e ancore luogo/persona se presenti.
Tempi:
- Se PERIODO=futuro → futuro/prossimo; se passato → “come se fosse accaduto”.
Chiusura:
- ${finaleInstr_it}`;
}

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Punchy inner banter. 2–3 punchlines. Keep it fun.
TENSE GUARDRAIL: If TIMEFRAME=future, avoid past-tense narration. End as instructed.`
      : `Formato: 8–10 righe brevi. Voce unica. Botta-e-risposta interna. 2–3 punchline. Divertente.
GUARDRAIL TEMPI: Se PERIODO=futuro, evita narrazione al passato. Chiudi come istruito.`;
  }
  return en
    ? `Format: 8–10 concise lines. Visual, candid, current. Include first step + realistic trade-off if relevant.
TENSE GUARDRAIL: Future => future/near-future; Past => as-if counterfactual. End as instructed.`
    : `Formato: 8–10 righe incisive. Visivo, sincero, attuale. Includi primo passo + trade-off realistico se serve.
GUARDRAIL TEMPI: Futuro => futuro/prossimo; Passato => controfattuale “come se”. Chiudi come istruito.`;
}

/* ============== Costruzione messaggio utente (con profilo) ============== */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz, tags = [], extra_news = "" }) {
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

  // Topic tags
  if (Array.isArray(tags) && tags.length) {
    L.push(en ? `TOPIC TAGS: ${tags.join(", ")}` : `TAG TEMA: ${tags.join(", ")}`);
  }

  // External context / attualità (opzionale, lo passi dal client)
  if (extra_news && String(extra_news).trim()) {
    L.push(en ? `EXTERNAL CONTEXT:\n${extra_news}` : `CONTESTO ESTERNO:\n${extra_news}`);
  }

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

  // Istruzioni per “predizione” concreta
  L.push(
    en
      ? `PREDICTIVE OBJECTIVE:
- PAST → counterfactual vignette as if it happened: include a plausible cost/trade-off and one signal that would've proved it worked.
- FUTURE → near-future path if they choose now: include first small step (1 call/email/hour), a concrete success indicator, and a realistic constraint.
- Weave decision window, risk tolerance, and place/person anchors naturally (not as bullets).
- Use small specific details (time of day, neighborhood) only when relevant. Avoid newsy claims unless provided here.`
      : `OBIETTIVO PREDITTIVO:
- PASSATO → vignetta controfattuale come se fosse accaduta: inserisci un costo/trade-off plausibile e un segnale che avrebbe provato che funzionava.
- FUTURO → percorso di prossimo futuro se sceglie ora: inserisci il primo passo piccolo (1 chiamata/email/ora), un indicatore di successo concreto e un vincolo realistico.
- Intreccia finestra decisionale, tolleranza al rischio e ancore luogo/persona in modo naturale (non a elenco).
- Usa dettagli piccoli (orario, quartiere) solo se servono. Evita riferimenti “di attualità” non forniti qui.`
  );

  return L.join("\n\n");
}

/* ============== Clarify “aware” del periodo + profiling progressivo ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You will write 3 short, highly-focused clarifying questions (one line each) tightly linked to the user's main question and its topic tags. Return ONLY a JSON array of { "id","label","placeholder" }. Avoid generic or repeated questions.`
    : `Scrivi 3 domande brevi e molto mirate (una riga) collegate in modo stretto alla domanda e ai suoi tag tematici. Restituisci SOLO un array JSON di { "id","label","placeholder" }. Evita domande generiche o ripetute.`;

  const period = en
    ? `PERIOD AWARE:
- If TIMEFRAME = "past": ask about pivot year/event, place/context then, key constraint/signal.
- If TIMEFRAME = "future": ask about decision window, success indicator, realistic constraint/resource.`
    : `Consapevole del PERIODO:
- "past": chiedi anno/evento di svolta, luogo/contesto di allora, vincolo/segno chiave.
- "future": chiedi finestra decisionale, indicatore di successo, vincolo/risorsa realistica.`;

  const profiling = en
    ? `Progressive profiling (only if missing): city_now/city_origin, work_role, one concrete main goal.`
    : `Profilazione progressiva (solo se mancano): city_now/city_origin, work_role, un obiettivo concreto.`;

  return `${base}\n${period}\n${profiling}`;
}

function clarifyUserContent({ domanda, periodo = "future", profilo = {}, lang = "it", tags = [] }) {
  const en = isEn(lang);
  const parts = [];
  parts.push((en ? "QUESTION: " : "DOMANDA: ") + (domanda || ""));
  parts.push((en ? "TIMEFRAME: " : "PERIODO: ") + periodo);

  if (Array.isArray(tags) && tags.length) {
    parts.push(en ? "TOPIC TAGS: " + tags.join(", ") : "TAG TEMA: " + tags.join(", "));
  }

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
      extra = "",              // input extra opzionale (es. forzare lingua)
      now: nowIso,             // opzionale: ISO dal client
      tz,                      // opzionale: timezone IANA dal client
      tags = [],               // <<< nuovi: topic tags dalla 4^ pagina
      extra_news = ""          // <<< nuovo: contesto esterno/attualità opzionale
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ---------- Clarify branch (versione migliorata e dinamica) ---------- */
    if (clarify) {
      let questions = [];
      try {
        const sys = clarifySystemPrompt(lang);
        const usr = clarifyUserContent({ domanda, periodo, profilo, lang, tags });
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
        console.error("Clarify dynamic error:", err);
      }

      // Fallback locale se la risposta non è valida
      if (!Array.isArray(questions) || questions.length === 0) {
        questions = localClarify(domanda, profilo, lang, periodo);
      }

      // Normalizza e prepara le domande
      questions = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i + 1}`),
        label: String(q.label || q?.text || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));

      // Log chiarimenti usati oggi (header per eventuale client tracking)
      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        const clarHdr = { date: todayIso, used: (questions?.length || 0) };
        res.setHeader("X-Whatif-Clarify", JSON.stringify(clarHdr));
      } catch {}

      return res.status(200).json({ questions });
    }

    /* ---------- Generation branch ---------- */
    const sys1 = systemPrompt({ stile, lang, profile: profilo, nowIso, tz });
    const user = buildUserContent({
      domanda,
      periodo,
      profilo,
      clarifications,
      lang,
      stile,
      nowIso,
      tz,
      tags,
      extra_news
    });
    const sys2 = responseStyleInstruction(lang, stile);

    // Finale/mid-episode hint (rinforzo)
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
