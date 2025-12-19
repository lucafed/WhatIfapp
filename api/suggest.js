// /api/suggest.js — Generatore spunti (personalizzate/generiche/assurde) + Oracolo (cards/answer/meta/next)
// Stessa impostazione di /api/ask.js: OpenAI + Upstash Rate + CORS.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 m"),
});

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it", "en", "es", "fr", "de"];
const normLang = (l = "it") => {
  const s = String(l || "it").toLowerCase().slice(0, 2);
  return SUP_LANGS.includes(s) ? s : "it";
};

function safeJSONPick(text) {
  if (typeof text !== "string") return null;
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function clampStr(x, n) {
  return String(x || "").slice(0, n);
}

function compactPicks(picks = {}) {
  // picks: { key: {id,label,emoji, freeText?} } -> string compatta per prompt
  const out = [];
  for (const k of Object.keys(picks || {})) {
    const v = picks[k] || {};
    const id = clampStr(v.id || "", 60);
    const label = clampStr(v.label || "", 120);
    const ft = clampStr(v.freeText || "", 140);
    const base = (label || id) ? `${k}: ${label || id}` : "";
    const extra = ft ? ` (+ "${ft}")` : "";
    if (!base && !extra) continue;
    out.push(`${base}${extra}`);
  }
  return out.join(" | ");
}

function safeGoal(goal) {
  const g = String(goal || "").trim();
  return clampStr(g, 220);
}

/* ========= Fallback (spunti classici) ========= */
const fallbackPools = {
  it: {
    generic: [
      "E se cambiassi lavoro quest’anno?",
      "E se ti trasferissi all’estero per 6 mesi?",
      "E se aprissi una piccola attività nel weekend?",
      "E se impostassi davvero un piano per l’inglese B2?",
      "E se provassi la settimana corta per un mese?",
      "E se spegnessi i social dopo le 22 per 30 giorni?",
      "E se organizzassi un esperimento di 7 giorni per un’abitudine che rimandi?",
      "E se delegassi una cosa che ti pesa ogni settimana?",
    ],
    absurd: [
      "E se domani il frigorifero ti suggerisse il menù della vita?",
      "E se aprissi una scuola per gatti allergici alle riunioni?",
      "E se diventassi l’allenatore non ufficiale del condominio?",
      "E se allenassi una squadra di cuscini gonfiabili la sera?",
    ],
  },
  en: {
    generic: [
      "What if you changed jobs this year?",
      "What if you lived abroad for 6 months?",
      "What if you started a weekend micro-business?",
      "What if you actually planned English B2?",
      "What if you tried a 4-day workweek for a month?",
      "What if you turned off social media after 10pm for 30 days?",
    ],
    absurd: [
      "What if tomorrow your fridge pitched you a life menu?",
      "What if you opened a school for cats who hate meetings?",
      "What if you became your building’s unofficial coach?",
    ],
  },
};

const finalQ = (q = "", L = "it") => {
  let t = String(q).replace(/[?？]+$/, "").trim();
  if (!t) return "";
  if (L === "es") {
    if (!t.startsWith("¿")) t = "¿" + t;
    if (!t.endsWith("?")) t += "?";
    return t;
  }
  if (L === "fr") {
    if (!t.endsWith("?")) t += " ?";
    return t.replace(/\s*\?$/, " ?");
  }
  if (!t.endsWith("?")) t += "?";
  return t;
};

/* ========= Prompt: SUGGEST classico ========= */
function buildSuggestPrompt({ lang, periodo, boost }) {
  const L = normLang(lang);
  const instr =
    L === "en"
      ? `Generate suggestions for the text field "What if…".`
      : L === "it"
      ? `Genera suggerimenti per il campo "E se…".`
      : L === "es"
      ? `Genera sugerencias para el campo "¿Y si…?".`
      : L === "fr"
      ? `Génère des suggestions pour le champ "Et si…".`
      : `Erzeuge Vorschläge für das Feld „Was wäre, wenn…“.`;

  const tense =
    String(periodo).toLowerCase() === "past"
      ? L === "en"
        ? "Past hypothetical tone."
        : "Tono ipotetico al passato."
      : L === "en"
      ? "Near-future tone."
      : "Tono di prossimo futuro.";

  const spec =
    L === "en"
      ? `Write short, well-formed questions. No lists, no numbering, no emojis.`
      : `Scrivi domande brevi e ben formate. Niente elenchi, numerazione o emoji.`;

  const out =
    L === "en"
      ? `Return STRICT JSON: {"personalized":[...12], "generic":[...8], "absurd":[...4]}`
      : `Restituisci JSON STRETTO: {"personalized":[...12], "generic":[...8], "absurd":[...4]}`;

  const boostHint =
    L === "en"
      ? boost
        ? `Prioritize topics related to: ${boost}`
        : `If no user profile, keep it broadly useful.`
      : boost
      ? `Dai priorità a temi legati a: ${boost}`
      : `Se non ci sono dati utente, mantieni utilità generale.`;

  return [
    {
      role: "system",
      content: `You are a suggestion generator. ${instr} ${tense} ${spec} Use keys exactly "personalized", "generic", "absurd". Return ONLY JSON.`,
    },
    {
      role: "user",
      content: `Language: ${L}\nBoost: ${boost || "(none)"}\n${out}\n${boostHint}`,
    },
  ];
}

/* ========= SAFETY SYSTEM (Oracolo) =========
   - non “consigli” per atti illegali, autolesionismo, armi, ecc.
   - se tema ad alto rischio: rifiuta e propone alternative sicure/risorse.
*/
function oracleSafetySystem(lang) {
  const L = normLang(lang);
  if (L === "en") {
    return `Safety policy:
- If the user goal asks for self-harm, violence, wrongdoing, weapons, drugs, or illegal activity: refuse and provide safe alternatives.
- If medical/legal/financial advice is requested: provide general information only, encourage professional help.
- Keep responses non-judgmental.`;
  }
  if (L === "es") {
    return `Política de seguridad:
- Si el objetivo pide autolesión, violencia, ilegalidad, armas, drogas o actos ilícitos: rechaza y ofrece alternativas seguras.
- Si pide consejos médicos/legales/financieros: solo información general y recomendar un profesional.
- Tono sin juicio.`;
  }
  if (L === "fr") {
    return `Politique de sécurité :
- Si l’objectif concerne l’automutilation, violence, illégalité, armes, drogues: refuser et proposer des alternatives sûres.
- Si demande médicale/juridique/financière: infos générales + conseiller un pro.
- Ton non jugeant.`;
  }
  if (L === "de") {
    return `Sicherheitsrichtlinie:
- Bei Selbstverletzung, Gewalt, Illegalität, Waffen, Drogen: ablehnen und sichere Alternativen anbieten.
- Bei Medizin/Recht/Finanzen: nur allgemeine Infos + Fachperson empfehlen.
- Wertfrei bleiben.`;
  }
  return `Policy di sicurezza:
- Se l’obiettivo riguarda autolesionismo, violenza, illegalità, armi, droghe o atti illeciti: rifiuta e proponi alternative sicure.
- Se chiede consigli medici/legali/finanziari: solo info generali e invita a un professionista.
- Tono non giudicante.`;
}

/* ========= Prompt: ORACOLO CARDS (4 step contestuali alla domanda) ========= */
function buildOracleCardsPrompt({ lang, voice, goal }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const g = safeGoal(goal);

  const tone =
    v === "wtf"
      ? (L === "en"
          ? "Tone: witty, blunt, bartender-energy, but still helpful."
          : "Tono: ironico, diretto, da barista affettuoso, ma utile.")
      : (L === "en"
          ? "Tone: empathic, pragmatic, grounded."
          : "Tono: empatico, pragmatico, concreto.");

  // IMPORTANTISSIMO: le carte NON devono chiedere “come agisci / strategia / canale”.
  // Devono raccogliere contesto per permettere alla risposta finale di dire “come fare”.
  const spec =
    L === "en"
      ? `Create exactly 4 steps (cards). Each step is a short clarifying QUESTION about the user's GOAL.
Rules:
- Do NOT ask the user to choose a strategy, channel, or "how to act". The FINAL answer will do that.
- Focus on: desired outcome, why it matters, constraints/risks, context/timeframe/resources, definition of "done".
- Each step has 4-6 options with id,label,emoji. Options should be distinct and practical.
Return ONLY strict JSON:
{
 "ui":{
   "cta":"Generate answer",
   "disclaimer_short":"...",
   "disclaimer_full":"..."
 },
 "steps":[
   {"key":"...","title":"...","subtitle":"...","options":[{"id":"...","label":"...","emoji":"..."}]}
 ]
}`
      : `Crea esattamente 4 step (carte). Ogni step è una DOMANDA breve per chiarire l’OBIETTIVO dell’utente.
Regole:
- NON chiedere all’utente “che strategia/canale/come agire”. Quello lo dirà la RISPOSTA FINALE.
- Focalizzati su: risultato desiderato, perché conta, vincoli/rischi, contesto/tempi/risorse, definizione di “fatto”.
- Ogni step ha 4-6 opzioni con id,label,emoji. Opzioni distinte e pratiche.
Restituisci SOLO JSON STRETTO:
{
 "ui":{
   "cta":"Rivela l’Oracolo",
   "disclaimer_short":"...",
   "disclaimer_full":"..."
 },
 "steps":[
   {"key":"...","title":"...","subtitle":"...","options":[{"id":"...","label":"...","emoji":"..."}]}
 ]
}`;

  // Disclaimer: vogliamo “pararci il culo” ma leggibile.
  const disclaimerShort =
    L === "en"
      ? "AI-generated guidance. Not professional advice."
      : L === "es"
      ? "Guía generada por IA. No es asesoramiento profesional."
      : L === "fr"
      ? "Conseils générés par IA. Pas un avis professionnel."
      : L === "de"
      ? "KI-generierte Hinweise. Keine Fachberatung."
      : "Suggerimenti generati da AI. Non è consulenza professionale.";

  const disclaimerFull =
    L === "en"
      ? "This feature provides ideas and planning prompts. It is not medical, legal, financial, or professional advice. Use your judgment and consult qualified professionals for high-stakes decisions. Do not use it for harmful or illegal activities."
      : L === "es"
      ? "Esta función ofrece ideas y preguntas guía. No es asesoramiento médico, legal, financiero ni profesional. Usa tu criterio y consulta a profesionales en decisiones importantes. No la uses para actividades dañinas o ilegales."
      : L === "fr"
      ? "Cette fonction propose des idées et des questions de cadrage. Ce n’est pas un avis médical, juridique, financier ou professionnel. Utilise ton jugement et consulte un professionnel pour les décisions à enjeux. Ne l’utilise pas pour des activités illégales ou nuisibles."
      : L === "de"
      ? "Diese Funktion liefert Ideen und Leitfragen. Keine medizinische, rechtliche, finanzielle oder sonstige Fachberatung. Nutze dein Urteilsvermögen und konsultiere Fachpersonen bei wichtigen Entscheidungen. Nicht für schädliche oder illegale Zwecke nutzen."
      : "Questa funzione offre idee e domande guida. Non è consulenza medica, legale, finanziaria o professionale. Usa il tuo giudizio e confrontati con professionisti per decisioni importanti. Non usarla per attività dannose o illegali.";

  return [
    { role: "system", content: `${oracleSafetySystem(L)}\nYou generate Oracle cards. ${tone}\nReturn JSON only.` },
    {
      role: "user",
      content: `Language: ${L}\nVoice: ${v}\nUser goal: ${g || "(empty)"}\n\n${spec}\n\nInclude ui.disclaimer_short="${disclaimerShort}" and ui.disclaimer_full="${disclaimerFull}".`,
    },
  ];
}

/* ========= Prompt: ORACOLO META (vecchia: 4 step generici) ========= */
function buildOracleMetaPrompt({ lang, voice }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";

  const tone =
    v === "wtf"
      ? (L === "en"
          ? "Tone: sharp, ironic, but still helpful and concrete."
          : "Tono: ironico/tagliente ma comunque utile e concreto.")
      : (L === "en"
          ? "Tone: serious, pragmatic, emotionally intelligent."
          : "Tono: serio, pragmatico, emotivamente intelligente.");

  const spec =
    L === "en"
      ? `Create 4 steps. Each step has a key, title, subtitle, and 4-6 options. Options have id,label,emoji.`
      : `Crea 4 step. Ogni step ha key, title, subtitle e 4-6 opzioni. Le opzioni hanno id,label,emoji.`;

  const rules =
    L === "en"
      ? `Make choices broad but not generic. No repetition. Make options mutually distinct.`
      : `Scelte ampie ma non generiche. Niente ripetizioni. Opzioni ben diverse tra loro.`;

  return [
    {
      role: "system",
      content:
        `You generate a compact multi-step picker UI for an "Oracle" feature. ${tone} ` +
        `Return ONLY strict JSON with this shape: ` +
        `{"ui":{"cta":"..."}, "steps":[{"key":"...","title":"...","subtitle":"...","options":[{"id":"...","label":"...","emoji":"..."}]}]}` +
        ` ${spec} ${rules}`,
    },
    {
      role: "user",
      content: `Language: ${L}\nVoice: ${v}\nGenerate the initial 4 steps now.`,
    },
  ];
}

/* ========= Prompt: ORACOLO NEXT (adattivo) ========= */
function buildOracleNextPrompt({ lang, voice, picks, startIndex }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const ctx = compactPicks(picks || {});
  const idx = Number.isFinite(+startIndex) ? Math.max(0, Math.min(3, +startIndex)) : 0;

  const tone =
    v === "wtf"
      ? (L === "en"
          ? "Tone: playful, ironic, but concrete and actionable."
          : "Tono: ironico ma concreto e utile.")
      : (L === "en"
          ? "Tone: serious, pragmatic, emotionally intelligent."
          : "Tono: serio, pragmatico, emotivamente intelligente.");

  const spec =
    L === "en"
      ? `Regenerate steps from index ${idx} to 3, adapting to previous picks. Keep steps consistent and non-repetitive.`
      : `Rigenera gli step da indice ${idx} a 3, adattandoli ai pick precedenti. Mantieni coerenza e niente ripetizioni.`;

  return [
    {
      role: "system",
      content:
        `You generate the remaining steps of an Oracle picker UI. ${tone} ` +
        `Return ONLY strict JSON with shape: {"steps":[...]} where steps are the FULL remaining steps (index ${idx}..3). ` +
        `Each step: {"key","title","subtitle","options":[{"id","label","emoji"}]} ` +
        `Options must be mutually distinct and specific. No duplicates across options.`,
    },
    {
      role: "user",
      content:
        `Language: ${L}\nVoice: ${v}\nAlready picked: ${ctx || "(none)"}\n` +
        `${spec}\nReturn JSON only.`,
    },
  ];
}

/* ========= Prompt: ORACOLO ANSWER (con GOAL) ========= */
function buildOracleAnswerPrompt({ lang, voice, picks, goal }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const ctx = compactPicks(picks || {});
  const g = safeGoal(goal);

  const tone =
    v === "wtf"
      ? (L === "en"
          ? "Voice: witty, blunt, bartender-energy, but still useful."
          : "Voce: ironica, diretta, da barista affettuoso, ma utile.")
      : (L === "en"
          ? "Voice: empathic, pragmatic, grounded."
          : "Voce: empatica, pragmatica, concreta.");

  const spec =
    L === "en"
      ? `Return ONLY JSON: {"title":"...","do":"...","first_step":"...","rules":[...],"safety":"..."}.
do = 3-6 sentences and MUST include: "what to do", "where to start", and a clear next direction.
first_step = 1 concrete action in 15 minutes.
rules = 4-6 short rules.
safety = one gentle warning (not professional advice + avoid illegal/harmful).`
      : `Restituisci SOLO JSON: {"title":"...","do":"...","first_step":"...","rules":[...],"safety":"..."}.
do = 3-6 frasi e DEVE includere: "cosa fare", "da dove partire" e una direzione chiara.
first_step = 1 azione concreta in 15 minuti.
rules = 4-6 regole brevi.
safety = un’avvertenza gentile (no consulenza + evita illegale/dannoso).`;

  return [
    { role: "system", content: `${oracleSafetySystem(L)}\nYou are the Oracle. ${tone} ${spec}` },
    {
      role: "user",
      content: `Language: ${L}\nVoice: ${v}\nUser goal: ${g || "(none)"}\nUser picks: ${ctx || "(none)"}\nReturn JSON only.`,
    },
  ];
}

/* ========= Handler ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    // Rate limit per IP
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString()
      .split(",")[0]
      .trim();
    const { success } = await rl.limit(`suggest:${ip}`);
    if (!success) return res.status(429).json({ error: "rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const lang = normLang(body.lang || "it");

    // Ping veloce
    if (body.ping === true) {
      return res.status(200).json({ ok: true, ping: true, model: MODEL, ts: Date.now() });
    }

    const mode = String(body.mode || "suggest");

    // ===== ORACOLO: cards contestuali alla domanda (NUOVO) =====
    if (mode === "oracle_cards") {
      const voice = String(body.voice || "whatif");
      const goal = safeGoal(body.goal || "");

      const messages = buildOracleCardsPrompt({ lang, voice, goal });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.75,
        top_p: 0.9,
        max_tokens: 950,
        messages,
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const data = safeJSONPick(raw);
      if (!data || !Array.isArray(data.steps)) throw new Error("bad_oracle_cards_json");

      const steps = data.steps.slice(0, 4).map((s, i) => ({
        key: clampStr(s.key || `step${i + 1}`, 30),
        title: clampStr(s.title || "—", 140),
        subtitle: clampStr(s.subtitle || "", 200),
        options: Array.isArray(s.options)
          ? s.options.slice(0, 6).map((o) => ({
              id: clampStr(o.id || o.label || "x", 50),
              label: clampStr(o.label || o.id || "—", 140),
              emoji: clampStr(o.emoji || "•", 6),
            }))
          : [],
      }));

      return res.status(200).json({
        ui: {
          cta: clampStr(data?.ui?.cta || (lang === "en" ? "Reveal the Oracle" : "🔮 Rivela l’Oracolo"), 44),
          disclaimer_short: clampStr(data?.ui?.disclaimer_short || "", 120),
          disclaimer_full: clampStr(data?.ui?.disclaimer_full || "", 420),
        },
        steps,
        used: "ai",
      });
    }

    // ===== ORACOLO: meta iniziale (vecchia) =====
    if (mode === "oracle_meta") {
      const voice = String(body.voice || "whatif");
      const messages = buildOracleMetaPrompt({ lang, voice });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.75,
        top_p: 0.9,
        max_tokens: 900,
        messages,
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const data = safeJSONPick(raw);

      if (!data || !Array.isArray(data.steps)) throw new Error("bad_oracle_meta_json");

      const steps = data.steps.slice(0, 4).map((s, i) => ({
        key: clampStr(s.key || `step${i + 1}`, 30),
        title: clampStr(s.title || "—", 120),
        subtitle: clampStr(s.subtitle || "", 180),
        options: Array.isArray(s.options)
          ? s.options.slice(0, 6).map((o) => ({
              id: clampStr(o.id || o.label || "x", 50),
              label: clampStr(o.label || o.id || "—", 120),
              emoji: clampStr(o.emoji || "•", 6),
            }))
          : [],
      }));

      return res.status(200).json({
        ui: { cta: clampStr(data?.ui?.cta || (lang === "en" ? "Reveal the Oracle" : "Rivela l’Oracolo"), 40) },
        steps,
        used: "ai",
      });
    }

    // ===== ORACOLO: next adattivo =====
    if (mode === "oracle_next") {
      const voice = String(body.voice || "whatif");
      const picks = (body.picks && typeof body.picks === "object") ? body.picks : {};
      const startIndex = Number.isFinite(+body.startIndex) ? +body.startIndex : 0;

      const messages = buildOracleNextPrompt({ lang, voice, picks, startIndex });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.85,
        top_p: 0.9,
        max_tokens: 900,
        messages,
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const data = safeJSONPick(raw);

      if (!data || !Array.isArray(data.steps)) throw new Error("bad_oracle_next_json");

      const steps = data.steps.slice(0, 4).map((s, i) => ({
        key: clampStr(s.key || `step${startIndex + i + 1}`, 30),
        title: clampStr(s.title || "—", 120),
        subtitle: clampStr(s.subtitle || "", 180),
        options: Array.isArray(s.options)
          ? s.options.slice(0, 6).map((o) => ({
              id: clampStr(o.id || o.label || "x", 50),
              label: clampStr(o.label || o.id || "—", 120),
              emoji: clampStr(o.emoji || "•", 6),
            }))
          : [],
      }));

      return res.status(200).json({ steps, used: "ai" });
    }

    // ===== ORACOLO: answer finale (con goal + picks + freeText) =====
    if (mode === "oracle_answer") {
      const voice = String(body.voice || "whatif");
      const picks = (body.picks && typeof body.picks === "object") ? body.picks : {};
      const goal = safeGoal(body.goal || "");

      const messages = buildOracleAnswerPrompt({ lang, voice, picks, goal });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.85,
        top_p: 0.9,
        max_tokens: 750,
        messages,
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const data = safeJSONPick(raw);

      if (!data || typeof data !== "object") throw new Error("bad_oracle_answer_json");

      return res.status(200).json({
        title: clampStr(data.title || "🔮", 80),
        do: clampStr(data.do || "", 800),
        first_step: clampStr(data.first_step || "", 260),
        rules: Array.isArray(data.rules) ? data.rules.map((x) => clampStr(x, 120)).slice(0, 6) : [],
        safety: clampStr(data.safety || "", 260),
        used: "ai",
      });
    }

    // ===== suggest classico (come il tuo) =====
    const periodo = String(body.periodo || "future");
    const boost = clampStr(body.boost || "", 400);

    const messages = buildSuggestPrompt({ lang, periodo, boost });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.6,
      top_p: 0.9,
      max_tokens: 500,
      messages,
    });

    const raw = completion?.choices?.[0]?.message?.content || "";
    const data = safeJSONPick(raw);
    if (!data || typeof data !== "object") throw new Error("bad_json");

    const personalized = (data.personalized || data.personalizzate || [])
      .map((x) => finalQ(x, lang))
      .filter(Boolean)
      .slice(0, 12);
    const generic = (data.generic || data.generiche || []).map((x) => finalQ(x, lang)).filter(Boolean).slice(0, 8);
    const absurd = (data.absurd || data.assurde || []).map((x) => finalQ(x, lang)).filter(Boolean).slice(0, 4);

    const pools = fallbackPools[lang] || fallbackPools.it;
    const ensure = (arr, need, from) => (arr.length >= need ? arr : [...arr, ...from].slice(0, need));
    const out = {
      personalized,
      generic: ensure(generic, 8, (pools.generic || []).map((s) => finalQ(s, lang))),
      absurd: ensure(absurd, 4, (pools.absurd || []).map((s) => finalQ(s, lang))),
      used: "ai",
    };

    return res.status(200).json(out);
  } catch (err) {
    console.error("❌ [/api/suggest] error:", err);

    // fallback totale per suggest classico
    const lang = normLang((req.body && req.body.lang) || "it");
    const pools = fallbackPools[lang] || fallbackPools.it;
    return res.status(200).json({
      personalized: [],
      generic: (pools.generic || []).map((s) => finalQ(s, lang)).slice(0, 8),
      absurd: (pools.absurd || []).map((s) => finalQ(s, lang)).slice(0, 4),
      used: "fallback",
      error: String(err?.message || err),
    });
  }
}
