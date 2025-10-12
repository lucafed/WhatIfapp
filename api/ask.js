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
  if (p.name) parts.push(`${p.name}${p.age_range ? ", " + p.age_range : ""}`);
  const roots = [p.city_origin || p.city_from, p.city_now || p.city].filter(Boolean).join(" → ");
  if (roots) parts.push(`luoghi: ${roots}`);
  if (p.work_role || p.role) parts.push(`ruolo: ${p.work_role || p.role}`);
  if (Array.isArray(p.goals) && p.goals.length) parts.push(`obiettivi: ${p.goals.join(", ")}`);
  if (p.goal && (!parts.find(x => x.startsWith("obiettivi:")))) parts.push(`obiettivo: ${p.goal}`);
  if (Array.isArray(p.values) && p.values.length) parts.push(`valori: ${p.values.join(", ")}`);
  if (Array.isArray(p.wins) && p.wins.length) parts.push(`vittorie: ${p.wins.join(", ")}`);
  if (Array.isArray(p.pains) && p.pains.length) parts.push(`difficoltà: ${p.pains.join(", ")}`);
  if (Array.isArray(p.hobbies) && p.hobbies.length) parts.push(`interessi: ${p.hobbies.join(", ")}`);
  if (typeof p.drinks_pref === "string") parts.push(`drinks_pref: ${p.drinks_pref}`);
  if (typeof p.unwind === "string") parts.push(`unwind: ${p.unwind}`);
  if (p.time_window) parts.push(`finestra: ${p.time_window}`);
  if (p.success_indicator) parts.push(`indicatore_successo: ${p.success_indicator}`);
  if (p.risk_tolerance) parts.push(`rischio: ${p.risk_tolerance}`);
  if (p.landmark) parts.push(`ancora: ${p.landmark}`);
  if (p.micro && typeof p.micro === "object") {
    Object.entries(p.micro).forEach(([k, v]) => {
      if (v && typeof v === "string" && v.trim()) parts.push(`${k}: ${v.trim()}`);
    });
  }
  return parts.join(" • ");
}

function isFinalEpisode(profile = {}) {
  const ep = Number(profile?.story_state?.episode ?? 1);
  const max = Number(profile?.story_state?.max_episodes ?? 3);
  return ep >= max;
}

