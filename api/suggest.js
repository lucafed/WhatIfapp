// /api/suggest.js — Generatore spunti (personalizzate/generiche/assurde) + Oracolo (meta/next/answer)
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
  // picks: { key: {id,label,emoji} } -> string compatta per prompt
  const out = [];
  for (const k of Object.keys(picks || {})) {
    const v = picks[k] || {};
    const id = clampStr(v.id || "", 60);
    const label = clampStr(v.label || "", 120);
    if (!id && !label) continue;
    out.push(`${k}: ${label || id}`);
  }
  return out.join(" | ");
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

/* ============================================================================
   ORACOLO — MODIFICA SOLO QUI (meta/next/answer) per farlo diventare:
   "Obiettivo -> 4 scelte -> piano d'azione"
   ============================================================================ */

function normalizeSeed(seed) {
  const s = clampStr(seed || "", 220).trim();
  return s;
}
function seedFallbackText(L) {
  return L === "en"
    ? "Goal not specified (generic)."
    : "Obiettivo non specificato (generico).";
}

/* ========= Prompt: ORACOLO META (4 step) — ORIENTATO AL PIANO ========= */
function buildOracleMetaPrompt({ lang, voice, seed, seedType }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const goal = normalizeSeed(seed);
  const goalLine = goal ? goal : seedFallbackText(L);

  const tone =
    v === "wtf"
      ? (L === "en"
          ? "Tone: witty, direct, but genuinely helpful and concrete."
          : "Tono: ironico/diretto, ma davvero utile e concreto.")
      : (L === "en"
          ? "Tone: empathic, pragmatic, grounded."
          : "Tono: empatico, pragmatico, concreto.");

  const concept =
    L === "en"
      ? `This Oracle turns a GOAL into a practical plan. The goal is what the user wants to achieve.`
      : `Questo Oracolo trasforma un OBIETTIVO in un piano pratico. L’obiettivo è ciò che l’utente vuole ottenere.`;

  const hardRules =
    L === "en"
      ? `Rules:
- Create EXACTLY 4 steps, always relevant to the goal.
- Each step must capture information needed to craft a plan: (1) target outcome, (2) why/meaning, (3) constraints & risk, (4) strategy style / next action preference.
- Each step has 4–6 options, mutually distinct, simple to understand, no jargon.
- Options must feel like "clickable" choices; short labels.
- Return ONLY JSON.`
      : `Regole:
- Crea ESATTAMENTE 4 step, sempre rilevanti all’obiettivo.
- Ogni step deve raccogliere info utili a costruire un piano: (1) risultato concreto, (2) perché/meaning, (3) vincoli & rischio, (4) stile strategia / preferenza prossima azione.
- Ogni step ha 4–6 opzioni, ben diverse, comprensibili, zero gergo.
- Opzioni "cliccabili": label brevi.
- Restituisci SOLO JSON.`;

  // NB: key stabili (aiuta front-end + coerenza)
  const schema =
    `Return strict JSON with shape:
{
  "ui":{"cta":"..."},
  "steps":[
    {"key":"outcome","title":"...","subtitle":"...","options":[{"id":"...","label":"...","emoji":"..."}]},
    {"key":"why","title":"...","subtitle":"...","options":[{"id":"...","label":"...","emoji":"..."}]},
    {"key":"constraints","title":"...","subtitle":"...","options":[{"id":"...","label":"...","emoji":"..."}]},
    {"key":"strategy","title":"...","subtitle":"...","options":[{"id":"...","label":"...","emoji":"..."}]}
  ]
}`;

  return [
    {
      role: "system",
      content:
        `You generate a 4-step picker UI for an "Oracle" planning feature. ${tone} ${concept}\n${hardRules}\n${schema}`,
    },
    {
      role: "user",
      content:
        `Language: ${L}\nVoice: ${v}\nSeedType: ${String(seedType || "user")}\nGOAL: ${goalLine}\nGenerate the 4 steps now. Return JSON only.`,
    },
  ];
}

