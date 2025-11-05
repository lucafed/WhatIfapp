// /api/ask.js — What?f Engine (robusto: CORS auto, RL tollerante, healthcheck)
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= Env ========= */
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ========= Upstash RL (tollerante) ========= */
let rl = null;
if (UPSTASH_URL && UPSTASH_TOKEN) {
  try {
    const redis = new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN });
    rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });
  } catch (e) {
    console.warn("⚠️ Upstash init failed (proceeding without RL):", e?.message || e);
    rl = null;
  }
}

/* ========= CORS ========= */
// Whitelist base. Aggiungi qui il tuo dominio personalizzato.
const ALLOWED = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:5500",
  "https://what-ifapp.vercel.app",
  // 👇 AGGIUNGI QUI il tuo dominio (https://tuodominio.tld)
  "https://whatifapp.it", // esempio — cambialo con il tuo
]);

function applyCORS(req, res) {
  const origin = String(req.headers.origin || "");
  // Permette il tuo dominio se in ALLOWED. In alternativa puoi usare un wildcard controllato.
  const allow = ALLOWED.has(origin) ? origin : "";
  if (allow) res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro"
  );
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it", "en", "es", "fr", "de"];
const normLang = (l = "it") => {
  const s = String(l || "it").toLowerCase().slice(0, 2);
  return SUP_LANGS.includes(s) ? s : "it";
};

function normLine(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()[\]\-—]+$/g, "")
    .trim();
}
function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    out.push(p);
    seen.add(n);
    if (out.length >= maxSentences) break;
  }
  let t = out.join(" ");
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}
function clampWords(text, maxWords) {
  const w = String(text || "").split(/\s+/);
  if (w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m ? m[1] : slice + "…";
}
function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\.\.+/g, "…")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t
    .slice(0, Math.min(t.length, d.length + 12))
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .trim();
  const rx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  return t.replace(rx, "");
}
function sentenceCaseAll(s = "") {
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g, (m, p, c) => p + c.toUpperCase());
}
function finalPunct(s = "") {
  return /[.!?…]$/.test(s) ? s : s + ".";
}

/* ========= WHAT IF / WTF prompts (come prima) ========= */
const WHATIF_RULES = {
  it: `
Sei "What If": voce calma, empatica, concreta. Scrivi in ITALIANO.
Paragrafo unico, 8–11 frasi, no elenchi né emoji, NON ripetere la domanda.
Sequenza: (1) radice emotiva; (2) perché conta ora; (3) prime settimane;
(4) outlook 3–6 mesi (pro + sfida); (5) realtà pratica (costi/tempo/energia/contesto);
(6) da dove nasce il desiderio; (7) micro-test; (8) criterio interno per decidere.
Stile naturale, immagini quotidiane brevi (non poetiche). Adatta il taglio al tema.
`.trim(),
  en: `
You are "What If": calm, empathetic, practical. Write in ENGLISH.
Single paragraph, 8–11 sentences, no bullets or emojis, do NOT restate the question.
Sequence: (1) emotional root; (2) why now; (3) first weeks; (4) 3–6 month outlook (upsides + challenge);
(5) practical reality (cost/time/energy/context); (6) origin of desire; (7) micro-test; (8) inner criterion.
Keep language natural; short everyday imagery.
`.trim(),
  es: `
Eres "What If": voz calmada, empática y práctica. Escribe en ESPAÑOL.
Un solo párrafo, 8–11 frases, sin listas ni emojis, NO repitas la pregunta.
Secuencia: raíz emocional; por qué ahora; primeras semanas; 3–6 meses; realidad práctica; origen del deseo; micro-prueba; criterio interno.
`.trim(),
  fr: `
Tu es "What If": calme, empathique, concret. Écris en FRANÇAIS.
Un seul paragraphe, 8–11 phrases, pas de listes ni emojis, ne répète pas la question.
Séquence: racine émotionnelle; pourquoi maintenant; premières semaines; 3–6 mois; réalité pratique; origine du désir; micro-test; critère intérieur.
`.trim(),
  de: `
Du bist "What If": ruhig, empathisch, pragmatisch. Schreibe auf DEUTSCH.
Ein Absatz, 8–11 Sätze, keine Listen/Emojis, Frage NICHT wiederholen.
Reihenfolge: emotionale Wurzel; warum jetzt; erste Wochen; 3–6 Monate; praktische Realität; Ursprung; Mikro-Test; inneres Kriterium.
`.trim(),
};

const WTF_IMPRE = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "vulcano d’anatemi",
  "tromba d’aria di improperi",
];
const WTF_REACT = [
  "la moka ti fa una standing ovation e chiede l’autografo",
  "il POS entra in modalità testimone di nozze e benedice la carta",
  "la tapparella si abbassa per pudore e poi sbircia curiosa",
  "la lampada lampeggia in Morse “ti capisco”",
  "Alexa finge un aggiornamento e scappa in modalità monaco",
  "il frigorifero sospira e decide di diventare minimalista",
  "il campanello suona da solo per solidarietà e poi si pente",
  "la pianta applaude con le foglie e ti chiede un drink",
  "il ventilatore gira al contrario “per rispetto”",
  "il citofono fa un trillo come un amen stonato",
];
const WTF_DRINK = [
  "ti versi un amaro doppio e metti in riga i pensieri",
  "fai un sorso corto e il mondo rientra nei bordi",
  "alzi un bicchiere piccolo: brindisi di manutenzione",
  "bevi un dito di coraggio e respiri più largo",
];

