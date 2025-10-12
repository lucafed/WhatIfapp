// /api/ask.js
import OpenAI from "openai";

/* ======================== Setup ======================== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = process.env.WHATIF_MODEL || "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* =================== Anti-cliché lists ================== */
const BAN_IT = [
  "chiama", "chiamata", "telefonata", "telefon", "barista", "bar ",
  "caffè", "caffe", "profumo", "odore", "nostalg", "bottiglie",
  "favore", "colpo di fulmine", "nuvole", "piazza", "abbracci a sorpresa"
];
const BAN_EN = [
  "call", "phone", "bartender", "bar ", "coffee", "smell", "scent",
  "nostalg", "bottles", "favor", "love at first sight", "clouds",
  "hugs out of nowhere", "square "
];
function containsBanned(text = "", lang = "it") {
  const list = isEn(lang) ? BAN_EN : BAN_IT;
  const low = text.toLowerCase();
  return list.some(w => low.includes(w));
}

/* =================== Profile digest ==================== */
function renderProfileDigest(p = {}) {
  if (!p || typeof p !== "object") return "";
  const parts = [];
  if (p.name) parts.push(`${p.name}${p.age_range ? ", " + p.age_range : ""}`);
  const roots = [p.city_origin || p.city_from, p.city_now || p.city].filter(Boolean).join(" → ");
  if (roots) parts.push(`luoghi: ${roots}`);
  if (p.work_role || p.role) parts.push(`ruolo: ${p.work_role || p.role}`);
  if (Array.isArray(p.goals) && p.goals.length) parts.push(`obiettivi: ${p.goals.join(", ")}`); else if (p.goal) parts.push(`obiettivo: ${p.goal}`);
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
    for (const [k, v] of Object.entries(p.micro)) {
      if (v && typeof v === "string" && v.trim()) parts.push(`${k}: ${v.trim()}`);
    }
  }
  return parts.join(" • ");
}
function isFinalEpisode(profile = {}) {
  const ep = Number(profile?.story_state?.episode ?? 1);
  const max = Number(profile?.story_state?.max_episodes ?? 3);
  return ep >= max;
}

