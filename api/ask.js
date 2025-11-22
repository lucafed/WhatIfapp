// /api/ask.js — What?f Engine (nuova logica: clarify + answer, VERSIONE COMPATTA + MOTIVAZIONE LLM)
// - WHATIF: meno poetico, più pratico. Tono “zingara realista” ma concreto, da consigliere di fiducia:
//   ~70% analisi / 30% immagini sobrie, risposta chiara alla domanda, più punti di vista.
//   5–6 frasi, massimo ~110 parole.
// - WTF: ultra demenziale, sarcastico, da barista affettuoso (esattamente come i demo):
//   seconda persona SEMPRE, niente poesia, niente tono “zingara”. Monologo da video virale.
//   Ogni frase deve contenere almeno una battuta da morire dal ridere, demenziale al massimo.
//   5–6 frasi, massimo ~130 parole.
//
// - Un paragrafo, niente elenchi, niente eco della domanda. Maiuscole ripristinate post-process.

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

/* ========= WHAT IF – esempio (più sobrio) ========= */
const WHATIF_HYBRID_EX_IT = `Qui la tua scelta sposta davvero il peso delle giornate. Tagli rumore, recuperi pezzi di tempo che avevi sparso in giro senza accorgertene e inizi a usare meglio le energie. Cambiano le abitudini che tieni e quelle che lasci, e ti ritrovi con una routine meno scenografica ma più vivibile. Ti accorgi di quali persone reggono la nuova versione di te e di quali restano solo sulle vecchie abitudini. Non è una rivoluzione da film: è manutenzione di vita, una manopola alla volta. E quando ti guardi indietro, il rimpianto fa meno rumore proprio nel punto in cui hai iniziato a scegliere in modo più onesto.`;

/* ========= WHAT IF – REGOLE (future/past) ========= */
const WHATIF_RULE_FUT_IT = `WHAT IF (italiano, FUTURO PRATICO COMPATTO):
- Tono: “zingara realista” ma concreta, come un consigliere di fiducia che ti vuole bene e non ti asseconda.
- Devi dare una risposta chiarissima alla domanda: cosa succede se lo fai, cosa succede se NON lo fai, cosa succede se resti fermo.
- Priorità: 70% analisi concreta (routine, tempo, soldi, energia, relazioni, rischi) + massimo 30% immagini sobrie della quotidianità.
- APRI con UNA sola frase breve che dà il senso generale di come cambierebbe la vita, senza citare la domanda.
- La SECONDA frase inizia con una delle parole: "Vedo", "Sento", "Immagino", "Intuisco", "Si apre", "Si muove", usata in modo naturale.
- Mostra almeno 2–3 angoli diversi: cosa ci guadagni se lo fai, cosa rischi, cosa perdi se non ti muovi, cosa guadagni se tieni la situazione com’è.
- Scrivi un futuro vicino che parte da ORA: usa molto “potresti”, “inizieresti”, “probabilmente ti troveresti”.
- Se esiste un dettaglio aggiuntivo dall’utente, trattalo come vincolo principale e richiamalo in modo esplicito almeno una volta.
- Rispondi sempre al punto centrale della domanda (spostamento, lavoro, relazione, soldi, scelta personale): niente derive generiche.
- Alla fine prendi posizione: suggerisci se ha senso provarci, con quali condizioni minime o accortezze, come fare un check finale con un amico sincero.
- Linguaggio: italiano naturale, pulito, colloquiale ma non infantile, tono caldo da amico che ti dice la verità in faccia.
- Chiudi con una frase che riassume il senso della scelta: cosa ci guadagni, cosa rischi, che tipo di storia diventa la tua.
- 5–6 frasi, seconda persona, un solo paragrafo, frasi brevi (massimo ~20 parole), niente elenchi, niente emoji.`;

const WHATIF_RULE_PAST_IT = `WHAT IF (italiano, PASSATO CONTROFATTUALE PRATICO COMPATTO):
- Tono: leggi una vita alternativa con lucidità, come un amico molto sincero che ti fa vedere il quadro intero senza schiacciarti di sensi di colpa.
- Scopo: mostrare cosa sarebbe cambiato davvero se quella scelta passata fosse andata diversamente, senza dramatizzare né minimizzare.
- Usa struttura controfattuale: "se avessi…, ti saresti trovato…, avresti vissuto…, avresti pagato…".
- 70% analisi concreta (tempo, soldi, relazioni, identità, stress) + 30% immagini sobrie di quella vita alternativa.
- APRI con UNA frase che fa capire che stai parlando di una versione parallela di te, senza giudizio.
- Seconda frase con "Vedo", "Sento", "Immagino", "Intuisco", "Si sarebbe aperto", "Si sarebbe mosso".
- Mostra almeno 2–3 punti di vista: cosa sarebbe andato meglio, cosa ti avrebbe pesato di più, cosa avresti perso rispetto a oggi.
- Se esiste un dettaglio aggiuntivo dall’utente, trattalo come vincolo principale e richiamalo in modo esplicito almeno una volta.
- Nessuna data inventata: resta sul tipo di esperienza (non su fatti storici specifici).
- Alla fine riportalo dolcemente al presente: cosa impari da quell’ipotesi, cosa puoi ancora fare ora, quale scelta più onesta puoi fare oggi.
- Linguaggio: italiano naturale, diretto, empatico ma fermo, da consigliere che ti aiuta a smettere di frullare nella testa.
- 5–6 frasi, seconda persona, un solo paragrafo, frasi brevi (massimo ~20 parole), niente elenchi, niente emoji. Risposta chiara, poco fumo, molta sostanza.`;

