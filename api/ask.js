// /api/ask.js
import OpenAI from "openai";

/* ============== Setup ============== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ============== Helpers ============== */
function seasonForMonth(m, lang) {
  const it = ["inverno","inverno","primavera","primavera","primavera","estate","estate","estate","autunno","autunno","autunno","inverno"];
  const en = ["winter","winter","spring","spring","spring","summer","summer","summer","autumn","autumn","autumn","winter"];
  return (lang === "en" ? en : it)[(m-1)%12];
}
function safeNow(nowIso, tz) {
  const d = nowIso ? new Date(nowIso) : new Date();
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return {
    time24: `${hh}:${mm}`,
    weekday_en: d.toLocaleDateString("en-GB",{weekday:"long"}),
    weekday_it: d.toLocaleDateString("it-IT",{weekday:"long"}),
    date_en: d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}),
    date_it: d.toLocaleDateString("it-IT",{day:"2-digit",month:"2-digit",year:"numeric"}),
    season_en: seasonForMonth(d.getMonth()+1,"en"),
    season_it: seasonForMonth(d.getMonth()+1,"it"),
    month_en: d.toLocaleDateString("en-GB",{month:"long"}),
    month_it: d.toLocaleDateString("it-IT",{month:"long"}),
    tz: tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}
function isFinalEpisode(profile = {}) {
  const ep = Number(profile?.story_state?.episode ?? 1);
  const max = Number(profile?.story_state?.max_episodes ?? 3);
  return ep >= max;
}
function renderProfileDigest(p = {}) {
  if (!p || typeof p !== "object") return "";
  const parts = [];
  if (p.name) parts.push(`${p.name}${p.age_range ? ", " + p.age_range : ""}`);
  const roots = [p.city_origin||p.city_from, p.city_now||p.city].filter(Boolean).join(" → ");
  if (roots) parts.push(`luoghi: ${roots}`);
  if (p.work_role||p.role) parts.push(`ruolo: ${p.work_role||p.role}`);
  if (p.goal) parts.push(`obiettivo: ${p.goal}`);
  if (Array.isArray(p.values)&&p.values.length) parts.push(`valori: ${p.values.join(", ")}`);
  if (p.time_window) parts.push(`finestra: ${p.time_window}`);
  if (p.success_indicator) parts.push(`indicatore_successo: ${p.success_indicator}`);
  if (p.risk_tolerance) parts.push(`rischio: ${p.risk_tolerance}`);
  if (p.landmark) parts.push(`ancora: ${p.landmark}`);
  if (p.micro && typeof p.micro === "object") {
    for (const [k,v] of Object.entries(p.micro)) if (v && typeof v==="string") parts.push(`${k}: ${v.trim()}`);
  }
  return parts.join(" • ");
}