/* ===== Mirror (specchio) + closing predittivo ===== */
function makeMirrorLine({ profilo = {}, lang = "it" }) {
  const it = !isEn(lang);
  const who = (profilo?.name ? profilo.name.split(" ")[0] : "").trim();
  const city = profilo?.city_now || profilo?.city || "";
  const role = profilo?.work_role || profilo?.role || "";
  const goal = Array.isArray(profilo?.goals) && profilo.goals[0] ? profilo.goals[0] : (profilo?.goal || "");
  const values = (Array.isArray(profilo?.values) ? profilo.values.slice(0, 2) : []).filter(Boolean);

  const itPool = [
    who ? `${who}, quando cambi non è per capriccio: ti serve un senso pulito.` : `Tu non cambi per capriccio: ti serve un senso pulito.`,
    city ? `Ti regge ${city}, ma ogni tanto ti manca una finestra aperta.` : `Ti serve una base solida e una finestra aperta.`,
    role ? `Nel lavoro (${role}) reggi finché il “perché” resta acceso.` : `Reggi finché il “perché” resta acceso.`,
    goal ? `In testa tieni questo filo: ${goal}. Il resto si allinea.` : `In testa tieni un filo chiaro. Il resto si allinea.`,
    values.length ? `Quando rispetti ${values.join(" e ")}, il passo diventa naturale.` : `Quando qualcosa ti rispetta davvero, il passo diventa naturale.`,
  ];
  const enPool = [
    who ? `${who}, you don’t move on whims — you move for meaning.` : `You don’t move on whims — you move for meaning.`,
    city ? `${city} grounds you, but you still need one open window.` : `You like a solid base and one open window.`,
    role ? `In (${role}) you keep pace while the “why” is lit.` : `You keep pace while the “why” is lit.`,
    goal ? `There’s a thread you hold: ${goal}. Everything else aligns.` : `There’s a clear thread you hold. Everything else aligns.`,
    values.length ? `When you honor ${values.join(" and ")}, your stride clicks.` : `When it truly fits you, your stride clicks.`,
  ];
  const pool = it ? itPool : enPool;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickClosing({ lang = "it", stile = "whatif" }) {
  const it = !isEn(lang);
  const softIT = [
    `Domani riprendiamo con due micro-domande furbe e vediamo dove porta.`,
    `Se torni domani, aggiungiamo due dettagli e la storia scorre.`,
    `Ci fermiamo qui: due domande corte domani e continuiamo puliti.`,
    `Quando vuoi, passo successivo: due spunti rapidi e avanti.`,
  ];
  const sharpIT = [
    `Stop qui. Domani due colpi secchi e si riparte.`,
    `Ok, pausa. Domani due cue veloci e alziamo il livello.`,
    `Segnalibro messo: domani due domande dritte e si va.`,
    `Basta bancone: domani due tiri corti e movimento.`,
  ];
  const softEN = [
    `Come back tomorrow: two tiny questions and we move the plot.`,
    `Pause here. Tomorrow two sharp prompts and we go deeper.`,
    `Bookmark this — tomorrow two micro-questions and the thread continues.`,
    `We stop here; tomorrow two quick cues and we keep going.`,
  ];
  const sharpEN = [
    `Close tab. Tomorrow two clean shots and we move.`,
    `Enough talk. Tomorrow: two fast cues, then action.`,
    `Pin this. Tomorrow two crisp prompts and we push on.`,
    `Bar’s closed. Tomorrow two hits and we roll.`,
  ];
  if (it) return (stile === "wtf" ? sharpIT : softIT)[Math.floor(Math.random() * 4)];
  return (stile === "wtf" ? sharpEN : softEN)[Math.floor(Math.random() * 4)];
}

/* ============== Persona prompts (coerenti con lo stile concordato) ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz }) {
  const en = isEn(lang);
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);
  const now = safeNow(nowIso, tz);

  const epHint_en = finale
    ? `FINALE: deliver real closure (no cliffhanger). One memorable final line inviting a new thread.`
    : `MID-EPISODE: close with a soft personal hook; no paywall mention.`;
  const epHint_it = finale
    ? `FINALE: chiudi davvero (niente cliffhanger). Una riga memorabile che invita a un nuovo filo.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile (senza paywall).`;

  const ban_en = `Do NOT use literal labels like "constraint", "trade-off", "indicator", "first step".
Weave those ideas naturally in narrative. Never use "I". Second person only. Avoid coaching tone.`;
  const ban_it = `NON usare etichette letterali tipo "vincolo", "trade-off", "indicatore", "primo passo".
Intreccia quei concetti nel racconto. Mai “io”. Solo seconda persona. Evita tono da coach.`;

  if (stile === "wtf") {
    return en
      ? `You are "What the F": witty late-night bartender — drunk-genius vibe, playful, never cruel.
One voice, 8–10 short lines, bar rhythm. Personalize implicitly with ${cityNow}, ${workRole}.
Use near-future for FUTURE, counterfactual for PAST. ${ban_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint_en}`
      : `Sei "What the F": barista nottambulo — genio un po’ brillo, tagliente ma pulito.
Una voce, 8–10 righe brevi, ritmo da bancone. Personalizza in modo implicito con ${cityNow}, ${workRole}.
Usa futuro vicino per FUTURO, controfattuale per PASSATO. ${ban_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint_it}`;
  }

  return en
    ? `You are "What?f": lucid, warm, predictive — “street oracle” tone.
One calm voice, 8–10 vivid short lines, cinematic rhythm. Second person only.
Real timings, small realistic costs, inner signals; personalize with ${cityNow}, ${workRole}.
Zero nostalgia clichés; no “call a friend” unless present in prompt. ${ban_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint_en}`
    : `Sei "What?f": amico lucido, caldo, predittivo — “zingara lucida”.
Una voce, 8–10 righe brevi e visive, ritmo cinematografico. Solo seconda persona.
Tempi reali, piccoli costi plausibili, segnali interiori; personalizza con ${cityNow}, ${workRole}.
Niente cliché; non proporre “chiama un amico” se non è nel prompt. ${ban_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint_it}`;
}

/* ============== Few-shot (quelli “buoni” che avevi scelto) ============== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  if (style === "wtf") {
    return it
      ? [
          { role: "system", content:
`WTF_IT_A
DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Ti vedo rientrare e già due favori in tasca.
Cuore pieno, lunedì pesante: pacchetto rientro.
Stai dove ti vogliono, ma scegli tu gli orari.
Se il primo lunedì è leggero, è casa. Se pesa, è museo.
Brinda pure, poi acqua: domani due colpi secchi e si riparte.` },
          { role: "system", content:
`WTF_IT_B
DOMANDA: "Se avessi un milione?"
RISPOSTA:
Un milione? Premium errori inclusi.
Attico? Bello. Anche il condominio.
Non comprare trofei: compra respiro.
Se dormi meglio e litighi meno, stai vincendo.
Stop bancone: domani due cue rapidi e movimento.` },
        ]
      : [
          { role: "system", content:
`WTF_EN_A
QUESTION: "What if I moved back home?"
ANSWER:
You walk in and the favors walk with you.
Full heart, heavy Mondays — the return bundle.
Stay where you’re wanted, on your terms.
If the first Monday feels light, that’s home.
Close tab: tomorrow two clean shots and we move.` },
          { role: "system", content:
`WTF_EN_B
QUESTION: "What if I had a million?"
ANSWER:
A million buys premium mistakes.
Penthouse? Gorgeous. Maintenance too.
Don’t buy trophies, buy breathing room.
If you sleep deeper and argue less, you’re winning.
Bar’s closed — tomorrow two fast cues and we roll.` },
        ];
  }

  // WHAT?f
  return it
    ? [
        { role: "system", content:
`WHATIF_IT_A
DOMANDA: "E se cambiassi lavoro?"
RISPOSTA:
Non scatti a caso: ti muovi quando il perché si accende.
Il primo mese limi il rumore, tieni solo conversazioni buone.
Una sera il corpo si rilassa prima della testa.
Se due volti nuovi ti danno energia, sei sulla rotta.
Ci fermiamo qui: domani due micro-domande e si va avanti.` },
        { role: "system", content:
`WHATIF_IT_B
DOMANDA: "E se tornassi all’Aquila tra 3–6 mesi?"
RISPOSTA:
Ti piace una base: ${"${city}"} resta zattera, non gabbia.
Provi settimane gemelle: stessi giorni, stesse persone.
La sera il telefono tace, il passo si fa leggero.
Se gli inviti scelti da te aumentano, la direzione è buona.
Stop qui: domani due dettagli e continuiamo puliti.` },
      ]
    : [
        { role: "system", content:
`WHATIF_EN_A
QUESTION: "What if I changed jobs?"
ANSWER:
You don’t jump on whims — you move when the why lights up.
Month one, fewer better conversations.
One evening your body relaxes before your mind.
If two new faces give you energy, you’re on line.
Hold here: tomorrow two tiny prompts and we continue.` },
        { role: "system", content:
`WHATIF_EN_B
QUESTION: "What if I moved back in 3–6 months?"
ANSWER:
You like a base: ${"${city}"} stays raft, not cage.
Test twin weeks: same days, same people.
Evenings get lighter; the phone gets quiet.
If chosen invitations grow, direction’s good.
We stop here; tomorrow two details and we keep going.` },
      ];
}

/* ============== Istruzioni di stile ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Bold sarcasm, playful, never cruel. Second person only (no "I"). Respect tense by timeframe. Do NOT use literal labels — show, don’t name.`
      : `Formato: 8–10 righe brevi. Voce unica. Sarcasmo brillante, mai cattivo. Solo seconda persona. Tempi coerenti. Niente etichette letterali — mostra, non nominare.`;
  }
  return en
    ? `Format: 8–10 concise lines. One speaker. Visual, candid, current. Second person only. Weave costs/signals/next moves naturally, without naming them. Respect timeframe.`
    : `Formato: 8–10 righe concise. Voce unica. Visivo, sincero, attuale. Solo seconda persona. Intreccia costi/segnali/mosse senza etichette. Rispetta il periodo.`;
}

/* ============== Costruzione messaggio utente ============== */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz }) {
  const en = isEn(lang);
  const L = [];
  L.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  L.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  L.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);

  const now = safeNow(nowIso, tz);
  L.push(
    en
      ? `NOW:\nweekday=${now.weekday_en}; season=${now.season_en}; month=${now.month_en}; local_time≈${now.time24};`
      : `ADESSO:\ngiorno=${now.weekday_it}; stagione=${now.season_it}; mese=${now.month_it}; ora_locale≈${now.time24};`
  );

  const digest = renderProfileDigest(profilo);
  if (digest) L.push(en ? `PROFILE DIGEST: ${digest}` : `SINTESI PROFILO: ${digest}`);

  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  L.push(
    en
      ? `PREDICTIVE OBJECTIVE:
- PAST → counterfactual vignette as if it happened: include a small plausible cost and one inner/outer sign — but never label them.
- FUTURE → near-future fork if they choose now: suggest a tiny move and a natural sign to watch — woven in the narrative.
- Keep details small and timeless.`
      : `OBIETTIVO PREDITTIVO:
- PASSATO → vignetta controfattuale come se fosse accaduta: inserisci un piccolo costo plausibile e un segnale credibile — ma senza etichette.
- FUTURO → biforcazione di prossimo futuro se sceglie ora: suggerisci una micro-mossa e un segno naturale da osservare — intrecciati nel racconto.
- Dettagli piccoli e senza tempo.`
  );

  return L.join("\n\n");
}

