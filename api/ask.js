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
  if (p.goal && !parts.find(x=>x.startsWith("obiettivi:"))) parts.push(`obiettivo: ${p.goal}`);
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
    Object.entries(p.micro).forEach(([k,v])=>{
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
  const values = (Array.isArray(profilo?.values) ? profilo.values.slice(0,2) : []).filter(Boolean);

  const itPool = [
    who ? `${who}, non ti muovi per capriccio: ti accendi quando ha senso.` : `Tu non ti muovi per capriccio: ti accendi quando ha senso.`,
    city ? `${city} ti dà base, ma vuoi una finestra aperta.` : `Ti piace avere una base solida e una finestra aperta.`,
    role ? `Nel lavoro (${role}) reggi finché il “perché” resta acceso.` : `Reggi finché il “perché” resta acceso.`,
    goal ? `In testa tieni questo faro: ${goal}. Il resto deve allinearsi.` : `Hai un faro in testa: il resto deve allinearsi.`,
    values.length ? `Quando rispetti ${values.join(" e ")}, il passo diventa naturale.` : `Quando ti senti rispettato, il passo diventa naturale.`,
    `Non cerchi drammi: ascolti segnali puliti. E oggi ne senti uno.`
  ];
  const enPool = [
    who ? `${who}, you don’t move on whims — you move for meaning.` : `You don’t move on whims — you move for meaning.`,
    city ? `${city} grounds you, but you still need an open window.` : `You like a solid base and one open window.`,
    role ? `In ${role} you keep pace while the “why” stays lit.` : `You keep pace while the “why” stays lit.`,
    goal ? `There’s a clear beacon: ${goal}. Everything else must align.` : `There’s a clear beacon. Everything else must align.`,
    values.length ? `When you honor ${values.join(" and ")}, your stride clicks.` : `When you feel respected, your stride clicks.`,
    `You don’t chase drama; you listen for clean signals. You’re hearing one now.`
  ];
  const pool = it ? itPool : enPool;
  return pool[Math.floor(Math.random()*pool.length)];
}
function pickClosing({ lang = "it", stile = "whatif" }) {
  const it = !isEn(lang);
  const softIT = [
    `Domani passo breve: due micro-domande furbe e andiamo più a fondo.`,
    `Quando vuoi continuiamo: due dettagli in più e la storia prosegue pulita.`,
    `Se torni domani, ho due spunti tagliati su di te.`,
    `Metto il segnalibro: domani due cue rapidi e riprendiamo.`
  ];
  const sharpIT = [
    `Stop qui. Domani due colpi secchi e si riparte.`,
    `Ok, chiudo il bancone: domani due domande veloci e alziamo il livello.`,
    `Fumo via l’ultima: domani due spunti precisi e muoviamo le cose.`,
    `Segno sul tovagliolo: domani due frecce dritte e via.`
  ];
  const softEN = [
    `Come back tomorrow: two tiny questions and we go deeper.`,
    `Bookmark set — tomorrow two smart cues and we continue clean.`,
    `If you return, I’ll bring two tailored prompts.`,
    `Pause here; tomorrow two quick nudges and the thread lives on.`
  ];
  const sharpEN = [
    `Bar’s closing. Tomorrow two clean shots and we move.`,
    `Cut here. Two quick prompts tomorrow — then action.`,
    `Last sip. Tomorrow two straight arrows; we level up.`,
    `Chalk mark on the counter: two cues tomorrow and go.`
  ];
  if (it) return (stile === "wtf" ? sharpIT : softIT)[Math.floor(Math.random()*4)];
  return (stile === "wtf" ? sharpEN : softEN)[Math.floor(Math.random()*4)];
}

/* ============== Persona prompts (anti-cliché) ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz }) {
  const en = isEn(lang);
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);
  const now = safeNow(nowIso, tz);

  const epHint = en
    ? (finale
        ? `FINALE: give real closure (no cliffhanger). One memorable line inviting a new thread.`
        : `MID-EPISODE: close with a soft personal hook (no paywall mention).`)
    : (finale
        ? `FINALE: chiudi davvero (niente cliffhanger). Una riga memorabile che invita a un nuovo filo.`
        : `EPISODIO INTERMEDIO: chiudi con un gancio personale e sottile (senza paywall).`);

  const ban = en
    ? `Do NOT use literal labels like "constraint", "trade-off", "indicator", "first step".
Show them implicitly in the scene. Never use "I". Second person only.`
    : `NON usare etichette letterali tipo "vincolo", "trade-off", "indicatore", "primo passo".
Mostra quei concetti nella scena. Mai "io". Solo seconda persona.`;

  if (stile === "wtf") {
    return en
      ? `You are "What the F": witty late-night bartender — funny, sharp, never cruel.
One speaker. 8–10 short lines. Bar-rhythm. Near-future for FUTURE; counterfactual for PAST.
Personalize implicitly with ${cityNow}, ${workRole}. ${ban}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint}`
      : `Sei "What the F": barista nottambulo — brillante, pungente, mai cattivo.
Voce unica. 8–10 righe brevi, ritmo da bancone. Futuro vicino per FUTURO; controfattuale per PASSATO.
Personalizza in modo implicito con ${cityNow}, ${workRole}. ${ban}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint}`;
  }

  return en
    ? `You are "What?f": lucid, warm, predictive friend (mystic vibe, no fluff).
One speaker. 8–10 vivid, concise lines. Second person only.
Real timings, tiny realistic costs, inner signals, plausible scenes.
Personalize implicitly with ${cityNow}, ${workRole}. ${ban}
Today is ${now.weekday_en}, ${now.date_en}. Season ${now.season_en}. Local time ~${now.time24}.
${epHint}`
    : `Sei "What?f": amico lucido, caldo, predittivo (zingara lucida, zero zucchero).
Voce unica. 8–10 righe vivide e concise. Solo seconda persona.
Tempi reali, piccoli costi realistici, segnali interiori, scene plausibili.
Personalizza in modo implicito con ${cityNow}, ${workRole}. ${ban}
Oggi è ${now.weekday_it}, ${now.date_it}. Stagione ${now.season_it}. Ora ~${now.time24}.
${epHint}`;
}

/* ============== Few-shot (IT/EN) ============== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  if (style === "wtf") {
    return it
      ? [
          { role: "system", content:
`WTF_IT_1
DOMANDA: "Se avessi vinto 1.000.000?"
RISPOSTA:
Un milione? Ottimo: errori premium sbloccati.
Attico? Bellissimo. Anche l’amministratore.
Non comprare trofei: compra respiro.
Se dormi meglio e litighi meno, stai vincendo.
Garage pieno < cuore quieto.
Brindiamo con testa, non con scontrini.
Domani passo al bancone: due colpi secchi e via.` },
          { role: "system", content:
`WTF_IT_2
DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Rientri e arrivano anche i favori.
Cuore su, agenda giù: pacchetto rientro.
Resta dove ti vogliono, ma coi tuoi orari.
Se il lunedì è leggero è casa; se pesa è museo.
Fai un giro corto e ascolta il passo.
Stop qui. Domani due frecce dritte.` },
        ]
      : [
          { role: "system", content:
`WTF_EN_1
QUESTION: "What if I won €1,000,000?"
ANSWER:
A million? Nice — premium mistakes unlocked.
Penthouse? Gorgeous. So is maintenance.
Don’t buy trophies; buy breathing room.
Sleep deeper, argue less — that’s winning.
Full garage < quiet heart.
We toast with sense, not receipts.
Tomorrow: two clean shots and we go.` },
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
Primo mese: poche conversazioni buone.
Una sera ti sorprendi sereno: il corpo lo sa prima della testa.
L’onda giusta sta nelle email corte e chiare.
Se due volti nuovi ti danno energia, sei allineato.
Tienila qui. Domani due dettagli e continuiamo.` },
        { role: "system", content:
`WHATIF_IT_2
DOMANDA: "E se tornassi all’Aquila tra 3–6 mesi?"
RISPOSTA:
Ti piace avere una base: ${"${city}"} resta zattera, non gabbia.
Provi settimane gemelle: stessi giorni, stesse facce.
La sera il passo è più leggero, il telefono meno urgente.
Se aumentano gli inviti scelti da te, stai andando bene.
Quando sorridi piano sulla via di casa, la scelta prende forma.
Chiudo qui. Domani due note veloci e si va avanti.` },
      ]
    : [
        { role: "system", content:
`WHATIF_EN_1
QUESTION: "What if I changed jobs?"
ANSWER:
You don’t jump on whims — you move when the why lights up.
Month one: fewer, better conversations.
One evening you’re calm; the body nods first.
The right wave shows in tidy, short emails.
If two new faces give you energy, you’re on line.
Hold here. Tomorrow two tiny details and we continue.` },
      ];
}

/* ============== Istruzioni di stile (compatte) ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines, one speaker, punchy bar rhythm. Bold sarcasm, playful, never cruel. Second person only. Respect timeframe. Do NOT use labels (constraint/trade-off/indicator/first step).`
      : `Formato: 8–10 righe brevi, voce unica, ritmo da bancone. Sarcasmo brillante, mai cattivo. Solo seconda persona. Rispetta il periodo. Vietate etichette (vincolo/trade-off/indicatore/primo passo).`;
  }
  return en
    ? `Format: 8–10 concise lines, one speaker, vivid and current. Second person only. Weave costs, signals and next moves naturally, without naming them. Respect timeframe.`
    : `Formato: 8–10 righe concise, voce unica, visivo e attuale. Solo seconda persona. Intreccia costi, segnali e mosse prossime senza nominarle. Rispetta il periodo.`;
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
- PAST: counterfactual vignette as if it happened; include one tiny plausible cost and one inner/outer sign — but never label them.
- FUTURE: near-future fork if they choose now; suggest a tiny move (call/email/hour) and a natural sign to watch — woven in narrative.
- Keep details small and timeless.`
      : `OBIETTIVO PREDITTIVO:
- PASSATO: vignetta controfattuale come se fosse accaduta; inserisci un piccolo costo plausibile e un segnale — ma senza etichette.
- FUTURO: biforcazione di prossimo futuro se sceglie ora; suggerisci una micro-mossa (chiamata/email/ora) e un segnale naturale da osservare — intrecciati nel racconto.
- Dettagli piccoli e senza tempo.`
  );

  return L.join("\n\n");
}

/* ============== Clarify (domande mirate) ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You generate 2–3 short, focused clarifying questions (one line each) to better answer the user's main question. Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Generi 2–3 domande brevi e mirate (una riga) per rispondere meglio. Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;
  const period = en
    ? `You are PERIOD-AWARE:
- If TIMEFRAME="past": ask about pivot year/event, place/context back then, key sign.
- If TIMEFRAME="future": ask about decision window, personal sign of progress, concrete limit/resource.`
    : `Consapevole del PERIODO:
- PERIODO "past": chiedi anno/evento di svolta, luogo/contesto di allora, segno chiave.
- PERIODO "future": chiedi finestra decisionale, segno personale di progresso, limite/risorsa concreta.`;
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
  const weekday_en = d.toLocaleDateString("en-GB", { weekday: "long" });
  const weekday_it = d.toLocaleDateString("it-IT", { weekday: "long" });
  const date_it = d.toLocaleDateString("it-IT", { day:"2-digit", month:"2-digit", year:"numeric" });
  const date_en = d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  const month = d.getMonth() + 1;
  const season_it = seasonForMonth(month, "it");
  const season_en = seasonForMonth(month, "en");
  const month_it = d.toLocaleDateString("it-IT", { month:"long" });
  const month_en = d.toLocaleDateString("en-GB", { month:"long" });
  return {
    time24: `${hh}:${mm}`,
    weekday_en, weekday_it, date_it, date_en,
    season_it, season_en, month_it, month_en,
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
      periodo = "future",          // "past" | "future"
      stile = "whatif",            // "whatif" | "wtf"
      clarify = false,             // true => genera 2–3 domande
      stream = false,              // true => text/event-stream
      profilo = {},                // { ... , story_state:{ episode, max_episodes } }
      clarifications = {},         // risposte ai chiarimenti
      extra = "",                  // input extra opzionale
      now: nowIso,                 // opzionale
      tz,                          // opzionale
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
          model: MODEL_TEXT, temperature: 0.6,
          messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        });
        const raw = resp.choices?.[0]?.message?.content?.trim() || "[]";
        const start = raw.indexOf("["); const end = raw.lastIndexOf("]");
        if (start >= 0 && end > start) questions = JSON.parse(raw.slice(start, end + 1));
      } catch {}
      if (!Array.isArray(questions) || questions.length === 0) {
        questions = localClarify(domanda, profilo, lang, periodo);
      }
      questions = questions.slice(0,3).map((q,i)=>({
        id: String(q.id || `q${i+1}`),
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
          ? "This is the FINALE: deliver closure (no cliffhanger). Invite to start a new 'what if'."
          : "Questo è il FINALE: chiudi davvero (niente cliffhanger). Invita a iniziare un nuovo 'e se'.")
      : (isEn(lang)
          ? "Mid-episode: end with a soft hook linked to their city or role."
          : "Episodio intermedio: chiudi con un gancio morbido legato a città o ruolo.");
    const fewshots = getFewShots(stile, lang);
    const mirror = makeMirrorLine({ profilo, lang });
    const closing = pickClosing({ lang, stile });

    const messages = [
      { role: "system", content: sys1 },
      ...fewshots,
      { role: "system", content: isEn(lang)
          ? `Open with one short mirror line (paraphrase naturally, don't copy): "${mirror}"`
          : `Apri con una breve riga di specchio (parafrasa, non copiare): "${mirror}"` },
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      { role: "system", content: isEn(lang)
          ? `Close with a natural episodic line like: "${closing}" (vary wording).`
          : `Chiudi con una riga episodica tipo: "${closing}" (varia il testo).` },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.97 : 0.82;

    // --- Streaming SSE affidabile ---
    const wantStream = String(req.headers["x-whatif-stream"] || "").length > 0 || !!stream;
    if (wantStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT, messages, temperature, max_tokens: 700, stream: true,
      });

      try {
        for await (const chunk of s) {
          const delta = chunk.choices?.[0]?.delta?.content || "";
          if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      } catch (e) {
        res.write(`data: ${JSON.stringify({ error: "stream_error", detail: e?.message || "unknown" })}\n\n`);
      }
      return res.end();
    }

    // --- Non-stream (fallback/test) ---
    const c = await client.chat.completions.create({
      model: MODEL_TEXT, messages, temperature, max_tokens: 700,
    });
    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res.status(500).json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