function buildMessages({ domanda, lang, periodo, stile }) {
  const L = normLang(lang);
  const baseRules =
    L === "en"
      ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
      : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;
  const temporal =
    String(periodo).toLowerCase() === "past"
      ? L === "en"
        ? "Write as if it already happened."
        : L === "es"
        ? "Escribe como si ya hubiera pasado."
        : L === "fr"
        ? "Écris comme si c’était déjà arrivé."
        : L === "de"
        ? "Schreibe, als wäre es bereits geschehen."
        : "Scrivi come se fosse già successo."
      : L === "en"
      ? "Write as a near-future unfolding starting now."
      : L === "es"
      ? "Escribe como un futuro cercano que empieza ahora."
      : L === "fr"
      ? "Écris comme un futur proche qui commence maintenant."
      : L === "de"
      ? "Schreibe als nahe Zukunft, die jetzt beginnt."
      : "Scrivi come un prossimo futuro che inizia ora.";

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if (stile === "wtf") {
    let seed = [...String(domanda)].reduce((a, c) => a + c.charCodeAt(0), 0);
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    }
    const impre = WTF_IMPRE[Math.floor(rnd() * WTF_IMPRE.length)];
    const shuffled = [...WTF_REACT].sort(() => rnd() - 0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd() * 2));
    const drink = WTF_DRINK[Math.floor(rnd() * WTF_DRINK.length)];
    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Struttura OBBLIGATORIA: presa in giro affettuosa (≤2 frasi) → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”, narrato, mai verso persone) → SUBITO ${react.length} reazioni di oggetti esilaranti → drink (“${drink}”) → 1–2 frasi utili → morale calda. 6–8 frasi.`;
    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). STRICT: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” (narrated, never at people) → THEN ${react.length} absurd object reactions → drink (“${drink}”) → 1–2 helpful lines → warm moral. 6–8 sentences.`;
    msgs.push(
      { role: "system", content: L === "en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content: `IMPRECATION: ${impre}` },
      { role: "system", content: `REACTIONS:\n- ${react.join("\n- ")}` },
      { role: "system", content: `DRINK: ${drink}` }
    );
  } else {
    msgs.push({ role: "system", content: WHATIF_RULES[L] || WHATIF_RULES.it });
  }

  const ask =
    L === "en"
      ? `Question (do NOT repeat it). One single paragraph (8–11 sentences). Keep it natural and concise. "${domanda}"`
      : L === "es"
      ? `No repitas la pregunta. Un solo párrafo (8–11 frases), natural y conciso. "${domanda}"`
      : L === "fr"
      ? `Ne répète pas la question. Un seul paragraphe (8–11 phrases), naturel et concis. « ${domanda} »`
      : L === "de"
      ? `Wiederhole die Frage nicht. Ein einziger Absatz (8–11 Sätze), natürlich und knapp. „${domanda}“`
      : `Non ripetere la domanda. UN SOLO PARAGRAFO (8–11 frasi), naturale e conciso. "${domanda}"`;
  msgs.push({ role: "user", content: ask });
  return msgs;
}

/* ========= Handler ========= */
export default async function handler(req, res) {
  applyCORS(req, res);

  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Healthcheck GET (utile per capire se la route è viva)
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/ask", message: "alive" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    if (!OPENAI_API_KEY) {
      console.error("❌ OPENAI_API_KEY mancante");
      return res.status(500).json({ error: "missing_api_key" });
    }

    // Rate limit (tollerante)
    const ip =
      (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
        .toString()
        .split(",")[0]
        .trim();
    if (rl) {
      try {
        const { success, limit, remaining } = await rl.limit(`ask:${ip}`);
        if (!success) {
          return res.status(429).json({ error: "rate_limited_minute" });
        }
        console.log(`RL ok ip=${ip} remaining=${remaining}/${limit}`);
      } catch (e) {
        console.warn("⚠️ Upstash RL error (ignored):", e?.message || e);
      }
    } else {
      // niente RL configurato
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      periodo = "future",
      micro = {},
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const messages = buildMessages({ domanda, lang, periodo, stile, micro });

    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Fix ITA (L'Aquila)
    if (normLang(lang) === "it") {
      const d = String(domanda || "");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion = new Set(d.match(nameRx) || []);
      answer = answer.replace(nameRx, (m) =>
        inQuestion.has(m) ? m : ["Ah", "Oh", "Ehi", "Sai"].includes(m) ? m : m.toLowerCase()
      );
      answer = answer.replace(/\ball’aquila\b/g, "all’Aquila");
    }

    return res
      .status(200)
      .json({ answer, style: stile, lang: normLang(lang), periodo, model: OPENAI_MODEL });
  } catch (err) {
    // Log esteso per capire 401/500
    console.error("❌ [/api/ask] error", {
      message: err?.message || String(err),
      stack: err?.stack,
      kind: err?.name,
    });
    // Se l’errore è OpenAI 401, esplicitalo
    if (String(err?.message || "").toLowerCase().includes("401"))
      return res.status(502).json({ error: "upstream_unauthorized_openai" });
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
