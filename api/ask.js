// /api/ask.js — What?f Engine (Zingara-Realista WHATIF + Friendly-WTF Demenziale)
// - WHATIF: tono “zingara mistica realista”, 60% analisi / 40% immagini sobrie,
//   chiusura con sensazione + gancio. Passato → controfattuale. Futuro → ipotesi vicina.
// - WTF: demenziale, sarcastico, da barista affettuoso. Niente poesia, niente elenchi.
//   Imprecazione e bevuta: SEMPRE variabili, mai uguali parola per parola.
//   Vietata la prima persona: niente "io, me, noi, nostro" ecc.
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
    try { const { success } = await rl.limit(key); return !!success; }
    catch { return true; }
  };
} catch { /* noop */ }

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
    : (process.env.NODE_ENV !== "production" ? origin : "");
  if (allow) res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
function normLang(l="it"){ const s=String(l||"it").toLowerCase().slice(0,2); return SUP_LANGS.includes(s)?s:"it"; }
function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){
    const n=normLine(p);
    if(!n||seen.has(n)) continue;
    out.push(p);
    if(out.length>=maxSentences) break;
  }
  let t=out.join(" ");
  if(!/[.!?…]$/.test(t)) t+=".";
  return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/);
  if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" ");
  const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){
  return String(s)
    .replace(/\s*\n+\s*/g," ")
    .replace(/\s{2,}/g," ")
    .replace(/\.\.\.+/g,"…")
    .replace(/\s+([.,;:!?])/g,"$1")
    .trim();
}
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){
    const cut=t.indexOf(".");
    if(cut>-1) t=t.slice(cut+1).trim();
  }
  t=t.replace(rx,"");
  return t;
}
function sentenceCaseAll(s=""){
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g, (m,prefix,chr)=> prefix + chr.toUpperCase());
}
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }
function hashStr(str=""){ let h=2166136261>>>0; for(const ch of String(str)){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619)>>>0; } return h>>>0; }
function pickDet(arr, seed){ return arr[ arr.length ? (seed % arr.length) : 0 ] || ""; }

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
- Linguaggio: italiano naturale, frasi grammaticalmente corrette, vocabolario vario (evita ripetizioni evidenti di verbi o immagini).
- Chiudi con una frase che lasci una sensazione chiara e un piccolo gancio di curiosità.
- 8–10 frasi, seconda persona, un paragrafo unico, NON ripetere la domanda, niente elenchi, niente emoji. Linguaggio semplice, concreto, coinvolgente.`;

const WHATIF_RULE_PAST_IT = `WHAT IF (italiano, PASSATO CONTROFATTUALE):
- Tono: veggente/zíngara che rilegge una vita alternativa, mistica ma concreta.
- APRI con UNA riga breve e intensa, come se indicassi una vita che non è stata vissuta.
- La SECONDA frase deve INIZIARE con "Vedo", "Sento", "Immagino", "Intuisco", "Si sarebbe aperto", "Si sarebbe mosso" (usa forma naturale).
- Scrivi in chiave controfattuale: "se avessi…, avresti…", "ti saresti trovato…", "avresti sentito…".
- Nessuna data o fatto reale non fornito; resta fedele al tema della domanda (relazione, scelta, città, lavoro, ecc.).
- 60% analisi concreta + 40% immagini sobrie di quella vita alternativa.
- Linguaggio: italiano naturale, frasi grammaticalmente corrette, vocabolario ricco e non ripetitivo.
- Chiudi con sensazione + micro-gancio che riporti dolcemente al presente ("non sarebbe stato un errore, sarebbe stata un'altra versione di te", ecc.).
- 8–10 frasi, seconda persona, un paragrafo unico, NON ripetere la domanda, niente elenchi, niente emoji. Linguaggio semplice, concreto, coinvolgente.`;

/* ========= Incipit dinamici — “ZINGARA MISTICA” ========= */
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
    "Qui il destino non urla: sussurra, ma con una precisione ostinata."
  ],
  en: [
    "The line of your fate thickens right here.",
    "The cards of your path are turning as you speak.",
    "A thin fold in your story is asking to be read."
  ],
  es: [
    "La línea de tu destino se marca justo aquí.",
    "Las cartas de tu camino se están girando ahora."
  ],
  fr: [
    "La ligne de ton destin se souligne précisément ici.",
    "Les cartes de ta route sont en train de tourner."
  ],
  de: [
    "Die Linie deines Weges wird genau hier deutlicher.",
    "Die Karten deines Weges wenden sich in diesem Moment."
  ],
};

/* ========= Finali “gancio” ========= */
const ZINGARA_ENDINGS = {
  it: {
    future: [
      "E lì ti accorgerai che non serve correre: basta scegliere bene.",
      "E proprio lì capirai che la calma non è rinuncia, è margine.",
      "Da quel punto sentirai la vita rispondere semplice: poco, ma tuo.",
      "E quando ti volterai, vedrai che la fatica stava solo aprendo spazio."
    ],
    past: [
      "Forse oggi lo sentiresti nelle ossa: non era destino, era ritmo.",
      "E ti verrebbe voglia di chiederti un’altra volta: e se lo facessi adesso?",
      "Ti ritroveresti a pensare che alcune strade restano aperte, anche tardi.",
      "E capirai che quel rimpianto non morde: invita a provare meglio, adesso."
    ]
  },
  en: {
    future: ["And there you’ll notice you don’t need speed, just a good angle."],
    past: ["Maybe you’d feel it in your bones: it wasn’t fate, just timing."]
  },
  es: {
    future: ["Y ahí notarás que no hace falta correr, solo elegir bien."],
    past: ["Y quizá hoy lo sentirías: no era destino, era ritmo."]
  },
  fr: {
    future: ["Et là tu verras: pas besoin de courir, juste de choisir juste."],
    past: ["Et peut-être que tu le saurais: ce n’était pas le destin, mais le tempo."]
  },
  de: {
    future: ["Und dort merkst du: Tempo ist egal, der Winkel zählt."],
    past: ["Vielleicht spürst du heute: kein Schicksal, nur Timing."]
  },
};
function ensureZingaraEnding({ text, lang, periodo, domanda }){
  let s = String(text||"").trim();
  const last = (s.match(/([^.!?…]+[.!?…])\s*$/)||[])[1] || s;
  const alreadyHasHook = /(ti accorgerai|capirai|ti verrà voglia|ti ritroverai|e lì|e proprio lì|da quel punto|forse oggi|maybe you’d feel|and there you’ll notice)/i.test(last);
  if(alreadyHasHook) return s;
  const L = normLang(lang);
  const pool = ((ZINGARA_ENDINGS[L]||ZINGARA_ENDINGS.it) || {});
  const bag = String(periodo).toLowerCase()==="past"
    ? (pool.past||ZINGARA_ENDINGS.it.past)
    : (pool.future||ZINGARA_ENDINGS.it.future);
  const addon = pickDet(bag, hashStr((domanda||"")+s));
  if(!addon) return s;
  s = s.replace(/[.!?…]+$/,'');
  return `${s}. ${addon}`;
}

/* ========= WTF — logica contestuale ========= */

/* Riconosci il contesto dalla domanda */
function detectWtfContext(domanda = "") {
  const t = String(domanda || "").toLowerCase();

  if (/(moto|motocicletta|casco|cilindrata|enduro|naked|scooter|pista)/.test(t)) return "moto";
  if (/(ufficio|collega|capo|meeting|riunion|scrivania|badge|excel|pc|computer|azienda|contratto|stipendio)/.test(t)) return "ufficio";
  if (/(casa|divano|cucina|salotto|camera|stanza|appartamento|mutuo|affitto|letto)/.test(t)) return "casa";
  if (/(l'aquila|laquila|aquila|trasferirmi|trasferimento|città|citta|quartiere|paese|lugano)/.test(t)) return "città";
  if (/(ex|relazione|fidanzat|ragazza|ragazzo|moglie|marito|matrimonio|lasciare|tornare insieme|storia)/.test(t)) return "relazione";
  if (/(soldi|budget|stipendio|busta paga|debito|conto|prestito|mutuo|invest|risparmi|tasse)/.test(t)) return "soldi";

  return "generico";
}

/* Pool di IMPRECAZIONI teatrali — usate come ESEMPI, non da copiare letteralmente */
const WTF_IMPRE_POOL = [
  "bestemmione corazzato a lunga gittata",
  "imprecazione turboguidata che sfiora il soffitto",
  "anatema blindato a tre stadi che sposta l’aria di un metro",
  "sacramentata supersonica degna di una finale di Champions",
  "raffica di parolacce pressurizzate con effetto sismico leggero",
  "vulcano d’anatemi in eruzione controllata ma non troppo",
  "scarica liturgica a combustione interna che mette a vibrare i vetri",
  "uragano di improperi classificato come evento meteo estremo",
  "rosario storto di imprecazioni recitato alla velocità della luce",
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
  "scarica elettrica di parole storte che manda in tilt il karma"
];

/* Reazioni degli oggetti, contestuali */
const WTF_REACT_BY_CONTEXT = {
  moto: [
    "un casco sullo scaffale si inclina come un giudice stanco che conosce già la sentenza",
    "il poster di una moto da corsa arriccia un angolo come se volesse chiedere il 730",
    "il tappetino all’ingresso si piega su se stesso come un sipario imbarazzato",
    "la porta a vetri vibra piano, come se avesse appena visto il tuo estratto conto",
    "il display dei prezzi lampeggia come un elettrocardiogramma in arresto fiscale"
  ],
  ufficio: [
    "il monitor apre una finestra di errore proprio mentre stai per sentirti competente",
    "la stampante decide di ingoiare il foglio più importante del giorno",
    "la sedia girevole fischia un lamento metallico ogni volta che ci sali sopra",
    "il neon sopra la testa sfarfalla come una riunione che non finisce mai",
    "il badge lampeggia rosso due volte, come un no comment aziendale"
  ],
  casa: [
    "la tapparella scende storta come la tua voglia di fare ordine",
    "il frigorifero emette un ruggito triste ogni volta che lo apri a vuoto",
    "il divano ti risucchia con la forza di un buco nero emotivo",
    "la lampada si spegne e si riaccende come se stesse votando contro i tuoi piani",
    "la lavatrice entra in centrifuga proprio quando la testa vorrebbe stare ferma"
  ],
  città: [
    "la buca sull’asfalto ti guarda come se avesse già firmato un contratto con la tua caviglia",
    "il portone del palazzo cigola come un vecchio amico che ti chiede spiegazioni arretrate",
    "la panchina in centro è già occupata da uno sconosciuto che ti ruba il posto nei ricordi",
    "il cartello del parcheggio lampeggia pieno anche dove vedi tre posti liberi",
    "il semaforo passa al rosso ogni volta che provi a sentirti protagonista"
  ],
  relazione: [
    "il telefono vibra a caso e sullo schermo non c’è mai il nome che vorresti",
    "la chat fissata in alto ti guarda come una spia luminosa del passato",
    "il letto sfatto sembra diviso da una linea immaginaria che nessuno ha il coraggio di attraversare",
    "il cuscino conserva la forma di chi non vuoi più nominare",
    "lo specchio del bagno aspetta solo il momento giusto per una scena da serie tv di bassa lega"
  ],
  soldi: [
    "l’estratto conto lampeggia cifre che sembrano coordinate di un disastro",
    "il portafoglio si chiude da solo come un riccio in autoconservazione",
    "gli scontrini si aprono a ventaglio come un coro greco giudicante",
    "la calcolatrice del telefono produce numeri sempre più lunghi e sempre meno sensati",
    "la busta paga sul tavolo si comporta come un pesce rosso: piccola, confusa e già dimenticata"
  ],
  generico: [
    "la stanza trattiene il fiato insieme al tuo cervello per un secondo buono",
    "le scarpe buttate in corridoio sembrano pronte a scappare senza di te",
    "la giacca sulla sedia alza metaforicamente le spalle",
    "la finestra socchiusa lascia entrare un’aria che sa di giudizio passivo-aggressivo",
    "il telefono a faccia in giù decide di vibrare solo quando è troppo tardi"
  ]
};

/* Bevute teatrali – usate come ESEMPI, ma il modello deve variare sempre */
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
  "lasci il bicchiere sul tavolo, ci fai un mezzo giro intorno, poi torni e lo bevi come se niente fosse"
];

/* ========= WTF: rapporto scientifico demenziale ========= */
function scientificReportDemenziale(domanda, lang="it"){
  function h(s=""){ let x=0; for(const c of s) x=(x*131 + c.charCodeAt(0))>>>0; return x>>>0; }
  const seed = h(domanda||"");
  const pick = (arr)=> arr[ seed % arr.length ];

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
  const METRIC = ["r=0.82","p=0.047","η²=0.31","β=0.67","AUC=0.73","OR=2.1"];

  const u = pick(UNI);
  const j = pick(JOUR);
  const e = pick(EFFECT);
  const m = pick(METRIC);
  const n = 30 + (seed % 70);

  if((lang||"it").startsWith("en")){
    return `Scientific-ish report: ${u} (n=${n}) found that a ${e} improves decision clarity (${m}). Peer-reviewed by ${j}, probably.`;
  }
  return `Rapporto scientifico (più o meno): ${u} (n=${n}) rileva che “${e}” migliora la chiarezza decisionale (${m}). Revisione a cura di ${j}, forse.`;
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const baseRules = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only. Stay close to the topic of the question. Use a rich, varied vocabulary, and keep grammar and punctuation clean. Avoid repeating the same words and images too often. Never use first person ("I", "me", "we", "our").`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona. Resta aderente al tema della domanda. Usa un vocabolario ricco e vario, italiano corretto, senza errori di grammatica e con punteggiatura curata. Evita ripetizioni evidenti di parole e immagini. Non usare mai la prima persona (io, me, noi, nostro, I, me, we, our).`;

  const msgs = [
    { role: "system", content: baseRules },
  ];

  if(stile==="wtf"){
    // seed deterministico
    let seed=[...String(domanda||"")].reduce((a,c)=>a+c.charCodeAt(0),0);
    function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; }

    const ctx = detectWtfContext(domanda);
    const impreSample = WTF_IMPRE_POOL[Math.floor(rnd()*WTF_IMPRE_POOL.length)];

    const reactPool = WTF_REACT_BY_CONTEXT[ctx] || WTF_REACT_BY_CONTEXT.generico;
    const shuffled=[...reactPool].sort(()=>rnd()-0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd()*2));

    const drinkSample = WTF_DRINK_POOL[Math.floor(rnd()*WTF_DRINK_POOL.length)];

    const WTF_RULE_IT = `WHAT THE F (demenziale, sarcastico, virale da bar, italiano).