/* ============== Mirror (specchio) + closing ============== */
function makeMirrorLine({ profilo = {}, lang = "it" }) {
  const it = !isEn(lang);
  const who = (profilo?.name || "").split(" ")[0];
  const city = profilo?.city_now || profilo?.city || "";
  const role = profilo?.work_role || profilo?.role || "";
  const goal = Array.isArray(profilo?.goals) && profilo.goals[0] ? profilo.goals[0] : (profilo?.goal || "");
  const values = (Array.isArray(profilo?.values) ? profilo.values.slice(0, 2) : []).filter(Boolean);

  const itPool = [
    who ? `${who}, non ti muovi per capriccio: insegui coerenza.` : `Tu non ti muovi per capriccio: cerchi coerenza.`,
    city ? `${city} ti regge, ma vuoi una finestra aperta.` : `Ti serve base solida e finestra aperta.`,
    role ? `Nel lavoro (${role}) vai forte finché il “perché” resta acceso.` : `Vai forte finché il “perché” resta acceso.`,
    goal ? `In testa tieni questo: ${goal}. Il resto si allinea.` : `Hai un faro chiaro: il resto si allinea.`,
    values.length ? `Quando rispetti ${values.join(" e ")}, il passo si allunga.` : `Quando ti senti rispettato, il passo si allunga.`,
  ];
  const enPool = [
    who ? `${who}, you move for coherence, not impulse.` : `You move for coherence, not impulse.`,
    city ? `${city} grounds you, but you need one open window.` : `You need one solid base and one open window.`,
    role ? `In ${role} you keep pace while the “why” is lit.` : `You keep pace while the “why” is lit.`,
    goal ? `You hold this: ${goal}. Everything else aligns.` : `You hold a clear beacon; the rest aligns.`,
    values.length ? `Honor ${values.join(" and ")} and your stride clicks.` : `Honor what fits and your stride clicks.`,
  ];
  const pool = it ? itPool : enPool;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickClosing({ lang = "it", stile = "whatif" }) {
  const it = !isEn(lang);
  const softIT = [
    "Se ti va, domani due micro-domande e continuiamo puliti.",
    "Segno la pagina: domani due dettagli rapidi e andiamo avanti.",
    "Torna quando vuoi: porto due cue corti e alziamo il livello.",
    "Ci fermiamo qui: domani due domande furbe e il filo riparte."
  ];
  const sharpIT = [
    "Ultimo giro: domani due colpi secchi e si va.",
    "Rubinetto chiuso. Domani due cue veloci e si riparte.",
    "Stop chiacchiere. Domani due domande dritte e muoviamo.",
    "Bicchiere giù: domani due botte secche e rilanciamo."
  ];
  const softEN = [
    "Come back tomorrow: two tiny questions and we keep it clean.",
    "Bookmark this — tomorrow two quick details and we move.",
    "Return and I’ll bring two sharp cues; one step further.",
    "Pause here; tomorrow two micro-questions and the thread continues."
  ];
  const sharpEN = [
    "Last call. Tomorrow two clean shots — then move.",
    "Close your tab. Tomorrow two fast cues and we roll.",
    "Enough talk. Tomorrow two blunt prompts and forward.",
    "Lights down. Tomorrow two quick hits and go."
  ];
  const pool = it ? (stile === "wtf" ? sharpIT : softIT) : (stile === "wtf" ? sharpEN : softEN);
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ================= Persona prompts ================== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz }) {
  const en = isEn(lang);
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);
  const now = safeNow(nowIso, tz);

  const epHint_en = finale
    ? `FINALE: real closure (no cliffhanger). One memorable last line inviting a new thread.`
    : `MID-EPISODE: close with a soft personal hook (no paywall).`;
  const epHint_it = finale
    ? `FINALE: chiudi davvero (niente cliffhanger). Una riga memorabile che invita a un nuovo filo.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile (niente paywall).`;

  const ban_en = `ABSOLUTE DO-NOTs:
- No literal labels like "constraint/trade-off/indicator/first step".
- No external helpers (friend/uncle/bartender/people) unless the user explicitly mentions them.
- Avoid clichés: coffee smells, nostalgia fog, favors, bottles, sudden epiphanies, weather/sky as decision drivers.
- Never use "I". Second person only. Keep agency with the user.`;
  const ban_it = `DIVIETI ASSOLUTI:
- Vietato usare etichette: “vincolo/trade-off/indicatore/primo passo”.
- Niente aiutanti esterni (amico/zia/barista/persone) se non citati dall’utente.
- Evita cliché: caffè/profumi/nostalgia/favori/bottiglie/colpi di fulmine/meteo come guida.
- Mai “io”. Solo seconda persona. L’agenzia resta a te.`;

  if (stile === "wtf") {
    return en
      ? `You are "What the F": witty late-night bartender — playful, sharp, a bit drunk but lucid.
One voice. 8–10 short lines, bar rhythm. Personalize subtly with ${cityNow}, ${workRole}.
Use near-future for FUTURE; counterfactual for PAST.
${ban_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint_en}`
      : `Sei “What the F”: barista nottambulo brillante — un filo brillo ma lucidissimo.
Una voce. 8–10 righe brevi, ritmo da bancone. Personalizza in modo implicito con ${cityNow}, ${workRole}.
Futuro vicino per FUTURO; controfattuale per PASSATO.
${ban_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint_it}`;
  }

  return en
    ? `You are "What?f": lucid, warm, predictive friend (mystic touch). One voice.
8–10 short vivid lines. Second person only. Real timings, inner signals, plausible scenes.
Personalize implicitly with ${cityNow}, ${workRole}.
${ban_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint_en}`
    : `Sei “What?f”: amico lucido, caldo, predittivo (tocco mistico). Una voce.
8–10 righe brevi e visive. Solo seconda persona. Tempi reali, segnali interiori, scene plausibili.
Personalizza in modo implicito con ${cityNow}, ${workRole}.
${ban_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint_it}`;
}

