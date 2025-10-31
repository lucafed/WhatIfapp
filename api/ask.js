// /api/ask.js — What?f Engine (Multilang • Sharp WHATIF split • Absurd WTF)
// Works with fourth.html (lang/mode/style/periodo). One paragraph, second person, no question echo.

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
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin))
    res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro"
  );
}

/* ========= Lang helpers ========= */
const SUP_LANGS = ["it", "en", "es", "fr", "de"];
function normLang(l = "it") {
  const s = String(l || "it").toLowerCase().slice(0, 2);
  return SUP_LANGS.includes(s) ? s : "it";
}
const isEnLike = (lang) => ["en", "es", "fr", "de"].includes(normLang(lang));

/* ========= Text utils ========= */
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
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    if (p.split(/\s+/).length <= 3 && !/[.!?…]$/.test(p)) continue;
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
    .replace(/\s+([.,;:!?…])/g, "$1")
    .trim();
}
function sentenceCaseAll(s = "") {
  // Maiuscole dopo . ! ? …
  return String(s)
    .replace(/(^\s*[a-zà-ÿ])|([.!?…]\s*)([a-zà-ÿ])/g, (m, a, b, c) =>
      a ? a.toUpperCase() : b + c.toUpperCase()
    )
    .trim();
}
function ensureFinalPunct(s = "") {
  return /[.!?…]$/.test(s) ? s : s + ".";
}
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "")
    .replace(/[“”"']/g, "")
    .trim()
    .toLowerCase();
  let t = String(text || "");
  const lead = t
    .slice(0, Math.min(t.length, d.length + 12))
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .trim();
  const rx = /^(?:e\s*se|what\s*if|pregunta|question|frage|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  t = t.replace(rx, "");
  return t;
}

/* ========= Temporal ========= */
function temporalInstruction(periodo = "future", lang = "it") {
  const en = isEnLike(lang);
  if (String(periodo).toLowerCase() === "past") {
    return en
      ? "Write as if it already happened (past/conditional allowed)."
      : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en
    ? "Write as a near-future unfolding starting now."
    : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi fissi (IT) ========= */
const WHATIF_ANALITICO_RX = `Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const WHATIF_POETICO_RX = `Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — few-shots (IT) per ancorare ritmo/tono ========= */
const FEWSHOT_WTF_IT = [
  `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
  `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
  `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

/* ========= WTF — banche demenziali ma “coerenti” al contesto ========= */
const WTF_IMPRECATIONS_IT = [
  "bestemmione corazzato",
  "imprecazione a detonazione controllata",
  "sacramentata a ciel sereno",
  "urlo liturgico strozzato",
  "anatema a grandinata",
  "tromba d’aria di improperi",
];
const WTF_REACTIONS_IT = [
  "la lampada sfarfalla in Morse come se capisse tutto",
  "la moka fischia una standing ovation e poi fa le bolle",
  "il POS recita un rosario di errori e si benedice da solo",
  "la tapparella si abbassa per imbarazzo e poi risale curiosa",
  "il campanile tossisce un amen stonato fuori orario",
  "il citofono fa uno squillo di solidarietà e poi si pente",
  "il ventilatore gira al contrario per reverenza",
  "i bicchieri applaudono in cristallo e chiedono il bis",
  "l’ascensore apre le porte da solo e ti fa l’inchino",
  "il carrello della spesa parte da solo verso il tramonto",
];

/* ========= Regole linguistiche ========= */
function baseRules(lang) {
  const en = isEnLike(lang);
  return en
    ? `RULES: single paragraph, no bullets, no emojis, do NOT restate the question. Second person ONLY. Keep the provided samples' tone exactly.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Solo seconda persona. Mantieni esattamente il tono degli esempi.`;
}

/* Distinzione netta WHAT IF */
function whatIfAnaliticoRule(lang) {
  const en = isEnLike(lang);
  return en
    ? `WHAT IF Analytic style. OPEN with a grounded sentence (no poetry). Focus on trade-offs (work, routines, costs, benefits, time), civic fabric and logistics. Plain cadence, concrete verbs. 135–155 words. Calm synthesis at the end. Do NOT use the poetic sample's imagery; avoid mountains, lovers, echoes.`
    : `WHAT IF Analitico. APRI con una frase concreta (niente poesia). Focus su scambi reali (lavoro, routine, costi/benefici, tempo), tessuto civico e logistica. Cadenza piana, verbi concreti. 135–155 parole. Sintesi finale calma. NON usare immagini del campione poetico; evita montagne, amanti, echi.`;
}
function whatIfRealeRule(lang) {
  const en = isEnLike(lang);
  return en
    ? `WHAT IF Real/Poetic. OPEN like a small cinematic breath. Sensory, domestic images, quiet irony, everyday pace. 135–155 words. Reconciled closing. Do NOT list costs/benefits; keep it experiential.`
    : `WHAT IF Reale/Poetico. APRI con un respiro piccolo e cinematografico. Immagini sensoriali quotidiane, ironia lieve, passo di vita. 135–155 parole. Chiusura riconciliata. NON elencare costi/benefici; resta esperienziale.`;
}

/* WHAT THE F — struttura rigida, comica, “sbronza elegante” */
function wtfRule(lang) {
  const en = isEnLike(lang);
  return en
    ? `WHAT THE F (friendly-chaotic). Be FUNNY, never mean. STRICT SEQUENCE in ONE paragraph (145–165 words):
1) Teasing opening (≤2 sentences).
2) 2–3 tiny mishaps tied to the question's context.
3) Exactly ONE theatrical IMPRECATION (from the provided list), never at people.
4) Immediately 2–3 OBJECT REACTIONS (absurd but context-fitting).
5) Alcoholic sip/shot (no water).
6) 1–2 actually useful lines that answer the question.
7) Warm, ironic moral.
Bans: insults to people, real anger, more than two “!”.`
    : `WHAT THE F (amichevole-caotico). Fai RIDERE, mai cattivo. SEQUENZA OBBLIGATORIA in UN paragrafo (145–165 parole):
1) Apertura di presa in giro (≤2 frasi).
2) 2–3 micro-imprevisti legati al contesto della domanda.
3) ESATTAMENTE UNA IMPRECAZIONE teatrale (dalla lista), mai contro persone.
4) Subito 2–3 REAZIONI DI OGGETTI (assurde ma coerenti).
5) Accenno alcolico (sorso/shot, niente acqua).
6) 1–2 frasi davvero utili che rispondono.
7) Morale calda e ironica.
Divieti: insulti a persone, vera rabbia, più di due “!”.`;
}

/* ========= Seeds per WTF ========= */
function pick(arr, n = 1) {
  const out = [];
  const used = new Set();
  while (out.length < n && used.size < arr.length) {
    const i = Math.floor(Math.random() * arr.length);
    if (used.has(i)) continue;
    used.add(i);
    out.push(arr[i]);
  }
  return out;
}
function wtfSeeds(lang, domanda, micro = {}) {
  const L = normLang(lang);
  const impre = pick(WTF_IMPRECATIONS_IT, 1)[0];
  const reacts = pick(WTF_REACTIONS_IT, 3); // massimo 3
  const opening =
    L === "it"
      ? `Oh {nick}, specialista in problemi artigianali fatti a mano.`
      : `Hey {nick}, artisan of hand-crafted problems.`;
  const nick =
    (micro?.nickname && String(micro.nickname).slice(0, 20)) ||
    (L === "it" ? "campione" : "champion");

  return [
    { role: "system", content: wtfRule(lang) },
    { role: "system", content: `IMPRECATION: ${impre}` },
    { role: "system", content: `REACTIONS:\n- ${reacts[0]}\n- ${reacts[1]}${reacts[2] ? `\n- ${reacts[2]}` : ""}` },
    { role: "system", content: `OPENING: ${opening.replace("{nick}", nick)}` },
    // Few-shots italiani per ancorare comicità/ritmo
    { role: "system", content: `ESEMPI VINCOLANTI (tono/ritmo IT):\n- ${FEWSHOT_WTF_IT[0]}\n- ${FEWSHOT_WTF_IT[1]}\n- ${FEWSHOT_WTF_IT[2]}` },
  ];
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode, micro }) {
  const L = normLang(lang);
  const msgs = [
    { role: "system", content: baseRules(L) },
    { role: "system", content: temporalInstruction(periodo, L) },
  ];

  if (stile === "wtf") {
    msgs.push(...wtfSeeds(L, domanda, micro));
  } else {
    if (mode === "analitico") {
      msgs.push(
        { role: "system", content: whatIfAnaliticoRule(L) },
        { role: "system", content: `ESEMPIO (IT Analitico):\n${WHATIF_ANALITICO_RX}` },
        { role: "system", content: `NON usare l'incipit del poetico; apri con una frase concreta (es. “Di solito inizi da…”, “Se rientri, succede questo…”).` }
      );
    } else {
      msgs.push(
        { role: "system", content: whatIfRealeRule(L) },
        { role: "system", content: `ESEMPIO (IT Poetico):\n${WHATIF_POETICO_RX}` },
        { role: "system", content: `NON elencare costi/benefici; apri con un respiro sensoriale (es. “Apri la finestra…”, “L’aria sa di…”)` }
      );
    }
  }

  // Istruzione finale localizzata
  const ask =
    L === "it"
      ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO a paragrafo unico.`
      : L === "en"
      ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH as a single paragraph.`
      : L === "es"
      ? `Pregunta (no la repitas): "${domanda}". Produce UNA respuesta en ESPAÑOL en un solo párrafo.`
      : L === "fr"
      ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.`
      : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.`;

  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= Post-process specifici ========= */
function keepSingleImprecazione(answer, lang) {
  // Mantieni una sola "bestemmia/imprecaz…" (IT) o "swear" (EN-like)
  const L = normLang(lang);
  const rx = L === "it" ? /\b(bestemmi\w+|imprecazion\w+|anatema\w+|sacrament\w+)\b/gi : /\bswear\w*\b/gi;
  let count = 0;
  return answer.replace(rx, (m) => {
    count += 1;
    return count === 1 ? m : (L === "it" ? "imprecazione a mezza voce" : "a half-whispered swear");
  });
}
function limitExclamations(answer) {
  return answer.replace(/!{3,}/g, "!!");
}
function forbidInsults(answer, lang) {
  const L = normLang(lang);
  const bad = /\b(cazzo|cazzata|stronzo|idiota|cretino|imbecille)\b/gi;
  return L === "it" ? answer.replace(bad, "accidente") : answer;
}
function ensureAlcohol(answer, lang) {
  // forza presenza di un riferimento alcolico non volgare
  const L = normLang(lang);
  const hasDrink = /\b(sorso|goccio|calice|dito|amaro|spritz|whisky|vino|birra|negroni|gin)\b/i.test(answer) ||
                   /\b(sip|shot|whisky|wine|beer|negroni|gin|spritz|toast)\b/i.test(answer);
  if (hasDrink) return answer;
  const line = L === "it" ? "Ti versi un goccio serio e rimetti in fila i pensieri." : "You take a proper sip and line up your thoughts.";
  return ensureFinalPunct(answer) + " " + line;
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    const ip = (
      req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      "unknown"
    )
      .toString()
      .split(",")[0]
      .trim();

    const { success } = await rl.limit(`ask:${ip}`);
    if (!success) return res.status(429).json({ error: "rate_limited_minute" });

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const {
      domanda = "",
      stile = "whatif",           // "whatif" | "wtf"
      mode = "analitico",         // for whatif: "analitico" | "reale"
      lang = "it",                // "it" | "en" | "es" | "fr" | "de"
      periodo = "future",
      micro = {},                 // micro-profili dalla fourth
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res
        .status(400)
        .json({ error: "bad_request", detail: "domanda_required" });

    const messages = buildMessages({
      domanda,
      lang: normLang(lang),
      periodo,
      stile,
      mode,
      micro,
    });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 520,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-process comune
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = ensureFinalPunct(answer);
    answer = limitExclamations(answer);

    if (stile === "wtf") {
      answer = keepSingleImprecazione(answer, lang);
      answer = forbidInsults(answer, lang);
      answer = ensureAlcohol(answer, lang);
    } else {
      // WHAT IF: blocca contaminazioni tra stili
      if (mode === "analitico") {
        // Rimuovi lessico troppo poetico ricorrente
        answer = answer
          .replace(/\b(montagne|eco|vicoli|amante|risata che rimbalza)\b/gi, "routine")
          .replace(/\bprofumo\b/gi, "segno");
      } else {
        // Poetico: rimuovi elenco costi/benefici se comparso
        answer = answer
          .replace(/\b(costi|benefici|stipendi|mutuo|bollette|budget|pro\s*\/\s*contro)\b/gi, "ritmo")
          .replace(/\b(\d+\s*(euro|€|percento|%))\b/gi, "misure piccole");
      }
    }

    // Guard-rail nomi: non introdurre nomi non presenti nella domanda (solo IT)
    if (normLang(lang) === "it") {
      (function () {
        const d = String(domanda || "");
        const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQuestion = new Set(d.match(nameRx) || []);
        answer = answer.replace(nameRx, (m) =>
          inQuestion.has(m)
            ? m
            : ["Ah", "Oh", "Ehi", "Bella", "Sai"].includes(m)
            ? m
            : m.toLowerCase()
        );
      })();
    }

    return res.status(200).json({
      answer,
      style: stile,
      mode,
      lang: normLang(lang),
      periodo,
      model: MODEL,
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res
      .status(500)
      .json({ error: "server_error", detail: String(err?.message || err) });
  }
}
