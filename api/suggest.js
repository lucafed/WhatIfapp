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

// hash semplice per cache key (senza crypto)
function djb2(str = "") {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/* ========= Hard guard (server-side) =========
   Blocco per richieste ad alto rischio (autolesionismo, violenza imminente, illeciti gravi).
   Non è perfetto ma tutela in modo concreto.
*/
function isHighRiskText(t = "") {
  const s = String(t || "").toLowerCase();

  // Autolesionismo / suicidio
  const selfHarm = [
    "suicid", "ammazz", "uccidermi", "mi voglio uccidere", "farmI del male", "autolesion",
    "kill myself", "suicide", "self harm", "cut myself",
    "quiero morir", "suicidarme", "me quiero matar", "autolesión",
    "je veux mourir", "suicider", "me tuer", "auto-mutil",
    "ich will sterben", "suizid", "mich töten", "selbstverletz",
  ].some(k => s.includes(k));

  // Violenza / danno a terzi (imminente)
  const violence = [
    "uccidere qualcuno", "fare del male a", "sparare", "accoltellare", "bomba", "esplosiv",
    "kill him", "kill her", "shoot", "stab", "bomb", "explosiv",
    "matar", "disparar", "apuñalar", "bomba",
    "tuer", "tirer", "poignarder", "bombe",
    "töten", "schießen", "erstechen", "bombe",
  ].some(k => s.includes(k));

  // Illeciti gravi / armi / droghe (istruzioni)
  const illegal = [
    "come fare una bomba", "come costruire una bomba", "ricetta bomba", "molotov",
    "how to make a bomb", "build a bomb", "molotov",
    "come fabbricare droga", "cucinare metanfetamina", "meth", "fentanyl",
    "how to cook meth", "make fentanyl",
  ].some(k => s.includes(k));

  return selfHarm || violence || illegal;
}

function blockedMessage(lang) {
  const L = normLang(lang);
  const M = {
    it: {
      title: "Non posso aiutarti su questo.",
      body:
        "Se ti senti in pericolo o stai pensando di farti del male, chiama subito il 112 (Italia) o il numero di emergenza del tuo Paese, oppure parla con qualcuno di fiducia adesso.",
    },
    en: {
      title: "I can’t help with that.",
      body:
        "If you feel in danger or you’re thinking about self-harm, call your local emergency number now, or reach out to someone you trust immediately.",
    },
    es: {
      title: "No puedo ayudarte con eso.",
      body:
        "Si estás en peligro o piensas en hacerte daño, llama ahora al número de emergencias de tu país o habla con alguien de confianza.",
    },
    fr: {
      title: "Je ne peux pas aider avec ça.",
      body:
        "Si tu es en danger ou si tu penses à te faire du mal, appelle immédiatement le numéro d’urgence de ton pays ou contacte une personne de confiance.",
    },
    de: {
      title: "Dabei kann ich nicht helfen.",
      body:
        "Wenn du in Gefahr bist oder daran denkst, dir etwas anzutun, ruf jetzt den Notruf deines Landes an oder wende dich sofort an eine vertraute Person.",
    },
  };
  return M[L] || M.it;
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

/* ========= Prompt: ORACOLO META (4 step) =========
   ✅ ORIENTATO ALL'OBIETTIVO.
   Gli step NON chiedono “strategia”, ma:
   1) Cosa vuoi ottenere (risultato concreto)
   2) Perché ti serve (motivazione)
   3) Vincoli & realtà (tempo/energia/soldi)
   4) Primo passo possibile (tipo di azione / contesto), non strategia.
*/
function buildOracleMetaPrompt({ lang, voice, goal }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const G = clampStr(goal || "", 240);

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
      ? `Create 4 steps aligned to the user's goal. Each step: key,title,subtitle, and 4-6 options. Options: id,label,emoji.`
      : `Crea 4 step ALLINEATI all’obiettivo utente. Ogni step: key,title,subtitle e 4-6 opzioni. Opzioni: id,label,emoji.`;

  const rules =
    L === "en"
      ? `No repetition. Options must be mutually distinct and meaningful. Keep text short and crystal-clear.`
      : `Niente ripetizioni. Opzioni ben diverse e sensate. Testo corto e chiarissimo.`;

  const schema =
    `Return ONLY strict JSON with shape: ` +
    `{"ui":{"cta":"..."}, "steps":[{"key":"...","title":"...","subtitle":"...","options":[{"id":"...","label":"...","emoji":"..."}]}]}`;

  // istruzioni step (sempre uguali), ma “riempite” in modo coerente col goal
  const stepGuideEN = `
Steps MUST map to:
1) Outcome: what exactly you want (concrete result / target)
2) Why: main motivation (identity / relief / growth / freedom etc.)
3) Constraints: time/energy/money/risk tolerance
4) Context: where/how you can act now (solo / with help / learning / networking / micro-test). 
DO NOT ask the user to choose a "strategy". The oracle will decide strategy in the final answer.
`;

  const stepGuideIT = `
Gli step DEVONO essere:
1) Risultato: cosa vuoi ottenere in modo concreto
2) Perché: motivazione principale
3) Vincoli: tempo/energia/soldi/rischio
4) Contesto: dove/come puoi agire adesso (da solo / con aiuto / studio / contatti / micro-test).
NON chiedere “che strategia vuoi adottare”. La strategia la decide l’Oracolo nella risposta finale.
`;

  return [
    {
      role: "system",
      content:
        `You generate a compact multi-step picker UI for an "Oracle" feature. ${tone} ${schema} ${spec} ${rules}`,
    },
    {
      role: "user",
      content:
        `Language: ${L}\nVoice: ${v}\nUser goal (optional): ${G || "(none)"}\n` +
        (L === "en" ? stepGuideEN : stepGuideIT) +
        `Generate the 4 steps now. Return JSON only.`,
    },
  ];
}

/* ========= Prompt: ORACOLO NEXT (adattivo) ========= */
function buildOracleNextPrompt({ lang, voice, picks, startIndex, goal }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const ctx = compactPicks(picks || {});
  const idx = Number.isFinite(+startIndex) ? Math.max(0, Math.min(3, +startIndex)) : 0;
  const G = clampStr(goal || "", 240);

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
      ? `Regenerate steps from index ${idx} to 3, adapting to previous picks and the goal. Keep consistent, no repetition.`
      : `Rigenera gli step da indice ${idx} a 3, adattandoli ai pick precedenti e al goal. Mantieni coerenza, niente ripetizioni.`;

  return [
    {
      role: "system",
      content:
        `You generate the remaining steps of an Oracle picker UI. ${tone} ` +
        `Return ONLY strict JSON with shape: {"steps":[...]} where steps are the FULL remaining steps (index ${idx}..3). ` +
        `Each step: {"key","title","subtitle","options":[{"id","label","emoji"}]} ` +
        `Options must be mutually distinct and specific. No duplicates.`,
    },
    {
      role: "user",
      content:
        `Language: ${L}\nVoice: ${v}\nGoal: ${G || "(none)"}\nAlready picked: ${ctx || "(none)"}\n` +
        `${spec}\nReturn JSON only.`,
    },
  ];
}

/* ========= Prompt: ORACOLO ANSWER ========= */
function buildOracleAnswerPrompt({ lang, voice, picks, goal }) {
  const L = normLang(lang);
  const v = voice === "wtf" ? "wtf" : "whatif";
  const ctx = compactPicks(picks || {});
  const G = clampStr(goal || "", 240);

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
Do = 2-4 sentences. first_step = 1 concrete action in 15 minutes. rules = 4-6 short rules. safety = one gentle warning.`
      : `Restituisci SOLO JSON: {"title":"...","do":"...","first_step":"...","rules":[...],"safety":"..."}.
do = 2-4 frasi. first_step = 1 azione concreta in 15 minuti. rules = 4-6 regole brevi. safety = un’avvertenza gentile.`;

  const goalHintEN = G
    ? `User goal: "${G}". Make the plan directly aligned to this goal.`
    : `No explicit goal provided. Infer a reasonable goal from picks and provide a useful plan.`;

  const goalHintIT = G
    ? `Obiettivo utente: "${G}". Allinea il piano direttamente a questo obiettivo.`
    : `Nessun obiettivo esplicito. Deducilo dai pick e proponi un piano utile.`;

  return [
    { role: "system", content: `You are the Oracle. ${tone} ${spec}` },
    {
      role: "user",
      content:
        `Language: ${L}\nVoice: ${v}\n` +
        (L === "en" ? goalHintEN : goalHintIT) +
        `\nUser picks: ${ctx || "(none)"}\nReturn JSON only.`,
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

    // ===== ORACOLO: meta iniziale (ora dipende dal goal) =====
    if (mode === "oracle_meta") {
      const voice = String(body.voice || "whatif");
      const goal = clampStr(body.goal || "", 240);

      // Hard guard server-side anche qui (non serve ai per roba pericolosa)
      if (isHighRiskText(goal)) {
        const msg = blockedMessage(lang);
        return res.status(200).json({
          blocked: true,
          message: `${msg.title}\n\n${msg.body}`,
        });
      }

      // Cache: stesso goal/lang/voice -> stessa meta (1 ora)
      const cacheKey = `oracle_meta:${lang}:${voice}:${djb2(goal || "(none)")}`;
      try {
        const cached = await redis.get(cacheKey);
        if (cached && typeof cached === "object" && Array.isArray(cached.steps)) {
          return res.status(200).json({ ...cached, used: "cache" });
        }
      } catch {}

      const messages = buildOracleMetaPrompt({ lang, voice, goal });

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

      const out = {
        ui: { cta: clampStr(data?.ui?.cta || (lang === "en" ? "Reveal the Oracle" : "Rivela l’Oracolo"), 40) },
        steps,
        used: "ai",
      };

      // salva cache 1 ora
      try {
        await redis.set(cacheKey, out, { ex: 3600 });
      } catch {}

      return res.status(200).json(out);
    }

    // ===== ORACOLO: next adattivo =====
    if (mode === "oracle_next") {
      const voice = String(body.voice || "whatif");
      const picks = body.picks && typeof body.picks === "object" ? body.picks : {};
      const startIndex = Number.isFinite(+body.startIndex) ? +body.startIndex : 0;
      const goal = clampStr(body.goal || "", 240);

      // Hard guard server-side
      const riskText = `${goal} | ${compactPicks(picks)}`;
      if (isHighRiskText(riskText)) {
        const msg = blockedMessage(lang);
        return res.status(200).json({
          blocked: true,
          message: `${msg.title}\n\n${msg.body}`,
        });
      }

      const messages = buildOracleNextPrompt({ lang, voice, picks, startIndex, goal });

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

    // ===== ORACOLO: answer finale =====
    if (mode === "oracle_answer") {
      const voice = String(body.voice || "whatif");
      const picks = body.picks && typeof body.picks === "object" ? body.picks : {};
      const goal = clampStr(body.goal || "", 240);

      // Hard guard server-side
      const riskText = `${goal} | ${compactPicks(picks)}`;
      if (isHighRiskText(riskText)) {
        const msg = blockedMessage(lang);
        return res.status(200).json({
          blocked: true,
          message: `${msg.title}\n\n${msg.body}`,
        });
      }

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

      // ✅ Safety “intelligente” + chiusura fissa (sempre)
      const safetyBase = clampStr(data.safety || "", 240);
      const fixedTail =
        lang === "en"
          ? " If this involves health, law, major money decisions, or personal safety, talk to a professional."
          : lang === "es"
          ? " Si esto implica salud, ley, dinero importante o seguridad personal, habla con un profesional."
          : lang === "fr"
          ? " Si cela touche à la santé, au droit, à de grosses décisions financières ou à ta sécurité, parle à un professionnel."
          : lang === "de"
          ? " Wenn es um Gesundheit, Recht, größere Geldentscheidungen oder persönliche Sicherheit geht, sprich mit einer Fachperson."
          : " Se riguarda salute, legge, soldi importanti o sicurezza personale, parla con un professionista.";

      const safety = clampStr((safetyBase ? safetyBase + " " : "") + fixedTail, 420);

      return res.status(200).json({
        title: clampStr(data.title || "🔮", 80),
        do: clampStr(data.do || "", 600),
        first_step: clampStr(data.first_step || "", 260),
        rules: Array.isArray(data.rules) ? data.rules.map((x) => clampStr(x, 120)).slice(0, 6) : [],
        safety,
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
