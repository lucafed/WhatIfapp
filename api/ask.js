// /api/ask.js — What?f Engine (FINAL EXPLOSIVE LOCKED)
// Stili: whatif (analitico | reale) · wtf
// IT/EN — paragrafo singolo, niente liste/emojis, solo seconda persona
// Rate 10/min per IP; Free 3/giorno · PRO 10/giorno

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
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
function normLine(s = "") {
  return String(s).toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").replace(/[.,;:!?()\[\]\-—]+$/g, "").trim();
}
function tightenSentences(text, maxSentences) {
  const parts = String(text || "").replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  const out = [], seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    if (p.split(/\s+/).length <= 3 && !/[.!?]$/.test(p)) continue;
    out.push(p); seen.add(n);
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
  return String(s).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}
function stripQuestionEcho(domanda, text) {
  const rx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  let t = String(text || "");
  t = t.replace(rx, "");
  return t;
}

/* ========= Modalità temporale ========= */
function temporalInstruction(periodo = "future", lang = "it") {
  const en = isEn(lang);
  if (String(periodo).toLowerCase() === "past") {
    return en ? "Write as if it already happened (past/conditional allowed)." : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en ? "Write as a near-future unfolding starting now." : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi ========= */
const EX_WHATIF_ANALITICO_IT =
  `Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const EX_WHATIF_REALE_IT =
  `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — esempi ========= */
const EX_WTF_MOTO_IT =
  `Ti convinci che la moto sia la cura definitiva contro la noia: libertà, vento, romanticismo a due ruote. I primi metri sembrano un film, poi il copione cambia: casco che appanna, giacca che s’incolla, GPS che ti manda dentro una rotonda infinita e un piccione che ti elegge pista d’atterraggio. A quel punto ti esplode un bestemmione corazzato, un suono primordiale che fa tremare le vetrine e interrompe la messa delle 18. Il semaforo lampeggia per rispetto, un cane smette di abbaiare e un tizio in bici applaude in silenzio. Ti fermi al bar più vicino per una sbronza elegante — doppio amaro e birra anti-trauma — e giuri che domani ci riprovi solo col sole. Poi guardi la moto da fuori, grondante come te, e pensi: sì, va bene così — tanto la libertà, se non ti bagna, non vale niente.`;

const EX_WTF_PACE_IT =
  `Ti presenti elegante e il destino in ciabatte. Pensi che fare pace sia un tè con i biscotti e due scuse perfette. Poi il messaggio resta su “sta scrivendo…”, il telefono cade nella tazza, la foto del vostro peggior litigio spunta come notifica, e il cuore ti tamburella come una batteria in prova. Ti esplode un’imprecazionona a detonazione che fa tremare i portafoto; la lampada sfarfalla in Morse, il POS recita un rosario di errori, e il cane del vicino prende appunti. Ti versi un bicchiere di rosso “per lucidare la sincerità” e ti presenti con voce da sopravvissuto. L’abbraccio è goffo ma intero: le parole inciampano e si rialzano. Alla fine, il silenzio è un applauso lento. Pace fatta, pure il semaforo lampeggia in verde per solidarietà.`;

/* ========= Sinonimi esplosivi (sfogo) ========= */
const WTF_SFOGO_STRONG = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "para-bestemmia a raffica",
  "madonna della miseria urlata",
  "anatema a grandinata",
  "urlo liturgico strozzato",
  "embolata sacrilega"
];

/* ========= Reazioni per contesto ========= */
const WTF_REACTIONS = {
  generic: [
    "la lampada fa facepalm e poi sfarfalla in Morse",
    "il campanile tossisce un amen stonato",
    "la tapparella si abbassa per imbarazzo e poi risale curiosa",
    "la statua all’angolo si copre gli occhi e sbircia tra le dita",
    "Alexa finge un aggiornamento e scappa in modalità ‘non disturbare’",
    "il citofono fa uno squillo di solidarietà e poi si pente",
    "i bicchieri applaudono in cristallo e chiedono il bis",
    "il ventilatore fa l’inchino e gira al contrario per reverenza",
    "la macchina del caffè sputa un getto a fontana come applauso",
    "la porta automatica si apre da sola, poi si vergogna e si richiude"
  ],
  moto: [
    "il semaforo passa al rosso per rispetto e resta zitto",
    "il casco fischia come un arbitro offeso",
    "l’autovelox lampeggia in applauso muto",
    "il benzinaio annuisce come un confessore con la pompa",
    "la visiera appanna in standing ovation"
  ],
  bar: [
    "la moka fischia standing ovation",
    "il POS recita un rosario di errori e si benedice da solo",
    "il registratore di cassa batte uno scontrino con scritto ‘amen’",
    "i cucchiaini tintinnano come una platea nervosa"
  ],
  studio: [
    "il proiettore lampeggia amen",
    "le fotocopie cadono in processione",
    "la macchinetta del caffè eroga solo acqua santa",
    "il Wi-Fi si fa il segno della croce e riparte a scatti"
  ],
  pace: [
    "la cornice sul mobile vibra e mette a fuoco da sola",
    "il citofono tossisce un ‘scusate’",
    "la pianta in salotto raddrizza le foglie come in parata"
  ]
};

/* ========= Chiusure di contesto ========= */
const WTF_CLOSERS = {
  moto: [
    "Domani riparti col sole, e giuri che alla prima curva riderai più forte del motore",
    "Ti rimetti in sella: il casco pesa meno, e la strada promette di ricordarsi il tuo nome",
    "Capisci che la libertà sa bagnarti e asciugarti: la prossima volta scegli tu quando farlo"
  ],
  bar: [
    "Stappi il silenzio come fosse un amaro: domani il bancone ti troverà più preparato del caos",
    "Il ghiaccio canta nell’amaro: dopodomani anche il POS farà pace con te",
    "Ti sistemi il grembiule: la mattina dopo il primo caffè avrà il sapore di una tregua"
  ],
  studio: [
    "Riapri il libro: tra due pagine troverai la pazienza, e tra tre la risposta che cercavi",
    "Ti siedi meglio: domani il Wi-Fi ti benedirà e il prof parlerà in lingua umana",
    "Ti prometti un capitolo al giorno: entro una settimana l’ansia smette di darti del tu"
  ],
  pace: [
    "L’abbraccio tiene: tra una settimana riderete di quella chat infinita",
    "Cammini più leggero: da domani i saluti non saranno più prove di coraggio",
    "La porta si chiude piano: la prossima volta basterà un caffè, non un armistizio"
  ],
  generic: [
    "Fai due passi: domani il mondo ti farà l’occhiolino prima di metterti alla prova",
    "Respiri: la prossima volta il caos arriva in orario e tu lo fai accomodare",
    "Sorridi storto: dopodomani la stessa scena ti sembrerà solo un buon aneddoto"
  ]
};

/* ========= Aperture ironiche (rotazione) ========= */
const WTF_OPENINGS = [
  "Ah ma guarda te, …",
  "Oh, eccoci, …",
  "Ti presenti elegante e il destino in ciabatte, …",
  "Giornata da manuale, capitolo imprevisti, …",
  "Hai studiato tutto, tranne il caos, …",
  "Sembra facile finché non tocca a te, …"
];

/* ========= Regole ========= */
const TECH_RULES_BASE = (lang) => (isEn(lang)
  ? `RULES:
- One paragraph. No bullets, no emojis, do NOT restate the question.
- Near-future tense. Second person only. No first-person narrator.
- No invented names. Use only those from the question.
- LENGTH: WHATIF ≈ 135–155 words. WTF ≈ 145–165 words.`
  : `REGOLE:
- Un solo paragrafo, niente elenchi/emoji, NON ripetere la domanda.
- Tempo: prossimo futuro. Solo seconda persona ("tu").
- Nomi: non inventare nomi.
- LUNGHEZZA: WHATIF ≈ 135–155 parole · WTF ≈ 145–165 parole.`);

const WHATIF_ANALITICO_STYLE_IT = `Tono concreto e sobrio: cornice economica/sociale, vincoli e scambi reali. Evita slogan. Usa "tu". Incipit tipo "Sai, questa domanda girava nell’aria da un po’". Chiudi con sintesi calma.`;
const WHATIF_REALE_STYLE_IT = `Tono sensoriale/poetico asciutto. Usa "tu". Incipit tipo "Bella questa — me l’aspettavo da te." Chiudi riconoscendo tempo e luogo come alleati.`;

const WTF_STRICT_IT = (openingShape) => `WTF:
1) Inizia esattamente con «${openingShape}».
2) 2–3 frasi di presa in giro (roasting).
3) 4 micro-imprevisti comici e realistici (coerenti col contesto della domanda).
4) Esplosione viscerale UNA sola volta: scegli tra ${WTF_SFOGO_STRONG.join(", ")}.
5) Subito dopo 2–4 reazioni teatrali coerenti col contesto.
6) Beat alcolico visibile (sbronza elegante ammessa).
7) Chiusura ironica o poetica breve con mini-profezia/callback.
Niente morale, ritmo serrato, risposta reale alla domanda.`;

/* ========= Aperture rotanti ========= */
async function pickRotating(list, key) {
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 86400);
    return list[(n - 1) % list.length];
  } catch {
    return list[Math.floor(Math.random() * list.length)];
  }
}

