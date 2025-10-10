// /api/ask.js
import OpenAI from "openai";

/**
 * ENV: OPENAI_API_KEY
 * Compatibile con il tuo frontend (clarify, stream SSE, lang, stile, profilo, clarifications, extra).
 * NOVITÀ: supporta history + day_count e un "Motif Governor" per evitare uso forzato di persone/luoghi/oggetti.
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.WHATIF_MODEL || "gpt-4o-mini";

// ———————————————————————————————————————
// Lingua
// ———————————————————————————————————————
const normLang = (lang) => (String(lang || "it").toLowerCase().startsWith("en") ? "en" : "it");
const isEn     = (lang) => normLang(lang) === "en";

const STRICT_LANG = (lang) =>
  isEn(lang)
    ? `Write STRICTLY in English. Do not mix Italian.`
    : `Scrivi RIGOROSAMENTE in italiano. Non mischiare inglese.`;

// ———————————————————————————————————————
// Anti-ripetizione “soft”: usa history per non martellare
// ———————————————————————————————————————
function buildAntiRepeatBlock(history = {}, lang = "it") {
  const L = isEn(lang);
  const { recent_topics = [], recent_people = [], recent_places = [], recent_styles = [] } = history || {};
  const list = (arr) => (arr && arr.length ? arr.join(", ") : "—");
  return L
    ? `NO-REPEAT HINTS:
- Avoid leaning again on: topics [${list(recent_topics)}], people [${list(recent_people)}], places [${list(recent_places)}], stylistic motifs [${list(recent_styles)}].
- If a reference (person/place/object) is not clearly relevant, skip it.
- Vary openings and key nouns; don’t repeat the same motif >2 times.`
    : `SUGGERIMENTI ANTI-RIPETIZIONE:
- Evita di insistere su: temi [${list(recent_topics)}], persone [${list(recent_people)}], luoghi [${list(recent_places)}], espedienti stilistici [${list(recent_styles)}].
- Se un riferimento (persona/luogo/oggetto) non è chiaramente rilevante, salta.
- Varia attacchi di frase e sostantivi chiave; non ripetere lo stesso motivo >2 volte.`;
}

// ———————————————————————————————————————
// Persona sintetica per system prompt
// ———————————————————————————————————————
function personaLine(profile = {}, lang = "it") {
  const bits = [];
  if (profile.name) bits.push(profile.name);
  if (profile.role) bits.push(profile.role);
  if (profile.city) bits.push(isEn(lang) ? `from ${profile.city}` : `di ${profile.city}`);
  return bits.length ? bits.join(isEn(lang) ? ", " : ", ") : isEn(lang) ? "a curious person" : "una persona curiosa";
}

// ———————————————————————————————————————
// WHAT IF – system + struttura
// ———————————————————————————————————————
function systemPromptWhatIf(lang, profile) {
  const who = personaLine(profile, lang);
  const L = isEn(lang);
  return L
    ? [
        STRICT_LANG(lang),
        `You are "What if": warm, empathetic, lightly ironic, reflective.`,
        `Imagine a PLAUSIBLE alternate life scene for the user (${who}), grounded in their signals.`,
        `Be sensory and specific without purple prose. Human, compact, cinematic.`,
        `No medical/therapy advice or promises. Avoid clichés.`,
        `Don’t repeat the same motifs across answers.`,
      ].join("\n")
    : [
        STRICT_LANG(lang),
        `Sei “What if”: caldo, empatico, con un filo di ironia e sguardo riflessivo.`,
        `Immagina una scena di vita ALTERNATIVA PLAUSIBILE per l’utente (${who}), ancorata ai suoi segnali.`,
        `Sensoriale e specifico senza barocchismi. Umano, compatto, cinematografico.`,
        `Niente consigli medici/terapeutici o promesse. Evita i cliché.`,
        `Non ripetere gli stessi motivi tra una risposta e l’altra.`,
      ].join("\n");
}

function structureWhatIf(lang) {
  return isEn(lang)
    ? `Structure (use bold headings):
1) Prologue — set mood (2–4 lines)
2) Alternative reality — a day/mini-sequence that makes it tangible (6–10 lines)
3) Key choices — 2–3 decisions they make
4) Consequences — plausible outcomes
5) Twist — small, human, believable
6) Reflection — 2–3 lines mirroring back to the user`
    : `Struttura (usa titoli in grassetto):
1) Prologo — imposta tono (2–4 righe)
2) Realtà alternativa — un giorno/mini-sequenza tangibile (6–10 righe)
3) Scelte-chiave — 2–3 decisioni
4) Conseguenze — esiti plausibili
5) Colpo di scena — piccolo, umano, credibile
6) Riflessione — 2–3 righe a specchio dell’utente`;
}

// ———————————————————————————————————————
// WTF – system (sarcastico) con vibe alcolica opzionale
// ———————————————————————————————————————
function systemPromptWTF(lang, profile) {
  const drinks = String(profile?.drinks_pref || "").toLowerCase() === "yes";
  const L = isEn(lang);
  const base = L
    ? [
        STRICT_LANG(lang),
        `You are "WTF": witty, sarcastic, playful — a late-night bartender-philosopher.`,
        `Punchy one-liners, surprising metaphors, quick rhythm. Roast gently, never punch down.`,
        `Compact (≈10–16 lines). If advice is needed, end with 3 crisp bullets.`,
        `Never cruel or discriminatory. Keep it safe and fun.`,
      ]
    : [
        STRICT_LANG(lang),
        `Sei “WTF”: brillante, sarcastico e giocoso — un barista filosofo nottambulo.`,
        `Battute secche, metafore a sorpresa, ritmo rapido. Pungi con affetto, mai verso il basso.`,
        `Compatto (≈10–16 righe). Se serve, chiudi con 3 bullet netti.`,
        `Mai crudele o discriminatorio. Sicuro e divertente.`,
      ];
  base.push(
    drinks
      ? (L
          ? `Booze vibe: you MAY lightly sound "tipsy" at times (looser phrasing), tastefully and sparingly. Disable for sensitive topics.`
          : `Vibe alcolica: PUOI suonare “un filo brilla” a tratti (lessico più sciolto), con gusto e raramente. Disattiva su temi sensibili.`)
      : (L
          ? `Booze vibe: OFF (user doesn't drink/unknown). Keep it sober yet spicy.`
          : `Vibe alcolica: OFF (utente non beve/sconosciuto). Sober ma speziato.`)
  );
  return base.join("\n");
}

// ———————————————————————————————————————
// MOTIF GOVERNOR — decide quando citare persone/luoghi/oggetti
// ———————————————————————————————————————
function tokenizeLower(s) {
  return (s || "").toLowerCase();
}
function containsAny(text, arr) {
  const t = tokenizeLower(text);
  return arr.some(x => t.includes(String(x || "").toLowerCase()));
}

function scoreSignals({ domanda, profile, clarifications }) {
  const q = tokenizeLower(domanda);
  const p = profile || {};
  const micro = p.micro || {};
  const clar = clarifications || {};

  // elementi candidati (persona / luogo / oggetto)
  const candidates = [];

  if (p.role) candidates.push({ type: "person", key: "role", value: p.role });
  if (p.name) candidates.push({ type: "person", key: "name", value: p.name });
  if (p.city) candidates.push({ type: "place", key: "city", value: p.city });
  if (micro.punto_riferimento) candidates.push({ type: "place", key: "landmark", value: micro.punto_riferimento });
  if (micro.indicatore) candidates.push({ type: "object", key: "indicator", value: micro.indicatore });

  // base relevance: match su domanda / goal / clar
  for (const c of candidates) {
    let score = 0;
    if (containsAny(q, [c.value])) score += 2;
    if (containsAny(tokenizeLower(p.goal), [c.value])) score += 2;
    if (containsAny(JSON.stringify(clar).toLowerCase(), [String(c.value).toLowerCase()])) score += 1;
    // preferisci goal/ruolo/landmark rispetto a name "personale"
    if (c.key === "goal" || c.key === "role" || c.key === "landmark") score += 1;
    c.score = score; // 0..6
  }
  return candidates.sort((a,b)=>b.score-a.score);
}

function motifGovernor({ domanda, profilo, clarifications, history, dayCount = 1, lang = "it" }) {
  // 1) scoring
  const ranked = scoreSignals({ domanda, profile: profilo, clarifications });

  // 2) penalità di saturazione da history
  const H = history || {};
  const usedPeople = new Set((H.recent_people || []).map(s=>s.toLowerCase()));
  const usedPlaces = new Set((H.recent_places || []).map(s=>s.toLowerCase()));

  ranked.forEach(c => {
    const v = String(c.value || "").toLowerCase();
    if (c.type === "person" && usedPeople.has(v)) c.score -= 1.5;
    if (c.type === "place"  && usedPlaces.has(v)) c.score -= 1.5;
  });

  // 3) soglie intelligenti
  // di base: includi 0–2 elementi; se dayCount>=3, richiedi score più alto per includere
  const baseThreshold = dayCount >= 3 ? 3 : 2;
  const maxItems = dayCount >= 3 ? 1 : 2; // quando sei al terzo, lascia più “aria”

  const selected = [];
  for (const c of ranked) {
    if (selected.length >= maxItems) break;
    if (c.score >= baseThreshold) selected.push(c);
  }

  // 4) costruisci guida per il modello (inclusione condizionata)
  const L = isEn(lang);
  if (!selected.length) {
    return L
      ? `PERSONALIZATION: If a person/place/object is NOT clearly relevant, keep it generic this time.`
      : `PERSONALIZZAZIONE: Se persona/luogo/oggetto NON è chiaramente rilevante, resta generico stavolta.`;
  }
  const items = selected.map(c => `${c.type}:${c.key}=${c.value}`).join(" | ");
  return L
    ? `PERSONALIZATION (use ONLY if naturally relevant): ${items}`
    : `PERSONALIZZAZIONE (usa SOLO se naturalmente rilevante): ${items}`;
}

// ———————————————————————————————————————
// User content (profilo + micro + chiarimenti + anti-repeat + struttura + governor)
// ———————————————————————————————————————
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

  Object.entries(micro).forEach(([k, v]) => {
    if (typeof v === "string" && v.trim()) prof.push(`${k}: ${v}`);
  });
  if (prof.length) lines.push(L ? `PROFILE:\n${prof.join("\n")}` : `PROFILO:\n${prof.join("\n")}`);

  if (clarifications && Object.keys(clarifications).length) {
    const cLines = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    lines.push(L ? `CLARIFICATIONS:\n${cLines.join("\n")}` : `CHIARIMENTI:\n${cLines.join("\n")}`);
  }

  // Motif Governor (decide quando citare e quando NO)
  lines.push(motifGovernor({ domanda, profilo, clarifications, history, dayCount, lang }));

  // Anti-repeat soft
  lines.push(buildAntiRepeatBlock(history, lang));

  // Struttura (solo What if)
  if (stile === "whatif") lines.push(structureWhatIf(lang));

  // Micro-vincoli anti-eco
  lines.push(
    L
      ? `MICRO-CONSTRAINTS: vary sentence openings; prefer fresh, specific details; avoid the same noun/phrase >2 times; if a reference feels forced, drop it.`
      : `MICRO-VINCOLI: varia gli attacchi di frase; preferisci dettagli freschi e specifici; evita lo stesso sostantivo/frase >2 volte; se un riferimento è forzato, non usarlo.`
  );

  lines.push(L ? `STYLE: ${stile}` : `STILE: ${stile}`);
  return lines.join("\n\n");
}

// ———————————————————————————————————————
// Clarify locale (2–3 domande mirate, gratis)
// ———————————————————————————————————————
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
      placeholder: en ? "a person, a place, a tiny constraint" : "una persona, un luogo, un piccolo vincolo",
    });
    out.push({
      id: "signal",
      label: en ? "One tangible signal you’d like to see?" : "Un segnale tangibile che vorresti vedere?",
      placeholder: en ? "metric, habit, time-of-day" : "metrica, abitudine, momento della giornata",
    });
  }
  return out.slice(0, 3);
}

// ———————————————————————————————————————
// Handler HTTP
// ———————————————————————————————————————
export default async function handler(req, res) {
  // CORS + preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

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
      history = {},      // opzionale
      day_count = 1,     // opzionale: 1..n (quanti What?f oggi)
      extra = "",
    } = req.body || {};

    const lang = normLang(langIn);

    // Clarify
    if (clarify) {
      const questions = localClarify(domanda, profilo, lang);
      return res.status(200).json({ questions });
    }

    // System + user prompt
    const system =
      stile === "wtf" ? systemPromptWTF(lang, profilo) : systemPromptWhatIf(lang, profilo);

    const user = buildUserContent({
      domanda,
      periodo,
      profilo,
      clarifications,
      lang,
      stile,
      history,
      dayCount: Number.isFinite(day_count) ? day_count : 1,
    });

    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
      {
        role: "system",
        content: isEn(lang)
          ? `Constraints: personalized, specific, compact; no offensive language or medical/therapy advice.`
          : `Vincoli: personalizzato, specifico, compatto; niente linguaggio offensivo o consigli medici/terapeutici.`,
      },
      ...(extra ? [{ role: "system", content: String(extra) }] : []),
    ];

    const temperature = stile === "wtf" ? 0.95 : 0.8;
    const maxTokens   = stile === "whatif" ? 900 : 800;

    // STREAM
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

    // NON-STREAM
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
    return res
      .status(500)
      .json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
