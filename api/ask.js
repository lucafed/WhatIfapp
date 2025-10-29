// /api/ask.js — What?f Engine (FINAL EXPLOSIVE LOCKED)
// Stili: whatif (analitico | reale) · wtf
// Un solo paragrafo · solo seconda persona · niente nomi inventati

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
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

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
  for (const p of parts) { const n = normLine(p); if (!n || seen.has(n)) continue; out.push(p); seen.add(n); if (out.length >= maxSentences) break; }
  let t = out.join(" "); if (!/[.!?…]$/.test(t)) t += "."; return t;
}
function clampWords(text, maxWords) {
  const w = String(text || "").split(/\s+/); if (w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" "); const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}
function normalizeOneParagraph(s = "") { return String(s).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim(); }
function stripQuestionEcho(domanda, text) {
  const rx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  let t = String(text || ""); return t.replace(rx, "");
}

/* ========= Temporal mode ========= */
function temporalInstruction(periodo = "future", lang = "it") {
  const en = isEn(lang);
  if (periodo === "past") return en ? "Write as if it already happened." : "Scrivi come se fosse già successo.";
  return en ? "Write as a near-future unfolding starting now." : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi ========= */
const EX_WHATIF_ANALITICO_IT = `Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_REALE_IT = `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — esempi ========= */
const EX_WTF_MOTO_IT = `Ti convinci che la moto sia la cura definitiva contro la noia: libertà, vento, romanticismo a due ruote. I primi metri sembrano un film, poi il copione cambia: casco che appanna, giacca che s’incolla, GPS che ti manda dentro una rotonda infinita e un piccione che ti elegge pista d’atterraggio. A quel punto ti esplode un bestemmione corazzato, un suono primordiale che fa tremare le vetrine e interrompe la messa delle 18. Il semaforo lampeggia per rispetto, un cane smette di abbaiare e un tizio in bici applaude in silenzio. Ti fermi al bar più vicino per una sbronza elegante — doppio amaro e birra anti-trauma — e giuri che domani ci riprovi solo col sole. Poi guardi la moto da fuori, grondante come te, e pensi: sì, va bene così — tanto la libertà, se non ti bagna, non vale niente.`;
const EX_WTF_PACE_IT = `Ti presenti elegante e il destino in ciabatte. Pensi che fare pace sia un tè con i biscotti e due scuse perfette. Poi il messaggio resta su “sta scrivendo…”, la foto del vostro peggior litigio rispunta come notifica, un taxi spruzza acqua sulle scarpe e il battito ti va a tempo di trap. Esplode un’imprecazionona a detonazione che fa vibrare i portafoto; la lampada sfarfalla in Morse, il citofono suona per empatia e il cane del vicino prende appunti. Bevi un rosso “per lucidare la sincerità” e ti presenti: l’abbraccio è goffo ma intero, le parole inciampano e si rialzano. A fine serata il silenzio è un applauso lento — pace fatta, e pure il semaforo lampeggia verde in solidarietà.`;

/* ========= Sfoghi viscerali (vari e forti) ========= */
const WTF_SFOGO_STRONG = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "para-bestemmia a raffica",
  "madonna della miseria urlata",
  "anatema a grandinata",
  "urlo da confessionale",
  "tuono da canonica",
  "rosario di improperi",
  "fulmine in sacrestia",
  "litania esplosa",
  "ringhio da campanile",
  "embolata sacrilega"
];

/* ========= Reazioni esilaranti, per contesto ========= */
const WTF_REACTIONS = {
  generic: [
    "la lampada fa facepalm e sfarfalla in Morse",
    "la tapparella si abbassa per imbarazzo e poi risale curiosa",
    "la statua all’angolo si copre gli occhi e sbircia tra le dita",
    "i bicchieri applaudono in cristallo e chiedono il bis",
    "il ventilatore fa l’inchino e gira al contrario per reverenza",
    "Alexa finge un aggiornamento e scappa in modalità ‘non disturbare’",
  ],
  moto: [
    "il semaforo passa al rosso per rispetto e resta così in silenzio",
    "il casco vibra come un tamburo di guerra e fischia l’inno",
    "la striscia pedonale si mette di traverso per non guardare",
    "il piccione fa un giro d’onore come speaker dello stadio",
    "l’autovelox lampeggia applausi invece di fotografarti",
  ],
  bar: [
    "la moka fischia standing ovation",
    "la macchina del caffè sputa una fontana come applauso",
    "il registratore di cassa batte uno scontrino con scritto “amen”",
    "il POS recita un rosario di errori e si benedice da solo",
    "le tazzine tintinnano a ritmo di ola",
  ],
  studio: [
    "il proiettore lampeggia amen",
    "le fotocopie cadono in processione ordinata",
    "la macchinetta del caffè eroga solo acqua santa",
    "il Wi-Fi fa il segno della croce e si riprende",
    "il banco cigola come un giudizio universale",
  ],
  pace: [
    "il citofono emette uno squillo di incoraggiamento",
    "i portafoto tremano e poi sorridono dritti",
    "la porta automatica si apre da sola e si richiude per pudore",
    "la pianta in salotto applaude con tutte le foglie",
    "il cane del vicino prende appunti e scuote la testa da giudice",
  ],
};