/* ========= Prompt: ORACOLO NEXT (adattivo) — stesso concetto, più coerente ========= */
function buildOracleNextPrompt({ lang, voice, picks, startIndex, seed, seedType }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const ctx = compactPicks(picks || {});
  const idx = Number.isFinite(+startIndex) ? Math.max(0, Math.min(3, +startIndex)) : 0;

  const goal = normalizeSeed(seed);
  const goalLine = goal ? goal : seedFallbackText(L);

  const tone =
    v === "wtf"
      ? (L === "en"
          ? "Tone: witty, direct, but actionable."
          : "Tono: ironico/diretto, ma operativo.")
      : (L === "en"
          ? "Tone: empathic, pragmatic, grounded."
          : "Tono: empatico, pragmatico, concreto.");

  const spec =
    L === "en"
      ? `Regenerate remaining steps from index ${idx}..3. Keep the 4-step planning structure aligned to the GOAL. No repetition.`
      : `Rigenera gli step rimanenti da indice ${idx}..3. Mantieni la struttura da piano allineata all’OBIETTIVO. Niente ripetizioni.`;

  return [
    {
      role: "system",
      content:
        `You generate remaining steps for an Oracle planning picker UI. ${tone}\n` +
        `Return ONLY strict JSON with shape: {"steps":[...]} where steps are the FULL remaining steps (index ${idx}..3).\n` +
        `Each step: {"key","title","subtitle","options":[{"id","label","emoji"}]}\n` +
        `Options must be mutually distinct and simple.\n`,
    },
    {
      role: "user",
      content:
        `Language: ${L}\nVoice: ${v}\nSeedType: ${String(seedType || "user")}\nGOAL: ${goalLine}\nAlready picked: ${ctx || "(none)"}\n${spec}\nReturn JSON only.`,
    },
  ];
}