/* ============== Clarify (domande mirate) ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You generate 2–3 short, focused clarifying questions (one line each). Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Generi 2–3 domande brevi e mirate (una riga). Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;

  const period = en
    ? `PERIOD-AWARE:
- TIMEFRAME="past": ask pivot year/event, place/context then, key sign.
- TIMEFRAME="future": ask decision window, personal sign of progress, concrete limit/resource.`
    : `Consapevole del PERIODO:
- PERIODO="past": chiedi anno/evento, luogo/contesto di allora, segno chiave.
- PERIODO="future": chiedi finestra decisionale, segno personale di avanzamento, limite/risorsa concreta.`;

  return `${base}\n${period}`;
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
    qs.push({ id: "key_sign", label: en ? "One sign it worked?" : "Un segno che funzionava?", placeholder: en ? "person/number/result" : "persona/numero/risultato" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Vera finestra decisionale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "personal_sign", label: en ? "Personal sign you'd watch?" : "Segno personale che osserveresti?", placeholder: en ? "sleep/energy/first reply" : "sonno/energia/prima risposta" });
    qs.push({ id: "concrete_limit", label: en ? "Most concrete limit?" : "Limite più concreto?", placeholder: en ? "budget/time/energy" : "budget/tempo/energia" });
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
      periodo = "future",
      stile = "whatif",          // "whatif" | "wtf"
      clarify = false,           // true => genera 2–3 domande
      stream = false,            // true => text/event-stream
      profilo = {},              // include story_state se vuoi archi episodici
      clarifications = {},
      extra = "",
      now: nowIso,
      tz,
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
          temperature: 0.7,
          messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        });
        const raw = resp.choices?.[0]?.message?.content?.trim() || "[]";
        const start = raw.indexOf("[");
        const end = raw.lastIndexOf("]");
        if (start >= 0 && end > start) questions = JSON.parse(raw.slice(start, end + 1));
      } catch {}
      if (!Array.isArray(questions) || questions.length === 0) {
        questions = localClarify(domanda, profilo, lang, periodo);
      }
      questions = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i + 1}`),
        label: String(q.label || q?.text || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));
      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        res.setHeader("X-Whatif-Clarify", JSON.stringify({ date: todayIso, used: (questions?.length || 0) }));
      } catch {}
      return res.status(200).json({ questions });
    }

    /* ---------- Generation branch ---------- */
    const sys1 = systemPrompt({ stile, lang, profile: profilo, nowIso, tz });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz });
    const sys2 = responseStyleInstruction(lang, stile);

    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "This is the FINALE for this thread: deliver closure (no cliffhanger). One-line invite to start a new 'what if'."
          : "Questo è il FINALE di questa storia: chiudi davvero (niente cliffhanger). Una riga che invita a un nuovo 'e se'.")
      : (isEn(lang)
          ? `Mid-episode: end with a subtle personal hook linked to ${profilo?.city_now || profilo?.city || "their city"} or ${profilo?.work_role || profilo?.role || "their role"}.`
          : `Episodio intermedio: chiudi con un gancio personale legato a ${profilo?.city_now || profilo?.city || "la tua città"} o ${profilo?.work_role || profilo?.role || "il tuo ruolo"}.`);

    const fewshots = getFewShots(stile, lang);
    const mirror = makeMirrorLine({ profilo, lang });
    const closing = pickClosing({ lang, stile });

    const messages = [
      { role: "system", content: sys1 },
      ...fewshots,
      { role: "system", content: isEn(lang)
        ? `Open with one short "mirror" line like (paraphrase, don't copy): "${mirror}"`
        : `Apri con una breve riga di “specchio” (parafrasa, non copiare): "${mirror}"` },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      { role: "system", content: isEn(lang)
        ? `Close with a natural episodic line like: "${closing}" (vary wording each time).`
        : `Chiudi con una riga episodica naturale tipo: "${closing}" (varia la frase ogni volta).` },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.97 : 0.82;

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
