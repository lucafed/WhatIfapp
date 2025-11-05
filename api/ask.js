// /api/ask.js — What?f Engine (WhatIf naturale + WTF demenziale)
// - WHATIF: voce calma, empatica, concreta. Paragrafo unico, 8–11 frasi,
//           “prime settimane” + outlook 3–6 mesi, micro-azione di test + criterio interno.
// - WTF: come da esempi, 2–3 reazioni demenziali, una sola “imprecazione” teatrale,
//        sorso alcolico, risposta vera, morale.
// - Post-process: maiuscole dopo . ? ! … ; un paragrafo; niente eco domanda; clamp frasi/parole.

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
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it", "en", "es", "fr", "de"];
function normLang(l = "it") {
  const s = String(l || "it").toLowerCase().slice(0, 2);
  return SUP_LANGS.includes(s) ? s : "it";
}

function normLine(s = "") {
  // normalizza per deduplica frasi
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
  t = t.replace(rx, "");
  return t;
}

function sentenceCaseAll(s = "") {
  // Metti maiuscola dopo (. ? ! …) — multilingua
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g, (m, prefix, chr) => prefix + chr.toUpperCase());
}
function finalPunct(s = "") {
  return /[.!?…]$/.test(s) ? s : s + ".";
}

/* ========= WHAT IF — regole & esempi ========= */
const WHATIF_RULE_IT = `
SEI "What If": voce calma, empatica, concreta. Scrivi in ITALIANO.
Obiettivo: lascia 1 sensazione, 1 idea concreta, 1 micro-azione, 1 criterio interno.
OBBLIGATORIO: paragrafo unico, 8–11 frasi, niente elenchi, niente emoji, NON ripetere la domanda.
Stile: semplice e adulto, zero toni “guru”; immagini quotidiane brevi (non poetiche).
Contenuto (sequenza):
1) riconosci la radice emotiva; 2) spiega perché conta adesso;
3) micro-scenario delle PRIME SETTIMANE; 4) outlook a 3–6 MESI (pro + sfida);
5) realtà pratica (costi/tempo/energia/contesto); 6) da dove nasce il desiderio;
7) micro-azione/test per verificarlo; 8) segnale interno per decidere.
Adatta il taglio al tema implicito (città/lavoro/relazioni/soldi/crescita). Linguaggio naturale.
`.trim();

const WHATIF_RULE_EN = `
You are "What If": calm, empathetic, practical. Write in the USER'S LANGUAGE.
Goal: leave 1 feeling, 1 concrete idea, 1 micro-action, 1 inner criterion.
MANDATORY: single paragraph, 8–11 sentences, no lists, no emojis, do not restate the question.
Style: simple and mature; short everyday imagery.
Content (sequence):
1) emotional root; 2) why it matters now; 3) FIRST WEEKS micro-scenario;
4) 3–6 MONTH outlook (upside + challenge); 5) practical reality (cost/time/energy/context);
6) origin of the desire; 7) micro test to verify; 8) inner signal to decide.
Adapt to topic (city/work/relationships/money/growth).
`.trim();

const WHATIF_EXAMPLE_IT = `
Questa domanda nasce quando una parte di te chiede un ritmo più tuo. Le prime settimane avrebbero un sapore familiare e strano insieme: luoghi che riconosci e la testa che corre meno. Dopo un mese arriva la prova vera: confrontarti con chi eri e chi sei adesso, capire se quella differenza ti allarga o ti stringe. Nel concreto guadagni spazio mentale e routine più sane, ma perdi un po’ di vibrazione quotidiana. Se lo vivi come passo in avanti e non ritorno al passato, in sei mesi puoi sentirti più stabile e presente; se ti sembra di rientrare in una versione più piccola di te, tornerà presto voglia di ripartire. Fai un test di due settimane “come se fosse già così”: orari, luoghi, lavoro. Se ti svegli più leggero e non senti di mettere la vita in pausa, non stai tornando: stai iniziando da lì.
`.trim();

const WHATIF_EXAMPLE_EN = `
This question appears when part of you asks for a rhythm that feels more like you. The first weeks feel familiar and odd at once; a month in, the real test is who you were vs who you are now. You gain mental space and steadier routines, but lose some everyday buzz. If it’s a step forward (not a return), in six months you feel more stable and present; if it shrinks you, the urge to move on returns. Run a two-week “as if already true” test: hours, places, work. If you wake up lighter and don’t feel on pause, you’re not going back — you’re starting from there.
`.trim();

/* ========= WTF — banche demenziali ========= */
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

