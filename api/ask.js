// /api/ask.js — What?f Engine (Stable Hybrid WHATIF + Friendly-WTF Demenziale)
// - WHATIF: 60% analisi / 40% immagini sobrie. Incipit VARIABILE obbligatorio (no “Bella ...”) + tocco psicologo leggero.
// - WTF: da esempi, 2–3 reazioni DEMENZIALI, una sola “imprecazione” teatrale, sorso alcolico, risposta vera, morale.
// - Maiuscole sistemate post-process dopo punto / “…”. Un paragrafo, niente elenchi, niente eco della domanda.

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
// FREE: 3/min — PRO: 10/min (nessuna differenza di modello)
const rlFree = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "1 m") });
const rlPro  = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ========= CORS ========= */
// Whitelist fissa + preview Vercel (branch builds)
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
const VERCEL_PREVIEW_RX = /^https:\/\/[a-z0-9-]+-what-ifapp-[a-z0-9-]+-vercel\.app$/i;

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const ok = ALLOWED_ORIGINS.includes(origin) || VERCEL_PREVIEW_RX.test(origin);
  if (ok) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro"
  );
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it", "en", "es", "fr", "de"];
function normLang(l = "it") {
  const s = String(l || "it").toLowerCase().slice(0, 2);
  return SUP_LANGS.includes(s) ? s : "it";
}

