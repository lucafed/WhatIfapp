// /api/ask.js — What?f Engine (Examples-Driven • Multilang • Friendly-WTF)
// by ChatGPT (matches user's reference style exactly)

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

/* ========= Helpers ========= */
const SUP_LANGS = ["it", "en", "es", "fr", "de"];
function normLang(l = "it") {
  const s = String(l || "it").toLowerCase().slice(0, 2);
  return SUP_LANGS.includes(s) ? s : "it";
}
const isEnLike = (lang) => ["en", "es", "fr", "de"].includes(normLang(lang));

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
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [],
    seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    if (p.split(/\s+/).length <= 3 && !/[.!?]$/.test(p)) continue;
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
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
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
function ensureSentenceCase(s = "") {
  const t = s.trim();
  if (!t) return s;
  return t[0].toUpperCase() + t.slice(1);
}
function finalPunct(s = "") {
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
  const rx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
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

/* ========= WHAT IF — ESEMPI VINCOLANTI (IT) ========= */
const WHATIF_ANALITICO_RX = `Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const WHATIF_POETICO_RX = `Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — few-shots (IT) vincolanti di tono ========= */
const FEWSHOT_WTF_IT = [
  `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
  `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
  `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

/* ========= WTF — banche “friendly” (IT + EN) ========= */
const WTF_BANKS_IT = {
  openings: [
    "Ah ma guarda te, {nick}… sempre in trattativa col destino a colpi di caffè.",
    "Oh eccoci, {nick}: campione mondiale di complicarsi la vita con stile.",
    "Bella mossa, {nick}: ti piace vincere facile, eh? Con i controvento in omaggio.",
    "Uè {nick}, specialista in problemi artigianali fatti a mano.",
  ],
  jabs: [
    "testa dura, cuore tenero, timing discutibile",
    "coraggio a secchiate e manuale d’istruzioni perso",
    "piano perfetto, viti avanzate, sorriso incluso",
    "eroe del quotidiano con mantello steso ad asciugare",
  ],
  imprecations: [
    "ti scappa una bestemmia a fisarmonica che entra ed esce come aria d’altura",
    "ti parte un bestemmione da cartone animato che vibra come un basso funk",
    "lasci andare una bestemmiata elastica che rimbalza sui muri e torna educata",
    "srotoli una bestemmia in slow-motion, tutta coreografia e zero veleno",
    "ti esce una bestemmia frizzante che fa le bollicine come l’acqua tonica",
    "scocca una bestemmia da manuale, con manuale incluso e firma in calce",
  ],
  reactions: [
    "la lampada sfarfalla in Morse e pare dirti «ricevuto»",
    "il frigorifero sospira e decide di diventare minimalista",
    "la tapparella si abbassa per imbarazzo e poi sbircia",
    "il POS finge un aggiornamento e si mette in «timido»",
    "la moka fa una standing ovation a vapore",
    "il citofono squilla per solidarietà e poi si pente",
    "il ventilatore gira al contrario per educazione",
    "la sedia scricchiola come se volesse applaudire piano",
  ],
  drinks: [
    "ti versi un goccio onesto e rimetti a posto i pensieri",
    "scegli un sorso corto, per mettere il mondo in riga",
    "alzi un calice piccolo: brindisi di manutenzione",
    "bevi un dito di coraggio e respiri più largo",
  ],
  morales: [
    "Morale: il caos non si doma, gli si dà del tu.",
    "Morale: se non si allinea, lo porti a bere e poi si convince.",
    "Morale: quando ride prima tu, il resto si arrangia.",
    "Morale: metà fortuna, metà mestiere, zero rancore.",
  ],
};

const WTF_BANKS_EN = {
  openings: [
    "Well, look at you, {nick}—negotiating with fate over a coffee.",
    "Here we go, {nick}: world champ of complicating life with style.",
    "Bold move, {nick}. You like winning uphill with a grin.",
    "Hey {nick}, artisan of hand-crafted problems.",
  ],
  jabs: [
    "stubborn head, soft heart, questionable timing",
    "courage by the bucket, lost manual",
    "perfect plan, extra screws, cheerful smile",
    "everyday hero with cape in the laundry",
  ],
  imprecations: [
    "a cartoon-grade ‘swear’ that wobbles like a funk bass",
    "a concertina ‘swear’ that breathes in and out politely",
    "a slow-motion ‘swear’—all choreography, zero venom",
    "a sparkling ‘swear’ that bubbles like tonic water",
    "a handbook ‘swear’, signed and stamped for the archives",
  ],
  reactions: [
    "the lamp blinks in Morse like it got the memo",
    "the fridge sighs and goes minimalist",
    "the shutter lowers in embarrassment, then peeks",
    "the card reader pretends to update and turns shy",
    "the moka pot gives a tiny standing ovation",
    "the door buzzer rings in solidarity and regrets it",
    "the fan spins backward out of respect",
    "the chair creaks as if clapping quietly",
  ],
  drinks: [
    "you pour an honest splash and line up your thoughts",
    "you choose a short sip and the world straightens",
    "you raise a small glass: maintenance toast",
    "you drink a finger of courage and breathe wider",
  ],
  morales: [
    "Moral: you don’t tame chaos—you call it by name.",
    "Moral: if it won’t align, buy it a drink and it might.",
    "Moral: laugh first, the rest falls in line.",
    "Moral: half luck, half craft, zero grudges.",
  ],
};

/* ========= Linguistic rules ========= */
function baseRules(lang) {
  const en = isEnLike(lang);
  return en
    ? `RULES: single paragraph, no bullets, no emojis, do NOT restate the question. Second person only. Keep the user's samples' tone exactly.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Solo seconda persona. Mantieni esattamente il tono degli esempi.`;
}

function whatIfAnaliticoRule(lang) {
  const en = isEnLike(lang);
  return en
    ? `WHAT IF Analytic: concrete tradeoffs, routine, cost/benefit. Match the cadence of the Italian sample. 8–10 sentences; calm closing.`
    : `WHAT IF Analitico: scambi concreti, routine, costi/benefici. Stessa cadenza dell’esempio. 8–10 frasi; chiusura calma.`;
}

function whatIfPoeticoRule(lang) {
  const en = isEnLike(lang);
  return en
    ? `WHAT IF Real/Poetic: sober sensory images; same breathing as the sample. 8–10 sentences; reconciled closing.`
    : `WHAT IF Reale/Poetico: immagini sobrie e quotidiane; stesso respiro dell’esempio. 8–10 frasi; chiusura riconciliata.`;
}

function wtfFriendlyRule(lang) {
  const en = isEnLike(lang);
  return en
    ? `WHAT THE F (friendly). Be funny, never aggressive. STRICT STRUCTURE (one paragraph): OPENING (playful tease, ≤2 sentences) → 2–3 tiny mishaps → EXACTLY ONE theatrical ‘swear’ (use IMPRECATION; never against people) → THEN 2 OBJECT REACTIONS → DRINK → 1–2 useful lines that truly answer → WARM IRONIC MORAL. 6–8 sentences total. Bans: insults to people, anger, >2 “!”.`
    : `WHAT THE F (amichevole). Fai ridere, mai aggressivo. STRUTTURA OBBLIGATORIA (un paragrafo): APERTURA (presa in giro affettuosa, ≤2 frasi) → 2–3 micro-imprevisti → ESATTAMENTE UNA “imprecazione” teatrale (usa IMPRECAZIONE; mai contro persone) → POI 2 REAZIONI DI OGGETTI → DRINK → 1–2 frasi che rispondono davvero → MORALE CALDA E IRONICA. Totale 6–8 frasi. Divieti: insulti a persone, rabbia, più di due “!”.`;
}

/* ========= Random seeds per WTF ========= */
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
  const L = normLang(lang) === "it" ? WTF_BANKS_IT : WTF_BANKS_EN;
  const nick =
    (micro?.nickname && String(micro.nickname).slice(0, 20)) ||
    (normLang(lang) === "it" ? "campione" : "champion");

  const opening =
    pick(L.openings, 1)[0].replace("{nick}", nick) +
    (Math.random() < 0.7 ? `: ${pick(L.jabs, 1)[0]}.` : "");
  const impre = pick(L.imprecations, 1)[0];
  const reacts = pick(L.reactions, 2);
  const drink = pick(L.drinks, 1)[0];
  const moral = pick(L.morales, 1)[0];

  return [
    { role: "system", content: wtfFriendlyRule(lang) },
    { role: "system", content: `IMPRECATION: ${impre}` },
    { role: "system", content: `REACTIONS:\n- ${reacts[0]}\n- ${reacts[1]}` },
    { role: "system", content: `DRINK: ${drink}` },
    { role: "system", content: `MORAL: ${moral}` },
    { role: "system", content: `OPENING: ${opening}` },
  ];
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode, micro }) {
  const msgs = [
    { role: "system", content: baseRules(lang) },
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  if (stile === "wtf") {
    msgs.push(
      ...wtfSeeds(lang, domanda, micro),
      { role: "system", content: `ESEMPI VINCOLANTI (tono/ritmo IT):\n- ${FEWSHOT_WTF_IT[0]}\n- ${FEWSHOT_WTF_IT[1]}\n- ${FEWSHOT_WTF_IT[2]}` }
    );
  } else {
    if (mode === "analitico") {
      msgs.push(
        { role: "system", content: whatIfAnaliticoRule(lang) },
        { role: "system", content: `ESEMPIO (IT):\n${WHATIF_ANALITICO_RX}` }
      );
    } else {
      msgs.push(
        { role: "system", content: whatIfPoeticoRule(lang) },
        { role: "system", content: `ESEMPIO (IT):\n${WHATIF_POETICO_RX}` }
      );
    }
  }

  const L = normLang(lang);
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

/* ========= Post-process specifico WTF ========= */
function keepSingleImprecazione(answer, lang) {
  const rx = normLang(lang) === "it" ? /\bbestemmi\w*/gi : /\bswear\w*/gi;
  let count = 0;
  return answer.replace(rx, (m) => {
    count += 1;
    return count === 1 ? m : (normLang(lang) === "it" ? "imprecazione a mezza voce" : "a half-whispered swear");
  });
}
function ensureDrink(answer, seedsObj) {
  const hasDrink =
    /\b(sorso|calice|goccio|dito|brindisi|bere|drink|glass|sip|toast)\b/i.test(
      answer
    );
  if (hasDrink) return answer;
  // Se manca il drink, aggiungo la frase del seed prima della morale (o in coda).
  const drinkLine = ensureSentenceCase(seedsObj?.drink || "ti versi un goccio onesto e rimetti a posto i pensieri") + ".";
  const moraleRx = /(Morale:|Moral:)/i;
  if (moraleRx.test(answer)) {
    return answer.replace(moraleRx, `${drinkLine} $1`);
  }
  return finalPunct(answer) + " " + drinkLine;
}
function limitExclamations(answer) {
  return answer.replace(/!{3,}/g, "!!");
}
function forbidInsults(answer, lang) {
  const bad = /\b(cazzo|cazzata|stronzo|idiota|cretino|imbecille)\b/gi;
  return answer.replace(bad, normLang(lang) === "it" ? "accidente" : "heck");
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
      stile = "whatif", // "whatif" | "wtf"
      mode = "analitico", // per whatif: "analitico" | "reale"
      lang = "it",
      periodo = "future",
      micro = {}, // micro-profili dalla fourth
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res
        .status(400)
        .json({ error: "bad_request", detail: "domanda_required" });

    const messages = buildMessages({
      domanda,
      lang,
      periodo,
      stile,
      mode,
      micro,
    });

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

    // Post-process comune
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    answer = ensureSentenceCase(answer);
    answer = finalPunct(answer);

    if (stile === "wtf") {
      // Conserva comicità: niente filtri che spengono il tono
      answer = keepSingleImprecazione(answer, lang);
      answer = limitExclamations(answer);
      answer = forbidInsults(answer, lang);
      // Assicura DRINK presente
      // NB: ricreo seeds per recuperare la riga drink usata nel prompt
      const L = normLang(lang) === "it" ? WTF_BANKS_IT : WTF_BANKS_EN;
      const drink = pick(L.drinks, 1)[0];
      answer = ensureDrink(answer, { drink });
    } else {
      // WHAT IF: solo pulizia fine
      answer = limitExclamations(answer);
    }

    // Evita nomi non presenti nella domanda (solo IT)
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

    return res
      .status(200)
      .json({ answer, style: stile, mode, lang: normLang(lang), periodo, model: MODEL });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res
      .status(500)
      .json({ error: "server_error", detail: String(err?.message || err) });
  }
}