/* ========= Prompt builder ========= */
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
        : "Scrivi come se fosse già successo."
      : L === "en"
      ? "Write as a near-future unfolding starting now."
      : "Scrivi come un prossimo futuro che inizia ora.";

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if (stile === "wtf") {
    // semi deterministici sulla domanda
    let seed = [...String(domanda)].reduce((a, c) => a + c.charCodeAt(0), 0);
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    }
    const impre = WTF_IMPRE[Math.floor(rnd() * WTF_IMPRE.length)];
    const shuffled = [...WTF_REACT].sort(() => rnd() - 0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd() * 2)); // 2 o 3
    const drink = WTF_DRINK[Math.floor(rnd() * WTF_DRINK.length)];

    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Struttura OBBLIGATORIA: presa in giro affettuosa (max 2 frasi) → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”, come narrazione, mai insulto a persone) → SUBITO ${react.length} reazioni di oggetti esilaranti → drink (“${drink}”) → 1–2 frasi che rispondono davvero → morale calda e ironica. Tono da barista affettuoso sbronzo-elegante, mai aggressivo. 6–8 frasi.`;
    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). STRICT sequence: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” (narrated, never insulting people) → THEN ${react.length} absurd object reactions → drink (“${drink}”) → 1–2 lines that truly answer → warm ironic moral. 6–8 sentences.`;

    msgs.push(
      { role: "system", content: L === "en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content: `IMPRECATION: ${impre}` },
      { role: "system", content: `REACTIONS:\n- ${react.join("\n- ")}` },
      { role: "system", content: `DRINK: ${drink}` },
      {
        role: "system",
        content: `ESEMPI VINCOLANTI (tono/ritmo IT):
- Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.
- Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.
- Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
      }
    );
  } else {
    // WHATIF definitivo: breve, naturale, con previsione narrativa e variazione per tema
    const rule = L === "it" ? WHATIF_RULE_IT : WHATIF_RULE_EN;
    const ex = L === "it" ? WHATIF_EXAMPLE_IT : WHATIF_EXAMPLE_EN;

    msgs.push(
      { role: "system", content: rule },
      { role: "system", content: `Esempio/Example (tone & pacing):\n${ex}` },
      {
        role: "system",
        content: `
ADATTAMENTO PER TEMA (se applicabile):
- CITTÀ/RELOCATION: routine, rete, costi, identità; scenario prime settimane + 3–6 mesi.
- LAVORO/CARRIERA: crescita vs fuga, struttura, pipeline contatti, micro-progetto, outlook 90 giorni.
- RELAZIONI: dinamiche nuove vs ruoli vecchi, confini, comunicazione, check onesto 4–6 settimane.
- SOLDI/RISCHIO: tempo prima dei soldi, unità di prova, soglia di uscita, scenario 30–45 giorni.
- CRESCITA PERSONALE: abitudini minime, energia, criteri interni, feedback settimanale, scenario 6–8 settimane.`,
      }
    );
  }

  // Istruzione finale all'assistente (non ripetere domanda, 8–11 frasi, naturale)
  const ask =
    L === "en"
      ? `Question (do NOT repeat it). Write ONE SINGLE PARAGRAPH (8–11 sentences). Keep it natural and concise. "${domanda}"`
      : L === "it"
      ? `Non ripetere la domanda. Scrivi UN SOLO PARAGRAFO (8–11 frasi), naturale e conciso. "${domanda}"`
      : L === "es"
      ? `No repitas la pregunta. Un solo párrafo (8–11 frases), natural y conciso. "${domanda}"`
      : L === "fr"
      ? `Ne répète pas la question. Un seul paragraphe (8–11 phrases), naturel et concis. « ${domanda} »`
      : `Wiederhole die Frage nicht. Ein einziger Absatz (8–11 Sätze), natürlich und knapp. „${domanda}“`;

  msgs.push({ role: "user", content: ask });
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString()
      .split(",")[0]
      .trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if (!success) return res.status(429).json({ error: "rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const {
      domanda = "",
      stile = "whatif", // "whatif" | "wtf"
      lang = "it",
      periodo = "future",
      micro = {},
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const messages = buildMessages({ domanda, lang, periodo, stile, micro });

    const completion = await client.chat.completions.create({
      model: MODEL,
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
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11); // WhatIf fino a 11 frasi
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Moderazione leggera IT: evita nomi propri non presenti nella domanda
    if (normLang(lang) === "it") {
      const d = String(domanda || "");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion = new Set(d.match(nameRx) || []);
      answer = answer.replace(nameRx, (m) =>
        inQuestion.has(m) ? m : ["Ah", "Oh", "Ehi", "Sai"].includes(m) ? m : m.toLowerCase()
      );
      // normalizza "all’aquila" → "all’Aquila"
      answer = answer.replace(/\ball’aquila\b/g, "all’Aquila").replace(/\ba l’aquila\b/g, "all’Aquila");
      answer = answer.replace(/\baquila\b/g, (m) => "Aquila"); // solo se isolato
    }

    return res.status(200).json({
      answer,
      style: stile,
      lang: normLang(lang),
      periodo,
      model: MODEL,
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
