// /api/ask.js — What?f Engine (FINAL EXPLOSIVE EDITION v2)
// - Un solo paragrafo, solo seconda persona, niente elenchi/emoji/nomi inventati.
// - Stili: whatif (mode: analitico | reale) · wtf
// - Aperture/sfogo/reazioni/alcol/finale: rotazione anti-ripetizione con Redis.
// - Reazioni coerenti col contesto (moto/pace-storie/studio/ufficio + base).
// - CORS + Rate limit (10/min per IP).

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

/* ========= Helpers base ========= */
function normLine(s = "") {
  return String(s).toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").replace(/[.,;:!?()\[\]\-—]+$/g, "").trim();
}
function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [], seen = new Set();
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
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}
function normalizeOneParagraph(s = "") {
  return String(s).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}
function stripQuestionEcho(_domanda, text) {
  // Già educhiamo il modello a NON ripeterla; qui lasciamo soft-clean.
  const rx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  return String(text || "").replace(rx, "");
}

/* ========= Helper: rotazione senza ripetizioni ravvicinate ========= */
async function pickUnique(list, key, window = 7) {
  try {
    const recent = (await redis.lrange(`${key}:recent`, 0, window - 1)) || [];
    const pool = list.filter((x) => !recent.includes(x));
    const choice = (pool.length ? pool : list)[Math.floor(Math.random() * (pool.length ? pool.length : list.length))];
    await redis.lpush(`${key}:recent`, choice);
    await redis.ltrim(`${key}:recent`, 0, window - 1);
    await redis.expire(`${key}:recent`, 86400);
    return choice;
  } catch {
    return list[Math.floor(Math.random() * list.length)];
  }
}