/* ============== Persona prompts (puliti) ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz }) {
  const en = isEn(lang);
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);
  const now = safeNow(nowIso, tz);

  const when_en = `Today is ${now.weekday_en}, ${now.date_en}. Season: ${now.season_en}. Local time ~${now.time24}.`;
  const when_it = `Oggi è ${now.weekday_it}, ${now.date_it}. Stagione: ${now.season_it}. Ora locale ~${now.time24}.`;

  const finaleInstr_en = finale
    ? `FINALE: closure, no cliffhanger. Memorable last line + soft invite to start a new "what if".`
    : `MID-EPISODE: end with a subtle, personal hook (no paywall mention).`;
  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero, zero cliffhanger. Ultima riga memorabile + invito leggero a un nuovo “e se”.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile (nessun accenno a paywall).`;

  const anti_en = `Avoid clichés unless present in the prompt:
- no “call an old friend”, “nostalgia/memories/warm hugs/coffee aroma/breathe better air”
- no generic “family will make you feel…”
- never reuse stock phrases across answers.`;
  const anti_it = `Evita cliché se non compaiono nella domanda:
- niente “chiama un vecchio amico”, “nostalgia/ricordi/abbracci/profumo di caffè/si respira meglio”
- niente “la famiglia ti farà sentire…”
- non riusare frasi stampino tra risposte.`;

  if (stile === "wtf") {
    return en
      ? `You are "What the F": a witty, slightly drunk bartender-philosopher.
${when_en}
One speaker, second person only. 8–10 punchy lines (≤15 words).
Smart, playful sarcasm; never cruel. At least two punchlines.
Personalize by weaving hints from ${cityNow}, ${workRole} (no lists).
Tense: FUTURE→near future; PAST→counterfactual.
${anti_en}
No label words (risk/indicator/constraint). Blend ideas into prose.
Ending: ${finaleInstr_en}
Rotate the closing nudge to invite: “come back tomorrow for two tiny questions to keep the story going.”`
      : `Sei “What the F”: genio ubriaco da bar, brillante e tagliente, mai cattivo.
${when_it}
Voce unica, seconda persona. 8–10 righe brevi (≤15 parole).
Sarcasmo intelligente e giocoso; almeno due punchline.
Personalizza accennando a ${cityNow}, ${workRole} senza elenchi.
Tempi: FUTURO→futuro vicino; PASSATO→controfattuale.
${anti_it}
Bandite parole-etichetta (rischio/indicatore/vincolo). Integra nella prosa.
Chiusura: ${finaleInstr_it}
Alterna l’invito: “torna domani per due micro-domande e continuiamo il filo”.`;
  }

  return en
    ? `You are "What?f": a lucid, warm, slightly mystical friend — predictive, concrete, upbeat.
${when_en}
One calm inner voice, second person only. 8–10 concise, visual lines.
Mirror-opening (varied): show you grasp habits/pace/limits without lists.
No label words (risk/indicator/constraint/trade-off). Weave them naturally.
Tense control as per timeframe.
${anti_en}
Ending: ${finaleInstr_en}
Rotate a gentle invite to return tomorrow for two micro-questions that sharpen the next chapter.`
    : `Sei “What?f”: zingara lucida — empatica, predittiva, concreta, tono sereno.
${when_it}
Una sola voce, seconda persona. 8–10 righe visive e concise.
Apertura-specchio (variata): fai capire che conosci ritmi/abitudini/limiti senza elenchi.
Evita parole-etichetta (rischio/indicatore/vincolo/trade-off): integra nel racconto.
Tempi coerenti col periodo.
${anti_it}
Chiusura: ${finaleInstr_it}
Alterna un invito lieve a tornare domani per due micro-domande che affinano il prossimo capitolo.`;
}

/* ============== Istruzioni di stile (varia aperture/chiusure) ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  const baseEn = `Vary openings and closings; never reuse stock lines. No explicit labels. Small, relevant details only.`;
  const baseIt = `Varia aperture e chiusure; mai frasi stampino. Nessuna etichetta esplicita. Dettagli piccoli e pertinenti.`;

  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines, one speaker, second person only. Bold, playful sarcasm. Respect tense. ${baseEn}
Closing nudge (rotate):
- "Tomorrow, two tiny questions — I’ll push the plot."
- "Drop by tomorrow; two quick checks and we keep the thread sharp."
- "Come back tomorrow; two dots to connect, then the fun part."`
      : `Formato: 8–10 righe brevi, voce unica, seconda persona. Sarcasmo brillante. Rispetta i tempi. ${baseIt}
Invito finale (ruota):
- "Domani passa: due micro-domande e stringiamo la rotta."
- "Torna domani: due check veloci e rimettiamo a fuoco."
- "Ci vediamo domani: due puntini da unire, poi si riparte."`;
  }

  return en
    ? `Format: 8–10 concise, visual lines, one speaker, second person only. Mirror-opening, predictive, upbeat. Respect tense. ${baseEn}
Closing nudge (rotate):
- "Come back tomorrow — two tiny questions and I’ll map the next turn."
- "Tomorrow, answer two micro-prompts; I’ll continue the chapter."
- "Drop by tomorrow; two quick notes and the path sharpens."`
    : `Formato: 8–10 righe concise e visive, seconda persona. Apertura-specchio, predittivo, sereno. Rispetta i tempi. ${baseIt}
Invito finale (ruota):
- "Domani torna: due micro-domande e ti porto al prossimo bivio."
- "Passa domani: due appunti veloci e continuo il capitolo."
- "Ci rivediamo domani: due note e il percorso si fa nitido."`;
}

/* ============== Few-shot essenziali (IT + EN) ============== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  if (style === "wtf") {
    return it ? [
      { role: "system", content:
`ESEMPIO_WTF_IT
DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Ti tenta, ammettilo: nomi corti, strade dritte.
Gioia inclusa, privacy in saldo: pacchetto rientro.
Metti paletti prima dei brindisi: ti salvano l’agenda.
Se il lunedì respira, è verde.
Se parte il “ci pensi tu?”, frena.
Scegli tavoli piccoli, non piazze.
Meno rumore, più tu.
Trucco da bancone: amerai la quiete più del casino.
Punchline: cuore pieno, calendario magro.
Domani passa: due micro-domande e affiniamo il tiro.`}
    ] : [
      { role: "system", content:
`WTF_EXAMPLE_EN
QUESTION: "What if I moved back to L'Aquila?"
ANSWER:
Tempting, right? Short names, straight streets.
Joy included, privacy discounted: classic bundle.
Set boundaries before the toasts; they save your calendar.
If Monday breathes, that’s green.
If “can you just…?” avalanches, brake.
Pick small tables, not public squares.
Less noise, more you.
Bartender tip: you’ll love quiet more than chaos.
Punchline: full heart, lean calendar.
Tomorrow swing by: two micro-questions; we fine-tune.`}
    ];
  }

  return it ? [
    { role: "system", content:
`ESEMPIO_WHATIF_IT
DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Ti carichi quando il ritmo è breve e ripetibile.
All’inizio non cerchi applausi: cerchi un passo che tenga.
Fissi due abitudini riconoscibili; il resto segue.
Se il lunedì scorre più quieto, stai puntando giusto.
Micro-mossa: un “giorno ponte” fisso al mese, sempre quello.
Accorgerti più gentile con te è il segnale buono.
Dopo tre cicli capisci: rientro vero o museo del cuore.
Niente fretta: coerenza che cresce.
Domani torna: due micro-domande e ti mostro la prossima curva.`}
  ] : [
    { role: "system", content:
`WHATIF_EXAMPLE_EN
QUESTION: "What if I moved back to L'Aquila?"
ANSWER:
You recharge on short, repeatable rhythms.
At first you don’t chase applause; you pick a step that holds.
Lock two recognizable habits; the rest follows.
If Monday runs quieter, you’re aligned.
Tiny move: one fixed “bridge day” per month.
Catching yourself kinder — that’s the sign.
After three cycles: true return or museum of the heart.
No rush; coherence compounds.
Tomorrow come back: two micro-questions; next bend revealed.`}
  ];
}

/* ============== Costruzione messaggi ============== */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz }) {
  const en = isEn(lang);
  const now = safeNow(nowIso, tz);
  const L = [];
  L.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  L.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  L.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);
  L.push(
    en
      ? `NOW: weekday=${now.weekday_en}; season=${now.season_en}; local_time≈${now.time24};`
      : `ADESSO: giorno=${now.weekday_it}; stagione=${now.season_it}; ora_locale≈${now.time24};`
  );
  const digest = renderProfileDigest(profilo);
  if (digest) L.push(en ? `PROFILE DIGEST: ${digest}` : `SINTESI PROFILO: ${digest}`);
  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k,v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }
  // Nota: niente parole-etichetta; usatele solo come concetti nella prosa.
  return L.join("\n\n");
}