/* ========= Prompt: ORACOLO ANSWER — PIANO PER RAGGIUNGERE OBIETTIVO ========= */
function buildOracleAnswerPrompt({ lang, voice, picks, seed, seedType }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const ctx = compactPicks(picks || {});
  const goal = normalizeSeed(seed);
  const goalLine = goal ? goal : seedFallbackText(L);

  const tone =
    v === "wtf"
      ? (L === "en"
          ? "Voice: witty, blunt, bartender-energy, but genuinely helpful."
          : "Voce: ironica, diretta, da barista affettuoso, ma davvero utile.")
      : (L === "en"
          ? "Voice: empathic, pragmatic, grounded."
          : "Voce: empatica, pragmatica, concreta.");

  // Output: piano, non “frase motivazionale”
  const spec =
    L === "en"
      ? `Return ONLY JSON:
{
 "title":"...",
 "do":"2–4 sentences describing the plan direction clearly (no fluff).",
 "first_step":"ONE concrete action doable in 15 minutes, specific.",
 "rules":[4–6 short rules that keep the user on-track],
 "safety":"One gentle warning about the main risk/trap."
}
Focus: help the user REACH the GOAL. Use picks as constraints/preferences.`
      : `Restituisci SOLO JSON:
{
 "title":"...",
 "do":"2–4 frasi che danno una direzione di piano chiara (niente fuffa).",
 "first_step":"UNA azione concreta fattibile in 15 minuti, specifica.",
 "rules":[4–6 regole brevi per restare in rotta],
 "safety":"Una avvertenza gentile sul rischio/trappola principale."
}
Focus: aiutare l’utente a RAGGIUNGERE l’OBIETTIVO. Usa i pick come vincoli/preferenze.`;

  // Piccolo vincolo: se goal mancante, risposta generica “definisci obiettivo”
  const behavior =
    L === "en"
      ? `If GOAL is missing, make the plan about clarifying the goal first.`
      : `Se manca l’obiettivo, fai un piano per chiarirlo prima.`;

  return [
    { role: "system", content: `You are the Oracle planner. ${tone} ${spec} ${behavior}` },
    {
      role: "user",
      content:
        `Language: ${L}\nVoice: ${v}\nSeedType: ${String(seedType || "user")}\nGOAL: ${goalLine}\nUser picks: ${ctx || "(none)"}\nReturn JSON only.`,
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
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`suggest:${ip}`);
    if (!success) return res.status(429).json({ error: "rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const lang = normLang(body.lang || "it");

    // Ping veloce
    if (body.ping === true) {
      return res.status(200).json({ ok: true, ping: true, model: MODEL, ts: Date.now() });
    }

    const mode = String(body.mode || "suggest");

    // ===== ORACOLO: meta iniziale =====
    if (mode === "oracle_meta") {
      const voice = String(body.voice || "whatif");
      const seed = clampStr(body.seed || "", 220);
      const seedType = clampStr(body.seedType || "user", 20);

      const messages = buildOracleMetaPrompt({ lang, voice, seed, seedType });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 900,
        messages,
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const data = safeJSONPick(raw);

      if (!data || !Array.isArray(data.steps)) throw new Error("bad_oracle_meta_json");

      // micro-normalize + key stabili
      const stepsIn = data.steps.slice(0, 4);

      const keyOrder = ["outcome", "why", "constraints", "strategy"];
      const steps = stepsIn.map((s, i) => ({
        key: clampStr(s.key || keyOrder[i] || `step${i+1}`, 30),
        title: clampStr(s.title || "—", 120),
        subtitle: clampStr(s.subtitle || "", 180),
        options: Array.isArray(s.options) ? s.options.slice(0, 6).map(o => ({
          id: clampStr(o.id || o.label || "x", 50),
          label: clampStr(o.label || o.id || "—", 120),
          emoji: clampStr(o.emoji || "•", 6),
        })) : [],
      }))
      // assicura l’ordine outcome/why/constraints/strategy anche se l’AI sbaglia
      .sort((a,b)=> keyOrder.indexOf(a.key) - keyOrder.indexOf(b.key));

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

      const seed = clampStr(body.seed || "", 220);
      const seedType = clampStr(body.seedType || "user", 20);

      const messages = buildOracleNextPrompt({ lang, voice, picks, startIndex, seed, seedType });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.8,
        top_p: 0.9,
        max_tokens: 900,
        messages,
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const data = safeJSONPick(raw);

      if (!data || !Array.isArray(data.steps)) throw new Error("bad_oracle_next_json");

      const steps = data.steps.slice(0, 4).map((s, i) => ({
        key: clampStr(s.key || `step${startIndex+i+1}`, 30),
        title: clampStr(s.title || "—", 120),
        subtitle: clampStr(s.subtitle || "", 180),
        options: Array.isArray(s.options) ? s.options.slice(0, 6).map(o => ({
          id: clampStr(o.id || o.label || "x", 50),
          label: clampStr(o.label || o.id || "—", 120),
          emoji: clampStr(o.emoji || "•", 6),
        })) : [],
      }));

      return res.status(200).json({ steps, used: "ai" });
    }

    // ===== ORACOLO: answer finale =====
    if (mode === "oracle_answer") {
      const voice = String(body.voice || "whatif");
      const picks = (body.picks && typeof body.picks === "object") ? body.picks : {};

      const seed = clampStr(body.seed || "", 220);
      const seedType = clampStr(body.seedType || "user", 20);

      const messages = buildOracleAnswerPrompt({ lang, voice, picks, seed, seedType });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.8,
        top_p: 0.9,
        max_tokens: 750,
        messages,
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const data = safeJSONPick(raw);

      if (!data || typeof data !== "object") throw new Error("bad_oracle_answer_json");

      return res.status(200).json({
        title: clampStr(data.title || "🔮", 80),
        do: clampStr(data.do || "", 650),
        first_step: clampStr(data.first_step || "", 280),
        rules: Array.isArray(data.rules) ? data.rules.map(x => clampStr(x, 140)).slice(0, 6) : [],
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

    const personalized = (data.personalized || data.personalizzate || []).map(x => finalQ(x, lang)).filter(Boolean).slice(0, 12);
    const generic = (data.generic || data.generiche || []).map(x => finalQ(x, lang)).filter(Boolean).slice(0, 8);
    const absurd = (data.absurd || data.assurde || []).map(x => finalQ(x, lang)).filter(Boolean).slice(0, 4);

    const pools = fallbackPools[lang] || fallbackPools.it;
    const ensure = (arr, need, from) => (arr.length >= need ? arr : [...arr, ...from].slice(0, need));
    const out = {
      personalized,
      generic: ensure(generic, 8, (pools.generic || []).map(s => finalQ(s, lang))),
      absurd: ensure(absurd, 4, (pools.absurd || []).map(s => finalQ(s, lang))),
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
      generic: (pools.generic || []).map(s => finalQ(s, lang)).slice(0, 8),
      absurd: (pools.absurd || []).map(s => finalQ(s, lang)).slice(0, 4),
      used: "fallback",
      error: String(err?.message || err),
    });
  }
}
