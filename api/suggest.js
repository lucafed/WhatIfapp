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

/* ========= Prompt: ORACOLO META (4 step) ========= */
/**
 * ✅ MODIFICA SOLO ORACLE:
 * - prende goal (obiettivo) e lo usa per generare step PERTINENTI
 * - step 4 NON chiede strategia: fa scegliere “che tipo di supporto/approccio vuoi ricevere”
 * - obbliga a cambiare carte se cambia goal
 */
function buildOracleMetaPrompt({ lang, voice, goal }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const g = clampStr(goal || "", 220);

  const tone =
    v === "wtf"
      ? (L === "en"
          ? "Tone: sharp, ironic, bartender-energy, but still useful and concrete."
          : "Tono: ironico/tagliente, energia da barista, ma comunque utile e concreto.")
      : (L === "en"
          ? "Tone: serious, pragmatic, emotionally intelligent."
          : "Tono: serio, pragmatico, emotivamente intelligente.");

  const spec =
    L === "en"
      ? `Create EXACTLY 4 steps. Each step has key,title,subtitle and 4-6 options. Options have id,label,emoji.`
      : `Crea ESATTAMENTE 4 step. Ogni step ha key,title,subtitle e 4-6 opzioni. Le opzioni hanno id,label,emoji.`;

  const rules =
    L === "en"
      ? `Steps must be aligned to the user's goal. If the goal changes, steps MUST change. No generic filler. No repetition. Options must be mutually distinct.`
      : `Gli step DEVONO essere allineati all’obiettivo dell’utente. Se il goal cambia, gli step DEVONO cambiare. Niente riempitivi generici. Niente ripetizioni. Opzioni ben diverse tra loro.`;

  const stepBlueprint =
    L === "en"
      ? `Step 1: "What outcome exactly?" (scope/target)
Step 2: "Why does it matter?" (motivation/meaning)
Step 3: "What constraints?" (time/money/energy/risk)
Step 4: "How should the Oracle help?" (style of plan: quick wins vs deep plan vs low-risk vs accountability) — DO NOT ask the user for the strategy itself.`
      : `Step 1: "Che risultato preciso?" (ambito/target)
Step 2: "Perché ti serve davvero?" (motivazione/significato)
Step 3: "Quali vincoli hai?" (tempo/soldi/energia/rischio)
Step 4: "Come vuoi che l’Oracolo ti aiuti?" (tipo di piano: quick wins vs piano profondo vs basso rischio vs accountability) — NON chiedere la strategia all’utente.`;

  return [
    {
      role: "system",
      content:
        `You generate a compact multi-step picker UI for an "Oracle" feature. ${tone}\n` +
        `Return ONLY strict JSON with this shape:\n` +
        `{"ui":{"cta":"..."}, "steps":[{"key":"...","title":"...","subtitle":"...","options":[{"id":"...","label":"...","emoji":"..."}]}]}\n` +
        `${spec}\n${rules}\n${stepBlueprint}\n` +
        `IMPORTANT: Each step title/subtitle/options must clearly reference the goal theme. Avoid abstract/meaningless labels.`,
    },
    {
      role: "user",
      content:
        `Language: ${L}\nVoice: ${v}\nGoal (user objective): ${g || "(none provided)"}\n` +
        `Generate the initial 4 steps now. JSON only.`,
    },
  ];
}