OBIETTIVO: ogni risposta deve sembrare il monologo di un amico al bancone in un video virale da 30–40 secondi, che fa RIDERE ad alta voce ma dice anche qualcosa di utile.

VINCOLO ASSOLUTO PERSONA:
- Vietata la prima persona singolare/plurale: niente "io", "me", "noi", "nostro", "nostra", "mio", "mia", "nostri", "nostre".
- Vietato anche in forma implicita: niente frasi tipo "succede che penso", "si pensa", ecc. Il punto di vista è sempre su "tu" o su etichette come "quello che…", "l’eroe del casino", ecc.

STRUTTURA OBBLIGATORIA (ITALIANO):

1) Apertura: AGGANCIO VIRAL
   - Prime 1–2 frasi: prendi in giro la SITUAZIONE, non la persona.
   - Usa inizi tipo: "Ah ma guarda te…", "Oh, eccolo il fenomeno…", "Ma guarda che capo del casino…".
   - Etichetta il protagonista con nomi tipo "supereroe delle rate", "centauro del traffico fermo", "direttore creativo dei drammi sentimentali", "campione olimpico dei ripensamenti".
   - Tono: secco, veloce, zero poesia.

2) Mini-film comico (2–3 scene concrete):
   - Descrivi scene quotidiane forti e visive legate al tema (${ctx}): concessionaria, bar, ufficio, letto, città, ecc.
   - Ogni scena deve avere un micro-disastro comico o un imbarazzo evidente: inciampi, oggetti che cadono, silenzi assurdi, gente che guarda malissimo.
   - Inserisci 1–3 suoni/onomatopee integrati in frase ("…e il casco fa *tlin* come un giudice stanco", "…e il silenzio fa praticamente *plof* sul tavolo").