/* ========= Modalità temporale ========= */
function temporalInstruction(periodo = "future", lang = "it") {
  if (String(periodo).toLowerCase() === "past") {
    return "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi ========= */
const EX_WHATIF_ANALITICO_IT =
  `Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_REALE_IT =
  `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — esempi ========= */
const EX_WTF_MOTO_IT =
  `Ah ma guarda te… ti convinci che la moto sia la cura definitiva contro la noia. I primi metri sembrano un film, poi il copione cambia: casco che appanna, giacca che s’incolla, GPS che ti manda in una rotonda infinita e un piccione che ti elegge pista d’atterraggio. Ti esplode un bestemmione corazzato che fa tremare le vetrine e interrompe la messa delle 18. Il semaforo passa al rosso per rispetto, i bicchieri applaudono sullo scaffale, e Alexa si mette in modalità penitenza. Ti fermi al bar per una sbronza elegante — doppio amaro e birra anti-trauma — e giuri che domani esci solo col sole. Poi guardi la moto: grondante come te, e pensi che la libertà, se non ti bagna, non vale niente.`;
const EX_WTF_PACE_IT =
  `Ti presenti elegante e il destino in ciabatte. Pensi che fare pace sia un tè con i biscotti e due scuse perfette. Poi il messaggio resta su “sta scrivendo…”, il telefono cade nella tazza, la foto del vostro peggior litigio spunta come notifica, e il cuore ti tamburella come una batteria in prova. Ti esplode un’imprecazionona a detonazione che fa tremare i portafoto; la lampada sfarfalla in Morse, il POS recita un rosario di errori, e il cane del vicino prende appunti. Ti versi un bicchiere di rosso “per lucidare la sincerità” e ti presenti con voce da sopravvissuto. L’abbraccio è goffo ma intero: le parole inciampano e si rialzano. Alla fine, il silenzio è un applauso lento. Pace fatta, pure il semaforo lampeggia in verde per solidarietà.`;

/* ========= Aperture (ampie, variabili) ========= */
const WTF_OPENINGS = [
  "Ah ma guarda te, …","Oh, eccoci, …","Ti presenti elegante e il destino in ciabatte, …",
  "Giornata da manuale, capitolo imprevisti, …","Hai studiato tutto, tranne il caos, …",
  "Ti metti in posa e la realtà ti fa la photobomb, …","Oggi la fortuna ti manda un vocale, …",
  "Parti convinto e l’universo risponde con un meme, …","Entri piano e la realtà pesta sull’acceleratore, …",
  "Vai leggero e il giorno ti aggancia col guinzaglio, …","Ti sistemi il colletto e la giornata fischia il fuorigioco, …",
  "Sei pronto? La vita ha già premuto play, …","Ti credi protagonista e il destino fa il cameo, …",
  "Carichi a molla e il mondo cambia musica, …","Fai il serio e l’aria ride, …","Piano piano? La giornata sceglie il nitro, …"
];

/* ========= Sfoghi (molti, forti, variabili) ========= */
const WTF_SFOGO_STRONG = [
  "bestemmione corazzato","imprecazionona a detonazione","sacramentata a ciel sereno",
  "para-bestemmia a raffica","madonna della miseria urlata","anatema a grandinata",
  "urlo liturgico strozzato","embolata sacrilega","rantolo di santi in fuga",
  "coro di anatemi con eco","scarica di rosari impazziti","ringhio teologico a valanga",
  "granata di improperi benedetti","tuono di pazienza scassata","requiem di imprecazioni a organo",
  "boato di sante intossicate","scoppio di nervi consacrati","litania di sdegno esploso",
  "tromba d’aria di scomuniche metaforiche","strappo di calma sacrale"
];

/* ========= Beat alcolici variabili ========= */
const WTF_ALCOHOL_BEATS = [
  "Ti versi un amaro di contrabbando emotivo",
  "Ordini un Negroni “per mettere in riga i santi”",
  "Scegli un doppio whisky che non fa domande",
  "Vai di birra scura: terapia con schiuma",
  "Prendi un Montenegro e lo chiami tregua",
  "Corretto al brandy, perché oggi serve grammatica forte",
  "Spritz di pace armata e via",
  "Un Barolo per mettere il futuro in bottiglia"
];

/* ========= Reazioni per contesto ========= */
const REACTIONS_BASE = [
  "la lampada fa facepalm e sfarfalla in Morse","il campanile tossisce un amen stonato",
  "la tapparella si abbassa per imbarazzo e poi risale curiosa","i bicchieri applaudono in cristallo e chiedono il bis",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita","Alexa finge un aggiornamento e scappa in ‘non disturbare’",
  "il ventilatore fa l’inchino e gira al contrario per reverenza","il citofono fa uno squillo di solidarietà e poi si pente"
];
const REACTIONS_MOTO = [
  "il semaforo passa al rosso per rispetto","un casco appeso scuote la testa come un maestro severo",
  "la moka del bar fischia standing ovation","il cane al guinzaglio cambia marciapiede da solo"
];
const REACTIONS_PACE = [
  "il POS recita un rosario di errori e si benedice da solo","la cornice sul bancone vibra come un batticuore",
  "il vaso fa tintinnare i cucchiai in segno di tregua","un piccione alla finestra picchietta come volesse verbalizzare"
];
const REACTIONS_STUDIO = [
  "il proiettore lampeggia amen","le fotocopie cadono in processione",
  "la macchinetta del caffè eroga solo acqua santa","il Wi-Fi fa il segno della croce e cade"
];
const REACTIONS_UFFICIO = [
  "la stampante canta un inno di carta inceppata","il badge finge di non riconoscerti",
  "l’ascensore sospira e si ferma a metà come in meditazione","la pianta grassa ti giudica senza fretta"
];
function pickReactionsFor(domanda) {
  const q = (domanda || "").toLowerCase();
  if (q.includes("moto") || q.includes("scooter")) return [...REACTIONS_BASE, ...REACTIONS_MOTO];
  if (q.includes("pace") || q.includes("persona") || q.includes("amore") || q.includes("ex")) return [...REACTIONS_BASE, ...REACTIONS_PACE];
  if (q.includes("stud") || q.includes("esame") || q.includes("univers")) return [...REACTIONS_BASE, ...REACTIONS_STUDIO];
  if (q.includes("lavor") || q.includes("ufficio") || q.includes("collega")) return [...REACTIONS_BASE, ...REACTIONS_UFFICIO];
  return REACTIONS_BASE;
}

/* ========= Regole tecniche ========= */
const TECH_RULES_BASE = () => `REGOLE:
- Un solo paragrafo. Niente elenchi, niente emoji. NON ripetere la domanda.
- Tempo: prossimo futuro che inizia ora. Solo seconda persona ("tu"), mai prima persona.
- Non inventare nomi. Usa solo quelli eventualmente presenti nella domanda.
- Lunghezza: WHATIF ≈ 135–155 parole, WTF ≈ 145–165 parole.`;

/* ========= Prompt builder ========= */
async function buildMessages({ domanda, periodo, stile, mode, ip }) {
  const msgs = [
    { role: "system", content: TECH_RULES_BASE() },
    { role: "system", content: temporalInstruction(periodo, "it") },
  ];

  if (stile === "wtf") {
    const opening = await pickUnique(WTF_OPENINGS, `rot:wtf:open:${ip}`, 10);
    msgs.push({
      role: "system",
      content:
        `WTF:
1) Inizia con «${opening}».
2) 2–3 frasi di presa in giro.
3) 4 micro-imprevisti a tema con la domanda.
4) UNA sola esplosione viscerale (niente bestemmie reali): variazione obbligatoria, lessico metaforico.
5) Subito 3–5 reazioni esilaranti coerenti col contesto.
6) Beat alcolico visibile e variabile.
7) Chiusa breve tipo callback, ironica o poetica, che risponde davvero alla domanda (previsione/controfattuale).
Seconda persona, un paragrafo, 145–165 parole.`,
    });
    msgs.push(
      { role: "system", content: `ESEMPIO · WTF (IT) · Moto\n${EX_WTF_MOTO_IT}` },
      { role: "system", content: `ESEMPIO · WTF (IT) · Pace\n${EX_WTF_PACE_IT}` },
    );
  } else {
    if (mode === "analitico") {
      msgs.push({ role: "system", content: `ESEMPIO · WHAT IF (IT) · Analitico\n${EX_WHATIF_ANALITICO_IT}` });
    } else {
      msgs.push({ role: "system", content: `ESEMPIO · WHAT IF (IT) · Reale\n${EX_WHATIF_REALE_IT}` });
    }
  }

  msgs.push({ role: "user", content: `Domanda: "${domanda}". Rispondi in IT con un solo paragrafo.` });
  return msgs;
}

/* ========= Handler ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unk").toString().split(",")[0].trim();

    // Rate limit
    const { success } = await rl.limit(`ask:${ip}`);
    if (!success) return res.status(429).json({ error: "rate_limited_minute" });

    // Body
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", mode = "reale", lang = "it", periodo = "future" } = body;
    if (!domanda) return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    // Prompt
    const messages = await buildMessages({ domanda, periodo, stile, mode, ip });

    // Call
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

    // Post-process base
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 172 : 160);
    answer = normalizeOneParagraph(answer);

    /* ========= Post-process speciale WTF ========= */
    if (stile === "wtf") {
      // 1) Incipit garantito e rotante
      const forcedOpen = await pickUnique(WTF_OPENINGS, `rot:wtf:open:${ip}`, 10);
      const openPlain = forcedOpen.replace(/[,…]\s*$/, "");
      const openRx = new RegExp(`^${openPlain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      if (!openRx.test(answer)) answer = `${forcedOpen} ${answer}`;

      // 2) Sfogo — vario e sempre presente
      const chosenSfogo = await pickUnique(WTF_SFOGO_STRONG, `rot:wtf:sfogo:${ip}`, 7);
      const hasSfogo = WTF_SFOGO_STRONG.some((s) => answer.toLowerCase().includes(s.split(" ")[0]));
      if (!hasSfogo) {
        const firstDot = answer.indexOf(".") > -1 ? answer.indexOf(".") + 1 : Math.min(answer.length, 140);
        answer = answer.slice(0, firstDot) + ` Ti esplode un ${chosenSfogo} che fa tremare l’aria.` + answer.slice(firstDot);
      } else {
        // rimpiazzo eventuale sfogo ripetuto
        answer = answer.replace(/(urlo liturgico strozzato|bestemmione corazzato|imprecazionona a detonazione)/i, chosenSfogo);
      }

      // 3) Reazioni a tema (3–5), subito dopo lo sfogo
      const bank = pickReactionsFor(domanda);
      const num = 3 + Math.floor(Math.random() * 3);
      const pool = [...bank];
      const chosen = [];
      for (let i = 0; i < num && pool.length; i++) {
        chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
      const sfIdx = answer.toLowerCase().indexOf(chosenSfogo.split(" ")[0].toLowerCase());
      if (sfIdx > -1) {
        const endSentence = answer.indexOf(".", sfIdx);
        if (endSentence > -1) {
          answer = answer.slice(0, endSentence + 1) + " " + chosen.join(", ") + ". " + answer.slice(endSentence + 1);
        }
      }

      // 4) Beat alcolico variabile (se assente)
      const alc = await pickUnique(WTF_ALCOHOL_BEATS, `rot:wtf:alcol:${ip}`, 7);
      if (!/(amaro|negroni|whisky|birra|montenegro|brandy|spritz|barolo)/i.test(answer)) {
        const cut = Math.floor(answer.length * 0.66);
        const p = answer.lastIndexOf(".", cut);
        const at = p > 0 ? p + 1 : cut;
        answer = answer.slice(0, at) + ` ${alc}.` + answer.slice(at);
      }

      // 5) Callback/finale variabile (sempre presente)
      const WTF_CALLBACKS = [
        "e scopri che, domani, sarete entrambi un filo più veri",
        "e capisci che la pace con te stesso arriva sempre in ritardo ma arriva",
        "e ti sorprendi a ridere: il futuro non capisce, però impara in fretta",
        "e la giornata si chiude come un portone: pesante, ma finalmente tua",
        "e ti resta in tasca l’eco buona: domani ci riprovi, con meno teatro e più te",
        "e per un istante il mondo smette di fare rumore e fa spazio",
        "e ti accorgi che l’ironia salva più dei caschi integrali",
        "e ti prometti di sbagliare meglio, possibilmente con stile",
        "e il silenzio che segue ha la forma di una tregua",
        "e ti pare che anche l’aria annuisca, finalmente dalla tua parte"
      ];
      const cb = await pickUnique(WTF_CALLBACKS, `rot:wtf:cb:${ip}`, 10);
      if (!new RegExp(WTF_CALLBACKS.map((x) => x.split(",")[0]).join("|"), "i").test(answer)) {
        if (!/[.!?…]$/.test(answer)) answer += ".";
        answer += " " + cb + ".";
      }

      // Pulizie finali
      answer = clampWords(answer, 172);
      answer = normalizeOneParagraph(answer);
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    return res.status(200).json({ answer, style: stile, mode, lang, periodo, model: MODEL });
  } catch (e) {
    console.error("❌ [/api/ask] error:", e);
    return res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
  }
}
