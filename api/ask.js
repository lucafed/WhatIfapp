// /api/ask.js
import OpenAI from "openai";

/* ============== Setup ============== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ============== Utils: profilo + stagione/ora ============== */
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
function safeNow(nowIso, tz) {
  const d = nowIso ? new Date(nowIso) : new Date();
  const w_en = d.toLocaleDateString("en-GB", { weekday: "long" });
  const w_it = d.toLocaleDateString("it-IT", { weekday: "long" });
  const date_it = d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
  const date_en = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const month = d.getMonth() + 1;
  const season_it = ["inverno","inverno","primavera","primavera","primavera","estate","estate","estate","autunno","autunno","autunno","inverno"][(month-1)%12];
  const season_en = ["winter","winter","spring","spring","spring","summer","summer","summer","autumn","autumn","autumn","winter"][(month-1)%12];
  const month_it = d.toLocaleDateString("it-IT", { month: "long" });
  const month_en = d.toLocaleDateString("en-GB", { month: "long" });
  return { time24: `${hh}:${mm}`, weekday_en: w_en, weekday_it: w_it, date_it, date_en, season_it, season_en, month_it, month_en, tz: tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
}

/* ============== Mirror & closing ============== */
function makeMirrorLine({ profilo = {}, lang = "it" }) {
  const it = !isEn(lang);
  const who = (profilo?.name ? profilo.name.split(" ")[0] : "").trim();
  const city = profilo?.city_now || profilo?.city || "";
  const role = profilo?.work_role || profilo?.role || "";
  const goal = Array.isArray(profilo?.goals) && profilo.goals[0] ? profilo.goals[0] : (profilo?.goal || "");
  const values = (Array.isArray(profilo?.values) ? profilo.values.slice(0, 2) : []).filter(Boolean);
  const pool_it = [
    who ? `${who}, quando cambi rotta non cerchi rumore: cerchi coerenza.` : `Non cambi rotta per rumore: cerchi coerenza.`,
    city ? `${city} ti fa da base, ma ogni tanto vuoi aria larga.` : `Ti serve una base solida e uno spiraglio aperto.`,
    role ? `Nel lavoro (${role}) reggi finché il “perché” resta acceso.` : `Reggi bene finché il “perché” resta acceso.`,
    goal ? `In testa hai chiaro questo: ${goal}. Il resto deve allinearsi.` : `Hai un faro chiaro in testa. Il resto segue.`,
    values.length ? `Quando rispetti ${values.join(" e ")}, ti si raddrizza il passo.` : `Quando ti senti rispettato, ti si raddrizza il passo.`,
  ];
  const pool_en = [
    who ? `${who}, you don’t move for noise — you move for coherence.` : `You don’t move for noise — you move for coherence.`,
    city ? `${city} grounds you, but you still need open air.` : `You like one steady base and one open window.`,
    role ? `In (${role}) you keep pace while the “why” stays lit.` : `You keep pace while the “why” stays lit.`,
    goal ? `Top of mind: ${goal}. Everything else aligns around it.` : `You carry one clear north. Everything else aligns.`,
    values.length ? `When ${values.join(" and ")} are honored, your stride clicks.` : `When you feel honored, your stride clicks.`,
  ];
  const pool = it ? pool_it : pool_en;
  return pool[Math.floor(Math.random() * pool.length)];
}
function pickClosing({ lang = "it", stile = "whatif" }) {
  const it = !isEn(lang);
  const soft_it = [
    `Domani continuiamo: due micro-domande e vediamo dove porta.`,
    `Se torni domani, aggiungo due dettagli e la storia va avanti.`,
    `Quando vuoi, riprendiamo: due appigli rapidi e si prosegue.`,
  ];
  const sharp_it = [
    `Stop qui. Domani due colpi secchi e si riparte.`,
    `Chiudi il conto: domani due prompt veloci e saliamo di livello.`,
    `Segnalibro messo: domani due spinte e avanti.`,
  ];
  const soft_en = [
    `Come back tomorrow: two micro-questions and we move.`,
    `Return tomorrow — two small details and the thread continues.`,
    `We pause here. Tomorrow two tiny prompts and forward.`,
  ];
  const sharp_en = [
    `Cut here. Tomorrow two clean shots and go.`,
    `Tab closed: tomorrow two quick cues and we level up.`,
    `Bookmark it. Tomorrow two nudges and onward.`,
  ];
  if (it) return (stile === "wtf" ? sharp_it : soft_it)[Math.floor(Math.random()*((stile==="wtf"?sharp_it:soft_it).length))];
  return (stile === "wtf" ? sharp_en : soft_en)[Math.floor(Math.random()*((stile==="wtf"?sharp_en:soft_en).length))];
}

/* ============== Persona prompts (forti, con anti-pattern) ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz }) {
  const en = isEn(lang);
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);
  const now = safeNow(nowIso, tz);

  const epHint = en
    ? (finale ? `FINALE: give real closure (no cliffhanger). One memorable last line inviting a new thread.` 
              : `MID-EPISODE: end with a subtle personal hook (no paywall mention).`)
    : (finale ? `FINALE: chiudi davvero (niente cliffhanger). Ultima riga memorabile con invito a un nuovo filo.`
              : `EPISODIO INTERMEDIO: chiusura con gancio personale e sottile (senza paywall).`);

  const antipattern_en = `HARD BANS:
- Do NOT use words: "constraint", "trade-off", "indicator", "first step", "imagine", "call a friend", "write an email".
- Never say "I". Second person only. No moralizing.`;
  const antipattern_it = `DIVIETI:
- NON usare: "vincolo", "trade-off", "indicatore", "primo passo", "immagina", "chiama un amico", "scrivi una mail".
- Mai "io". Solo seconda persona. Niente moralismi.`;

  if (stile === "wtf") {
    return en
      ? `You are "What the F": witty late-night bartender — brilliant, a bit tipsy, never cruel.
Speak as ONE voice in 8–10 short punchy lines (≤15 words). Bar rhythm. Near-future for FUTURE; counterfactual for PAST.
Personalize subtly with ${cityNow}, ${workRole}. ${antipattern_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint}`
      : `Sei "What the F": barista nottambulo — brillante, un po’ brillo, mai cattivo.
Una sola voce in 8–10 righe corte (≤15 parole). Ritmo da bancone. Futuro vicino per FUTURO; controfattuale per PASSATO.
Personalizza in modo implicito con ${cityNow}, ${workRole}. ${antipattern_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint}`;
  }

  return en
    ? `You are "What?f": lucid, warm, predictive friend — like a sharp fortune-teller.
One calm voice, 8–10 vivid lines. Second person only.
Show small realistic costs, inner signs, plausible scenes — but NEVER label them. Personalize with ${cityNow}, ${workRole}.
${antipattern_en}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint}`
    : `Sei "What?f": amica lucida e calda — una zingara che azzecca il sottotesto.
Una sola voce, 8–10 righe visive. Solo seconda persona.
Mostra piccoli costi, segnali interiori, scene plausibili — ma NON etichettarli. Personalizza con ${cityNow}, ${workRole}.
${antipattern_it}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint}`;
}

/* ============== Few-shots (IT/EN) curati ============== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  // WHAT THE F — bar rhythm
  if (style === "wtf") {
    return it ? [
      { role: "system", content:
`WTF_IT_A
DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Rientri e tre favori ti attendono alla porta.
Cuore su, calendario giù: pacchetto rientro.
Stai dove ti vogliono, ma scegli tu i confini.
Se il lunedì è leggero, è casa.
Se pesa, è museo con audio-guida.
Fatti un giro corto; ascolta il passo.
Se sorrido io, ok. Se no, cambiamo bar.
Chiudi qui. Domani due colpi secchi e via.` },
      { role: "system", content:
`WTF_IT_B
DOMANDA: "E se comprassi la moto a marzo?"
RISPOSTA:
La prendi e balli sui rattoppi di Bussolengo.
Adrenalina su, assicurazione ti guarda storto.
Cuffie? No. Casco, e cervello acceso.
Se torni col sorriso, hai già capito.
Se torni a bestemmiare, vendi l’idea, non la moto.
Stappa acqua: domani due prompt veloci e ripensiamo.` },
    ] : [
      { role: "system", content:
`WTF_EN_A
QUESTION: "What if I moved back home?"
ANSWER:
You walk in; three favors walk with you.
Heart up, calendar down — return bundle.
Stay where you’re wanted, on your terms.
If Monday feels light, that’s home.
If heavy, it’s a museum with echoes.
Take a short loop, listen to your stride.
If the bartender smiles, you’re fine.
Cut here. Tomorrow two clean shots and go.` },
      { role: "system", content:
`WTF_EN_B
QUESTION: "What if I bought the bike in March?"
ANSWER:
You’ll dance over potholes and grin.
Adrenaline up, insurance staring back.
Helmet on, brain online.
If you return smiling, message received.
If you return swearing, sell the idea, not the bike.
Pause. Tomorrow two quick prompts and rethink.` },
    ];
  }

  // WHAT?f — mirror + predictive, no labels
  return it ? [
    { role: "system", content:
`WHATIF_IT_A
DOMANDA: "E se cambiassi lavoro?"
RISPOSTA:
Ti muovi quando il perché si accende, non per capriccio.
Il primo mese scegli poche conversazioni buone.
Una sera il corpo si rilassa prima della testa.
Le email diventano corte, chiare.
Se due volti nuovi ti danno energia, sei in rotta.
Quando raddrizzi la schiena senza pensarci, è un sì che cresce.
Domani due dettagli e la trama continua.` },
    { role: "system", content:
`WHATIF_IT_B
DOMANDA: "E se tornassi all’Aquila tra 3–6 mesi?"
RISPOSTA:
${"${city}"} resta base, non gabbia.
Provi settimane gemelle: stessi giorni, stessi volti.
La sera senti più aria, il telefono chiede meno.
Se aumentano gli inviti scelti da te, va bene così.
Sorriso basso sulla via di casa: la scelta prende forma.
Domani due micro-domande e andiamo più a fuoco.` },
  ] : [
    { role: "system", content:
`WHATIF_EN_A
QUESTION: "What if I changed jobs?"
ANSWER:
You move when the why lights up, not for noise.
Month one: fewer, better conversations.
One evening the body relaxes first.
Emails turn short, tidy.
If two new faces give energy, you’re aligned.
When posture lifts by itself, a yes is forming.
Tomorrow two tiny details and we go on.` },
    { role: "system", content:
`WHATIF_EN_B
QUESTION: "What if I moved back in 3–6 months?"
ANSWER:
${"${city}"} stays raft, not cage.
Test twin weeks: same days, same people.
Evenings get lighter; phone quiets down.
If chosen invitations grow, direction’s right.
Soft smile on the way home: choice forming.
Tomorrow two micro-questions and we sharpen it.` },
  ];
}

/* ============== Costruzione contenuti user ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Punchy, playful, never cruel. Second person only. Respect timeframe. NEVER use the banned words.`
      : `Formato: 8–10 righe corte. Voce unica. Punchy, giocoso, mai crudele. Solo seconda persona. Rispetta il periodo. Mai parole vietate.`;
  }
  return en
    ? `Format: 8–10 concise lines. One speaker. Visual, candid, current. Show costs/signs/next moves without labels. Second person only.`
    : `Formato: 8–10 righe concise. Una voce. Visivo, sincero, attuale. Mostra costi/segnali/mosse senza etichette. Solo seconda persona.`;
}
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz }) {
  const en = isEn(lang);
  const L = [];
  const now = safeNow(nowIso, tz);
  L.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  L.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  L.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);
  L.push(en
    ? `NOW: weekday=${now.weekday_en}; season=${now.season_en}; month=${now.month_en}; local_time≈${now.time24};`
    : `ADESSO: giorno=${now.weekday_it}; stagione=${now.season_it}; mese=${now.month_it}; ora≈${now.time24};`);
  const digest = renderProfileDigest(profilo);
  if (digest) L.push(en ? `PROFILE DIGEST: ${digest}` : `SINTESI PROFILO: ${digest}`);
  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }
  L.push(en
    ? `PREDICTIVE OBJECTIVE:
- PAST → counterfactual vignette that *feel lived*. Include one small cost and one sign it worked, but do NOT label them.
- FUTURE → near-future fork. Suggest one tiny move and one inner/outer sign to watch, woven naturally.`
    : `OBIETTIVO PREDITTIVO:
- PASSATO → vignetta controfattuale “vissuta”. Un piccolo costo e un segno che funzionava, ma senza etichette.
- FUTURO → biforcazione di prossimo futuro. Una micro-mossa e un segno da osservare, intrecciati nel racconto.`);
  return L.join("\n\n");
}

/* ============== Clarify (2–3 domande) ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  return en
    ? `Generate 2–3 focused clarifying questions (one line each). Return ONLY a JSON array of {"id","label","placeholder"}.`
    : `Genera 2–3 domande di chiarimento, mirate e in una riga. Restituisci SOLO un array JSON di {"id","label","placeholder"}.`;
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
function localClarify(domanda = "", _profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  if (periodo === "past") {
    return [
      { id: "pivot_year", label: en ? "Turning point year/event?" : "Anno/evento di svolta?", placeholder: en ? "e.g., 2018 move" : "es. trasferimento 2018" },
      { id: "then_place", label: en ? "Where and who mattered then?" : "Dove e chi contava allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" },
      { id: "one_sign", label: en ? "One sign it worked?" : "Un segno che funzionava?", placeholder: en ? "result/reply/feeling" : "risultato/risposta/sensazione" },
    ];
  }
  return [
    { id: "time_window", label: en ? "Real decision window?" : "Vera finestra decisionale?", placeholder: en ? "this month / 3–6 months" : "questo mese / 3–6 mesi" },
    { id: "feel_sign", label: en ? "Personal sign you’d watch?" : "Segno personale da osservare?", placeholder: en ? "sleep/energy/first reply" : "sonno/energia/prima risposta" },
    { id: "limit", label: en ? "Most concrete limit?" : "Limite più concreto?", placeholder: en ? "budget/time/energy" : "budget/tempo/energia" },
  ];
}

/* ============== Polish pass (riscrittura anti-cliché) ============== */
function sanitizeInputForModel(text) { return String(text || ""); }

function needsPolish(text) {
  return /\b(immagina|chiama|telefonata|scrivi (una )?mail|indicatore|vincolo|trade[- ]?off|primo passo)\b/i.test(text);
}

async function polishOutput({ text, lang = "it", stile = "whatif" }) {
  const en = isEn(lang);
  // Heuristic rewrite prompt: remove banned & keep tone.
  const sys = en ? 
`Rewrite with the same meaning and tone (${stile} persona), but:
- remove clichés and banned words: "imagine/call a friend/email/indicator/constraint/trade-off/first step"
- keep second person only
- show ideas, don't label them
- for WTF: 8–10 short lines (≤15 words), bar rhythm`
:
`R riscrivi con stesso senso e tono (${stile}), ma:
- elimina cliché e parole vietate: "immagina/chiama/scrivi una mail/indicatore/vincolo/trade-off/primo passo"
- solo seconda persona
- mostra i concetti, non etichettarli
- se WTF: 8–10 righe corte (≤15 parole), ritmo da bancone`;
  const usr = en ? `TEXT:\n${text}` : `TESTO:\n${text}`;
  const resp = await client.chat.completions.create({
    model: MODEL_TEXT,
    temperature: 0.4,
    messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
    max_tokens: 700,
  });
  return resp.choices?.[0]?.message?.content?.trim() || text;
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
      stile = "whatif",    // "whatif" | "wtf"
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

    /* ------ Clarify branch ------ */
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
        const start = raw.indexOf("["); const end = raw.lastIndexOf("]");
        if (start >= 0 && end > start) questions = JSON.parse(raw.slice(start, end+1));
      } catch {}
      if (!Array.isArray(questions) || questions.length === 0) {
        questions = localClarify(domanda, profilo, lang, periodo);
      }
      questions = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i+1}`),
        label: String(q.label || q?.text || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));
      return res.status(200).json({ questions });
    }

    /* ------ Generation branch ------ */
    const sys1 = systemPrompt({ stile, lang, profile: profilo, nowIso, tz });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz });
    const sys2 = responseStyleInstruction(lang, stile);

    const fewshots = getFewShots(stile, lang);
    const mirror = makeMirrorLine({ profilo, lang });
    const closing = pickClosing({ lang, stile });

    const messages = [
      { role: "system", content: sys1 },
      ...fewshots,
      { role: "system", content: isEn(lang)
          ? `Open with a short mirror line (paraphrase naturally): "${mirror}"`
          : `Apri con una breve riga di specchio (parafrasa): "${mirror}"` },
      { role: "user", content: sanitizeInputForModel(user) },
      { role: "system", content: sys2 },
      { role: "system", content: isEn(lang)
          ? `Close with a natural episodic line like: "${closing}" — vary phrasing.`
          : `Chiudi con una riga episodica tipo: "${closing}" — varia la frase.` },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.95 : 0.82;
    const base = await client.chat.completions.create({
      model: MODEL_TEXT,
      messages,
      temperature,
      presence_penalty: 0.3,   // meno ripetizioni
      max_tokens: 700,
    });
    let text = base.choices?.[0]?.message?.content?.trim() || "";

    // Polish pass se compaiono parole/strutture vietate
    if (needsPolish(text)) {
      text = await polishOutput({ text, lang, stile });
    }

    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res.status(500).json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