/* ===================== Few-shots ===================== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  if (style === "wtf") {
    return it
      ? [
          { role: "system", content:
`WTF_IT_1
DOMANDA: "Se avessi vinto 1.000.000?"
RISPOSTA:
Un milione? Ottimo: adesso puoi sbagliare con stile.
L’attico è bello; l’ansia da mantenimento meno.
Non comprare trofei: compra respiro.
Se dormi profondo e litighi meno col conto, stai vincendo.
Garage pieno non batte cuore quieto.
Brindiamo con testa, non con scontrini.
Ultimo sorso: domani due colpi secchi e si va.` },
          { role: "system", content:
`WTF_IT_2
DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Appena rientri, l’agenda tenta di comandare.
Metti tu i paletti, non la piazza.
Se il lunedì è leggero, chiama “casa”; se pesa, chiama “museo”.
Giro corto, testa alta, ascolta il passo.
Stop qui: domani due domande dritte e decidiamo.` },
        ]
      : [
          { role: "system", content:
`WTF_EN_1
QUESTION: "What if I won €1,000,000?"
ANSWER:
A million? Great — premium mistakes unlocked.
Penthouse looks rich; maintenance feels richer.
Buy room to breathe, not trophies.
If sleep deepens and arguments thin, you’re ahead.
Full garage < quiet heart.
We toast smart, not loud.
Last call — tomorrow two clean shots and we move.` },
          { role: "system", content:
`WTF_EN_2
QUESTION: "What if I moved back home?"
ANSWER:
The calendar will try to own you.
You set the rules, not the street.
Light Mondays mean home; heavy Mondays mean museum.
Short loop, steady stride, listen.
Pause here. Tomorrow two fast cues and we decide.` },
        ];
  }

  // WHAT?f
  return it
    ? [
        { role: "system", content:
`WHATIF_IT_1
DOMANDA: "E se cambiassi lavoro?"
RISPOSTA:
Non scatti per capriccio: ti muovi quando il perché si accende.
Mese uno: meno voci, più pulizia.
Una sera il corpo si rilassa prima della testa.
L’onda giusta la vedi nelle risposte chiare.
Se due facce nuove ti danno energia, sei allineato.
Quando la schiena si raddrizza da sola, un sì sta nascendo.
Segnalibro qui: domani due micro-domande e continuiamo.` },
        { role: "system", content:
`WHATIF_IT_2
DOMANDA: "E se tornassi all’Aquila tra 3–6 mesi?"
RISPOSTA:
Ti piace una base: ${"${city}"} resta zattera, non gabbia.
Provi settimane gemelle: stessi giorni, stessi ritmi.
La sera si alleggerisce; il telefono si spegne prima.
Se aumentano gli inviti scelti da te, stai andando bene.
Quel sorriso piano, sulla via di casa, dice che funziona.
Torna domani: due dettagli rapidi e andiamo oltre.` },
      ]
    : [
        { role: "system", content:
`WHATIF_EN_1
QUESTION: "What if I changed jobs?"
ANSWER:
You move when the why lights up.
Month one trims the noise.
One night the body relaxes first.
The right wave shows in tidy replies.
If two new faces feed you energy, you’re aligned.
When posture lifts by itself, a yes is forming.
Bookmark it: tomorrow two micro-questions and we go on.` },
        { role: "system", content:
`WHATIF_EN_2
QUESTION: "What if I moved back in 3–6 months?"
ANSWER:
You like a base: ${"${city}"} stays raft, not cage.
Test twin weeks: same days, same people.
Evenings get lighter; the phone goes quiet.
If chosen invitations rise, direction’s good.
That soft smile on the walk home means it’s working.
Come back tomorrow; two small cues and we continue.` },
      ];
}

/* ============== Style guardrails (no labels) ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Bold sarcasm, playful, never cruel. Second person only. Respect timeframe. No labels. No external helpers. No clichés.`
      : `Formato: 8–10 righe brevi. Voce unica. Sarcasmo brillante, mai cattivo. Solo seconda persona. Rispetta il periodo. Niente etichette, niente aiutanti esterni, niente cliché.`;
  }
  return en
    ? `Format: 8–10 concise lines. One speaker. Visual, candid, current. Second person only. Weave costs/signals/moves naturally (no labels, no clichés, no external helpers).`
    : `Formato: 8–10 righe concise. Voce unica. Visivo, sincero, attuale. Solo seconda persona. Intreccia costi/segnali/mosse senza etichette, senza cliché, senza personaggi esterni.`;
}

/* ============== Build user content ============== */
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

  // Obiettivo predittivo senza etichette
  L.push(
    en
      ? `PREDICTIVE GOAL:
- PAST → counterfactual vignette as if it happened: fold in a small realistic cost and a natural sign it worked — without naming them.
- FUTURE → near-future fork: suggest a tiny move (call/email/hour) and a sign to watch — woven into the scene.
- Keep details small and timeless. No external helpers unless present in the user's prompt.`
      : `OBIETTIVO PREDITTIVO:
- PASSATO → vignetta come se fosse accaduta: intreccia un piccolo costo realistico e un segno naturale — senza nominarli.
- FUTURO → biforcazione di prossimo futuro: suggerisci una micro-mossa (chiamata/email/ora) e un segno da osservare — dentro la scena.
- Dettagli piccoli e senza tempo. Nessun aiutante esterno se non citato dall’utente.`
  );

  return L.join("\n\n");
}