3) IMPRECAZIONE TEATRALE (UNA SOLA):
   - Inserisci UNA sola imprecazione teatrale, esagerata e grottesca, rivolta alla SITUAZIONE (non a persone reali né gruppi reali).
   - Ispirati a esempi come: "${impreSample}", ma NON COPIARE MAI quella frase.
   - Usa formule creative tipo: "bestemmione orbitale in dialetto interiore", "anatema fiscale a tre stadi", "scarica di parolacce benedette dal commercialista".
   - Evita riferimenti religiosi diretti e insulti reali: deve sembrare una "bestemmia cartoon", finta ma potente.

4) OGGETTI CHE REAGISCONO (SUBITO DOPO LO SFOGO):
   - Fai reagire ${react.length} oggetti nella scena: casco, poster, tappetino, lampada, bicchiere, telefono, piatto di arrosticini, sedie, ecc.
   - Usa le idee fornite come ispirazione ma non copiarle. Ogni risposta deve inventare combi diverse.
   - Le reazioni devono essere surreali ma chiare: oscillano, si inclinano, "giudicano", "trattengono il fiato", "fanno finta di non vedere".

5) MOMENTO DRINK (ANCORATO ALLA SCENA):
   - Prima mostra un gesto concreto coerente con il contesto: entri in un bar, apri la credenza in cucina, appoggi le chiavi sul bancone, apri il frigo buono.
   - Poi descrivi il modo in cui ti versi da bere e lo bevi, ispirandoti a idee tipo: ${drinkSample}.
   - Ma varia SEMPRE: a volte un sorso lungo unico, a volte tre sorsi piccoli, a volte metà adesso e metà dopo. Mai ripetere formule uguali.
   - Il drink è una gag teatrale, non un invito a esagerare con l’alcol.