/* ========= Aperture ironiche (rotanti) ========= */
const WTF_OPENINGS = [
  "Ah ma guarda te,",
  "Oh, eccoci,",
  "Ti presenti elegante e il destino in ciabatte,",
  "Giornata da manuale, capitolo imprevisti,",
  "Hai studiato tutto, tranne il caos,",
  "Sembra facile finché non tocca a te,",
];

/* ========= Regole base ========= */
const TECH_RULES_BASE = (lang) => `REGOLE:
- Un solo paragrafo. Niente elenchi, niente emoji. NON ripetere la domanda.
- Tempo: prossimo futuro. Solo seconda persona ("tu").
- Lunghezza: WHATIF ≈ 135–155 parole · WTF ≈ 145–165 parole.`;

/* ========= Divieto WhatIf per WTF ========= */
const WTF_ANTI_WHATIF = `DIVIETO WHATIF (solo per WTF):
- Vietati tono analitico/poetico, cornici socio-economiche, consigli, metafore consolatorie.
- Vietati incipit tipici WhatIf: "Sai, questa domanda", "Bella questa", "Metti giù le chiavi", "Tieniti stretto ciò che funziona", "Non chiedi permesso al dubbio".
- Struttura obbligatoria in quest’ordine: 1) 2–3 prese in giro, 2) 4 micro-imprevisti coerenti, 3) UNO sfogo viscerale (sinonimo), 4) 2–3 reazioni sproporzionate di contesto, 5) beat alcolico, 6) mini-profezia/risposta, 7) callback.
- Ritmo comico, immagini concrete, niente morale finale.`;

/* ========= Stile WHAT IF ========= */
const WHATIF_ANALITICO_STYLE_IT = `Tono concreto e sobrio: vincoli, scambi reali, esempi quotidiani. Usa "tu". Incipit tipo "Sai, questa domanda girava nell’aria da un po’." Chiudi con una sintesi calma.`;
const WHATIF_REALE_STYLE_IT = `Tono sensoriale/poetico asciutto. Usa "tu". Incipit tipo "Bella questa — me l’aspettavo da te." Chiudi riconoscendo tempo e luogo come alleati.`;

/* ========= Aperture rotanti ========= */
async function pickRotating(list, key) {
  try { const n = await redis.incr(key); if (n === 1) await redis.expire(key, 86400); return list[(n - 1) % list.length]; }
  catch { return list[Math.floor(Math.random() * list.length)]; }
}