/* ========= Context detector ========= */
function detectContext(domanda) {
  const q = String(domanda || "").toLowerCase();
  if (/\bmoto|motor|scooter|casco|asfalt|semafor|visiera|benzina/i.test(q)) return "moto";
  if (/\bbar|caff[eè]|moka|pos|tazzin|bancone|spritz|amaro/i.test(q)) return "bar";
  if (/\bstudi|esame|universit|lezion|prof|libri|scuol|wi[-\s]?fi/i.test(q)) return "studio";
  if (/\bpace|scusar|chiarir|riconcil|parlare col passato|io di \d+ anni|me di/i.test(q)) return "pace";
  return "generic";
}

/* ========= Prompt builder ========= */
async function buildMessages({ domanda, lang, periodo, stile, mode, ip }) {
  const msgs = [
    { role: "system", content: TECH_RULES_BASE(lang) },
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  if (stile === "wtf") {
    const opening = await pickRotating(WTF_OPENINGS, `rot:wtf:${ip}`);
    msgs.push(
      { role: "system", content: WTF_STRICT_IT(opening) },
      { role: "system", content: `ESEMPIO · WTF (IT) · Moto\n${EX_WTF_MOTO_IT}` },
      { role: "system", content: `ESEMPIO · WTF (IT) · Pace\n${EX_WTF_PACE_IT}` },
    );
  } else {
    if (mode === "analitico") {
      msgs.push(
        { role: "system", content: WHATIF_ANALITICO_STYLE_IT },
        { role: "system", content: `ESEMPIO · WHAT IF (IT) · Analitico\n${EX_WHATIF_ANALITICO_IT}` },
      );
    } else {
      msgs.push(
        { role: "system", content: WHATIF_REALE_STYLE_IT },
        { role: "system", content: `ESEMPIO · WHAT IF (IT) · Reale\n${EX_WHATIF_REALE_IT}` },
      );
    }
  }

  msgs.push({
    role: "user",
    content: `Domanda (NON ripeterla): "${domanda}". Genera UNA risposta in ${lang.toUpperCase()} in un solo paragrafo.`,
  });
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unk").toString().split(",")[0].trim();
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit + crediti
    const { success } = await rl.limit(`ask:${ip}`);
    if (!success) return res.status(429).json({ error: "rate_limited_minute" });

    let used = 0, dailyCap = isPro ? 10 : 3;
    const today = new Date().toISOString().slice(0, 10);
    const key = `credits:${ip}:${today}`;
    used = (await redis.incr(key)) ?? 1;
    if (used === 1) await redis.expire(key, 60 * 60 * 24);
    if (used > dailyCap) return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });

    // Body
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", mode = "reale", lang = "it", periodo = "future" } = body;
    if (!domanda || typeof domanda !== "string") return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const messages = await buildMessages({ domanda, lang, periodo, stile, mode, ip });

    // ===== Completion + Post-processing con sequenza blindata WTF =====
    let answer = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: stile === "wtf" ? (attempt ? 1.0 : 0.98) : (mode === "analitico" ? 0.68 : 0.72),
        top_p: stile === "wtf" ? 0.92 : 0.90,
        max_tokens: 480,
        frequency_penalty: 0.1,
        presence_penalty: 0.0,
        messages: attempt === 0 ? messages : [
          ...messages.slice(0, -1),
          { role: "system", content: "RIGENERA in stile WTF puro rispettando tassativamente la sequenza e usando reazioni coerenti al contesto. Vietato il tono analitico/poetico." },
          messages[messages.length - 1],
        ],
      });

      answer = completion?.choices?.[0]?.message?.content?.trim() || "";
      answer = stripQuestionEcho(domanda, answer);
      answer = normalizeOneParagraph(answer);

      if (stile === "wtf") {
        // 1) Garantire sfogo UNA volta (inserito dopo ~4 frasi)
        const hasSfogo = WTF_SFOGO_STRONG.some(s => answer.toLowerCase().includes(s.split(" ")[0]));
        if (!hasSfogo) {
          const pick = WTF_SFOGO_STRONG[Math.floor(Math.random() * WTF_SFOGO_STRONG.length)];
          const sentences = answer.split(/(?<=[.!?])\s+/);
          const injIdx = Math.min(4, Math.max(2, sentences.length - 3));
          sentences.splice(injIdx, 0, `Ti esplode un ${pick} che fa tremare pure i santi di gesso.`);
          answer = sentences.join(" ");
        }

        // 2) Reazioni subito dopo sfogo (una sola volta)
        const ctx = detectContext(domanda);
        const bank = [
          ...(WTF_REACTIONS.generic || []),
          ...((WTF_REACTIONS[ctx] || []))
        ];
        let parts = answer.split(/(?<=[.!?])\s+/);
        let sfogoIdx = parts.findIndex(p => /ti esplode un/i.test(p));
        if (sfogoIdx === -1) sfogoIdx = Math.min(4, parts.length - 2);

        const nearby = parts.slice(sfogoIdx, sfogoIdx + 3).join(" ");
        const reactedRx = /(sfarfalla|moka|semaforo|proiettore|citofono|tazzine|autovelox|campanile|statua|ventilatore|tapparella|pos\b)/i;

        if (!reactedRx.test(nearby)) {
          const pool = [...bank];
          const num = 2 + Math.floor(Math.random() * 3); // 2–4 reazioni
          const add = [];
          for (let i = 0; i < num && pool.length; i++) add.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
          parts.splice(sfogoIdx + 1, 0, add.join(", ") + ".");
        }

        answer = parts.join(" ");

        // 3) Beat alcolico (se manca)
        if (!/\b(bar|amaro|birra|vino|spritz|whisky|grappa|negroni|sbronza|corretto)\b/i.test(answer)) {
          parts = answer.split(/(?<=[.!?])\s+/);
          sfogoIdx = parts.findIndex(p => /ti esplode un/i.test(p));
          const afterIdx = Math.min(sfogoIdx + 2, parts.length - 1);
          const alcoholBeat = ctx === "bar"
            ? "Ti versi un bicchierino professionale e un respiro lungo come uno scontrino"
            : "Ti rifugi al bar per una sbronza elegante: amaro doppio e un sorso di birra che spegne il fumo in testa";
          parts.splice(afterIdx, 0, alcoholBeat + ".");
          answer = parts.join(" ");
        }

        // 4) Chiusura di contesto (sempre)
        const closers = WTF_CLOSERS[ctx] || WTF_CLOSERS.generic;
        const close = closers[Math.floor(Math.random() * closers.length)];
        if (!/(domani|dopodomani|settimana|prossima volta|alla fine|capisci che)\b/i.test(answer)) {
          answer = answer.replace(/\s*$/, " ") + close + ".";
        }
      }

      // Stringiamo SOLO ora (così non tagliamo la chiusa)
      answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
      answer = clampWords(answer, stile === "wtf" ? 168 : 160);
      answer = normalizeOneParagraph(answer);
      if (!/[.!?…]$/.test(answer)) answer += ".";
      break;
    }

    // Out
    return res.status(200).json({
      answer,
      style: stile,
      mode,
      lang,
      periodo,
      model: MODEL,
      credits: { used, dailyCap }
    });

  } catch (e) {
    console.error("❌ [/api/ask] error:", e);
    return res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
  }
}