/* ========= Prompt: ORACOLO NEXT (adattivo) ========= */
function buildOracleNextPrompt({ lang, voice, picks, startIndex, goal }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const ctx = compactPicks(picks || {});
  const idx = Number.isFinite(+startIndex) ? Math.max(0, Math.min(3, +startIndex)) : 0;
  const g = clampStr(goal || "", 220);

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
      ? `Regenerate steps from index ${idx} to 3, adapting to previous picks AND the goal. Keep steps consistent and non-repetitive.`
      : `Rigenera gli step da indice ${idx} a 3, adattandoli ai pick precedenti E al goal. Mantieni coerenza e niente ripetizioni.`;

  return [
    {
      role: "system",
      content:
        `You generate the remaining steps of an Oracle picker UI. ${tone}\n` +
        `Return ONLY strict JSON with shape: {"steps":[...]} where steps are the FULL remaining steps (index ${idx}..3).\n` +
        `Each step: {"key","title","subtitle","options":[{"id","label","emoji"}]}\n` +
        `Options must be mutually distinct and specific. No duplicates across options.\n` +
        `Do NOT ask the user to choose a "strategy" — step 4 must be "how you want help" not "which strategy to adopt".`,
    },
    {
      role: "user",
      content:
        `Language: ${L}\nVoice: ${v}\nGoal: ${g || "(none)"}\nAlready picked: ${ctx || "(none)"}\n` +
        `${spec}\nReturn JSON only.`,
    },
  ];
}

/* ========= Prompt: ORACOLO ANSWER ========= */
function buildOracleAnswerPrompt({ lang, voice, picks, goal }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const ctx = compactPicks(picks || {});
  const g = clampStr(goal || "", 220);

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
do = 2-4 sentences. first_step = 1 concrete action in 15 minutes. rules = 4-6 short rules. safety = one gentle warning.
The answer must be a practical mini-plan to reach the goal.`
      : `Restituisci SOLO JSON: {"title":"...","do":"...","first_step":"...","rules":[...],"safety":"..."}.
do = 2-4 frasi. first_step = 1 azione concreta in 15 minuti. rules = 4-6 regole brevi. safety = un’avvertenza gentile.
La risposta deve essere un mini-piano pratico per raggiungere il goal.`;

  const goalLine =
    L === "en"
      ? `Goal (objective): ${g || "(none provided)"}`
      : `Goal (obiettivo): ${g || "(non specificato)"}`;

  return [
    { role: "system", content: `You are the Oracle. ${tone}\n${spec}` },
    {
      role: "user",
      content: `Language: ${L}\nVoice: ${v}\n${goalLine}\nUser picks: ${ctx || "(none)"}\nReturn JSON only.`,
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
      const goal = clampStr(body.goal || "", 220); // ✅ goal arriva dal client
      const messages = buildOracleMetaPrompt({ lang, voice, goal });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.95, // ✅ più variazione, meno “template”
        top_p: 0.9,
        max_tokens: 900,
        messages,
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const data = safeJSONPick(raw);

      if (!data || !Array.isArray(data.steps)) throw new Error("bad_oracle_meta_json");

      // micro-normalize
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
      const picks = body.picks && typeof body.picks === "object" ? body.picks : {};
      const startIndex = Number.isFinite(+body.startIndex) ? +body.startIndex : 0;
      const goal = clampStr(body.goal || "", 220); // ✅ (compatibile se lo userai)

      const messages = buildOracleNextPrompt({ lang, voice, picks, startIndex, goal });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.9,
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

    // ===== ORACOLO: answer finale =====
    if (mode === "oracle_answer") {
      const voice = String(body.voice || "whatif");
      const picks = body.picks && typeof body.picks === "object" ? body.picks : {};
      const goal = clampStr(body.goal || "", 220); // ✅ goal entra nella risposta

      const messages = buildOracleAnswerPrompt({ lang, voice, picks, goal });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.85,
        top_p: 0.9,
        max_tokens: 700,
        messages,
      });

      const raw = completion?.choices?.[0]?.message?.content || "";
      const data = safeJSONPick(raw);

      if (!data || typeof data !== "object") throw new Error("bad_oracle_answer_json");

      return res.status(200).json({
        title: clampStr(data.title || "🔮", 80),
        do: clampStr(data.do || "", 600),
        first_step: clampStr(data.first_step || "", 260),
        rules: Array.isArray(data.rules) ? data.rules.map((x) => clampStr(x, 120)).slice(0, 6) : [],
        safety: clampStr(data.safety || "", 240),
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

    const personalized = (data.personalized || data.personalizzate || []).map((x) => finalQ(x, lang)).filter(Boolean).slice(0, 12);
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