function normLine(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}
function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [], seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    out.push(p);
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
// Evita eco/tracce della domanda
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
  t = t.replace(rx, "");
  return t;
}
// Maiuscole robuste (inizio + dopo .?!… anche con virgolette/parentesi)
function sentenceCaseAll(s = "") {
  if (!s) return s;
  s = s.replace(/^(\s*[«“"'\(\[]*)([a-zà-ÿ])/u, (m, pre, ch) => pre + ch.toUpperCase());
  s = s.replace(/([.!?…]\s+)([«“"'\(\[]*)([a-zà-ÿ])/gu, (m, p, pre, ch) => p + pre + ch.toUpperCase());
  return s;
}
function finalPunct(s = "") {
  return /[.!?…]$/.test(s) ? s : s + ".";
}

function seededPick(arr, seedStr) {
  let x = [...String(seedStr)].reduce((a, c) => (a * 131 + c.charCodeAt(0)) >>> 0, 2166136261);
  x = (x ^ (x >>> 13)) >>> 0;
  const r = x / 2 ** 32;
  return arr[Math.floor(r * arr.length)];
}

/* ========= WHAT IF – incipit multilingua ========= */
const WHATIF_OPENERS = {
  it: [
    "Non è una domanda semplice e lo sai.",
    "Se guardi bene, qui non c’è solo un sì o un no.",
    "Prima di tutto: ha senso che tu sia diviso.",
    "Questa scelta tira da due lati e tu la senti.",
    "Vale la pena trattarla come un esperimento, non un verdetto."
  ],
  en: [
    "This isn’t a simple question and you know it.",
    "Look closely: it’s not just a yes or a no.",
    "First things first: it makes sense you’re torn.",
    "This choice pulls from two sides and you feel it.",
    "Treat it like an experiment, not a verdict."
  ],
  es: [
    "No es una pregunta sencilla y lo sabes.",
    "Si miras de cerca, no es solo un sí o un no.",
    "Para empezar: es normal que estés dividido.",
    "Esta elección tira de dos lados y lo notas.",
    "Conviene tratarlo como un experimento, no como un veredicto."
  ],
  fr: [
    "Ce n’est pas une question simple et tu le sais.",
    "Si tu regardes bien, ce n’est ni un oui ni un non.",
    "D’abord: c’est normal d’être partagé.",
    "Ce choix tire dans deux sens et tu le sens.",
    "Traite-la comme une expérience, pas comme un verdict."
  ],
  de: [
    "Das ist keine einfache Frage und das weißt du.",
    "Wenn du genau hinsiehst, ist es nicht nur Ja oder Nein.",
    "Zuerst: Es ist logisch, dass du hin- und hergerissen bist.",
    "Diese Entscheidung zieht an zwei Seiten, und das spürst du.",
    "Behandle es wie ein Experiment, nicht wie ein Urteil."
  ]
};

const WHATIF_RULE = {
  it: `WHAT IF HYBRID (italiano): 60% analisi concreta (costi/benefici, routine, qualità di vita), 40% immagini sobrie della quotidianità. Incipit analitico VARIABILE scelto da lista; vietato iniziare con “Bella”. 8–10 frasi, seconda persona, paragrafo unico, niente eco della domanda. Tocco psicologo leggero (ambivalenza, normalizzazione, scambio tra tempo/denaro/energia/relazioni).`,
  en: `WHAT IF HYBRID (English): 60% concrete analysis (cost/benefit, routine, quality of life), 40% sober everyday imagery. Start with a VARIABLE opener from the list; never start with “Nice one”. 8–10 sentences, second person, one paragraph, do NOT restate the question. Light therapist touch (name ambivalence, normalize effort, frame trade-offs across time/money/energy/relationships).`,
  es: `WHAT IF HYBRID (español): 60% análisis concreto (coste/beneficio, rutina, calidad de vida), 40% imágenes sobrias cotidianas. Empieza con un INICIO VARIABLE de la lista; nunca empieces con “Qué bonito”. 8–10 frases, segunda persona, un párrafo, sin repetir la pregunta. Toque psicológico ligero (ambivalencia, normalizar, intercambios entre tiempo/dinero/energía/relaciones).`,
  fr: `WHAT IF HYBRID (français): 60% analyse concrète (coût/bénéfice, routine, qualité de vie), 40% images sobres du quotidien. Commence par un OUVERTURE VARIABLE de la liste; ne commence jamais par « Sympa ». 8–10 phrases, deuxième personne, un paragraphe, ne répète pas la question. Touche de psychologue légère (ambivalence, normalisation, arbitrages temps/argent/énergie/relations).`,
  de: `WHAT IF HYBRID (Deutsch): 60% konkrete Analyse (Kosten/Nutzen, Routine, Lebensqualität), 40% nüchterne Alltagsbilder. Beginne mit einem VARIABLEN OPENER aus der Liste; niemals mit „Na toll“. 8–10 Sätze, zweite Person, ein Absatz, Frage nicht wiederholen. Leichte therapeutische Note (Ambivalenz benennen, normalisieren, Trade-offs zwischen Zeit/Geld/Energie/Beziehungen).`
};

// Esempio IT (àncora di ritmo)
const WHATIF_HYBRID_EX_IT = `Sai, questa non è una domanda leggera. Guardi i numeri, poi guardi le abitudini: costi più bassi da una parte, occasioni più larghe dall’altra. La qualità della vita non è un grafico, è una routine: tempi di spostamento, servizi che funzionano, persone che senti vicine. Se stringi, il portafoglio respira un po’ di più; in cambio accetti un ritmo meno veloce e meno “vetrine” da inseguire. Le giornate si accorciano di frenesia e si allungano di fiato: un caffè fatto bene, una strada che conosci, un’aria che sa di casa. Non è una fuga né un eroismo: è ingegneria quotidiana, spostare pesi tra tempo, denaro e relazioni. A conti fatti, potresti guadagnare spazio mentale e perdere solo rumore. E quando la sera chiudi la porta, non senti il rimpianto bussare: senti il tuo passo tornare al suo passo.`;

/* ========= WTF — banca demenziale ========= */
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

/* ========= OpenAI retry helper (soft) ========= */
async function askOpenAI(payload) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      return await client.chat.completions.create(payload);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }) {
  const L = normLang(lang);
  const baseRules =
    L === "en"
      ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
      : L === "es"
      ? `REGLAS: un solo párrafo, sin listas ni emojis. NO repitas la pregunta. Segunda persona.`
      : L === "fr"
      ? `RÈGLES : un seul paragraphe, pas de listes ni d’emojis. NE répète pas la question. Deuxième personne.`
      : L === "de"
      ? `REGELN: ein einziger Absatz, keine Aufzählungen oder Emojis. Die Frage NICHT wiederholen. Zweite Person.`
      : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;

  const temporal =
    String(periodo).toLowerCase() === "past"
      ? L === "en"
        ? "Write as if it already happened."
        : L === "es"
        ? "Escribe como si ya hubiera ocurrido."
        : L === "fr"
        ? "Écris comme si c’était déjà arrivé."
        : L === "de"
        ? "Schreibe, als wäre es bereits passiert."
        : "Scrivi come se fosse già successo."
      : L === "en"
      ? "Write as a near-future unfolding starting now."
      : L === "es"
      ? "Escribe como un futuro cercano que empieza ahora."
      : L === "fr"
      ? "Écris comme un futur proche qui commence maintenant."
      : L === "de"
      ? "Schreibe wie eine nahe Zukunft, die jetzt beginnt."
      : "Scrivi come un prossimo futuro che inizia ora.";

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if (stile === "wtf") {
    // Random deterministico su domanda
    let seed = [...String(domanda)].reduce((a, c) => a + c.charCodeAt(0), 0);
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    }
    const impre = WTF_IMPRE[Math.floor(rnd() * WTF_IMPRE.length)];
    const shuffled = [...WTF_REACT].sort(() => rnd() - 0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd() * 2)); // 2 o 3
    const drink = WTF_DRINK[Math.floor(rnd() * WTF_DRINK.length)];

    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). STRICT sequence: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” (narrated, never insulting people) → THEN ${react.length} absurd object reactions → drink (“${drink}”) → 1–2 lines that truly answer → warm ironic moral. 6–8 sentences.`;
    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Struttura OBBLIGATORIA: presa in giro affettuosa (max 2 frasi) → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”, come narrazione, mai insulto a persone) → SUBITO ${react.length} reazioni di oggetti esilaranti → drink (“${drink}”) → 1–2 frasi che rispondono davvero → morale calda e ironica. 6–8 frasi.`;
    const WTF_RULE_ES = `WHAT THE F (amable, absurdo pero útil). Secuencia ESTRICTA: broma cariñosa (≤2) → 2–3 microcontratiempos → UNA “${impre}” teatral (narrada, nunca insultar a personas) → LUEGO ${react.length} reacciones absurdas de objetos → trago (“${drink}”) → 1–2 líneas que sí responden → moraleja cálida e irónica. 6–8 frases.`;
    const WTF_RULE_FR = `WHAT THE F (amical, absurde mais utile). Séquence STRICTE : taquinerie affectueuse (≤2) → 2–3 micro-couacs → UNE “${impre}” théâtrale (racontée, jamais insultante) → PUIS ${react.length} réactions absurdes d’objets → boisson (“${drink}”) → 1–2 phrases qui répondent vraiment → morale chaleureuse et ironique. 6–8 phrases.`;
    const WTF_RULE_DE = `WHAT THE F (freundlich, absurd aber hilfreich). STRIKTE Reihenfolge: liebevolles Necken (≤2) → 2–3 Mini-Pannen → EINE theatralische „${impre}“ (erzählt, niemanden beleidigen) → DANN ${react.length} absurde Objektreaktionen → Drink („${drink}“) → 1–2 Sätze als echte Antwort → warme, ironische Moral. 6–8 Sätze.`;

    msgs.push(
      { role: "system", content:
          L === "en" ? WTF_RULE_EN :
          L === "es" ? WTF_RULE_ES :
          L === "fr" ? WTF_RULE_FR :
          L === "de" ? WTF_RULE_DE :
          WTF_RULE_IT
      },
      { role: "system", content: `IMPRECATION: ${impre}` },
      { role: "system", content: `REACTIONS:\n- ${react.join("\n- ")}` },
      { role: "system", content: `DRINK: ${drink}` },
      // Esempi IT come àncora di tono
      { role: "system", content:
`ESEMPI VINCOLANTI (tono/ritmo IT):
- Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.
- Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.
- Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.` }
    );
  } else {
    // WHATIF ibrido: INCIPIT VARIABILE + psicologo leggero
    const openers = WHATIF_OPENERS[L] || WHATIF_OPENERS.it;
    const opener = seededPick(openers, domanda);
    msgs.push(
      { role: "system", content: WHATIF_RULE[L] || WHATIF_RULE.it },
      { role: "system", content:
        `APRIRE OBBLIGATORIAMENTE con un incipit tra: ${openers.join(" | ")}. Preferisci: ${opener}. Vietato usare “Bella”.`
      },
      { role: "system", content: `ESEMPIO (respiro e tono IT):\n${WHATIF_HYBRID_EX_IT}` }
    );
  }

  // Istruzione finale all'assistente (nella lingua)
  const ask =
    L === "en"
      ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH. Single paragraph.`
      : L === "es"
      ? `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.`
      : L === "fr"
      ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.`
      : L === "de"
      ? `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.`
      : `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico.`;
  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    // FREE vs PRO via header x-pro: "true" | "1"
    const isPro =
      String(req.headers["x-pro"] || "").toLowerCase() === "true" ||
      String(req.headers["x-pro"] || "") === "1";

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString()
      .split(",")[0]
      .trim();

    const { success } = await (isPro ? rlPro : rlFree).limit(`ask:${ip}:${isPro ? "pro" : "free"}`);
    if (!success) return res.status(429).json({ error: "rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      lang  = "it",
      periodo = "future",
      micro = {}
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, micro });

    const completion = await askOpenAI({
      model: MODEL, // stesso modello per free e pro (richiesta utente)
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // ===== Post-process =====
    answer = stripQuestionEcho(domanda, answer);

    // Forza INCIPIT WHATIF in tutte le lingue (se manca)
    if (stile === "whatif") {
      const L = normLang(lang);
      const openers = WHATIF_OPENERS[L] || WHATIF_OPENERS.it;
      const opener = seededPick(openers, domanda);
      const firstSlice = answer.slice(0, Math.min(160, answer.length)).toLowerCase();
      const hasOpener = openers.some((o) => firstSlice.includes(o.slice(0, 12).toLowerCase()));
      if (!hasOpener) {
        const joiner = /^\s*[.!?…]/.test(answer) ? " " : " ";
        answer = `${opener}${joiner}${answer}`;
      }
    }

    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Moderazioni leggere (IT: evita nomi propri non presenti nella domanda)
    if (normLang(lang) === "it") {
      (function () {
        const d = String(domanda || "");
        const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/gu;
        const inQuestion = new Set(d.match(nameRx) || []);
        answer = answer.replace(nameRx, (m) =>
          inQuestion.has(m) ? m : (["Ah", "Oh", "Ehi", "Sai"].includes(m) ? m : m.toLowerCase())
        );
      })();
    }

    return res.status(200).json({
      answer,
      style: stile,
      lang: normLang(lang),
      periodo,
      model: MODEL,
      pro: isPro
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