/* ============== Clarify (2–3 domande) ============== */
function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  const qs = [];
  if (periodo === "past") {
    qs.push({ id: "pivot", label: en?"Turning point year/event?":"Anno/evento di svolta?", placeholder: en?"e.g., 2018 move":"es. trasferimento 2018" });
    qs.push({ id: "context_then", label: en?"Where/with whom back then?":"Dove e con chi allora?", placeholder: en?"city/team/family":"città/team/famiglia" });
  } else {
    qs.push({ id: "window", label: en?"Real decision window?":"Finestra reale?", placeholder: en?"this month / 3–6 months":"questo mese / 3–6 mesi" });
    qs.push({ id: "signal", label: en?"What would tell you it's working?":"Cosa ti direbbe che funziona?", placeholder: en?"sleep/energy/first client":"sonno/energia/primo cliente" });
  }
  qs.push({ id: "anchor", label: en?"A place/person anchor to consider?":"Un luogo/persona-ancora da considerare?", placeholder: en?"neighborhood/person":"quartiere/persona" });
  return qs.slice(0,3);
}

/* ============== HTTP handler ============== */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

  try {
    const {
      domanda, lang="it", periodo="future", stile="whatif",
      clarify=false, stream=false, profilo={}, clarifications={},
      extra="", now: nowIso, tz
    } = req.body || {};

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    // ----- Clarify -----
    if (clarify) {
      let questions = localClarify(domanda, profilo, lang, periodo);
      return res.status(200).json({ questions: questions.map((q,i)=>({
        id:String(q.id||`q${i+1}`),
        label:String(q.label|| (isEn(lang)?"Question":"Domanda")),
        placeholder:String(q.placeholder|| (isEn(lang)?"Answer in one line":"Rispondi in una riga"))
      }))});
    }

    // ----- Generation -----
    const sys1 = systemPrompt({ stile, lang, profile: profilo, nowIso, tz });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz });
    const sys2 = responseStyleInstruction(lang, stile);
    const fewshots = getFewShots(stile, lang);

    const messages = [
      { role:"system", content: sys1 },
      ...fewshots,
      { role:"user", content: user },
      { role:"system", content: sys2 },
      extra ? { role:"user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.97 : 0.84;

    if (String(req.headers["x-whatif-stream"]||"").length>0 || stream) {
      res.setHeader("Content-Type","text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control","no-cache, no-transform");
      res.setHeader("Connection","keep-alive");

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
      res.write(`data: ${JSON.stringify({ done:true })}\n\n`);
      return res.end();
    }

    const c = await client.chat.completions.create({
      model: MODEL_TEXT, messages, temperature, max_tokens: 700
    });
    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = (""+err?.message).toLowerCase().includes("aborted");
    return res.status(500).json({ error:"server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
