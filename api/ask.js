// /api/ask.js — What?f Engine (Zingara-Realista WHATIF + Friendly-WTF Demenziale)
// - WHATIF: tono “zingara mistica realista”, 60% analisi / 40% immagini sobrie,
//   chiusura con sensazione + gancio. Passato → controfattuale. Futuro → ipotesi vicina.
// - WTF: demenziale, sarcastico, da barista affettuoso. Niente poesia, niente elenchi.
//   Imprecazione e bevuta: SEMPRE variabili, mai uguali parola per parola.
//   SEMPRE e SOLO seconda persona (tu / ti / te / tuo): vietata qualunque prima persona.
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
    "il semaforo decide di restare rosso un secondo in più solo per giudicarti",
    "il casco in esposizione ruota di qualche grado come se volesse vedere meglio la scena",
    "il poster della moto da corsa piega l’angolo come per offrirti una pacca sulla spalla",
    "il tappetino davanti al bancone scivola di mezzo centimetro appena ti avvicini",
    "il cavalletto di una moto in vetrina scricchiola come se stesse sospirando"
  ],
  ufficio: [
    "la sedia girevole fa un mezzo giro da sola e si ferma a guardarti",
    "lo schermo del PC lampeggia come se stesse cercando di avvisarti del disastro",
    "la stampante fa un rumore strano e poi si zittisce, tipo “io questa non la stampo”",
    "il badge sbatte due volte contro il lettore e il led rosso ti guarda deluso",
    "il mouse scivola verso il bordo della scrivania come se volesse buttarsi giù"
  ],
  casa: [
    "il divano affonda di un centimetro solo a vederti, rassegnato",
    "la tapparella si blocca a metà corsa, indecisa come te",
    "il frigorifero fa un ronzio lunghissimo tipo sospiro",
    "la lampada da tavolo lampeggia due volte in modalità giudizio silenzioso",
    "lo zerbino si arriccia su un lato come per farti lo sgambetto"
  ],
  città: [
    "la panchina dove ti sedevi da ragazzino è occupata da qualcuno identico a una vecchia versione di te",
    "il portone del palazzo cigola il tuo nome invece del solito rumore",
    "la fermata dell’autobus ti lascia passare davanti e poi fa finta di non conoscerti",
    "un’insegna al neon sfarfalla proprio sulla parola “casa”",
    "un piccione ti guarda con aria da agente immobiliare stanco"
  ],
  relazione: [
    "la chat rimane inchiodata in alto come una spia luminosa che non si spegne mai",
    "il letto sfatto sembra avere due impronte diverse che non vanno più d’accordo",
    "il telefono vibra a vuoto e tu sai che non è lei, ma ci speri lo stesso per mezzo secondo",
    "il cuscino conserva una piega come se stesse tenendo il posto a qualcuno",
    "il gatto ti fissa come un terapeuta che ha finito i fogli degli appunti"
  ],
  soldi: [
    "il portafoglio si chiude da solo con un piccolo scatto di difesa",
    "l’estratto conto sullo schermo aggiorna la cifra con un’animazione troppo lenta per essere innocente",
    "gli scontrini sul tavolo si aprono a ventaglio come un fascicolo processuale",
    "la calcolatrice del telefono mostra più zeri del dovuto solo per spaventarti",
    "la cassettiera dove tieni i risparmi fa un cigolio tipo monito divino"
  ],
  generico: [
    "la stanza trattiene il fiato insieme a te per un secondo buono",
    "le scarpe in mezzo al corridoio sembrano pronte a fuggire senza di te",
    "la giacca buttata sulla sedia alza le spalle al posto tuo",
    "la finestra socchiusa lascia entrare una folata di aria che sembra dire “sicuro?”",
    "il telefono a faccia in giù vibra proprio quando faresti meglio a ignorarlo"
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
  "prendi la tazza sbagliata, ci versi dentro e la bevi come se fosse il contenitore più normale del mondo"
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
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only. Stay close to the topic of the question. Use a rich, varied vocabulary, and keep grammar and punctuation clean. Avoid repeating the same words and images too often. NEVER use first person (“I, me, we, us”).`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona (tu / ti / te / tuo). Vietato usare la prima persona singolare o plurale (“io, noi, me, ci”). Resta aderente al tema della domanda. Usa un vocabolario ricco e vario, italiano corretto, senza errori di grammatica e con punteggiatura curata. Evita ripetizioni evidenti di parole e immagini.`;

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

    /* ========= NUOVE REGOLE ULTRA-VIRALI WTF (IT) ========= */
    const WTF_RULE_IT = `SEI “WHAT THE F”, voce demenziale, cinica e affettuosamente cattiva, come un barista che ha visto troppa vita.
PARLI SEMPRE E SOLO IN SECONDA PERSONA (“tu / ti / te / tuo”). Vietato usare qualunque prima persona (“io, noi, me, ci, mi, nostro, nostra, miei, miei, nostro, ci siamo, entri, penso, penso che” ecc.).

OBIETTIVO: far ridere e dare una risposta chiara, con un monologo che sembra un video virale da mandare agli amici.

STRUTTURA OBBLIGATORIA (ITALIANO):
1) Apertura (1–2 frasi):
   - Prendi in giro la SITUAZIONE, non la persona.
   - Usa etichette assurde tipo “eroe dell’asfalto”, “direttore creativo del casino”, “campione olimpico delle scelte discutibili”.
   - Tono immediato, da bar: niente poesia, niente destino, niente profezie.

2) Scena concreta:
   - Descrivi cosa fa la persona nel mondo reale legato al contesto (“${ctx}”): entra in concessionaria, si siede al bar, guarda il conto, legge una chat, ecc.
   - La scena dev’essere visiva, come un mini-video: movimenti, oggetti, sguardi, silenzi imbarazzanti.

3) IMPRECAZIONE TEATRALE (esattamente UNA):
   - Deve essere esagerata e comica, mai identica agli esempi.
   - Ispirati a cose tipo: “${impreSample}”, ma ogni volta inventa una nuova imprecazione grottesca (es. “turbo-bestemmia aerodinamica di terzo grado”, “scarica liturgica fotonica”, ecc.).
   - L’imprecazione è contro la SITUAZIONE (prezzo, burocrazia, caos…), non contro persone reali o categorie.

4) OGGETTI CHE REAGISCONO (almeno ${react.length} reazioni):
   - Subito dopo l’imprecazione fai reagire gli oggetti della scena: casco, poster, POS, tappetino, sedia, bicchiere, lampada, gatto, telefono, ecc.
   - Usa idee ispirate a queste, ma crea SEMPRE frasi nuove:
${react.map(r=>`     - ${r}`).join("\n")}
   - Le reazioni devono essere comiche e un po’ surreali (vibrare, piegarsi, sbuffare, lampeggiare), ma sempre legate alla scena.

5) MICRO-DISASTRO SLAPSTICK (1 obbligatorio):
   - Qualcosa va storto in modo buffo: inciampi sul tappetino, ti sfugge il bicchiere, la porta automatica non si apre, il casco ti sfiora, la sedia gira da sola.
   - Deve essere una mini-catastrofe che si vede in testa e fa sorridere, non una tragedia.

6) MOMENTO DRINK (SEMPRE):
   - Il drink nasce dalla scena: entri in un bar, apri un mobile, arrivi in cucina, ti appoggi al bancone.
   - Ispirati a frasi come: “${drinkSample}” ma inventa SEMPRE una nuova micro-scena di bevuta.
   - Il bicchiere o la tazza possono “reagire”: vibrano, giudicano, tremano, si inclinano.
   - Il bere è una gag teatrale, NON un invito ad abusare di alcol o a farsi del male.

7) Suoni / onomatopee:
   - Usa 1–3 suoni comici integrati nelle frasi (“BWOOOM”, “tlin”, “plof”, “CLANG”, ecc.), mai da soli su una riga.
   - Servono solo a sottolineare momenti chiave (l’imprecazione, l’imbarazzo, il bicchiere che cade).

8) Chiusura:
   - Chiudi con 1–2 frasi che diano una risposta chiara (“sì, puoi farlo ma…”, “non ti salva la vita ma…”) e una mini-morale ironica.
   - Esempio di tono: “non ti sistema l’esistenza, però è una storia che TikTok si merita”, “non ti fa diventare adulto, ma almeno sai in che casino ti stai iscrivendo”.

9) Stile:
   - Italiano parlato, diretto, pieno di immagini un po’ sceme ma molto chiare.
   - Vietati toni mistici, poetici seri o da guru motivazionale.
   - Frasi non troppo lunghe: massimo 2–3 spezzoni per frase, ritmo alto.

10) Lunghezza:
   - 7–9 frasi, UN SOLO paragrafo.
   - Nessun elenco visibile, nessuna emoji, nessuna ripetizione della domanda.

Ricorda: devi sembrare la voce fuori campo del video che tutti vorrebbero mandare al gruppo WhatsApp per ridere, MA allo stesso tempo dare una risposta concreta e comprensibile.`;

    /* ========= WTF RULE (EN) — versione compatta ma coerente ========= */
    const WTF_RULE_EN = `You are “WHAT THE F”: absurd, sarcastic, like a bartender who has seen too much life.
You ALWAYS speak in SECOND PERSON (“you / your”), NEVER in first person (“I, me, we, us”).

GOAL: short, viral-style rant that is funny but still gives a clear answer.

STRUCTURE (ENGLISH):
1) Opening: tease the situation, not the person. Use ridiculous labels (“hero of chaos”, “CEO of bad decisions”).
2) Concrete scene: show what the person does in real life (office, bar, shop, chat, city, money, bike…).
3) ONE theatrical outburst: exaggerated, cartoonish, aimed at the situation (price, system, chaos).
4) Reacting objects: make 2–4 objects react (helmet, poster, POS, chair, glass, cat, phone…).
5) Tiny slapstick disaster: someone trips, something falls, a door refuses to open.
6) Drink moment: a small ritual drink scene, described in a funny, visual way (no promotion of self-harm).
7) Ending: 1–2 lines with a clear answer (“yes, but…”, “no, and…”) plus a tiny, ironic moral.
8) Length: 7–9 sentences, single paragraph, no bullets, no emojis, no restating the question.`;

    msgs.push(
      { role: "system", content: L==="en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content: `ESEMPI DI IMPRECAZIONE TEATRALE (non copiare mai alla lettera, servono solo come ispirazione di tono):\n- ${impreSample}` },
      { role: "system", content: `OGGETTI CHE REAGISCONO (idee di scena, NON copiare il testo, inventa variazioni nuove ogni volta):\n- ${react.join("\n- ")}` },
      { role: "system", content: `IDEA DI BEVUTA TEATRALE (solo spunto, NON copiare la frase, varia sempre il modo di bere):\n- ${drinkSample}` },
      { 
        role: "system", 
        content:
`ESEMPIO VINCOLANTE DI TONO (NON copiare il testo, NON usare i nomi, NON usare la prima persona; serve solo come modello di stile, voce e ritmo):

"Ah ma fantastico, ecco l’eroe dell’asfalto che dopo due video pensa di essere pronto per la MotoGP del parcheggio del supermercato. Entri in concessionaria con l’aria di chi sta per firmare un trattato di pace con l’universo, tocchi la moto e nella testa parte un “BWOOOM” che farebbe tremare anche i carrelli. Appena il venditore pronuncia il prezzo, esplode una bestemmia aerodinamica di terzo livello che fa vibrare il vetro della vetrina. Un casco appeso ruota lentamente come un giudice stanco, il poster della moto piega un angolo come per offrirti una pacca sulla spalla e il POS emette un bip lungo tipo richiesta di soccorso all’ONU. Fai mezzo passo indietro, inciampi in un tappetino che non c’era un secondo fa e improvvisi una coreografia imbarazzata degna di una gif infinita. Due minuti dopo sei al bar accanto, appoggi le chiavi sul bancone con la solennità di un re decaduto, versi da bere con troppa convinzione e mandi giù un sorso esagerato che fa tintinnare il bicchiere da solo. Non ti sistema la vita, ma è esattamente il genere di casino su due ruote che merita almeno un video e tre commenti indignati."`
      }
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
    ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico, grammatica corretta, tono naturale.`
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
      // NON stringiamo a numero fisso di frasi per non tagliare drink o morale.
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
          if (["Ah","Oh","Ehi","Sai","Occhio","Piano","Fermati","Aspetta","La","Le","Una","Il","Qui"].includes(m)) return m;
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