6) TIPO DI UMORISMO:
   - Niente stile mistico, niente frasi poetiche. Se esce qualcosa di epico, trasformalo in scena scema e concreta.
   - Linguaggio parlato, diretto, con immagini un po’ assurde ma sempre chiare.
   - Concessa volgarità leggera (“casino”, “cavolata”, “incasinare tutto”), ma niente odio verso categorie reali.

7) FINALE VIRAL:
   - Chiudi con 1–2 frasi che uniscano:
     • una risposta pratica (es. "sì, puoi farlo ma...", "non ti salva la vita, però…"),
     • una morale ironica e tenera in stile: "non ti sistema l’esistenza, però è esattamente il tipo di casino che un video virale adorerebbe".
   - Il finale deve sembrare una caption perfetta da mettere sotto al video.

8) LUNGHEZZA E FORMA:
   - 6–8 frasi totali.
   - UN SOLO paragrafo.
   - Nessun elenco visibile nell’output, nessuna emoji.
   - Non usare mai la prima persona (io, me, noi, nostro, ecc.): parla sempre di "tu" o in terza persona tipo "quello che crede di…".`;

    const WTF_RULE_EN = `WHAT THE F (absurd, sarcastic, viral bar-monologue).

GOAL: every answer should sound like a short, chaotic rant in a 30–40 second viral clip: funny enough to make people laugh, sharp enough to feel a bit true.

