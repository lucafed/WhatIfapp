// /api/ask.js — What?f Engine (Zingara-Realista WHATIF + Friendly-WTF Demenziale, con quarta domanda)
// - WHATIF: tono “zingara mistica realista”, 60% analisi / 40% immagini sobrie,
//   chiusura con sensazione + gancio. Passato → controfattuale. Futuro → ipotesi vicina.
//   In quinta pagina usa la risposta della quarta come contesto, SENZA ripeterla, e dà consigli pratici da più punti di vista.
// - WTF: barista demenziale, sarcastico, un po’ volgare ma affettuoso, ogni frase deve far ridere o almeno sorridere storto.
//   In quarta fa una domanda di chiarimento ironica, in quinta risponde a manetta, tutta scena, oggetti che reagiscono, drink, sarcasmo.
// - Un paragrafo, niente elenchi visibili, niente eco della domanda. Maiuscole ripristinate post-process.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

// Wrapper tollerante: se Upstash non è configurato/non risponde, non bloccare
let rateOk = async () => true;
try {
  rateOk = async (key) => {
    try {
      const { success } = await rl.limit(key);
      return !!success;
    } catch {
      return true;
    }
  };
} catch {
  /* noop */
}

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const allow = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : process.env.NODE_ENV !== "production"
    ? origin
    : "";
  if (allow) res.setHeader("Access-Control-Allow-Origin", allow);
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
  const out = [];
  const seen = new Set();
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
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g, (m, prefix, chr) => prefix + chr.toUpperCase());
}
function finalPunct(s = "") {
  return /[.!?…]$/.test(s) ? s : s + ".";
}
function hashStr(str = "") {
  let h = 2166136261 >>> 0;
  for (const ch of String(str)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function pickDet(arr, seed) {
  return arr[arr.length ? seed % arr.length : 0] || "";
}

/* ========= WHAT IF – esempio di respiro (non fisso) ========= */
const WHATIF_HYBRID_EX_IT = `La linea del tuo destino qui si fa più spessa del resto. Vedi una scelta che alleggerisce le tue giornate: meno rumore, più tempo che torna davvero tuo. Senti le abitudini stringersi e poi allentarsi, finché trovi un ritmo più umano. Non è fuga né eroismo: è manutenzione di vita, dove sposti peso tra lavoro, relazioni ed energia. In fondo, non insegui più la vetrina: ti scegli una stanza in cui respirare meglio. E quando ti volterai, capirai che il rimpianto ha perso voce proprio dove hai iniziato a scegliere te.`;

/* ======= WHAT IF RULES (IT) ======= */
const WHATIF_RULE_FUT_IT = `WHAT IF (italiano, FUTURO):
- Tono: veggente/zíngara realista, mistica ma concreta.
- APRI con UNA sola riga breve e intensa, come se leggessi il destino: niente onomatopee tipo "shh", "mmm", niente ripetizione della domanda.
- La SECONDA frase deve INIZIARE con una di queste parole, scegliendo quella più adatta alla domanda: "Vedo", "Sento", "Immagino", "Intuisco", "Si apre", "Si muove".
- 60% analisi concreta (routine, tempo, costi/benefici, energia, relazioni) + 40% immagini sobrie della quotidianità.
- Scrivi un futuro vicino che inizia adesso: usa futuro/condizionale semplice ("potresti", "inizierai", "probabilmente").
- Mantieni la risposta aderente al tema della domanda (città, relazione, lavoro, ecc.), senza esempi generici fuori contesto.
- Usa la risposta della quarta pagina solo come contesto interno: NON citarla, NON riscriverla, NON farne un riassunto.
- In ogni risposta prova a toccare almeno 3 punti di vista: cosa ci guadagni, cosa rischi, cosa succede se resti fermo.
- Dai almeno 2–3 consigli pratici concreti (cose da fare, verifiche, piccoli esperimenti) legati alla decisione.
- Linguaggio: italiano naturale, frasi grammaticalmente corrette, vocabolario vario (evita ripetizioni evidenti di verbi o immagini).
- Chiudi con una frase che lasci una sensazione chiara e un piccolo gancio di curiosità.
- 8–10 frasi, seconda persona, un paragrafo unico, NON ripetere la domanda, niente elenchi, niente emoji.`;

const WHATIF_RULE_PAST_IT = `WHAT IF (italiano, PASSATO CONTROFATTUALE):
- Tono: veggente/zíngara che rilegge una vita alternativa, mistica ma concreta.
- APRI con UNA riga breve e intensa, come se indicassi una vita che non è stata vissuta.
- La SECONDA frase deve INIZIARE con "Vedo", "Sento", "Immagino", "Intuisco", "Si sarebbe aperto", "Si sarebbe mosso".
- Scrivi in chiave controfattuale: "se avessi…, avresti…", "ti saresti trovato…", "avresti sentito…".
- Nessuna data o fatto reale non fornito; resta fedele al tema della domanda (relazione, scelta, città, lavoro, ecc.).
- 60% analisi concreta + 40% immagini sobrie di quella vita alternativa.
- Usa la risposta della quarta pagina solo come contesto interno: NON citarla, NON riscriverla, NON fare riassunti.
- Tieni almeno 3 punti di vista: cosa sarebbe andato meglio, cosa ti avrebbe pesato, cosa avresti perso rispetto a oggi.
- Nelle ultime frasi porta sempre dolcemente al presente e lascia 2–3 micro-consigli su cosa puoi fare ORA con questa consapevolezza.
- Linguaggio: italiano naturale, frasi grammaticalmente corrette, vocabolario ricco e non ripetitivo.
- 8–10 frasi, seconda persona, un paragrafo unico, niente emoji, niente elenchi.`;

const ZINGARA_INTROS = {
  it: [
    "La linea del tuo destino si illumina proprio qui.",
    "Le carte della tua strada si stanno girando adesso.",
    "Una piega sottile nel tuo cammino chiede di essere guardata.",
    "La notte ti restituisce un segnale più chiaro di quanto pensi.",
    "Il filo della tua storia vibra mentre fai questa domanda.",
    "C’è una porta socchiusa nel tuo percorso e questa domanda è la mano sulla maniglia.",
    "Una parte di te ha già scelto: io vedo soltanto la traccia che lascia.",
    "Il tuo cuore ha parlato prima delle parole, e si sente.",
    "Il tempo fa un piccolo nodo intorno a questa scelta.",
    "Qui il destino non urla: sussurra, ma con una precisione ostinata.",
  ],
};

/* ========= Finali “gancio” ========= */
const ZINGARA_ENDINGS = {
  it: {
    future: [
      "E lì ti accorgerai che non serve correre: basta scegliere bene.",
      "E proprio lì capirai che la calma non è rinuncia, è margine.",
      "Da quel punto sentirai la vita rispondere semplice: poco, ma tuo.",
      "E quando ti volterai, vedrai che la fatica stava solo aprendo spazio.",
    ],
    past: [
      "Forse oggi lo sentiresti nelle ossa: non era destino, era ritmo.",
      "E ti verrebbe voglia di chiederti un’altra volta: e se lo facessi adesso?",
      "Ti ritroveresti a pensare che alcune strade restano aperte, anche tardi.",
      "E capirai che quel rimpianto non morde: invita a provare meglio, adesso.",
    ],
  },
  en: {
    future: ["And there you’ll notice you don’t need speed, just a good angle."],
    past: ["Maybe you’d feel it in your bones: it wasn’t fate, just timing."],
  },
  es: {
    future: ["Y ahí notarás que no hace falta correr, solo elegir bien."],
    past: ["Y quizá hoy lo sentirías: no era destino, era ritmo."],
  },
  fr: {
    future: ["Et là tu verras: pas besoin de courir, juste de choisir juste."],
    past: ["Et peut-être que tu le saurais: ce n’était pas le destin, mais le tempo."],
  },
  de: {
    future: ["Und dort merkst du: Tempo ist egal, der Winkel zählt."],
    past: ["Vielleicht spürst du heute: kein Schicksal, nur Timing."],
  },
};
function ensureZingaraEnding({ text, lang, periodo, domanda }) {
  let s = String(text || "").trim();
  const last = (s.match(/([^.!?…]+[.!?…])\s*$/) || [])[1] || s;
  const alreadyHasHook =
    /(ti accorgerai|capirai|ti verrà voglia|ti ritroverai|e lì|e proprio lì|da quel punto|forse oggi|maybe you’d feel|and there you’ll notice)/i.test(
      last
    );
  if (alreadyHasHook) return s;
  const L = normLang(lang);
  const pool = (ZINGARA_ENDINGS[L] || ZINGARA_ENDINGS.it) || {};
  const bag =
    String(periodo).toLowerCase() === "past"
      ? pool.past || ZINGARA_ENDINGS.it.past
      : pool.future || ZINGARA_ENDINGS.it.future;
  const addon = pickDet(bag, hashStr((domanda || "") + s));
  if (!addon) return s;
  s = s.replace(/[.!?…]+$/, "");
  return `${s}. ${addon}`;
}

/* ========= WTF — logica contestuale ========= */
function detectWtfContext(domanda = "") {
  const t = String(domanda || "").toLowerCase();

  if (/(moto|motocicletta|casco|cilindrata|enduro|naked|scooter|pista)/.test(t)) return "moto";
  if (/(ufficio|collega|capo|meeting|riunion|scrivania|badge|excel|pc|computer|azienda|contratto|stipendio)/.test(t))
    return "ufficio";
  if (/(casa|divano|cucina|salotto|camera|stanza|appartamento|mutuo|affitto|letto)/.test(t)) return "casa";
  if (/(l'aquila|laquila|aquila|trasferirmi|trasferimento|città|citta|quartiere|paese|lugano)/.test(t)) return "città";
  if (/(ex|relazione|fidanzat|ragazza|ragazzo|moglie|marito|matrimonio|lasciare|tornare insieme|storia)/.test(t))
    return "relazione";
  if (/(soldi|budget|stipendio|busta paga|debito|conto|prestito|mutuo|invest|risparmi|tasse)/.test(t)) return "soldi";

  return "generico";
}

/* Imprecazioni teatrali — spinta ma non gratuite */
const WTF_IMPRE = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "vulcano di parolacce compresse",
  "tromba d’aria di improperi",
];

/* Reazioni degli oggetti, contestuali */
const WTF_REACT_BY_CONTEXT = {
  moto: [
    "il semaforo passa al rosso per rispetto e ti guarda in silenzio",
    "un cane cambia marciapiede da solo come se avesse capito tutto",
    "il casco sul sellino oscilla giudicante come un pendolo del destino",
    "la saracinesca del garage sbatte come un applauso offeso",
    "il contachilometri ti fissa come a dire “davvero vuoi farlo?”",
  ],
  ufficio: [
    "il monitor decide di aggiornarsi proprio ora e ti pianta in asso",
    "la stampante entra in errore mistico e sputa un foglio mezzo bianco",
    "la sedia girevole cigola come una nonna che ti giudica",
    "il neon sopra la testa sfarfalla come se facesse il tifo ma a metà",
    "il badge non legge al primo colpo e ti respinge come se sapesse già",
  ],
  casa: [
    "la tapparella si blocca a metà e finge di non conoscerti",
    "il frigorifero sospira e decide di sembrare più vuoto del necessario",
    "il divano ti risucchia come se volesse firmarti il contratto a vita",
    "la lampada sfarfalla due volte come un “sei sicuro?” luminoso",
    "la lavatrice parte in centrifuga esistenziale proprio mentre pensi di cambiare vita",
  ],
  città: [
    "la valigia sul letto si apre da sola e rovescia mezza vita sul pavimento",
    "il portone di casa tua cigola come un vecchio amico che ti chiede spiegazioni",
    "il bar sotto casa ti vede dalla vetrina e sembra alzare un sopracciglio",
    "la panchina dove ti sedevi sempre è occupata da un altro e ti fa strano",
    "la salita davanti a te sembra allungarsi di un piano ogni volta che ci pensi",
  ],
  relazione: [
    "il telefono vibra a vuoto e ti fa credere che sia un suo messaggio",
    "la chat con lei rimane lì in cima come una spia luminosa",
    "il letto sfatto a metà sembra chiederti da che parte vuoi stare",
    "il cuscino affonda come se stesse conservando ancora la sua forma",
    "il gatto ti guarda con quell’aria da psicologo non pagato",
  ],
  soldi: [
    "l’estratto conto sullo schermo si aggiorna con un sospiro",
    "il portafoglio si piega da solo come per proteggersi",
    "gli scontrini sul tavolo si aprono a ventaglio come un processo",
    "la calcolatrice del telefono comincia a riempirsi di cifre senza che tu capisca come",
    "la busta paga stropicciata ti fissa da un angolo come una minaccia passiva",
  ],
  generico: [
    "la stanza trattiene il fiato insieme a te per un secondo buono",
    "le scarpe in mezzo al corridoio ti guardano come pronte a scappare",
    "la giacca buttata sulla sedia sembra alzare le spalle",
    "la finestra socchiusa lascia entrare un’aria che sembra un commento",
    "il telefono a faccia in giù vibra proprio quando non vorresti sentirlo",
  ],
};

/* Bevute, legate al contesto */
const WTF_DRINKS_BY_CONTEXT = {
  moto: [
    "vai al bar vicino al concessionario e ti fai riempire un bicchiere serio al bancone",
    "ti fermi al primo bar sulla strada e ti scolpisci una birra media in piedi fuori",
    "entri nel locale dell’angolo e ti spari un caffè lungo, bevuto in tre sorsi cattivi",
  ],
  ufficio: [
    "ti trascini in sala pausa e riempi fino all’orlo un bicchiere di plastica di caffè della macchinetta",
    "nella cucina aziendale ti versi una tazza gigante di caffè annacquato e la butti giù come fosse liquore",
    "al distributore prendi un bicchierone d’acqua e lo bevi come se fosse superalcolico da after",
  ],
  casa: [
    "vai in cucina, apri l’armadietto buono e riempi un bicchiere grande fino al bordo",
    "ti appoggi al lavandino con un mezzo calice traboccante e lo svuoti in una tirata",
    "apri il frigorifero, prendi la prima cosa seria che trovi e la versi in un bicchiere pieno",
  ],
  città: [
    "svolti l’angolo, entri al bar sotto casa e ti fai versare un bicchiere pesante, pieno fino all’orlo",
    "ti siedi al tavolino del corso con un calice pieno e lo guardi come se avesse le risposte",
    "vai nel solito locale dove ti conoscono per nome e ti fai riempire il bicchiere senza nemmeno parlare",
  ],
  relazione: [
    "ti siedi sul bordo del letto con un calice pieno fino all’orlo e lo bevi guardando il telefono a faccia in giù",
    "ti sposti sulla soglia del balcone con un bicchiere esagerato e lo svuoti guardando il vuoto",
    "resti in cucina con un bicchiere serio, appoggiato al tavolo, facendo finta di pensare e invece senti",
  ],
  soldi: [
    "resti davanti allo schermo con un bicchiere colmo e lo bevi fissando il saldo",
    "ti sposti al tavolo dei conti e ti versi un bicchiere grande che accompagna gli scontrini",
    "appoggi il bicchiere pieno accanto alla calcolatrice e fai un sorso ogni cifra che non ti torna",
  ],
  generico: [
    "ti versi un bicchiere grande riempito più del necessario e lo butti giù in due colpi teatrali",
    "prendi un calice traboccante e lo svuoti in un’unica tirata un po’ esagerata",
    "riempi un bicchiere colmo e lo finisci senza staccare gli occhi da quello che ti preoccupa",
  ],
};

/* ========= WTF: rapporto scientifico demenziale ========= */
function scientificReportDemenziale(domanda, lang = "it") {
  function h(s = "") {
    let x = 0;
    for (const c of s) x = (x * 131 + c.charCodeAt(0)) >>> 0;
    return x >>> 0;
  }
  const seed = h(domanda || "");
  const pick = (arr) => arr[seed % arr.length];

  const UNI = [
    "Dipartimento di Metafisica Applicata – Università di Busto Arsizio Est",
    "Politecnico delle Scuse Creative",
    "Istituto Europeo di Scuse Baristiche",
    "Laboratorio di Statistiche Improbabili",
    "Centro Studi di Fisica dell’Umore",
    "Accademia Transalpina delle Decisioni Avventate",
  ];
  const JOUR = [
    "Rivista di Fisica dell’Umore",
    "Giornale Internazionale di Scuse Quantistiche",
    "Annali di Metodologie Poco Replicabili",
    "Quaderni di Ergonomia dell’Anima",
  ];
  const EFFECT = [
    "imprecazione calibrata",
    "brindisi di manutenzione",
    "tapparelle giudicanti",
    "POS in modalità benedizione",
    "ventilatore che gira al contrario “per rispetto”",
    "lampada che lampeggia “ti capisco” in Morse",
  ];
  const METRIC = ["r=0.82", "p=0.047", "η²=0.31", "β=0.67", "AUC=0.73", "OR=2.1"];

  const u = pick(UNI);
  const j = pick(JOUR);
  const e = pick(EFFECT);
  const m = pick(METRIC);
  const n = 30 + (seed % 70);

  if ((lang || "it").startsWith("en")) {
    return `Scientific-ish report: ${u} (n=${n}) found that a ${e} improves decision clarity (${m}). Peer-reviewed by ${j}, probably.`;
  }
  return `Rapporto scientifico (più o meno): ${u} (n=${n}) rileva che “${e}” migliora la chiarezza decisionale (${m}). Revisione a cura di ${j}, forse.`;
}

/* ========= CLARIFY MESSAGES (quarta pagina) ========= */
function buildClarifyMessages({ domanda, lang, periodo, stile }) {
  const L = normLang(lang);
  const isPast = String(periodo).toLowerCase() === "past";

  if (stile === "wtf") {
    // WHAT THE F — domanda demenziale ma utile
    const sys =
      L === "it"
        ? `Sei “WHAT THE F”: barista demenziale, sarcastico e un po’ volgare ma affettuoso.
Parli SEMPRE in seconda persona (“tu / ti / te / tuo”) quando ti riferisci a chi fa la domanda.
COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ITALIANO.
- La domanda deve essere ironica, sarcastica e un po’ sboccata (parole tipo “cavolo, cazzo, porca miseria, che casino”), ma senza insultare direttamente la persona.
- Prendi in giro la SITUAZIONE, non la dignità di chi legge.
- Cita esplicitamente la scena (“in quella città”, “con quel lavoro”, “con quella relazione”) in poche parole.
- Usa una sola frase, massimo 20–22 parole, con UN solo punto interrogativo finale, niente elenco, niente emoji.`
        : `You are “WHAT THE F”: chaotic, sarcastic and a bit foul-mouthed but secretly kind.
Always speak in SECOND PERSON (“you / your”) when you refer to the user.
TASK:
- Ask EXACTLY ONE clarifying question in the user’s language.
- The question must be funny, sarcastic, slightly vulgar but never hateful.
- Tease the SITUATION, not the person, and mention the concrete scene (“that city”, “that job”, “that relationship”).
- One sentence, max 20–22 words, single question mark at the end, no emojis, no lists.`;

    const userMessage =
      L === "it"
        ? isPast
          ? `Domanda sul passato dell’utente: "${domanda}". Fai UNA domanda di chiarimento in italiano, in modalità flashback, come se stessi commentando una puntata già andata, mantenendo il tono demenziale.`
          : `Domanda dell’utente: "${domanda}". Fai UNA domanda di chiarimento in italiano, per capire meglio cosa sta davvero scegliendo, mantenendo tono demenziale e sarcastico.`
        : `User question: "${domanda}". Ask ONE clarifying question in the user’s language, same demenziale/sarcastic bartender style.`;

    return [
      { role: "system", content: sys },
      { role: "user", content: userMessage },
    ];
  }

  // WHAT IF — domanda chiarificatrice “zingara realista”
  const sysIT = `Sei “WHAT IF”: voce da zingara mistica ma molto concreta.
Parli in seconda persona (“tu / ti / te / tuo”).
COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in italiano.
- Punta su 1–2 dettagli che cambiano davvero la risposta (vincoli principali, obiettivo reale, tempi).
- Cita esplicitamente la scelta (“in quella città”, “con quel lavoro”, “con quella persona”).
- Niente poesia inutile: domanda chiara, diretta ma empatica.
- Una sola frase, massimo 20–22 parole, niente emoji, niente elenco.`;

  const sys =
    L === "it"
      ? sysIT
      : `You are “WHAT IF”: grounded, slightly mystical but very practical advisor.
Ask EXACTLY ONE clarifying question in the user’s language.
Focus on the key missing constraint or goal. Single sentence, max 22 words, no emojis.`;

  const userMessageIT = isPast
    ? `Domanda controfattuale sul passato: "${domanda}". Fai UNA domanda di chiarimento in italiano, riferendoti a quel periodo passato (“all’epoca”, “in quel momento”).`
    : `Domanda sul futuro/presente: "${domanda}". Fai UNA domanda di chiarimento in italiano che ti aiuti a dare una risposta più precisa dopo.`;

  const userMessage =
    L === "it"
      ? userMessageIT
      : `User “what if” question: "${domanda}". Ask ONE clarifying question in the user’s language, so you can give a better answer later.`;

  return [
    { role: "system", content: sys },
    { role: "user", content: userMessage },
  ];
}

/* ========= Prompt builder ANSWER (quinta pagina) ========= */
function buildMessages({ domanda, clarification, lang, periodo, stile }) {
  const L = normLang(lang);
  const baseRules =
    L === "en"
      ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. If there is an extra detail from the user, use it as context only, do NOT quote or summarize it. Second person only when talking to the user. Stay close to the topic of the question. Use a rich, varied vocabulary, and keep grammar and punctuation clean. Avoid repeating the same words and images too often.`
      : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Se c’è un dettaglio aggiuntivo dall’utente (risposta della quarta pagina), usalo solo come contesto: NON citarlo, NON riscriverlo, NON farne un riassunto. Parla in seconda persona quando ti rivolgi all’utente. Resta aderente al tema della domanda. Usa un vocabolario ricco e vario, italiano corretto, senza errori di grammatica e con punteggiatura curata. Evita ripetizioni evidenti di parole e immagini.`;

  const msgs = [{ role: "system", content: baseRules }];

  const hasClar = clarification && String(clarification).trim().length > 0;
  const clar = hasClar ? String(clarification).trim() : "";

  if (stile === "wtf") {
    // seed deterministico
    let seed = [...String(domanda || "")].reduce((a, c) => a + c.charCodeAt(0), 0);
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    }

    const ctx = detectWtfContext(domanda);
    const impre = WTF_IMPRE[Math.floor(rnd() * WTF_IMPRE.length)];

    const reactPool = WTF_REACT_BY_CONTEXT[ctx] || WTF_REACT_BY_CONTEXT.generico;
    const shuffled = [...reactPool].sort(() => rnd() - 0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd() * 2)); // 2–3 reazioni

    const drinkPool = WTF_DRINKS_BY_CONTEXT[ctx] || WTF_DRINKS_BY_CONTEXT.generico;
    const drink = drinkPool[Math.floor(rnd() * drinkPool.length)];

    const WTF_RULE_IT = `WHAT THE F (amichevole, super demenziale, sarcastico, un po’ volgare ma affettuoso).

OBIETTIVO:
- Deve far ridere o almeno sorridere STORTO a OGNI frase.
- Prendi in giro la situazione, non la dignità di chi legge.
- Usa parolacce leggere (“cavolo”, “cazzo”, “porca miseria”, “che casino”, “minchia”) in modo comico, mai come insulto diretto alla persona.

STRUTTURA OBBLIGATORIA:
1) 1–2 frasi iniziali: presa in giro affettuosa e sarcastica della SITUAZIONE, come un barista che scuote la testa e ride con te.
2) 2–3 micro-imprevisti comici legati al tema (casa, città, lavoro, relazione, soldi, ecc.).
3) UNO sfogo teatrale: usa la formula "${impre}" dentro una frase narrativa, tipo esplosione catartica.
4) SUBITO DOPO, inserisci ${react.length} reazioni di OGGETTI o DETTAGLI della SCENA, coerenti con il contesto (${ctx}):
   - prendi solo ispirazione dalle idee che ti passo, ma NON copiare le frasi;
   - ogni volta inventa oggetti diversi, come se l’universo intero commentasse la scena.
5) MOMENTO DRINK:
   - Inserisci UNA sola frase in cui il personaggio beve qualcosa (amaro, vino, gin, birra, caffè velenoso, ecc.).
   - Usa questa idea come spunto: "${drink}", ma NON scriverla mai identica: riscrivi sempre con parole diverse, più teatrali.
6) 2–3 frasi finali che rispondono davvero alla domanda: cosa succede se fai quella scelta, cosa succede se resti fermo, con un consiglio storto ma onesto.
7) Chiudi con una morale cinica ma calorosa: ti prendi gioco della situazione e allo stesso tempo fai sentire l’utente meno solo.

LINGUAGGIO:
- Italiano parlato, fluido, frasi brevi e pulite dal punto di vista grammaticale.
- Ogni frase deve avere almeno un elemento comico forte (immagine assurda, paragone idiota ma geniale, ribaltamento improvviso).
- Evita tono poetico: qui è tutto bar, bicchieri, oggetti che reagiscono, sarcasmo, verità scomode ma dette ridendo.
- 6–8 frasi, un solo paragrafo, niente elenco visibile nell’output, niente emoji.`;

    const WTF_RULE_EN = `WHAT THE F (friendly, extremely absurd, sarcastic, slightly vulgar but kind).

- Every single sentence must carry at least one strong comic or sarcastic element: absurd image, dumb-brilliant comparison or sideways insult to the situation.
- Use light swearing (hell, crap, damn, freaking, etc.) in a playful way, never as a direct personal attack.
- Structure: teasing intro (1–2 lines), 2–3 comic mishaps, ONE big dramatic outburst ("${impre}"), object reactions (${ctx} context), ONE drink line inspired by "${drink}" (but rephrased), and 2–3 lines that actually answer the question with a crooked but honest advice.
- 6–8 sentences, single paragraph, no emojis, no bullet lists in the output.`;

    msgs.push(
      { role: "system", content: L === "en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content: `IMPRECATION: ${impre}` },
      {
        role: "system",
        content: `REACTIONS (solo idee di scena, NON copiare il testo, inventa sempre variazioni nuove):\n- ${react.join(
          "\n- "
        )}`,
      },
      {
        role: "system",
        content: `DRINK (solo idea da trasformare, NON usare la frase letterale): ${drink}`,
      },
      {
        role: "system",
        content: `ESEMPI DI TONO/RITMO (NON copiare il testo, NON riutilizzare i nomi, servono solo come modello di stile):

Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.

Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.

Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
      }
    );
  } else {
    // WHAT IF dipendente dal tempo (IT), altre lingue solo baseRules
    if (L === "it") {
      const ruleIT = String(periodo).toLowerCase() === "past" ? WHATIF_RULE_PAST_IT : WHATIF_RULE_FUT_IT;
      msgs.push(
        { role: "system", content: ruleIT },
        {
          role: "system",
          content: `ESEMPIO (respiro e tono, non vincolante nei contenuti):\n${WHATIF_HYBRID_EX_IT}`,
        }
      );
    }
  }

  // Messaggio utente finale per l’LLM
  let ask;
  if (L === "en") {
    ask = hasClar
      ? `Original question (do not repeat it): "${domanda}". Extra detail from the user (fourth page answer, do NOT quote or summarize it): "${clar}". Produce ONE answer in ENGLISH, single paragraph, very clear and concrete.`
      : `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH, single paragraph.`;
  } else if (L === "it") {
    ask = hasClar
      ? `Domanda originale (NON ripeterla): "${domanda}". Dettaglio aggiuntivo dall’utente (risposta in quarta pagina, NON citarla e NON riassumerla): "${clar}". Genera UNA risposta in ITALIANO, paragrafo unico, tono naturale. Usa quel dettaglio solo per essere più preciso, più concreto e più utile.`
      : `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO, paragrafo unico, grammatica corretta, tono naturale.`;
  } else if (L === "es") {
    ask = hasClar
      ? `Pregunta original (no la repitas): "${domanda}". Detalle adicional del usuario (cuarta pantalla, no lo cites literalmente): "${clar}". Escribe UNA respuesta en ESPAÑOL, clara y concreta, en un solo párrafo.`
      : `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.`;
  } else if (L === "fr") {
    ask = hasClar
      ? `Question originale (ne la répète pas): « ${domanda} ». Détail supplémentaire de l’utilisateur (quatrième écran, ne le cite pas textuellement): « ${clar} ». Donne UNE réponse en FRANÇAIS, claire et concrète, en un seul paragraphe.`
      : `Question (ne la répète pas): « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.`;
  } else {
    ask = hasClar
      ? `Ursprüngliche Frage (nicht wiederholen): „${domanda}“. Zusatzdetail des Nutzers (vierte Seite, nicht wörtlich zitieren): „${clar}“. Gib EINE klare Antwort auf DEUTSCH, ein einziger Absatz.`
      : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.`;
  }

  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= Server-side PCT ========= */
function computePct(domanda, stile) {
  const t = String(domanda || "").toLowerCase();
  let s = 50;
  if (/\b(7|14|21|30|60|90)\b/.test(t)) s += 12;
  if (/\b\d+([.,]\d+)?\b/.test(t)) s += 8;
  if (/budget|€|euro|spesa|max|under|sotto/.test(t)) s += 6;
  if (/senza|solo|al massimo|minimo|entro|prima delle|ogni|per/.test(t)) s += 8;
  if (/lancia|apri|impara|scrivi|chiedi|corri|studia|automatizza|testa/.test(t)) s += 6;
  if (/forse|magari|maybe|quizás/.test(t)) s -= 8;
  if (!/\b\d/.test(t)) s -= 6;
  s += stile === "wtf" ? -4 : +2;
  const pct = Math.max(25, Math.min(92, Math.round(s)));
  return pct;
}

/* ========= WHAT IF: motivazione sintetica ========= */
function buildWhatIfMotivation(domanda, lang = "it", pct = 60) {
  const L = (lang || "it").slice(0, 2);
  const t = String(domanda || "").toLowerCase();

  const hasTime = /\b(7|14|21|30|60|90|giorn|settiman|mes|mesi|anni|days?|weeks?|months?|years?)\b/.test(t);
  const hasBudget = /(budget|€|euro|spesa|costo|prezzo|max|under|sotto|caparra|cost|money)/.test(t);
  const hasDeadline = /(entro|prima|scadenza|deadline|by\s+\d|before\s+\d)/.test(t);
  const action =
    /(apri|lancia|impara|studia|scrivi|automatizza|testa|cambia|trova|assumi|costruisci|crea|launch|start|learn|build|create)/.test(
      t
    );
  const riskHedging = /(senza|solo|al massimo|minimo|rischio|risk|minimize|hedge)/.test(t);

  if (L === "it") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push("la timeline è gestibile se spezzetti il percorso");
      cons.push("se non proteggi il tempo, rischi di rimandare all’infinito");
    }
    if (hasBudget) {
      pros.push("puoi tenere i costi sotto controllo fissando un tetto chiaro");
      cons.push("se sottostimi le spese, la pressione economica può frenarti");
    }
    if (hasDeadline) {
      pros.push("una scadenza esplicita ti aiuta a decidere prima, non meglio");
      cons.push("se la scadenza è vaga, tenderai a spostarla sempre un po’ più avanti");
    }
    if (action) {
      pros.push("hai una leva concreta su cui agire ogni giorno");
    }
    if (riskHedging) {
      pros.push("puoi limitare il rischio con poche regole semplici");
      cons.push("se cerchi rischio zero, potresti non muoverti mai davvero");
    }

    if (!pros.length) {
      pros.push("la vera leva è la routine: piccoli passi costanti battono le grandi intenzioni");
    }
    if (!cons.length) {
      cons.push("il collo di bottiglia è la tua energia: se allarghi troppo lo scope, ti blocchi");
    }

    const pSentence = `Probabilità circa ${pct}%.`;
    const proSentence = `A favore: ${pros.slice(0, 2).join(", ")}.`;
    const conSentence = `Contro: ${cons.slice(0, 2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  if (L === "en") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push("the timeline is realistic if you break it into small chunks");
      cons.push("if you don’t protect time, you’ll quietly postpone it forever");
    }
    if (hasBudget) {
      pros.push("you can keep costs under control with a clear cap");
      cons.push("underestimating expenses can add pressure and slow you down");
    }
    if (hasDeadline) {
      pros.push("an explicit deadline helps you decide sooner, not necessarily better");
      cons.push("a fuzzy deadline tends to drift and weaken your commitment");
    }
    if (action) {
      pros.push("you have a concrete lever you can pull every day");
    }
    if (riskHedging) {
      pros.push("simple constraints can cap the downside");
      cons.push("chasing zero risk can keep you stuck at the start line");
    }

    if (!pros.length) {
      pros.push("the real lever is routine: small consistent steps beat big intentions");
    }
    if (!cons.length) {
      cons.push("your main bottleneck is energy and focus, not luck");
    }

    const pSentence = `Estimated probability around ${pct}%.`;
    const proSentence = `Pros: ${pros.slice(0, 2).join(", ")}.`;
    const conSentence = `Cons: ${cons.slice(0, 2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  if (L === "es") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push("el tiempo es manejable si divides el camino en pasos pequeños");
      cons.push("si no proteges tu tiempo, acabarás posponiéndolo una y otra vez");
    }
    if (hasBudget) {
      pros.push("puedes mantener los costes bajo control con un límite claro");
      cons.push("si infravaloras los gastos, la presión económica puede frenarte");
    }
    if (hasDeadline) {
      pros.push("un plazo definido empuja a decidir antes");
      cons.push("si el plazo es difuso, se irá moviendo hacia adelante");
    }
    if (action) {
      pros.push("tienes una palanca concreta para avanzar cada día");
    }
    if (riskHedging) {
      pros.push("puedes limitar el riesgo con pocas reglas sencillas");
      cons.push("buscar riesgo cero puede dejarte inmóvil");
    }

    if (!pros.length) {
      pros.push("la palanca real es la rutina: pequeños pasos constantes vencen a los grandes planes");
    }
    if (!cons.length) {
      cons.push("el cuello de botella es tu energía y foco, no la suerte");
    }

    const pSentence = `Probabilidad aproximada ${pct}%.`;
    const proSentence = `A favor: ${pros.slice(0, 2).join(", ")}.`;
    const conSentence = `En contra: ${cons.slice(0, 2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  if (L === "fr") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push("le calendrier reste gérable si tu découpes en petites étapes");
      cons.push("sans temps protégé, tu repousseras discrètement sans fin");
    }
    if (hasBudget) {
      pros.push("tu peux contenir les coûts avec un plafond clair");
      cons.push("si tu sous-estimes les dépenses, la pression financière peut te freiner");
    }
    if (hasDeadline) {
      pros.push("une échéance claire aide à trancher plus vite");
      cons.push("une date floue glisse facilement et affaiblit ton engagement");
    }
    if (action) {
      pros.push("tu as un levier concret à actionner chaque jour");
    }
    if (riskHedging) {
      pros.push("quelques règles simples peuvent limiter le risque");
      cons.push("viser le risque zéro risque justement de t’immobiliser");
    }

    if (!pros.length) {
      pros.push("le vrai levier, c’est la routine: de petits pas réguliers dépassent les grandes intentions");
    }
    if (!cons.length) {
      cons.push("le principal goulot d’étranglement est ton énergie et ta clarté, pas la chance");
    }

    const pSentence = `Probabilité estimée autour de ${pct}%.`;
    const proSentence = `Atouts: ${pros.slice(0, 2).join(", ")}.`;
    const conSentence = `Freins: ${cons.slice(0, 2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  if (L === "de") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push("der Zeitplan ist machbar, wenn du ihn in kleine Schritte teilst");
      cons.push("ohne geschützte Zeit wirst du es immer wieder verschieben");
    }
    if (hasBudget) {
      pros.push("mit einem klaren Kostenlimit bleibt das Budget unter Kontrolle");
      cons.push("wenn du Ausgaben unterschätzt, entsteht Druck, der dich bremst");
    }
    if (hasDeadline) {
      pros.push("eine klare Deadline zwingt zu früheren Entscheidungen");
      cons.push("eine vage Frist rutscht leicht nach hinten");
    }
    if (action) {
      pros.push("du hast einen konkreten Hebel, den du täglich bewegen kannst");
    }
    if (riskHedging) {
      pros.push("einfache Regeln können das Risiko begrenzen");
      cons.push("wenn du null Risiko willst, kommst du vielleicht nie in Gang");
    }

    if (!pros.length) {
      pros.push("der wahre Hebel ist Routine: kleine, konstante Schritte schlagen große Vorsätze");
    }
    if (!cons.length) {
      cons.push("der Engpass ist deine Energie und Fokussierung, nicht das Schicksal");
    }

    const pSentence = `Geschätzte Wahrscheinlichkeit etwa ${pct}%.`;
    const proSentence = `Dafür: ${pros.slice(0, 2).join(", ")}.`;
    const conSentence = `Dagegen: ${cons.slice(0, 2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  return buildWhatIfMotivation(domanda, "it", pct);
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString()
      .split(",")[0]
      .trim();
    const ok = await rateOk(`ask:${ip}`);
    if (!ok) return res.status(429).json({ error: "rate_limited_minute" });

    const bodyRaw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    const body = bodyRaw
      ? typeof req.body === "string"
        ? JSON.parse(bodyRaw)
        : req.body || {}
      : {};

    const {
      stage = "answer", // "clarify" | "answer"
      domanda = "",
      clarification = "",
      stile = "whatif", // "whatif" | "wtf"
      lang = "it",
      periodo = "future", // "future" | "past"
      micro = {},
    } = body || {};

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const L = normLang(lang);

    /* ===== STAGE: CLARIFY (quarta pagina) ===== */
    if (stage === "clarify") {
      const messages = buildClarifyMessages({ domanda, lang: L, periodo, stile });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: stile === "wtf" ? 0.95 : 0.8,
        top_p: 0.9,
        max_tokens: 80,
        messages,
      });

      let clarQ = completion?.choices?.[0]?.message?.content?.trim() || "";
      clarQ = normalizeOneParagraph(clarQ);
      clarQ = sentenceCaseAll(clarQ);
      clarQ = finalPunct(clarQ);

      return res.status(200).json({
        mode: "clarify",
        clarifyingQuestion: clarQ,
        style: stile,
        lang: L,
        periodo,
        model: MODEL,
      });
    }

    /* ===== STAGE: ANSWER (quinta pagina) ===== */
    const messages = buildMessages({ domanda, clarification, lang: L, periodo, stile, micro });

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
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);

    // Moderazioni leggere IT (prima del ripristino maiuscole)
    if (normLang(lang) === "it") {
      (function () {
        const d = String(domanda || "");
        const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQuestion = new Set(d.match(nameRx) || []);
        answer = answer.replace(nameRx, (m) => {
          if (
            [
              "Ah",
              "Oh",
              "Ehi",
              "Sai",
              "Occhio",
              "Piano",
              "Fermati",
              "Aspetta",
              "La",
              "Le",
              "Una",
              "Il",
              "Qui",
            ].includes(m)
          )
            return m;
          return inQuestion.has(m) ? m : m.toLowerCase();
        });
      })();
    }

    // Ripristina maiuscole frasi
    answer = sentenceCaseAll(answer);

    // Finale emozionale con gancio se manca (solo WHAT IF)
    if (stile === "whatif") {
      answer = ensureZingaraEnding({ text: answer, lang, periodo, domanda });
    }

    // Punteggiatura finale
    answer = finalPunct(answer);

    // Extra payload
    const pct = computePct(domanda, stile);
    const motivation = stile === "whatif" ? buildWhatIfMotivation(domanda, L, pct) : undefined;
    const isSurprise = !!(micro && (micro.surprise === true || micro.src === "surprise"));
    const scientific = stile === "wtf" && !isSurprise ? scientificReportDemenziale(domanda, L) : undefined;

    return res.status(200).json({
      mode: "answer",
      answer,
      style: stile,
      lang: L,
      periodo,
      model: MODEL,
      pct,
      motivation,
      scientific,
      usedClarification: !!clarification,
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