/* ============== Clarify (2–3 domande) ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `Generate 2–3 short, focused clarifying questions (one line each). Return ONLY a JSON array of {"id","label","placeholder"}.`
    : `Genera 2–3 domande brevi e mirate (una riga). Restituisci SOLO un array JSON di {"id","label","placeholder"}.`;
  const period = en
    ? `PERIOD-AWARE:
- If TIMEFRAME="past": ask about pivot year/event, place/context, key sign.
- If TIMEFRAME="future": ask about decision window, personal sign, concrete limit/resource.`
    : `Consapevole del PERIODO:
- PERIODO="past": chiedi anno/evento di svolta, luogo/contesto, segno chiave.
- PERIODO="future": chiedi finestra decisionale, segno personale, limite/risorsa concreta.`;
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
    qs.push({ id: "then_context", label: en ? "Where/what context back then?" : "Dove e quale contesto allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" });
    qs.push({ id: "key_sign", label: en ? "One sign it worked?" : "Un segno che funzionava?", placeholder: en ? "person/number/result" : "persona/numero/risultato" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Vera finestra decisionale?", placeholder: en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi" });
    qs.push({ id: "personal_sign", label: en ? "Personal sign you'd watch?" : "Segno personale che guarderesti?", placeholder: en ? "sleep/energy/first reply" : "sonno/energia/prima risposta" });
    qs.push({ id: "concrete_limit", label: en ? "Most concrete limit?" : "Limite più concreto?", placeholder: en ? "budget/time/energy" : "budget/tempo/energia" });
  }
  return qs.slice(0, 3);
}

/* ===================== Helpers ===================== */
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

/* ================== HTTP handler ================== */
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
      clarify = false,
      stream = false,
      profilo = {},
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
          temperature: 0.6,
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
        res.setHeader("X-Whatif-Clarify", JSON.stringify({ date: new Date().toISOString().slice(0,10), used: questions.length }));
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
          : "Questo è il FINALE: chiudi davvero (niente cliffhanger). Una riga che invita a un nuovo 'e se'.")
      : (isEn(lang)
          ? `Mid-episode: end with a subtle personal hook tied to ${profilo?.city_now || profilo?.city || "their city"} or ${profilo?.work_role || profilo?.role || "their role"}.`
          : `Episodio intermedio: chiudi con un gancio personale legato a ${profilo?.city_now || profilo?.city || "la tua città"} o ${profilo?.work_role || profilo?.role || "il tuo ruolo"}.`);

    const fewshots = getFewShots(stile, lang);
    const mirror = makeMirrorLine({ profilo, lang });
    const closing = pickClosing({ lang, stile });

    const baseMessages = [
      { role: "system", content: sys1 },
      ...fewshots,
      { role: "system", content: isEn(lang)
          ? `Open with one short personal mirror (paraphrase): "${mirror}". No external helpers.`
          : `Apri con una breve riga di specchio personale (parafrasa): "${mirror}". Niente personaggi esterni.` },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      { role: "system", content: isEn(lang)
          ? `Close with a varied episodic invite: "${closing}" (change wording each time).`
          : `Chiudi con un invito episodico variato: "${closing}" (cambia formulazione ogni volta).` },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.97 : 0.74;

    // Streaming SSE
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      const s = await client.chat.completions.create({
        model: MODEL_TEXT, messages: baseMessages, temperature, max_tokens: 700, stream: true,
      });
      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // Non-stream: 1) draft  2) optional rewrite if banned
    const draft = await client.chat.completions.create({
      model: MODEL_TEXT, messages: baseMessages, temperature, max_tokens: 700,
    });
    let text = draft.choices?.[0]?.message?.content?.trim() || "";

    if (containsBanned(text, lang)) {
      const list = isEn(lang) ? BAN_EN.join(", ") : BAN_IT.join(", ");
      const sysFix = isEn(lang)
        ? `Rewrite the following answer in the SAME style and length, but remove and replace any cliché or banned token. Keep second person, no external helpers, no labels. BANNED: ${list}`
        : `R riscrivi la risposta MANTENENDO stile e lunghezza, ma sostituisci ogni cliché o parola vietata. Solo seconda persona, nessun personaggio esterno, niente etichette. VIETATE: ${list}`;
      const fix = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature: Math.max(0.5, temperature - 0.2),
        messages: [
          { role: "system", content: sysFix },
          { role: "user", content: text }
        ],
        max_tokens: 700,
      });
      text = fix.choices?.[0]?.message?.content?.trim() || text;
    }

    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err?.message || err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res.status(500).json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