PERSON RESTRICTION:
- Never use first person: no "I", "me", "we", "our".
- Always talk directly to "you" or in third person labels like "the hero of bad decisions", "the chaos rider", etc.

STRICT SEQUENCE (ENGLISH):

1) Hook:
   - First 1–2 sentences: tease the SITUATION, not the person.
   - Use intros like: "Oh, look at this chaos pilot…", "Here comes the genius of trouble…".
   - Give an over-the-top label: "superhero of monthly payments", "traffic gladiator", "CEO of unfinished feelings".
   - Tone: fast, dry, zero poetry.

2) Mini-movie (2–3 concrete scenes):
   - Show concrete scenes tied to the topic (${ctx}): dealership, office, couch, bar, city street, bed, etc.
   - Each scene needs a small cringe or mini-disaster: tripping, awkward silence, objects falling, people staring.
   - Add 1–3 sounds inside sentences ("…and the helmet goes *tlin* like a tired judge", "…silence lands on the table with a *plof*").

3) THEATRICAL OUTBURST (ONE ONLY):
   - Include exactly ONE theatrical outburst: exaggerated, cartoon-like, aimed at the situation.
   - Take inspiration from "${impreSample}" but NEVER copy it.
   - Use creative fake-swears like "cosmic rage-ball in dialect", "three-stage tax-flavoured meltdown".
   - No real hateful slurs or religious insults, keep it cartoonish.

4) REACTING OBJECTS (RIGHT AFTER THE OUTBURST):
   - Make ${react.length} objects react: helmet, poster, mat, lamp, glass, phone, plate, chair, etc.
   - Reactions must be slightly surreal but clear: they tilt, vibrate, pretend not to see, judge quietly.

5) DRINK MOMENT (GROUNDED):
   - First, anchor the drink in the scene: walking into a bar, opening the cupboard, leaning on the kitchen counter, etc.
   - Then describe how the drink is poured and drunk, inspired by: ${drinkSample}, but always changing details (sips, pace, hesitation).
   - It’s a theatrical gag, not a suggestion for heavy drinking.

6) HUMOR:
   - No mystical tone, no serious poetic lines.
   - Spoken, direct language with vivid, silly images; light profanity is okay ("mess", "crap") but no hate.

7) ENDING:
   - Finish with 1–2 sentences combining:
     • a practical answer ("yes, you can do it but…", "no, it won’t fix your whole life…"),
     • a small ironic moral, like "it won’t fix everything, but it’s exactly the kind of mess a viral clip lives for."

8) LENGTH & FORM:
   - 6–8 sentences, ONE paragraph only, no bullets, no emojis.
   - Never use first person: keep it in second person or playful third person labels.`;

    msgs.push(
      { role: "system", content: L==="en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content: `ESEMPI DI IMPRECAZIONE TEATRALE (non copiare mai alla lettera, servono solo come ispirazione di tono):\n- ${impreSample}` },
      { role: "system", content: `OGGETTI CHE REAGISCONO (idee di scena, NON copiare il testo, inventa variazioni nuove ogni volta):\n- ${react.join("\n- ")}` },
      { role: "system", content: `IDEA DI BEVUTA TEATRALE (solo spunto, NON copiare la frase, varia sempre il modo di bere):\n- ${drinkSample}` },
      { role: "system", content:
`ESEMPI VINCOLANTI (tono/ritmo IT, NON copiare il testo, NON riutilizzare i nomi; servono solo come modello di stile, voce e ritmo):

- Ah ma guarda te, quello che dopo tre reel di moto si sente già il re dell’asfalto. Il concessionario lo vede arrivare con la stessa espressione di chi ha appena letto il saldo del conto, e mentre il prezzo esce dalla bocca del venditore parte un bestemmione orbitale in dialetto interiore che fa vibrare i caschi esposti come lampadine stanche. Il tappetino all’ingresso si arriccia come se volesse accompagnare gentilmente verso l’uscita, e un poster di moto da corsa piega un angolo come un “buona fortuna, campione delle rate”. Due minuti dopo, il bar accanto accoglie l’eroe delle decisioni impulsive: le chiavi atterrano sul bancone con un “tac” da film low budget, il bicchiere si riempie con troppa convinzione e il primo sorso scende come se stesse firmando un contratto con il caos controllato. Non sistema la vita, ma è esattamente il tipo di casino che un video virale adorerebbe.