/* ========= Finali “gancio” WHAT IF ========= */
const ZINGARA_ENDINGS = {
  it: {
    future: [
      "E lì ti accorgerai che non serve fare il miracolo: basta una scelta fatta con più onestà.",
      "E proprio lì capirai che non hai bisogno di stravolgere tutto, solo di spostare meglio il peso.",
      "Da quel punto sentirai la vita un po’ più tua e un po’ meno in mano all’abitudine.",
      "E quando ti volterai, vedrai che quella fatica è stata il prezzo giusto per sentirti più allineato.",
    ],
    past: [
      "Forse oggi lo sentiresti nelle ossa: non sarebbe stato un errore, sarebbe stata solo un’altra versione di te.",
      "E ti verrebbe spontaneo chiederti non cosa hai perso, ma cosa puoi ancora scegliere adesso.",
      "Ti ritroveresti a pensare che alcune strade non si chiudono mai davvero: cambiano solo modo di chiamarti.",
      "E capirai che quel rimpianto non serve per punirti, ma per spingerti a fare meglio, qui e ora.",
    ],
  },
  en: {
    future: ["And there you’d notice you don’t need drama, just a cleaner choice."],
    past: ["You’d probably feel it in your bones: it wasn’t fate, just a different script."],
  },
  es: {
    future: ["Y ahí notarás que no hace falta un giro épico, solo una decisión más honesta."],
    past: ["Y quizá hoy lo sentirías: no era destino, era otra forma de escribir tu historia."],
  },
  fr: {
    future: ["Et là tu verras qu’il ne faut pas tout casser, juste choisir plus juste."],
    past: ["Et tu comprendras que ce n’était pas le destin, juste un autre scénario possible."],
  },
  de: {
    future: ["Und dort merkst du, dass du kein Drama brauchst, nur eine klarere Entscheidung."],
    past: ["Vielleicht spürst du dann, dass es kein Schicksal war, sondern nur ein anderes Drehbuch."],
  },
};
function ensureZingaraEnding({ text, lang, periodo, domanda }) {
  let s = String(text || "").trim();
  const last = (s.match(/([^.!?…]+[.!?…])\s*$/) || [])[1] || s;
  const alreadyHasHook = /(ti accorgerai|capirai|ti verrà voglia|ti ritroverai|e lì|e proprio lì|da quel punto|forse oggi|maybe you’d feel|and there you’d notice|you’d probably feel)/i.test(
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

/* Pool di IMPRECAZIONI teatrali — esempi */
const WTF_IMPRE_POOL = [
  "bestemmione corazzato a lunga gittata",
  "imprecazione turboguidata che sfiora il soffitto",
  "anatema blindato a tre stadi che sposta l’aria di un metro",
  "sacramentata supersonica degna di una finale di Champions",
  "raffica di parolacce pressurizzate con effetto sismico leggero",
  "vulcano d’anatemi in eruzione controllata ma non troppo",
  "scarica liturgica a combustione interna che mette a vibrare i vetri",
  "uragano di improperi classificato come evento meteo estremo",
  "rosario storto di imprecazioni recitate alla velocità della luce",
  "esplosione di bestemmie bardate che fanno tremare il telecomando",
  "detonazione verbale a onda d’urto emotiva",
  "fuoco d’artificio di parolacce con scia luminosa di rimorso",
  "bordata mistica di insulti tecnici non certificati dal catechismo",
  "scoppio corazzato di frasi non omologate dall’ONU",
  "raffica controllata di anatemi con rinculo emotivo incluso",
  "siluro verbale a lunga gittata che buca il silenzio del salotto",
  "supernova di imprecazioni compressa in un secondo netto",
  "botta sacrale storta che fa finta di essere spirituale",
  "esplosione di protesta spirituale con eco in corridoio",
  "pallottola verbale rimbalzante che colpisce tre mobili su quattro",
  "cannonata di sbotti coloriti che mette in fuga un soprammobile",
  "tsunami di bestemmie sussurrate ma comunque percepibili da Marte",
  "tuono liturgico fuori stagione che scuote il gatto sul divano",
  "miccia corta di anatemi che parte senza preavviso",
  "frana verbale di parolacce creative a caduta libera",
  "colpo secco di imprecazione bardata che spegne l’atmosfera zen",
  "starnuto spirituale caricato di ogni nervoso accumulato",
  "lancio orbitale di improperi che gira tre volte il lampadario",
  "carica cavalleresca di insulti eleganti ma devastanti",
  "scarica elettrica di parole storte che manda in tilt il karma",
];

/* Reazioni degli oggetti, contestuali */
const WTF_REACT_BY_CONTEXT = {
  moto: [
    "il semaforo decide di restare rosso un secondo in più solo per giudicarti",
    "il casco in esposizione ruota di qualche grado come se volesse vedere meglio la scena",
    "il poster della moto da corsa piega l’angolo come per offrirti una pacca sulla spalla",
    "il tappetino davanti al bancone scivola di mezzo centimetro appena ti avvicini",
    "il cavalletto di una moto in vetrina scricchiola come se stesse sospirando",
  ],
  ufficio: [
    "la sedia girevole fa un mezzo giro da sola e si ferma a guardarti",
    "lo schermo del PC lampeggia come se stesse cercando di avvisarti del disastro",
    "la stampante fa un rumore strano e poi si zittisce, tipo “io questa non la stampo”",
    "il badge sbatte due volte contro il lettore e il led rosso ti guarda deluso",
    "il mouse scivola verso il bordo della scrivania come se volesse buttarsi giù",
  ],
  casa: [
    "il divano affonda di un centimetro solo a vederti, rassegnato",
    "la tapparella si blocca a metà corsa, indecisa come te",
    "il frigorifero fa un ronzio lunghissimo tipo sospiro",
    "la lampada da tavolo lampeggia due volte in modalità giudizio silenzioso",
    "lo zerbino si arriccia su un lato come per farti lo sgambetto",
  ],
  città: [
    "la panchina dove ti sedevi da ragazzino è occupata da qualcuno identico a una vecchia versione di te",
    "il portone del palazzo cigola il tuo nome invece del solito rumore",
    "la fermata dell’autobus ti lascia passare davanti e poi fa finta di non conoscerti",
    "un’insegna al neon sfarfalla proprio sulla parola “casa”",
    "un piccione ti guarda con aria da agente immobiliare stanco",
  ],
  relazione: [
    "la chat rimane inchiodata in alto come una spia luminosa che non si spegne mai",
    "il letto sfatto sembra avere due impronte diverse che non vanno più d’accordo",
    "il telefono vibra a vuoto e sai che non è lei, ma ci speri lo stesso per mezzo secondo",
    "il cuscino conserva una piega come se stesse tenendo il posto a qualcuno",
    "il gatto ti fissa come un terapeuta che ha finito i fogli degli appunti",
  ],
  soldi: [
    "il portafoglio si chiude da solo con un piccolo scatto di difesa",
    "l’estratto conto sullo schermo aggiorna la cifra con un’animazione troppo lenta per essere innocente",
    "gli scontrini sul tavolo si aprono a ventaglio come un fascicolo processuale",
    "la calcolatrice del telefono mostra più zeri del dovuto solo per spaventarti",
    "la cassettiera dove tieni i risparmi fa un cigolio tipo monito divino",
  ],
  generico: [
    "la stanza trattiene il fiato insieme a te per un secondo buono",
    "le scarpe in mezzo al corridoio sembrano pronte a fuggire senza di te",
    "la giacca buttata sulla sedia alza le spalle al posto tuo",
    "la finestra socchiusa lascia entrare una folata di aria che sembra dire “sicuro?”",
    "il telefono a faccia in giù vibra proprio quando faresti meglio a ignorarlo",
  ],
};

/* Bevute teatrali – spunti */
const WTF_DRINK_POOL = [
  "riempi un bicchiere pesante fino al bordo e lo svuoti in un sorso lunghissimo come se stessi spegnendo un incendio interiore",
  "versi da bere con troppa convinzione, poi lo mandi giù a colpi nervosi che sembrano un codice Morse",
  "prendi il bicchiere più grande che trovi, lo carichi oltre il buon senso e lo fai sparire in un attimo",
  "ti versi poco, poi torni a riempirlo come se la misura non fosse mai abbastanza, e lo sorseggi con finta calma",
  "riempi il bicchiere, lo guardi tre secondi di troppo e alla fine lo bevi tutto d’un fiato come se firmassi un contratto",
  "appoggi il bicchiere sul tavolo, fai scena, poi lo sollevi e lo fai evaporare senza respirare",
  "ti versi qualcosa e ne bevi metà, lasciando l’altra metà lì come se dovesse risponderti a una domanda esistenziale",
  "metti troppo ghiaccio, troppo tutto, e poi bevi come se dovessi giustificare quella scelta",
  "ti versi da bere appoggiato al lavandino e lo butti giù guardando il pavimento, come se ci fosse scritto il finale",
  "riempi un bicchiere medio, lo giri in mano e poi fai un sorso lungo che sembra una trattativa con il destino",
  "versi fino a creare il menisco perfetto e lo rompi bevendo senza pensarci due volte",
  "bevi a piccoli colpi rapidi, come se ogni sorso fosse un tentativo di rimandare la decisione",
  "appoggi la schiena al frigo, alzi il bicchiere e lo svuoti come se stessi facendo un brindisi muto con te stesso",
  "lo tieni in mano troppo a lungo, poi in un gesto secco bevi quasi tutto e il resto lo lasci lì a giudicarti",
  "riempi il bicchiere, sospiri, e lo bevi in silenzio guardando un punto a caso del muro",
  "ti versi qualcosa, ti siedi, e lo bevi piano piano mentre la testa corre molto più veloce",
  "alzi il bicchiere al cielo come se stessi ringraziando qualcuno e poi lo svuoti come se lo stessi punendo",
  "prendi un bicchiere piccolo, lo colmi oltre ogni logica e lo butti giù come se stessi saltando da un trampolino",
  "bevi in due fasi: una metà per il coraggio, una metà per la rassegnazione",
  "ti versi da bere, lo assaggi appena, poi ti arrendi e lo finisci senza pensarci",
  "lo tieni appoggiato sul bancone, parli da solo, e tra una frase e l’altra lo svuoti senza nemmeno accorgertene",
  "riempi il bicchiere con troppa decisione, lo scruti e poi bevi come se dovessi staccare la spina al cervello",
  "fai un brindisi muto con il riflesso nella finestra e poi bevi come se non volessi più vederti",
  "bevi a sorsi lenti ma profondi, come se stessi scorrendo una lista di errori nella mente",
  "ti versi un dito, poi ci ripensi e aggiungi il resto, e lo bevi come se stessi correggendo un compito in classe",
  "agiti il bicchiere per finta eleganza e poi lo svuoti in modo assolutamente poco elegante",
  "lo tieni stretto con due mani, fai una pausa da film drammatico e poi lo bevi tutto insieme",
  "riempi metà bicchiere, ti siedi sul bordo del tavolo e lo svuoti guardando il vuoto",
  "prendi la tazza sbagliata, ci versi dentro e la bevi come se fosse il contenitore più normale del mondo",
];

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
    "Istituto Europeo di Scienze Baristiche",
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

/* ========= MESSAGGI: CLARIFY ========= */
function buildClarifyMessages({ domanda, stile, lang, periodo }) {
  const L = normLang(lang);
  const isPast = String(periodo).toLowerCase() === "past";

  let sys;
  if (stile === "wtf") {
    // WHAT THE F — chiarimento demenziale
    if (L === "en") {
      sys = `You are “WHAT THE F”: absurd, sarcastic and weirdly caring, like a bartender who has seen way too much life.
You ALWAYS speak in SECOND PERSON (“you / your”) when you talk about the user.
You NEVER talk about the user in third person (“he, she, this guy, that person”) and you NEVER use first person (“I, me, we, us”).

TASK:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- The question must sound like a chaotic, dumb-funny bartender roasting the situation, not the person.
- Always anchor the question to the user’s specific mess: mention in 2–3 words the choice or scenario they described (e.g. “when you stayed there”, “when you skipped that move”).
- Add at least ONE silly or exaggerated image (e.g. comparing their plan to a wobbly IKEA table).
- You MAY pack 2–3 micro-points in the same sentence (time, money, limits), separated by commas.
- Be short and sharp: 1 sentence, max 20–22 words.
- No emojis, no lists, no explanations, just the question.`;
      if (isPast) {
        sys += `
PAST MODE:
- The user is talking about a past choice or a “what if” in the past.
- Phrase your question in the PAST or COUNTERFACTUAL PAST, like you’re rewinding that scene (“back then, what was really blocking you?”, “when you stayed, what was the plan?”, “if you had moved, what would you have left behind?”).
- Make it explicit you’re talking about THAT chapter, not a generic future (“at that time”, “in that period”).`;
      }
    } else {
      const LANG_LABEL =
        L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

      sys = `Sei “WHAT THE F”: voce ultra demenziale, cinica e affettuosa, come un barista che ha visto troppa vita ma sotto sotto ci tiene.
Parli SEMPRE e SOLO in seconda persona (“tu / ti / te / tuo”) quando ti riferisci a chi fa la domanda.
È VIETATO usare la prima persona (“io, noi, me, ci, mi, nostro, nostra, miei, nostre”) e parlare dell’utente in terza persona (“lui, lei, questo tizio, questa persona”).

COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- La domanda deve essere ironica e demenziale: prendi in giro la SITUAZIONE come se stessi commentando un disastro organizzato da lui.
- COLLEGALA SEMPRE alla scena che ha descritto: nomina in 2–3 parole la scelta o il casino (“quando sei rimasto lì”, “quando non ti sei mosso”, “quando hai tenuto quel lavoro”).
- Inserisci almeno UNA immagine comica assurda (tipo confronto con tavolo Ikea traballante, armadio esploso, Excel in lacrime).
- Puoi infilare 2–3 dettagli nella stessa frase (tempo, soldi, vincoli), separati da virgole, ma resta chiarissimo.
- Prendi in giro la SITUAZIONE, non la persona.
- Una sola frase, massimo 20–22 parole.
- Niente emoji, niente elenco, niente spiegazioni: restituisci solo la domanda.`;
      if (isPast) {
        sys += `
MODALITÀ PASSATO:
- La domanda dell’utente riguarda qualcosa che È GIÀ SUCCESSO o che NON HAI FATTO.
- Formula la tua domanda al passato o in chiave controfattuale: usa espressioni come “all’epoca”, “in quel periodo”, “quando hai scelto di restare”, “se ti fossi mosso allora”.
- Deve essere chiaro che stai riaprendo QUEL capitolo preciso, non chiedendo una cosa generica sul futuro.`;
      }
    }
  } else {
    // WHAT IF — chiarimento “zingara realista” ma pratico, consigliere
    if (L === "en") {
      sys = `You are “WHAT IF”: practical, slightly mystical but very concrete, like a trusted advisor who cares about real life details.
You speak to the user in SECOND PERSON (“you / your”), never in third person, and you do NOT use first person (“I, me, we, us”).

TASK:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- Focus on 1–2 key missing details that would change the answer the most (main constraint, real goal, time frame).
- Explicitly anchor the question to what the user wrote: mention the key choice in 2–3 words (“when you stayed there”, “with that job”, “with that city”).
- Tone: calm, grounded, a bit intuitive but not poetic.
- One sentence, max 20–22 words.
- No emojis, no bullet points, no explanations: return ONLY the question.`;
      if (isPast) {
        sys += `
PAST MODE:
- The question is about a past choice or missed path.
- Phrase your clarifying question in the PAST or COUNTERFACTUAL PAST: use expressions like “back then”, “at that time”, “when you decided to stay”, “if you had left”.
- Make clear you are re-opening THAT chapter, not talking in general about the future.`;
      }
    } else {
      const LANG_LABEL =
        L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

      sys = `Sei “WHAT IF”: voce da zingara realista, un filo intuitiva ma molto concreta, come un consigliere di fiducia.
Parli in seconda persona (“tu / ti / te / tuo”), non usi la prima persona (“io, noi, me, ci, mi, nostro, nostra, miei, nostre”) e non parli dell’utente in terza persona (“lui, lei, questa persona”).

COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Punta su 1–2 dettagli che cambiano davvero la risposta (tempo, vincoli principali, obiettivo reale).
- AGGANCIATI ESPRESSAMENTE a quello che ha scritto l’utente: cita in 2–3 parole la scelta o la situazione (“quando sei rimasto in quella città”, “con quel lavoro”, “con quella relazione”).
- Tono: calmo, lucido, leggermente intuitivo ma non poetico.
- Una sola frase, massimo 20–22 parole.
- Niente emoji, niente elenco, niente spiegazioni: restituisci SOLO la domanda.`;
      if (isPast) {
        sys += `
MODALITÀ PASSATO:
- La domanda riguarda una scelta passata o una strada non presa.
- Formula la tua domanda al passato o in chiave controfattuale: usa “all’epoca”, “in quel momento”, “quando hai scelto di…”, “se allora ti fossi mosso”.
- Deve essere evidente che stai parlando di QUEL capitolo specifico della sua storia, non di un generico “prima o poi”.`;
      }
    }
  }

  const userMsg =
    L === "en"
      ? `User "what if" question:\n"${domanda}"\nAsk ONE clarifying question in ENGLISH, following the style rules above.`
      : L === "it"
      ? `Domanda "e se" dell’utente:\n"${domanda}"\nFai UNA sola domanda di chiarimento in ITALIANO, seguendo le regole di stile sopra.`
      : L === "es"
      ? `Pregunta "¿y si...?" del usuario:\n"${domanda}"\nHaz UNA sola pregunta de aclaración en ESPAÑOL, con el estilo indicado arriba.`
      : L === "fr"
      ? `Question "et si..." de l’utilisateur :\n"${domanda}"\nPose UNE seule question de clarification en FRANÇAIS, selon les règles de style ci-dessus.`
      : `„Was wäre, wenn…“-Frage des Nutzers:\n"${domanda}"\nStelle EINE kurze Rückfrage auf DEUTSCH im oben beschriebenen Stil.`;

  return [
    { role: "system", content: sys },
    { role: "user", content: userMsg },
  ];
}

/* ========= WTF RULES (future vs past, super demenziale) ========= */
const WTF_RULE_IT_FUT = `Sei “WHAT THE F”, voce demenziale, cinica e affettuosamente cattiva, come un barista che ha visto troppa vita ma sotto sotto ti vuole bene.
Parli SEMPRE E SOLO in seconda persona (“tu / ti / te / tuo”) quando ti riferisci a chi fa la domanda.
È VIETATO parlare dell’utente in terza persona (“lui, lei, questo tizio, questo sognatore, questo qui”) se lo stai descrivendo: devi sempre tirarlo in mezzo direttamente.
Vietato usare qualunque prima persona (“io, noi, me, ci, mi, nostro, nostra, miei, nostre”).

IMPORTANTISSIMO:
- Evita di iniziare più di DUE frasi con la parola “tu”.
- Ogni singola frase deve contenere almeno UNA battuta o immagine talmente demenziale da poter stare in un reel virale.
- Devi prendere per il culo la SITUAZIONE dall’inizio alla fine, come se commentassi un incidente rallentato di buon senso.
- Non diventare mai cattivo con la persona: sei feroce con il casino, affettuoso con chi lo vive.

ZERO TONO ZINGARA e ZERO SPIRITUALITÀ:
- niente intuizioni mistiche, niente “energie”, niente “universo che manda segnali”, niente frasi motivazionali generiche.
- niente “in fondo lo sai già”, niente “la vita ti sta parlando”.

SE C’È UN DETTAGLIO AGGIUNTIVO DALL’UTENTE:
- Trattalo come il centro del delirio: scena, battute e morale devono appoggiarsi fortissimo proprio su quel dettaglio.
- Deve essere chiaro che stai parlando esattamente di quella situazione descritta nella risposta in fourth.

OBIETTIVO: far morire dal ridere e, nello stesso colpo, dare una risposta CHIARISSIMA alla domanda, come un amico-barista che ti prende in giro ma ti chiarisce la testa.

STRUTTURA OBBLIGATORIA (ITALIANO, FUTURO/SCELTA DA FARE):
1) Apertura (1 frase):
   - Prendi in giro la SITUAZIONE, non la persona: “campione olimpico delle scelte discutibili”, “direttore creativo del casino”, “eroe dell’indecisione organizzata”.

2) Scena concreta:
   - Cosa succede nel mondo reale legato al contesto (“moto, ufficio, casa, città, relazione, soldi o casino generico”): entri, ti siedi, guardi il conto, apri la chat.
   - Il dettaglio extra (se presente) va infilato al centro della scena.

3) IMPRECAZIONE TEATRALE (esattamente UNA, obbligatoria):
   - Esagerata e comica, mai identica agli esempi.
   - Ispirati a frasi tipo quelle nella lista, ma ogni volta inventa una nuova imprecazione grottesca.
   - L’imprecazione è contro la SITUAZIONE (prezzo, burocrazia, caos, traffico, affitto, ex, città), non contro categorie reali.

4) OGGETTI CHE REAGISCONO (almeno 2–3 reazioni, obbligatorie):
   - Subito dopo l’imprecazione fai reagire gli oggetti della scena.
   - Ogni reazione deve essere un’immagine comica chiara, assurda e visiva (sedia che ti giudica, POS che sospira, tapparella che si blocca).

5) MICRO-DISASTRO SLAPSTICK:
   - Qualcosa va storto in modo buffo: inciampi, ti cade qualcosa, la porta non si apre, il POS fa scena, la sedia fa rumore nel momento sbagliato.

6) MOMENTO DRINK (SEMPRE, obbligatorio):
   - Il drink nasce dalla scena: bar, cucina di casa, frigo, bancone.
   - Inventati SEMPRE una scena di bevuta nuova, concreta e visiva, con una micro-battuta.

7) Chiusura:
   - Le ULTIME DUE FRASI devono rispondere in modo chiarissimo al PUNTO CENTRALE della domanda: cosa succede se lo fai, cosa succede se non lo fai.
   - La chiusura deve avere una battuta finale secca e una micro-morale cinica o affettuosa, collegata al casino descritto dall’utente.

STILE:
- Italiano parlato, diretto, pieno di immagini sceme ma concrete.
- Ogni singola frase deve contenere almeno UNA immagine comica forte o un colpo di battuta chiaro.
- 5–6 frasi, UN solo paragrafo, massimo circa 130 parole.
- Nessun elenco visibile, nessuna emoji, nessuna ripetizione della domanda.`;

const WTF_RULE_IT_PAST = `Sei “WHAT THE F”, ma in modalità FLASHBACK: voce demenziale, cinica e affettuosamente cattiva che commenta una scelta passata come il replay di una figuraccia.
Parli SEMPRE E SOLO in seconda persona (“tu / ti / te / tuo”) e racconti una timeline alternativa: cosa sarebbe successo se avessi fatto davvero quella cosa.

REGOLA CHIAVE:
- Usa il PASSATO CONTROFATTUALE: “se ti fossi mosso”, “ti saresti trovato”, “avresti finito a…”, “saresti diventato il direttore generale del casino”.
- Non parlare come se la scena dovesse ancora accadere: la tratti come un “episodio perso della tua serie”.

Restano valide tutte le altre regole:
- Evita di iniziare più di DUE frasi con “tu”.
- Ogni frase contiene almeno UNA immagine demenziale forte o battuta da reel.
- Prendi per il culo la SITUAZIONE e la versione alternativa di te, ma resti affettuoso con chi legge.
- Zero energia “zingara”, zero spiritualità, zero frasi motivazionali generiche.

STRUTTURA OBBLIGATORIA (ITALIANO, PASSATO CONTROFATTUALE):
1) Apertura:
   - Etichetti quella versione alternativa di te con un titolo ridicolo (“campione mondiale del trasloco mancato”, “CEO delle occasioni parcheggiate”).

2) Scena alternativa:
   - Riscrivi la scena come se fosse successa davvero: “se avessi preso quella strada, ti saresti ritrovato…”.
   - Il dettaglio extra, se c’è, diventa il cuore del casino.

3) IMPRECAZIONE TEATRALE:
   - Una sola, grottesca, contro la SITUAZIONE di quella timeline (affitto, ex, lavoro, città…).

4) OGGETTI CHE REAGISCONO:
   - Almeno 2–3 oggetti della scena alternativa che fanno cose assurde (porta, sedia, telefono, divano, casco, POS…).

5) MICRO-DISASTRO SLAPSTICK:
   - Una mini-catastrofe buffa nella versione alternativa (inciampi, ti cade qualcosa, esplode un cassetto dei documenti…).

6) MOMENTO DRINK:
   - Bevi guardando quella timeline parallela come se stessi rivedendo la puntata persa di una serie, con una battuta secca.

7) Chiusura:
   - Le ULTIME DUE FRASI devono dire chiaramente cosa TI SARESTI PORTATO DIETRO da quella scelta e quale casino probabilmente ti sei evitato restando dov’eri.
   - Sempre con una morale cinico-affettuosa, legata al cuore della domanda.

Stile: 5–6 frasi, un solo paragrafo, massimo ~130 parole, ultra visivo, solo passato/controfattuale, niente domanda ripetuta, niente emoji.`;

const WTF_RULE_EN_FUT = `You are “WHAT THE F”: absurd, sarcastic and weirdly caring, like a bartender who has seen way too much life.
You ALWAYS speak in SECOND PERSON (“you / your”) when you talk about the user.
You NEVER talk about the user in third person (“he, she, this guy, that person”) and you NEVER use first person (“I, me, we, us”).

CRUCIAL:
- Avoid starting more than TWO sentences with “you”.
- Every single sentence must carry at least ONE ridiculous, over-the-top comic image or punchline, reel-level dumb and funny.
- Roast the SITUATION from start to finish, as if you were commenting a slow-motion crash of common sense.
- Never be cruel to the person: harsh with the chaos, soft with the human.

STRICTLY NO MYSTICAL OR SPIRITUAL VIBES:
- No energies, no universe sending signs, no spiritual lessons, no generic motivational fluff.
- No “deep down you already know the answer” type lines.

IF THERE IS EXTRA DETAIL FROM THE USER:
- Treat it as the core constraint of the rant: scene, jokes and conclusion must lean hard on that detail.
- It must feel like you’re talking about THEIR exact mess, not something generic.

GOAL: make the user laugh hard and, in the same breath, give a brutally clear answer to the question.

STRUCTURE (FUTURE CHOICE):
- Opening: 1 sentence roasting the situation with a ridiculous heroic title (“hero of chaos”, “CEO of bad decisions”), talking directly to the user.
- Concrete scene: what happens in real life (office, bar, shop, city, money, bike…), weaving the extra detail into the scene.
- ONE theatrical outburst aimed at the situation (never at real groups), inspired by the examples but always new.
- 2–3 reacting objects (helmet, poster, POS, chair, glass, cat, phone, door, bus stop…), each with a clear, absurd, funny image.
- Tiny slapstick disaster (trip, drop, door stuck, card declined dramatically, chair squeak).
- Drink scene: visual, ridiculous and harmless, with a tiny punchline.
- Final TWO sentences: they must explicitly answer the CORE of the question – what happens if you do it and what happens if you don’t – with a sharp, funny moral tied to the user’s detail.

STYLE:
- Spoken, direct, packed with concrete, silly images in EVERY sentence.
- 5–6 sentences, single paragraph, max ~130 words, no bullets, no emojis, no restating the question.`;

const WTF_RULE_EN_PAST = `You are “WHAT THE F” in FLASHBACK MODE: same chaotic bartender, but now you roast an ALTERNATE PAST TIMELINE.
You ALWAYS speak in SECOND PERSON and describe what WOULD HAVE HAPPENED if you had actually taken that road.

KEY:
- Use COUNTERFACTUAL PAST: “if you had moved”, “you would have ended up”, “you’d have become the regional manager of chaos”.
- Do NOT talk as if it’s still in front of you; it’s a lost episode of your life that you’re rewatching drunk at the bar.

Keep all the usual rules:
- No more than TWO sentences starting with “you”.
- Every sentence must carry at least one loud, absurd, comic image or punchline.
- Roast the situation and that alternate version of you, stay kind to the person holding the phone.
- No mystical lessons, no spiritual nonsense, no generic “the universe wanted this”.

STRUCTURE (PAST COUNTERFACTUAL):
- Opening: label that alternate-you with a ridiculous title (“world champion of almost-moving”, “CFO of missed chances”).
- Alternate scene: rewrite what would have actually unfolded if you had done it, using clear counterfactual language.
- ONE theatrical outburst against that alternate mess (rent, job, ex, city…).
- 2–3 reacting objects in that timeline (chair, phone, door, fridge, cat…) doing something stupid and visual.
- Tiny slapstick disaster in the alternate reality (trip, spill, door stuck, papers exploding).
- Drink scene: you drink while staring at that imaginary timeline, with a sharp joke.
- Final TWO sentences: clearly state what you WOULD HAVE CARRIED from that choice and what disaster you probably dodged, with a cynical-hug vibe, directly answering the core of the past question.

Style: 5–6 sentences, single paragraph, max ~130 words, fully counterfactual, no question echo, no emojis.`;

/* ========= MESSAGGI RISPOSTA ========= */
function buildMessages({ domanda, clarification, lang, periodo, stile }) {
  const L = normLang(lang);
  const baseRules =
    L === "en"
      ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. SECOND PERSON ONLY (“you / your”) when you talk about the user. Never talk about the user in third person (“he, she, this guy, this person”). Do NOT use first person (“I, me, we, us”). Stay close to the topic of the question and answer its core point clearly. Use a rich, varied vocabulary, and keep grammar and punctuation clean. Avoid repeating the same words and images too often. Prefer short sentences (max ~20 words).`
      : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona (tu / ti / te / tuo) quando parli dell’utente. Vietato usare la prima persona singolare o plurale (“io, noi, me, ci, mi, nostro, nostra, miei, nostre”) e vietato parlare dell’utente in terza persona (“lui, lei, questo tizio, questa persona”). Resta aderente al tema della domanda e rispondi in modo chiaro al punto centrale. Usa un vocabolario ricco e vario, italiano corretto, senza errori di grammatica e con punteggiatura curata. Evita ripetizioni evidenti di parole e immagini. Preferisci frasi brevi (massimo ~20 parole).`;

  const msgs = [{ role: "system", content: baseRules }];

  const hasClar = clarification && String(clarification).trim().length > 0;
  const c = hasClar ? String(clarification).trim() : "";
  const isPast = String(periodo).toLowerCase() === "past";

  if (stile === "wtf") {
    // seed deterministico
    let seed = [...String(domanda || "")].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    }

    const ctx = detectWtfContext(domanda);
    const impreSample = WTF_IMPRE_POOL[Math.floor(rnd() * WTF_IMPRE_POOL.length)];

    const reactPool = WTF_REACT_BY_CONTEXT[ctx] || WTF_REACT_BY_CONTEXT.generico;
    const shuffled = [...reactPool].sort(() => rnd() - 0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd() * 1)); // 2–3 reazioni

    const drinkSample = WTF_DRINK_POOL[Math.floor(rnd() * WTF_DRINK_POOL.length)];

    const wtfRule =
      L === "en"
        ? isPast
          ? WTF_RULE_EN_PAST
          : WTF_RULE_EN_FUT
        : isPast
        ? WTF_RULE_IT_PAST
        : WTF_RULE_IT_FUT;

    msgs.push(
      { role: "system", content: wtfRule },
      {
        role: "system",
        content: `ESEMPI DI IMPRECAZIONE TEATRALE (non copiare mai alla lettera, servono solo come ispirazione di tono):\n- ${impreSample}`,
      },
      {
        role: "system",
        content: `OGGETTI CHE REAGISCONO (idee di scena, NON copiare il testo, inventa variazioni nuove ogni volta):\n- ${react.join(
          "\n- "
        )}`,
      },
      {
        role: "system",
        content: `IDEA DI BEVUTA TEATRALE (solo spunto, NON copiare la frase, varia sempre il modo di bere):\n- ${drinkSample}`,
      }
    );
  } else {
    // WHATIF più pratico, consigliere di fiducia
    if (L === "it") {
      const ruleIT = isPast ? WHATIF_RULE_PAST_IT : WHATIF_RULE_FUT_IT;
      msgs.push(
        { role: "system", content: ruleIT },
        {
          role: "system",
          content: `ESEMPIO (respiro e tono, non vincolante nei contenuti):\n${WHATIF_HYBRID_EX_IT}`,
        }
      );
    }
  }

  if (hasClar) {
    // Messaggio extra esplicito su uso del chiarimento
    if (L === "it") {
      msgs.push({
        role: "system",
        content:
          "Il dettaglio aggiuntivo fornito dall’utente va trattato come parte centrale della risposta: usalo per contestualizzare la scena, i diversi punti di vista e la chiusura, e richiamalo almeno una volta in modo chiaro.",
      });
    } else if (L === "en") {
      msgs.push({
        role: "system",
        content:
          "The extra detail from the user is central: use it to anchor the scene, the different angles and the conclusion, and refer to it explicitly at least once.",
      });
    } else {
      msgs.push({
        role: "system",
        content:
          "Il dettaglio aggiuntivo dell’utente è centrale: usalo per ancorare scena, ragionamento e chiusura, e citalo esplicitamente almeno una volta.",
      });
    }
  }

  // Utente finale
  const ask = (function () {
    if (L === "en") {
      if (hasClar) {
        if (isPast) {
          return `Original question about the PAST (do not repeat it): "${domanda}". Extra detail from the user (FOURTH PAGE ANSWER): "${c}". Produce ONE COUNTERFACTUAL answer in ENGLISH, single paragraph, very clear and concrete. For WHAT IF show an alternate past timeline (5–6 short sentences) and then give a clear takeaway for the present. For WHAT THE F use 5–6 short, absurd sentences in full counterfactual style, and make sure the last two sentences clearly answer the core of the past question.`;
        }
        return `Original question (do not repeat it): "${domanda}". Extra detail from the user (FOURTH PAGE ANSWER): "${c}". Produce ONE answer in ENGLISH, single paragraph, very clear and concrete. For WHAT IF use 5–6 short sentences, show multiple angles and then take a clear position. For WHAT THE F use 5–6 short sentences that stay glued to the core of the question, not just the vibe.`;
      }
      if (isPast) {
        return `Question about the PAST (do not repeat it): "${domanda}". Produce ONE COUNTERFACTUAL answer in ENGLISH: describe the alternate timeline as if it had really happened, then extract what matters now. Single paragraph.`;
      }
      return `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH. Single paragraph.`;
    }
    if (L === "it") {
      if (hasClar) {
        if (isPast) {
          return `Domanda originale sul PASSATO (non ripeterla): "${domanda}". Dettaglio aggiuntivo fornito dall’utente (risposta in fourth): "${c}". Genera UNA risposta CONTROFATTUALE in ITALIANO: descrivi la vita alternativa come se fosse successa davvero e poi collega tutto a quello che puoi fare oggi. Paragrafo unico. Se stile WHAT IF: 5–6 frasi corte, mostra più punti di vista del “come sarebbe andata” e chiudi con una presa di posizione chiara, da consigliere di fiducia. Se stile WHAT THE F: 5–6 frasi corte, monologo demenziale controfattuale come nei tuoi esempi, e le ultime due frasi devono rispondere in modo esplicito al cuore della domanda sul passato.`;
        }
        return `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo fornito dall’utente (risposta in fourth): "${c}". Genera UNA risposta in ITALIANO, molto concreta, che tenga conto di entrambi. Paragrafo unico. Se stile WHAT IF: 5–6 frasi corte, mostra più punti di vista e poi dai una presa di posizione chiara, da consigliere di fiducia. Se stile WHAT THE F: 5–6 frasi corte, monologo demenziale come nei tuoi esempi, ma sempre centrato sul punto della domanda (non solo sulla scenetta).`;
      }
      if (isPast) {
        return `Domanda sul PASSATO (non ripeterla): "${domanda}". Genera UNA risposta CONTROFATTUALE in ITALIANO: racconta cosa sarebbe successo se quella scelta fosse andata davvero così, e chiudi riportando l’attenzione su cosa puoi fare adesso. Paragrafo unico, tono naturale.`;
      }
      return `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico, grammatica corretta, tono naturale. Se WHAT IF: aiuta davvero a decidere, mostrando più angoli e chiudendo con un consiglio secco.`;
    }
    if (L === "es") {
      return hasClar
        ? `Pregunta original (no la repitas): "${domanda}". Detalle adicional del usuario: "${c}". Escribe UNA respuesta en ESPAÑOL, clara y concreta, en un solo párrafo.`
        : `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.`;
    }
    if (L === "fr") {
      return hasClar
        ? `Question originale (ne la répète pas) : « ${domanda} ». Détail supplémentaire donné par l’utilisateur : « ${c} ». Donne UNE réponse en FRANÇAIS, claire et concrète, en un seul paragraphe.`
        : `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.`;
    }
    // de
    return hasClar
      ? `Ursprüngliche Frage (nicht wiederholen): „${domanda}“. Zusatzdetail vom Nutzer: „${c}“. Gib EINE klare, konkrete Antwort auf DEUTSCH, ein einziger Absatz.`
      : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.`;
  })();

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

/* ========= WHAT IF: motivazione fallback (heuristica, compatta) ========= */
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
      pros.push("una scadenza esplicita ti aiuta a decidere prima");
      cons.push("se la scadenza è vaga tenderai a spostarla sempre un po’ più avanti");
    }
    if (action) {
      pros.push("hai una leva concreta su cui agire ogni giorno");
    }
    if (riskHedging) {
      pros.push("puoi limitare il rischio con poche regole semplici");
      cons.push("se cerchi rischio zero potresti non muoverti mai davvero");
    }

    if (!pros.length) {
      pros.push("la vera leva è la routine: piccoli passi costanti battono le grandi intenzioni");
    }
    if (!cons.length) {
      cons.push("il collo di bottiglia è la tua energia più che la fortuna");
    }

    const pSentence = `Probabilità circa ${pct}%.`;
    const proConSentence = `A favore: ${pros[0]}. Contro: ${cons[0]}.`;

    return `${pSentence} ${proConSentence}`.trim();
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
      pros.push("an explicit deadline helps you decide sooner");
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
    const proConSentence = `Pros: ${pros[0]}. Cons: ${cons[0]}.`;

    return `${pSentence} ${proConSentence}`.trim();
  }

  if (L === "es") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push("el tiempo es manejable si divides el camino en pasos pequeños");
      cons.push("si non proteges tu tiempo, acabarás posponiéndolo una y otra vez");
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
    const proConSentence = `A favor: ${pros[0]}. En contra: ${cons[0]}.`;

    return `${pSentence} ${proConSentence}`.trim();
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
    const proConSentence = `Atouts: ${pros[0]}. Freins: ${cons[0]}.`;

    return `${pSentence} ${proConSentence}`.trim();
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
    const proConSentence = `Dafür: ${pros[0]}. Dagegen: ${cons[0]}.`;

    return `${pSentence} ${proConSentence}`.trim();
  }

  return buildWhatIfMotivation(domanda, "it", pct);
}

/* ========= MOTIVAZIONE LLM (coerente con la risposta) ========= */
async function generateMotivationLLM({ domanda, clarification, answer, lang, pct }) {
  const L = normLang(lang);

  let sys;
  if (L === "en") {
    sys = `You are the MOTIVATION MODULE of “WHAT IF”.
Your job is to write ONE short sentence that explains, in a very practical way, WHY the probability is around ${pct}% for this scenario.
The sentence must be CONSISTENT with the main answer given above (same logic, same mood), not random.
Do NOT repeat the whole answer or question, focus on what helps and what makes it harder.
No emojis, no lists, no bullet points. ONE sentence, max 25 words.`;
  } else if (L === "it") {
    sys = `Sei il MODULO MOTIVAZIONE di “WHAT IF”.
Devi scrivere UNA sola frase che spiega in modo pratico perché la probabilità è circa ${pct}% in questo scenario.
La frase deve essere COERENTE con la risposta principale qui sopra (stessa logica, stessa atmosfera), non generica.
Non ripetere tutta la risposta o la domanda: metti a fuoco cosa aiuta e cosa ostacola.
Niente emoji, niente elenco, UNA frase sola, massimo 25 parole.`;
  } else if (L === "es") {
    sys = `Eres el MÓDULO DE MOTIVACIÓN de “WHAT IF”.
Escribe UNA sola frase che explique de forma práctica por qué la probabilidad es aproximadamente ${pct}% en este escenario.
Debe ser coherente con la respuesta principal, sin repetirla entera. Una frase, máximo 25 palabras, sin emojis ni listas.`;
  } else if (L === "fr") {
    sys = `Tu es le MODULE MOTIVATION de “WHAT IF”.
Écris UNE seule phrase qui explique de manière concrète pourquoi la probabilité est d’environ ${pct}% dans ce scénario.
Elle doit rester cohérente avec la réponse principale. Une seule phrase, max 25 mots, sans emoji ni liste.`;
  } else {
    sys = `Du bist das MOTIVATIONSMODUL von „WHAT IF“.
Schreibe EINEN kurzen Satz, der praktisch erklärt, warum die Wahrscheinlichkeit hier etwa ${pct}% ist.
Satz muss zum Haupttext passen. 1 Satz, max. 25 Wörter, keine Emojis.`;
  }

  const userContent =
    L === "en"
      ? `User question: "${domanda}".
Extra detail (if any): "${clarification || ""}".
Main answer (keep the same logic and mood): "${answer}".
Now write ONE motivation sentence in ENGLISH.`
      : L === "it"
      ? `Domanda dell’utente: "${domanda}".
Dettaglio aggiuntivo (se presente): "${clarification || ""}".
Risposta principale (mantieni la stessa logica e atmosfera): "${answer}".
Ora scrivi UNA frase di motivazione in ITALIANO.`
      : L === "es"
      ? `Pregunta del usuario: "${domanda}".
Detalle adicional (si existe): "${clarification || ""}".
Respuesta principal: "${answer}".
Ahora escribe UNA frase de motivación en ESPAÑOL.`
      : L === "fr"
      ? `Question de l’utilisateur : « ${domanda} ».
Détail complémentaire (s’il existe) : « ${clarification || ""} ».
Réponse principale : « ${answer} ».
Écris maintenant UNE phrase de motivation en FRANÇAIS.`
      : `Frage des Nutzers: „${domanda}“.
Zusatzdetail (falls vorhanden): „${clarification || ""}“.
Hauptantwort: „${answer}“.
Schreibe jetzt EINEN Motivationssatz auf DEUTSCH.`;

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.6,
    top_p: 0.9,
    max_tokens: 60,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userContent },
    ],
  });

  let m = completion?.choices?.[0]?.message?.content?.trim() || "";
  m = normalizeOneParagraph(m);
  m = sentenceCaseAll(m);
  m = finalPunct(m);

  // sicurezza: se l’LLM ha generato più frasi, tieni solo la prima
  const first = m.split(/(?<=[.!?…])\s+/)[0] || m;
  return first.trim();
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
    const body =
      bodyRaw && typeof req.body === "string" ? JSON.parse(bodyRaw) : req.body || {};

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

    /* ====== STAGE: CLARIFY ====== */
    if (stage === "clarify") {
      const messages = buildClarifyMessages({ domanda, stile, lang: L, periodo });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: stile === "wtf" ? 0.9 : 0.7,
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

    /* ====== STAGE: ANSWER (default) ====== */
    const messages = buildMessages({ domanda, clarification, lang: L, periodo, stile, micro });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.99 : 0.8,
      top_p: stile === "wtf" ? 0.95 : 0.92,
      max_tokens: 260,
      frequency_penalty: stile === "wtf" ? 0.25 : 0.1,
      presence_penalty: stile === "wtf" ? 0.35 : 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // ===== Post-process (ordine CORRETTO) =====
    answer = stripQuestionEcho(domanda, answer);

    if (stile === "wtf") {
      // WHAT THE F: tieni fino a 7 frasi per non mozzare il finale, poi limita un po’ le parole
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 150);
      answer = normalizeOneParagraph(answer);
    } else {
      // WHAT IF: 5–6 frasi, ~110 parole
      answer = tightenSentences(answer, 6);
      answer = clampWords(answer, 110);
      answer = normalizeOneParagraph(answer);
    }

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
              "Tu",
            ].includes(m)
          )
            return m;
          return inQuestion.has(m) ? m : m.toLowerCase();
        });
      })();
    }

    // Ripristina maiuscole frasi
    answer = sentenceCaseAll(answer);

    // Finale emozionale con gancio solo per lingue diverse dall’italiano
    if (stile === "whatif" && L !== "it") {
      answer = ensureZingaraEnding({ text: answer, lang: L, periodo, domanda });
    }

    // Punteggiatura finale
    answer = finalPunct(answer);

    // ===== Extra payload =====
    const pct = computePct(domanda, stile);

    let motivation;
    if (stile === "whatif") {
      try {
        motivation = await generateMotivationLLM({
          domanda,
          clarification,
          answer,
          lang: L,
          pct,
        });
      } catch (e) {
        // fallback se LLM motivazione faila
        motivation = buildWhatIfMotivation(domanda, L, pct);
      }
    }

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
