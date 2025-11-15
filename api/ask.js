// /api/ask.js — What?f Engine (Zingara-Realista WHATIF + Friendly-WTF Demenziale)
// - WHATIF: tono “zingara mistica realista”, 60% analisi / 40% immagini sobrie,
//   chiusura con sensazione + gancio. Passato → controfattuale. Futuro → ipotesi vicina.
// - WTF: come da tuoi esempi. Payload extra 'scientific' (non nella risposta).
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
- Chiudi con una frase che lasci una sensazione chiara e un piccolo gancio di curiosità.
- 8–10 frasi, seconda persona, un paragrafo unico, NON ripetere la domanda, niente elenchi, niente emoji. Linguaggio semplice, concreto, coinvolgente.`;

const WHATIF_RULE_PAST_IT = `WHAT IF (italiano, PASSATO CONTROFATTUALE):
- Tono: veggente/zíngara che rilegge una vita alternativa, mistica ma concreta.
- APRI con UNA riga breve e intensa, come se indicassi una vita che non è stata vissuta.
- La SECONDA frase deve INIZIARE con "Vedo", "Sento", "Immagino", "Intuisco", "Si sarebbe aperto", "Si sarebbe mosso" (usa forma naturale).
- Scrivi in chiave controfattuale: "se avessi…, avresti…", "ti saresti trovato…", "avresti sentito…".
- Nessuna data o fatto reale non fornito; resta fedele al tema della domanda (relazione, scelta, città, lavoro, ecc.).
- 60% analisi concreta + 40% immagini sobrie di quella vita alternativa.
- Chiudi con sensazione + micro-gancio che riporti dolcemente al presente ("non sarebbe stato un errore, sarebbe stata un'altra versione di te", ecc.).
- 8–10 frasi, seconda persona, un paragrafo unico, NON ripetere la domanda, niente elenchi, niente emoji. Linguaggio semplice, concreto, coinvolgente.`;

/* ========= Incipit dinamici — “ZINGARA MISTICA” (non più forzati via post-process) ========= */
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

/* ========= Finali “gancio” — realistici e brevi ========= */
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

/* ========= WTF: contesti, oggetti, bevute, personalità ========= */

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

const WTF_OBJECTS_BY_CONTEXT = {
  moto: [
    "il casco appoggiato male sul sellino",
    "il cavalletto che scricchiola",
    "gli specchietti che vibrano per niente",
    "il contachilometri che ti fissa",
    "il venditore appoggiato al bancone",
    "la saracinesca del garage a metà"
  ],
  ufficio: [
    "il monitor che lampeggia a caso",
    "la stampante in errore cronico",
    "la sedia girevole che cigola giudicante",
    "il neon tremolante sopra la testa",
    "il badge che non legge al primo colpo",
    "la tastiera piena di briciole"
  ],
  casa: [
    "la tapparella che si blocca a metà",
    "il frigorifero che borbotta",
    "il divano sfondato che ti trattiene",
    "la lampada che sfarfalla",
    "la porta che sbatte da sola",
    "la lavatrice in centrifuga esistenziale"
  ],
  città: [
    "la valigia aperta sul letto",
    "la finestra che dà sulla strada",
    "il portone che conosci a memoria",
    "il bar sotto casa con il solito bancone",
    "la panchina dove ti sei seduto mille volte",
    "la salita che ti guarda di traverso"
  ],
  relazione: [
    "il telefono che vibra senza notifiche nuove",
    "la chat aperta da mesi",
    "il letto sfatto a metà",
    "il cuscino che sa troppi segreti",
    "il gatto che ti guarda giudicante",
    "lo specchio che eviti di guardare"
  ],
  soldi: [
    "l’estratto conto aperto sullo schermo",
    "la calcolatrice del telefono in mano",
    "il portafoglio piegato male",
    "gli scontrini sparsi sul tavolo",
    "la busta paga stropicciata",
    "le monete mollate sulla mensola"
  ],
  generico: [
    "la stanza che ti guarda in silenzio",
    "le scarpe lasciate in mezzo",
    "la giacca buttata sulla sedia",
    "il tavolo con troppe cose sopra",
    "la finestra socchiusa",
    "il telefono messo a faccia in giù"
  ]
};

const WTF_DRINKS_BY_CONTEXT = {
  moto: [
    "un bicchiere grande al bancone del bar accanto al concessionario",
    "una birra media bevuta in piedi fuori dal locale",
    "un caffè lungo al bancone, bevuto in tre sorsi molto decisi"
  ],
  ufficio: [
    "un bicchiere di plastica pieno fino all’orlo di caffè della macchinetta",
    "una tazza gigante di caffè annacquato nella cucina aziendale",
    "un bicchierone d’acqua al distributore, buttato giù come fosse superalcolico"
  ],
  casa: [
    "un bicchiere grande riempito fino al bordo in cucina",
    "un mezzo calice traboccante bevuto appoggiato al lavandino",
    "un bicchiere pieno bevuto in piedi davanti al frigorifero aperto"
  ],
  città: [
    "un bicchiere pesante al bancone del bar sotto casa",
    "un calice pieno bevuto lentamente al tavolino del corso",
    "un bicchiere colmo preso nel solito locale dove ti conoscono per nome"
  ],
  relazione: [
    "un calice pieno fino all’orlo bevuto seduto sul bordo del letto",
    "un bicchiere esagerato bevuto sulla soglia del balcone",
    "un bicchiere serio bevuto in cucina, con il telefono a faccia in giù sul tavolo"
  ],
  soldi: [
    "un bicchiere colmo bevuto guardando il saldo sullo schermo",
    "un sorso lungo e pesante da un bicchiere grande vicino ai conti",
    "un bicchiere pieno bevuto davanti a una pila di scontrini"
  ],
  generico: [
    "un bicchiere grande riempito più del necessario",
    "un calice traboccante bevuto in un’unica tirata",
    "un bicchiere colmo svuotato senza togliere gli occhi da quello che ti preoccupa"
  ]
};

/* Personalità di What the F (stesso personaggio, energie diverse) */
const WTF_PERSONAS = [
  {
    id: "classico",
    desc: "barista amico, affettuosamente sarcastico, ritmo medio, prese in giro morbide ma precise."
  },
  {
    id: "sbronzo_filosofico",
    desc: "stesso barista, ma un filo più brillo: metafore assurde, piccole derive filosofiche, sempre tornando al punto."
  },
  {
    id: "stanco_secco",
    desc: "sarcasmo asciutto, meno fronzoli, frasi un po’ più secche, ma comunque caldo sotto."
  },
  {
    id: "teatrale",
    desc: "versione più esagerata: immagini forti, mini-scene quasi da film, ritmo un po’ più alto."
  },
  {
    id: "confidente",
    desc: "più vicino emotivamente, come se parlasse a un amico stretto; resta comico ma un filo più dolce sul finale."
  }
];

function pickPersonaForQuestion(domanda = "") {
  const t = String(domanda || "").toLowerCase();

  if (/(lasciare|mollare|ex|relazione|storia|cuore|fidanzat|matrimonio|divorzio)/.test(t)) {
    return "confidente";
  }
  if (/(lavoro|ufficio|stipendio|collega|capo|azienda|contratto)/.test(t)) {
    return "stanco_secco";
  }
  if (/(moto|macchina|auto|pista|viaggio|trasferirmi|trasferimento|città|citta|lugano|l'aquila|laquila|spostarmi)/.test(t)) {
    return "teatrale";
  }
  if (/(soldi|debito|conto|mutuo|tasse|invest|risparmi|budget)/.test(t)) {
    return "sbronzo_filosofico";
  }

  // default: classico
  return "classico";
}

/* Imprecazioni “emotive”, non letterali, variabili */
const WTF_IMPRE = [
  "una raffica di imprecazioni creative che bucano il soffitto",
  "un tuono di parolacce eleganti ma molto convinte",
  "una liturgia storta di santi e pianeti allineati male",
  "un coro di bestemmie trattenute che si sente fino al pianerottolo",
  "un’esplosione di santi in sciopero emotivo",
  "una scarica di invocazioni sgangherate che manco allo stadio",
  "una benedizione rovesciata detta coi denti stretti",
  "un rosario di parole storte ma sincere",
  "una tempesta di improperi detti a bassa voce",
  "un lampo di bestemmie interiori che nessuno sente ma tutti intuirebbero"
];

const WTF_MODES = [
  "storia da bancone, con lui protagonista e il barista che commenta",
  "telecronaca esagerata di quello che gli passa nella testa",
  "sfogo teatrale breve e poi consiglio secco da barista",
  "mini monologo comico che parte in quarta e atterra morbido",
  "pseudo-analisi psicologica da bar con troppo caffè"
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const baseRules = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only. Stay close to the topic of the question.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona. Resta aderente al tema della domanda.`;

  const msgs = [
    { role: "system", content: baseRules },
  ];

  if(stile==="wtf"){
    // seed deterministico per varietà stabile per stessa domanda
    let seed=[...String(domanda||"")].reduce((a,c)=>a+c.charCodeAt(0),0);
    function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; }

    const ctx = detectWtfContext(domanda);
    const persona = pickPersonaForQuestion(domanda);
    const objPool = WTF_OBJECTS_BY_CONTEXT[ctx] || WTF_OBJECTS_BY_CONTEXT.generico;
    const drinkPool = WTF_DRINKS_BY_CONTEXT[ctx] || WTF_DRINKS_BY_CONTEXT.generico;

    const shuffledObjs = [...objPool].sort(()=>rnd()-0.5);
    const sceneObjects = shuffledObjs.slice(0,3);
    const drinkIdea = drinkPool[Math.floor(rnd()*drinkPool.length)];
    const impre = WTF_IMPRE[Math.floor(rnd()*WTF_IMPRE.length)];
    const mode = WTF_MODES[Math.floor(rnd()*WTF_MODES.length)];

    const personaLineIT =
      persona === "classico"
        ? "Tono: barista amico, affettuosamente sarcastico, vicino ma pungente."
        : persona === "sbronzo_filosofico"
        ? "Tono: barista leggermente sbronzo, metafore assurde, filosofia spiccia ma concreta."
        : persona === "stanco_secco"
        ? "Tono: barista stanco, sarcasmo secco, frasi più asciutte ma comunque calde."
        : persona === "teatrale"
        ? "Tono: barista teatrale, immagini forti, ritmo un po’ più alto, ma sempre ancorato alla realtà della domanda."
        : "Tono: barista confidente, più vicino emotivamente, come se parlasse a un amico, sempre con ironia.";

    const WTF_RULE_IT = `
WHAT THE F (voce comica, barista amico, demenziale ma utile).
${personaLineIT}
Mantieni SEMPRE la personalità che hai negli esempi: parli direttamente alla persona, la prendi in giro, ma fai chiaramente il tifo per lei.

REGOLE DI CONTENUTO:
- Parti dalla situazione reale implicita nella domanda e resta sempre attaccato a quella (contesto: ${ctx}).
- La scena si muove mentre RISPONDI alla domanda: la presa in giro, la micro-sfiga, l’incazzatura e la bevuta devono nascere da ciò che potrebbe succedere davvero se lui/lei facesse quella scelta.
- L'incazzatura nasce da un evento coerente con la scena (conti, burocrazia, ricordi, imbarazzo, costi, difficoltà pratiche, ecc.), non dal nulla.
- Usa imprecazioni creative e teatrali in forma narrativa (es: "ti parte ${impre}"), senza insultare direttamente persone reali; prendi in giro la situazione, non l’utente.
- Puoi usare oggetti di scena come: ${sceneObjects.join(", ")} — ma solo se hanno senso nella scena.
- Se ha senso, inserisci UNA bevuta coerente con il contesto (idea: ${drinkIdea}), spiegando come ci arriva (esce al bar, va in cucina, va in sala pausa, ecc.): niente bicchieri che appaiono dal nulla.
- Dopo la parte teatrale, DEVI rispondere chiaramente alla domanda: se ha senso farlo, quando, con quali condizioni minime (soldi, tempo, testa, sicurezza, ecc.).
- Chiudi con una mini morale calda e ironica che riassume in modo semplice cosa sarebbe sensato fare adesso.

REGOLE DI STILE:
- Mantieni lo stesso stile degli esempi che conosci già: incipit diretti, tono da bar, sarcasmo affettuoso.
- 6–9 frasi, un solo paragrafo, niente elenchi, niente emoji.
- Varia gli inizi: non iniziare sempre con la stessa parola o esclamazione; cambia ritmo, non copiare strutture identiche.
- Non copiare mai alla lettera gli esempi che hai visto: prendi il ritmo, non il testo.`;

    const WTF_RULE_EN = `
WHAT THE F (comic voice, friendly bartender, absurd but helpful).
Persona tone: ${persona}.
Keep the same personality as in the examples you’ve seen: direct, teasing, warm, but actually helpful.

CONTENT RULES:
- Start from the real situation implied by the question and stay anchored to it (context: ${ctx}).
- The scene must move WHILE you answer the question: the tease, the small mishap, the anger and the drink all come from what could realistically happen if they made that choice.
- Anger comes from a coherent event in the scene (money, logistics, memories, embarrassment, bureaucracy…), never from nowhere.
- Use creative, theatrical exclamations in narrative form (e.g. "a burst like ${impre}"), never direct insults to real people; mock the situation, not the user.
- You may use scene objects such as: ${sceneObjects.join(", ")}, but only if they make sense.
- If it fits, include ONE contextual drink (idea: ${drinkIdea}), and explain how they get it (bar, kitchen, office break room, etc.): no drinks spawning from nowhere.
- After the comic/chaotic part, you MUST give a clear answer to the question: say if it makes sense, when, and under which basic conditions.
- End with a short warm, ironic moral that summarizes what would realistically make sense to do now.

STYLE:
- Same voice as your known examples: bar tone, direct address, teasing but on their side.
- 6–9 sentences, single paragraph, no bullets, no emojis.
- Vary openings; don’t always start the same way.
- Never copy example texts verbatim; imitate only the rhythm.`;

    msgs.push(
      { role: "system", content: L==="en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content: `MODALITÀ NARRATIVA PER QUESTA RISPOSTA: ${mode}. Interpreta questa modalità nel tono WHAT THE F, restando sempre aderente alla domanda e portando a una risposta chiara.` },
      { role: "system", content: `CONTESTO RILEVATO: ${ctx}. OGGETTI DI SCENA POSSIBILI (idee, non obbligatori): ${sceneObjects.join(", ")}.` },
      { role: "system", content: `IMPRECATION ENERGETICA (NON da copiare letteralmente, solo come intensità): ${impre}.` },
      { role: "system", content: `IDEA DI BEVUTA CONTESTUALE (NON obbligatoria): ${drinkIdea}.` }
    );

  } else {
    // WHAT IF dipendente dal tempo (IT ottimizzato, altre lingue usano solo baseRules)
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
    ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico.`
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

/* ========= WHAT IF: motivazione sintetica (stile “motivazioni pro/contro”) ========= */
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
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);

    // (Niente più iniezione di incipit ZINGARA via funzione: ora è gestito dal modello nei system rules)

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
