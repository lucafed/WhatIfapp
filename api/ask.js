// /api/ask.js
import OpenAI from "openai";

/**
 * Serverless handler per What?f
 * ENV richieste: OPENAI_API_KEY
 * Facoltativo: WHATIF_MODEL
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.WHATIF_MODEL || "gpt-4o-mini";

// ---------- Lang helpers ----------
const normLang = (lang) => (String(lang || "it").toLowerCase().startsWith("en") ? "en" : "it");
const isEn = (lang) => normLang(lang) === "en";
const STRICT_LANG = (lang) => (isEn(lang) ? "Write STRICTLY in English." : "Scrivi RIGOROSAMENTE in italiano.");

// ---------- Anti-repeat (soft) ----------
function buildAntiRepeatBlock(history = {}, lang = "it") {
  const L = isEn(lang);
  const { recent_topics = [], recent_people = [], recent_places = [], recent_styles = [] } = history || {};
  const list = (a) => (a && a.length ? a.join(", ") : "—");
  return L
    ? `NO-REPEAT:
- Avoid leaning again on topics [${list(recent_topics)}], people [${list(recent_people)}], places [${list(recent_places)}], motifs [${list(recent_styles)}].
- Use people/places/objects ONLY if naturally relevant this time.
- Vary the opening; avoid reusing the same motif >2 times.`
    : `ANTI-RIPETIZIONE:
- Evita di tornare su temi [${list(recent_topics)}], persone [${list(recent_people)}], luoghi [${list(recent_places)}], espedienti [${list(recent_styles)}].
- Usa persone/luoghi/oggetti SOLO se davvero rilevanti stavolta.
- Varia l’attacco; non riusare lo stesso motivo >2 volte.`;
}

// ---------- Persona strings ----------
function whoLine(p = {}, lang = "it") {
  const bits = [];
  if (p.name) bits.push(p.name);
  if (p.role) bits.push(p.role);
  if (p.city) bits.push(isEn(lang) ? `from ${p.city}` : `di ${p.city}`);
  return bits.length ? bits.join(", ") : isEn(lang) ? "a curious person" : "una persona curiosa";
}

// ---------- WHAT IF persona ----------
function systemPromptWhatIf(lang, profile) {
  const who = whoLine(profile, lang);
  return [
    STRICT_LANG(lang),
    isEn(lang)
      ? `You are "What if": warm, pragmatic, empathetic with a light ironic wink. Imagine a PLAUSIBLE alternate-life scene for ${who}, grounded in their signals. Be sensory, specific, cinematic but concise. Provide clear next steps only if helpful.`
      : `Sei “What if”: caldo, pragmatico, empatico con una leggera ironia. Immagina una scena di vita ALTERNATIVA PLAUSIBILE per ${who}, ancorata ai suoi segnali. Sii sensoriale, specifico, cinematografico ma conciso. Fornisci passi concreti solo se utile.`,
  ].join("\n");
}

function structureWhatIf(lang) {
  return isEn(lang)
    ? `Structure (use bold headings):
1) Prologue — mood (2–4 lines)
2) Alternate scene — tangible mini-sequence (6–10 lines)
3) Key choices — 2–3 decisions
4) Consequences — plausible outcomes
5) Reflection — 2–3 lines`
    : `Struttura (usa titoli in **grassetto**):
1) Prologo — tono (2–4 righe)
2) Scena alternativa — mini-sequenza tangibile (6–10 righe)
3) Scelte-chiave — 2–3 decisioni
4) Conseguenze — esiti plausibili
5) Riflessione — 2–3 righe`;
}

// ---------- WTF persona (barista filosofo, brillante, sarcastico) ----------
function systemPromptWTF(lang, profile) {
  const drinks = String(profile?.drinks_pref || "").toLowerCase() === "yes";
  const base = [
    STRICT_LANG(lang),
    isEn(lang)
      ? `You are "WTF": a late-night bartender-philosopher. Witty, sharp, joyfully sarcastic, never offensive. Playful cynicism, quick rhythm, clean punchlines.`
      : `Sei “WTF”: barista filosofo nottambulo. Arguto, affilato, gioiosamente sarcastico, mai offensivo. Cinismo giocoso, ritmo rapido, chiuse pulite.`,
    drinks
      ? isEn(lang)
        ? `Booze vibe: HIGH (delightfully tipsy). Looser syntax and playful bar imagery allowed; tasteful, no glorification of harm.`
        : `Vibe alcolica: ALTA (piacevolmente alticcio). Sintassi più sciolta e immagini da bancone; di gusto, senza glorificare comportamenti dannosi.`
      : isEn(lang)
      ? `Booze vibe: OFF (user doesn't drink/unknown). Keep it sharp, spicy, but sober.`
      : `Vibe alcolica: OFF (utente non beve/sconosciuto). Tagliente e speziato, ma sobrio.`,
    isEn(lang)
      ? `Length: compact (≈10–14 lines). If advice emerges, close with up to 3 crisp bullets.`
      : `Lunghezza: compatta (≈10–14 righe). Se emerge consiglio, chiudi con max 3 bullet incisivi.`,
  ];
  return base.join("\n");
}

// ---------- Timeline blocks ----------
function timelineBlock(periodo, lang, stile) {
  const L = isEn(lang);
  const isPast = String(periodo || "").toLowerCase() === "past";
  if (isPast) {
    return stile === "wtf"
      ? (L
          ? `COUNTERFACTUAL (PAST): Second person, past tense. Stage a vivid alternate timeline (fork → 2–3 consequences → witty philosophical aside).`
          : `CONTROFATTUALE (PASSATO): Seconda persona, tempi passati. Metti in scena una timeline vivida (bivio → 2–3 conseguenze → chiusa ironico-filosofica).`)
      : (L
          ? `COUNTERFACTUAL (PAST): Second person, past tense; concrete beats; gentle reflection.`
          : `CONTROFATTUALE (PASSATO): Seconda persona, tempi passati; battute concrete; riflessione gentile.`);
  }
  // Future
  return stile === "wtf"
    ? (L
        ? `PROSPECTIVE (FUTURE): Second person; present→near future. Concrete beats; smart sarcastic reflection at the end.`
        : `PROSPETTICO (FUTURO): Seconda persona; presente→prossimo futuro. Battute concrete; chiusa sarcastica e intelligente.`)
    : (L
        ? `PROSPECTIVE (FUTURE): Second person; tangible steps; gentle reflection.`
        : `PROSPETTICO (FUTURO): Seconda persona; passi tangibili; riflessione gentile.`);
}

// ---------- Motif governor: quando citare persone/luoghi/oggetti ----------
function tok(s){ return (s||"").toLowerCase(); }
function hasAny(text, arr){ const t=tok(text); return (arr||[]).some(x=>t.includes(String(x||"").toLowerCase())); }

function scoreSignals({ domanda, profile, clarifications }) {
  const q = tok(domanda);
  const p = profile || {};
  const micro = p.micro || {};
  const clar = clarifications || {};
  const cand = [];
  if (p.role) cand.push({ type:"person", key:"role", value:p.role });
  if (p.name) cand.push({ type:"person", key:"name", value:p.name });
  if (p.city) cand.push({ type:"place",  key:"city", value:p.city });
  if (micro.punto_riferimento) cand.push({ type:"place", key:"landmark", value: micro.punto_riferimento });
  if (micro.indicatore) cand.push({ type:"object", key:"indicator", value: micro.indicatore });

  for (const c of cand){
    let score = 0;
    if (hasAny(q, [c.value])) score += 2;
    if (hasAny(tok(p.goal), [c.value])) score += 2;
    if (hasAny(JSON.stringify(clar).toLowerCase(), [String(c.value).toLowerCase()])) score += 1;
    if (c.key === "role" || c.key === "city" || c.key === "landmark") score += 1;
    c.score = score;
  }
  return cand.sort((a,b)=>b.score-a.score);
}

function motifGovernor({ domanda, profilo, clarifications, history, dayCount = 1, lang = "it" }) {
  const ranked = scoreSignals({ domanda, profile: profilo, clarifications });
  const H = history || {};
  const usedPeople = new Set((H.recent_people || []).map(s=>s.toLowerCase()));
  const usedPlaces = new Set((H.recent_places || []).map(s=>s.toLowerCase()));

  ranked.forEach(c => {
    const v = String(c.value || "").toLowerCase();
    if (c.type === "person" && usedPeople.has(v)) c.score -= 1.5;
    if (c.type === "place"  && usedPlaces.has(v)) c.score -= 1.5;
  });

  const baseThreshold = dayCount >= 3 ? 3 : 2;
  const maxItems = dayCount >= 3 ? 1 : 2;

  const selected = [];
  for (const c of ranked) {
    if (selected.length >= maxItems) break;
    if (c.score >= baseThreshold) selected.push(c);
  }

  const L = isEn(lang);
  if (!selected.length) {
    return L
      ? `PERSONALIZATION: If a person/place/object isn't clearly relevant, keep it generic this time.`
      : `PERSONALIZZAZIONE: Se persona/luogo/oggetto non è chiaramente rilevante, resta generico stavolta.`;
  }
  const items = selected.map(c => `${c.type}:${c.key}=${c.value}`).join(" | ");
  return L
    ? `PERSONALIZATION (use ONLY if naturally relevant): ${items}`
    : `PERSONALIZZAZIONE (usa SOLO se naturalmente rilevante): ${items}`;
}

// ---------- Build user content ----------
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, history, dayCount }) {
  const L = isEn(lang);
  const p = profilo || {};
  const micro = p.micro || {};
  const lines = [];

  lines.push(L ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  lines.push(L ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);

  const prof = [];
  if (p.name)  prof.push(`name: ${p.name}`);
  if (p.role)  prof.push(`role: ${p.role}`);
  if (p.city)  prof.push(`city: ${p.city}`);
  if (p.goal)  prof.push(`goal: ${p.goal}`);
  if (typeof p.drinks_pref === "string") prof.push(`drinks_pref: ${p.drinks_pref}`);
  if (p.values?.length)  prof.push(`values: ${p.values.join(", ")}`);
  if (p.style)           prof.push(`style: ${p.style}`);
  if (p.change_attitude) prof.push(`change_attitude: ${p.change_attitude}`);
  if (p.motivation)      prof.push(`motivation: ${p.motivation}`);
  if (p.self_view)       prof.push(`self_view: ${p.self_view}`);
  Object.entries(micro).forEach(([k,v])=>{ if (typeof v === "string" && v.trim()) prof.push(`${k}: ${v}`); });
  if (prof.length) lines.push(L ? `PROFILE:\n${prof.join("\n")}` : `PROFILO:\n${prof.join("\n")}`);

  if (clarifications && Object.keys(clarifications).length) {
    const cLines = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    lines.push(L ? `CLARIFICATIONS:\n${cLines.join("\n")}` : `CHIARIMENTI:\n${cLines.join("\n")}`);
  }

  lines.push(timelineBlock(periodo, lang, stile));
  lines.push(motifGovernor({ domanda, profilo, clarifications, history, dayCount, lang }));
  lines.push(buildAntiRepeatBlock(history, lang));

  if (stile === "whatif") lines.push(structureWhatIf(lang));

  lines.push(
    L
      ? `STYLE CONSTRAINTS:
- Show, don't tell. Concrete beats and sensory verbs.
- Vary openings; avoid same noun/phrase >2 times.
- No insults, no slurs, inclusive humor.`
      : `VINCOLI DI STILE:
- Mostra, non spiegare. Battute concrete e verbi sensoriali.
- Varia gli attacchi; evita lo stesso sostantivo/frase >2 volte.
- Niente insulti o volgarità; umorismo inclusivo.`
  );

  lines.push(L ? `STYLE: ${stile}` : `STILE: ${stile}`);
  return lines.join("\n\n");
}

// ---------- Local clarify (2–3 micro domande) ----------
function localClarify(domanda, profilo, lang) {
  const en = isEn(lang);
  const out = [];
  const s = (domanda || "").toLowerCase();

  const wantsWork = /(lavor|work|career|job|azienda|company|project)/i.test(s);
  const wantsMove = /(trasfer|move|city|città|paese|quartiere)/i.test(s);
  const wantsStudy = /(stud|master|course|laurea)/i.test(s);
  const wantsMoney = /(euro|€|soldi|stipendio|debito|invest|salary|debt|invest)/i.test(s);

  if (wantsWork) {
    out.push({
      id: "priority",
      label: en ? "What’s the #1 priority in this choice?" : "Qual è la priorità n.1 in questa scelta?",
      placeholder: en ? "growth / stability / flexibility" : "crescita / stabilità / flessibilità",
    });
    out.push({
      id: "constraint_2w",
      label: en ? "One realistic constraint in the next 2 weeks?" : "Un vincolo realistico nelle prossime 2 settimane?",
      placeholder: en ? "budget / time / energy…" : "budget / tempo / energia…",
    });
  }
  if (wantsMove) {
    out.push({
      id: "landmark",
      label: en ? "A reference place that matters to you?" : "Un luogo di riferimento che conta per te?",
      placeholder: en ? "square / station / neighborhood…" : "piazza / stazione / quartiere…",
    });
  }
  if (wantsStudy || wantsMoney) {
    out.push({
      id: "indicator",
      label: en ? "One indicator that tells you you’re on track?" : "Un indicatore che ti dice che stai andando bene?",
      placeholder: en ? "hours/week, € saved, clients…" : "ore/settimana, € risparmiati, clienti…",
    });
  }
  if (out.length === 0) {
    out.push({
      id: "context",
      label: en ? "What detail would make this scenario more *you*?" : "Che dettaglio renderebbe questo scenario più *tuo*?",
      placeholder: en ? "a person, a place, a small constraint" : "una persona, un luogo, un piccolo vincolo",
    });
    out.push({
      id: "signal",
      label: en ? "One tangible signal you’d like to see?" : "Un segnale tangibile che vorresti vedere?",
      placeholder: en ? "metric, habit, time-of-day" : "metrica, abitudine, momento della giornata",
    });
  }
  return out.slice(0, 3);
}

// ---------- HTTP handler ----------
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      lang: langIn = "it",
      periodo = "future",
      stile = "whatif",
      clarify = false,
      stream = false,
      profilo = {},
      clarifications = {},
      history = {},
      day_count = 1,
      extra = "",
    } = req.body || {};

    const lang = normLang(langIn);

    // Clarify branch
    if (clarify) {
      const questions = localClarify(domanda, profilo, lang);
      return res.status(200).json({ questions });
    }

    // Build messages
    const system = stile === "wtf" ? systemPromptWTF(lang, profilo) : systemPromptWhatIf(lang, profilo);
    const user = buildUserContent({
      domanda, periodo, profilo, clarifications, lang, stile, history,
      dayCount: Number.isFinite(day_count) ? day_count : 1,
    });

    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
      {
        role: "system",
        content: isEn(lang)
          ? `Constraints: personalized, specific, compact; show-don't-tell; no offensive language or medical/therapy advice.`
          : `Vincoli: personalizzato, specifico, compatto; mostra-non-spiegare; niente linguaggio offensivo o consigli medici/terapeutici.`,
      },
      ...(extra ? [{ role: "system", content: String(extra) }] : []),
    ];

    const temperature = stile === "wtf" ? 0.95 : 0.8;
    const maxTokens  = stile === "wtf" ? 850 : 900;

    // Stream
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const streamResp = await client.chat.completions.create({
        model: MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      });

      for await (const chunk of streamResp) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // Non-stream
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    const text = completion.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res.status(500).json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