- Oh, eccolo il campione del “torno nella mia città e aggiusto tutto in tre giorni”. I vicoli lo guardano passare come una ex che ha appena visto “ultimo accesso oggi alle 03:27”, e ogni sampietrino sembra pronto a far partire un test d’ingresso di equilibrio emotivo. Appena legge i prezzi degli arrosticini scatta una sacramentata fiscale di categoria pesante, abbastanza potente da far svolazzare un tovagliolo e far girare la testa a un piccione con aria da critico gastronomico fallito. La panchina in centro si fa occupare da qualcun altro proprio mentre il sedere si stava avvicinando, il portone di un palazzo cigola come un parente che vuole aggiornamenti non richiesti e una vetrina riflette la faccia di uno che finge di avere il piano sotto controllo. Il bar di fiducia materializza un bicchiere serio, il liquido sale fino al limite del buon senso e il primo sorso scende lungo come una mail passivo-aggressiva al destino. Non salva l’esistenza, ma regala abbastanza materiale per una serie intera di storie da mandare agli amici.

- Ah ma guarda questo direttore creativo del dramma sentimentale, convinto di poter chiudere con l’ex come se stesse archiviando un PDF. La chat fissata in alto brilla sul telefono come una spia motore accesa da mesi, e ogni foto vecchia appare come una slide motivazionale scritta da un sadico. Nel momento esatto in cui parte l’ennesimo “basta, fine, archivio definitivo”, esplode un anatema emotivo a tre strati che fa tremare il comodino, far sfarfallare la lampada e far vibrare il telefono con una notifica di tutt’altro. L’armadio scricchiola per solidarietà, il letto sembra diviso da una linea di metà campo e il gatto lo osserva come un terapeuta non pagato con agenda piena. In cucina, il bicchiere si riempie di qualcosa di serio, metà va giù in un sorso unico da “ok, si fa”, l’altra metà resta lì a giudicare ogni ripensamento dei prossimi dieci minuti. Non guarisce il cuore, ma è il tipo di scena che internet trasformerebbe volentieri in audio da usare sopra ogni video di rottura definitiva.` }
    );
  } else {
    // WHATIF dipendente dal tempo (IT ottimizzato, altre lingue usano solo baseRules)
    if (L === "it") {
      const ruleIT = String(periodo).toLowerCase()==="past" ? WHATIF_RULE_PAST_IT : WHATIF_RULE_FUT_IT;
      msgs.push(
        { role: "system", content: ruleIT },
        { role: "system", content: `ESEMPIO (respiro e tono, non vincolante nei contenuti):\n${WHATIF_HYBRID_EX_IT}` }
      );
    }
  }

  // Utente finale
  const ask = (L==="en")
    ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH. Single paragraph.`
    : (L==="it")
    ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico, grammatica corretta, tono naturale. Nessun uso della prima persona.`
    : (L==="es")
    ? `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.`
    : (L==="fr")
    ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.`
    : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.`;
  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= Server-side PCT ========= */
function computePct(domanda, stile){
  const t=String(domanda||"").toLowerCase();
  let s=50;
  if(/\b(7|14|21|30|60|90)\b/.test(t)) s+=12;
  if(/\b\d+([.,]\d+)?\b/.test(t)) s+=8;
  if(/budget|€|euro|spesa|max|under|sotto/.test(t)) s+=6;
  if(/senza|solo|al massimo|minimo|entro|prima delle|ogni|per/.test(t)) s+=8;
  if(/lancia|apri|impara|scrivi|chiedi|corri|studia|automatizza|testa/.test(t)) s+=6;
  if(/forse|magari|maybe|quizás/.test(t)) s-=8;
  if(!/\b\d/.test(t)) s-=6;
  s += (stile==='wtf' ? -4 : +2);
  const pct = Math.max(25, Math.min(92, Math.round(s)));
  return pct;
}

/* ========= WHAT IF: motivazione sintetica ========= */
function buildWhatIfMotivation(domanda, lang="it", pct=60){
  const L = (lang||"it").slice(0,2);
  const t = String(domanda||"").toLowerCase();

  const hasTime = /\b(7|14|21|30|60|90|giorn|settiman|mes|mesi|anni|days?|weeks?|months?|years?)\b/.test(t);
  const hasBudget = /(budget|€|euro|spesa|costo|prezzo|max|under|sotto|caparra|cost|money)/.test(t);
  const hasDeadline = /(entro|prima|scadenza|deadline|by\s+\d|before\s+\d)/.test(t);
  const action = /(apri|lancia|impara|studia|scrivi|automatizza|testa|cambia|trova|assumi|costruisci|crea|launch|start|learn|build|create)/.test(t);
  const riskHedging = /(senza|solo|al massimo|minimo|rischio|risk|minimize|hedge)/.test(t);

  // ITALIANO
  if (L === "it") {
    const pros = [];
    const cons = [];

    if(hasTime){
      pros.push("la timeline è gestibile se spezzetti il percorso");
      cons.push("se non proteggi il tempo, rischi di rimandare all’infinito");
    }
    if(hasBudget){
      pros.push("puoi tenere i costi sotto controllo fissando un tetto chiaro");
      cons.push("se sottostimi le spese, la pressione economica può frenarti");
    }
    if(hasDeadline){
      pros.push("una scadenza esplicita ti aiuta a decidere prima, non meglio");
      cons.push("se la scadenza è vaga, tenderai a spostarla sempre un po’ più avanti");
    }
    if(action){
      pros.push("hai una leva concreta su cui agire ogni giorno");
    }
    if(riskHedging){
      pros.push("puoi limitare il rischio con poche regole semplici");
      cons.push("se cerchi rischio zero, potresti non muoverti mai davvero");
    }

    if(!pros.length){
      pros.push("la vera leva è la routine: piccoli passi costanti battono le grandi intenzioni");
    }
    if(!cons.length){
      cons.push("il collo di bottiglia è la tua energia: se allarghi troppo lo scope, ti blocchi");
    }

    const pSentence = `Probabilità circa ${pct}%.`;
    const proSentence = `A favore: ${pros.slice(0,2).join(", ")}.`;
    const conSentence = `Contro: ${cons.slice(0,2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  // ENGLISH
  if (L === "en") {
    const pros = [];
    const cons = [];

    if(hasTime){
      pros.push("the timeline is realistic if you break it into small chunks");
      cons.push("if you don’t protect time, you’ll quietly postpone it forever");
    }
    if(hasBudget){
      pros.push("you can keep costs under control with a clear cap");
      cons.push("underestimating expenses can add pressure and slow you down");
    }
    if(hasDeadline){
      pros.push("an explicit deadline helps you decide sooner, not necessarily better");
      cons.push("a fuzzy deadline tends to drift and weaken your commitment");
    }
    if(action){
      pros.push("you have a concrete lever you can pull every day");
    }
    if(riskHedging){
      pros.push("simple constraints can cap the downside");
      cons.push("chasing zero risk can keep you stuck at the start line");
    }

    if(!pros.length){
      pros.push("the real lever is routine: small consistent steps beat big intentions");
    }
    if(!cons.length){
      cons.push("your main bottleneck is energy and focus, not luck");
    }

    const pSentence = `Estimated probability around ${pct}%.`;
    const proSentence = `Pros: ${pros.slice(0,2).join(", ")}.`;
    const conSentence = `Cons: ${cons.slice(0,2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  // ESPAÑOL
  if (L === "es") {
    const pros = [];
    const cons = [];

    if(hasTime){
      pros.push("el tiempo es manejable si divides el camino en pasos pequeños");
      cons.push("si no proteges tu tiempo, acabarás posponiéndolo una y otra vez");
    }
    if(hasBudget){
      pros.push("puedes mantener los costes bajo control con un límite claro");
      cons.push("si infravaloras los gastos, la presión económica puede frenarte");
    }
    if(hasDeadline){
      pros.push("un plazo definido empuja a decidir antes");
      cons.push("si el plazo es difuso, se irá moviendo hacia adelante");
    }
    if(action){
      pros.push("tienes una palanca concreta para avanzar cada día");
    }
    if(riskHedging){
      pros.push("puedes limitar el riesgo con pocas reglas sencillas");
      cons.push("buscar riesgo cero puede dejarte inmóvil");
    }

    if(!pros.length){
      pros.push("la palanca real es la rutina: pequeños pasos constantes vencen a los grandes planes");
    }
    if(!cons.length){
      cons.push("el cuello de botella es tu energía y foco, no la suerte");
    }

    const pSentence = `Probabilidad aproximada ${pct}%.`;
    const proSentence = `A favor: ${pros.slice(0,2).join(", ")}.`;
    const conSentence = `En contra: ${cons.slice(0,2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  // FRANÇAIS
  if (L === "fr") {
    const pros = [];
    const cons = [];

    if(hasTime){
      pros.push("le calendrier reste gérable si tu découpes en petites étapes");
      cons.push("sans temps protégé, tu repousseras discrètement sans fin");
    }
    if(hasBudget){
      pros.push("tu peux contenir les coûts avec un plafond clair");
      cons.push("si tu sous-estimes les dépenses, la pression financière peut te freiner");
    }
    if(hasDeadline){
      pros.push("une échéance claire aide à trancher plus vite");
      cons.push("une date floue glisse facilement et affaiblit ton engagement");
    }
    if(action){
      pros.push("tu as un levier concret à actionner chaque jour");
    }
    if(riskHedging){
      pros.push("quelques règles simples peuvent limiter le risque");
      cons.push("viser le risque zéro risque justement de t’immobiliser");
    }

    if(!pros.length){
      pros.push("le vrai levier, c’est la routine: de petits pas réguliers dépassent les grandes intentions");
    }
    if(!cons.length){
      cons.push("le principal goulot d’étranglement est ton énergie et ta clarté, pas la chance");
    }

    const pSentence = `Probabilité estimée autour de ${pct}%.`;
    const proSentence = `Atouts: ${pros.slice(0,2).join(", ")}.`;
    const conSentence = `Freins: ${cons.slice(0,2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  // DEUTSCH
  if (L === "de") {
    const pros = [];
    const cons = [];

    if(hasTime){
      pros.push("der Zeitplan ist machbar, wenn du ihn in kleine Schritte teilst");
      cons.push("ohne geschützte Zeit wirst du es immer wieder verschieben");
    }
    if(hasBudget){
      pros.push("mit einem klaren Kostenlimit bleibt das Budget unter Kontrolle");
      cons.push("wenn du Ausgaben unterschätzt, entsteht Druck, der dich bremst");
    }
    if(hasDeadline){
      pros.push("eine klare Deadline zwingt zu früheren Entscheidungen");
      cons.push("eine vage Frist rutscht leicht nach hinten");
    }
    if(action){
      pros.push("du hast einen konkreten Hebel, den du täglich bewegen kannst");
    }
    if(riskHedging){
      pros.push("einfache Regeln können das Risiko begrenzen");
      cons.push("wenn du null Risiko willst, kommst du vielleicht nie in Gang");
    }

    if(!pros.length){
      pros.push("der wahre Hebel ist Routine: kleine, konstante Schritte schlagen große Vorsätze");
    }
    if(!cons.length){
      cons.push("der Engpass ist deine Energie und Fokussierung, nicht das Schicksal");
    }

    const pSentence = `Geschätzte Wahrscheinlichkeit etwa ${pct}%.`;
    const proSentence = `Dafür: ${pros.slice(0,2).join(", ")}.`;
    const conSentence = `Dagegen: ${cons.slice(0,2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  // fallback IT
  return buildWhatIfMotivation(domanda, "it", pct);
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const ok = await rateOk(`ask:${ip}`);
    if(!ok) return res.status(429).json({ error:"rate_limited_minute" });

    const bodyRaw = typeof req.body === "string" ? req.body : JSON.stringify(req.body||{});
    const body = bodyRaw ? (typeof req.body === "string" ? JSON.parse(bodyRaw) : (req.body||{})) : {};
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      lang  = "it",
      periodo = "future", // "future" | "past"
      micro = {},
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

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
    if(!answer) throw new Error("empty_model_response");

    // ===== Post-process (ordine CORRETTO) =====
    answer = stripQuestionEcho(domanda, answer);

    if (stile === "wtf") {
      // Per il WTF NON stringiamo a numero fisso di frasi per non tagliare drink o morale.
      // Limitiamo solo il numero di parole e normalizziamo.
      answer = clampWords(answer, 230);
      answer = normalizeOneParagraph(answer);
    } else {
      // WHATIF e altri stili più compatti/letterari.
      answer = tightenSentences(answer, 10);
      answer = clampWords(answer, 165);
      answer = normalizeOneParagraph(answer);
    }

    // Moderazioni leggere IT (prima del ripristino maiuscole)
    if(normLang(lang)==="it"){
      (function(){
        const d=String(domanda||"");
        const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQuestion=new Set((d.match(nameRx)||[]));
        answer=answer.replace(nameRx,(m)=>{
          if (["Ah","Oh","Ehi","Sai","Occhio","Piano","Fermati","Aspetta","La","Le","Una","Il","Qui","Ma"].includes(m)) return m;
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

    // ===== Extra payload =====
    const L = normLang(lang);
    const pct = computePct(domanda, stile);

    const motivation = (stile==="whatif") ? buildWhatIfMotivation(domanda, L, pct) : undefined;

    const isSurprise = !!(micro && (micro.surprise === true || micro.src === "surprise"));
    const scientific = (stile==="wtf" && !isSurprise) ? scientificReportDemenziale(domanda, L) : undefined;

    return res.status(200).json({
      answer,
      style: stile,
      lang: L,
      periodo,
      model: MODEL,
      pct,
      motivation,
      scientific,
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
    }