/* ========= Prompt builder ========= */
async function buildMessages({ domanda, lang, periodo, stile, mode, ip }) {
  const msgs = [
    { role: "system", content: TECH_RULES_BASE(lang) },
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  const ctxHint = stile === "wtf"
    ? "Le reazioni DEVONO essere coerenti con l’ambiente della domanda (moto→semafori/casco/asfalto; bar→moka/tazzine; studio→prof/proiettore; pace→citofono/portafoto)."
    : "";

  if (stile === "wtf") {
    const opening = await pickRotating(WTF_OPENINGS, `rot:wtf:${ip}`);
    msgs.push(
      { role: "system", content: WTF_ANTI_WHATIF },
      { role: "system", content: `Inizia esattamente con: "${opening}"` },
      { role: "system", content: `VOCABOLARIO SFOGO (usane UNO): ${WTF_SFOGO_STRONG.join(", ")}` },
      { role: "system", content: `ESEMPIO · WTF (IT) · Moto\n${EX_WTF_MOTO_IT}` },
      { role: "system", content: `ESEMPIO · WTF (IT) · Pace\n${EX_WTF_PACE_IT}` },
    );
  } else {
    msgs.push(
      { role: "system", content: mode === "analitico" ? WHATIF_ANALITICO_STYLE_IT : WHATIF_REALE_STYLE_IT },
      { role: "system", content: mode === "analitico" ? `ESEMPIO · WHAT IF (IT) · Analitico\n${EX_WHATIF_ANALITICO_IT}` : `ESEMPIO · WHAT IF (IT) · Reale\n${EX_WHATIF_REALE_IT}` },
    );
  }

  msgs.push({ role: "user", content: `Domanda: "${domanda}". ${ctxHint} Rispondi in IT con UN SOLO paragrafo.` });
  return msgs;
}

/* ========= Guard-rail WTF vs WhatIf ========= */
function looksLikeWhatIf(answer) {
  const bannedWI = /\b(Sai, questa domanda|Bella questa|Metti giù le chiavi|Tieniti stretto ciò che funziona|Non chiedi permesso al dubbio|economia|reti locali|costo della vita|in fondo non sarebbe un passo indietro|Ogni giorno è più semplice)\b/i;
  const hasSfogo = /\b(bestemmion|imprecazionon|sacramentata|para-?bestemmia|madonna della miseria|anatema|confessionale|canonico|rosario|sacrestia|litania|campanile|embolata)\b/i.test(answer);
  const hasAlcohol = /\b(bar|amaro|birra|vino|spritz|whisky|grappa|negroni|sbronza)\b/i.test(answer);
  return bannedWI.test(answer) || !(hasSfogo && hasAlcohol);
}

/* ========= Handler ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unk").toString().split(",")[0].trim();

    const { success } = await rl.limit(`ask:${ip}`);
    if (!success) return res.status(429).json({ error: "rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { domanda = "", stile = "whatif", mode = "reale", lang = "it", periodo = "future" } = body;
    if (!domanda) return res.status(400).json({ error: "bad_request" });

    const messages = await buildMessages({ domanda, lang, periodo, stile, mode, ip });

    // === Una sola rigenerazione mirata se WTF “deriva” su WhatIf
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
          { role: "system", content: "Rigenera in stile WTF puro rispettando tassativamente la sequenza e usando reazioni coerenti al contesto. Vietato qualunque tono analitico/poetico." },
          messages[messages.length - 1],
        ],
      });

      answer = completion?.choices?.[0]?.message?.content?.trim() || "";
      answer = stripQuestionEcho(domanda, answer);
      answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
      answer = clampWords(answer, stile === "wtf" ? 168 : 160);
      answer = normalizeOneParagraph(answer);
      if (!/[.!?…]$/.test(answer)) answer += ".";

      if (stile !== "wtf" || !looksLikeWhatIf(answer)) break; // ok oppure non-WTF
    }

    if (!answer) throw new Error("empty_model_response");

    // Salvagente incipit & sfogo & reazioni (solo WTF)
    if (stile === "wtf") {
      const openingList = WTF_OPENINGS.map(s => s.replace(/[,…]\s*$/, "")).join("|");
      if (!new RegExp(`^(${openingList})\\b`, "i").test(answer)) {
        const forced = await pickRotating(WTF_OPENINGS, `rot:wtf:open:${ip}`);
        answer = `${forced} ${answer}`;
      }
      if (!WTF_SFOGO_STRONG.some(s => answer.toLowerCase().includes(s.split(" ")[0]))) {
        const pick = WTF_SFOGO_STRONG[Math.floor(Math.random() * WTF_SFOGO_STRONG.length)];
        answer += ` Ti esplode un ${pick} che fa tremare pure i santi di gesso.`;
      }
      // Inserisci 2–4 reazioni coerenti al contesto (se non già presenti)
      const lowerQ = domanda.toLowerCase();
      let bank = WTF_REACTIONS.generic;
      if (/\bmoto|motor|scooter|casc|asfalt|semafor/i.test(lowerQ)) bank = [...bank, ...WTF_REACTIONS.moto];
      else if (/\bbar|caff[eè]|moka|pos|tazzin/i.test(lowerQ)) bank = [...bank, ...WTF_REACTIONS.bar];
      else if (/\bstudi|esame|universit|lezion|prof|libri|scuol/i.test(lowerQ)) bank = [...bank, ...WTF_REACTIONS.studio];
      else if (/\bpace|scusar|chiarir|riconcil/i.test(lowerQ)) bank = [...bank, ...WTF_REACTIONS.pace];

      const need = !( /sfarfalla|moka|semaforo|proiettore|citofono|tazzine|autovelox|campanile|statua/i.test(answer) );
      if (need) {
        const pool = [...bank]; const num = 2 + Math.floor(Math.random() * 3); const add = [];
        for (let i = 0; i < num && pool.length; i++) add.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        answer += ` ${add.join(", ")}.`;
      }
    }

    return res.status(200).json({ answer, style: stile, mode, lang, periodo, model: MODEL });
  } catch (e) {
    console.error("❌ [/api/ask] error:", e);
    return res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
  }
        }
