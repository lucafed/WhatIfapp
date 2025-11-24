// /api/ask.js — What?f Engine (nuova logica: clarify + answer)
// - WHATIF: analisi scenari + consigli pratici.
//   Prima guarda i diversi scenari (se lo fai / non lo fai / lo rimandi / lo fai in modo diverso),
//   poi ti dice cosa ha più senso fare e come comportarti concretamente.
//   5–7 frasi, massimo ~120 parole, tono da consigliere molto lucido ma umano.
// - WTF: buzzurro grezzo e volgare ma colto e filoso incazzato.
//   Sembra un barista filoso incazzato che ti prende per il culo ma dice la verità.
//   Super ironico a ogni battuta, demenziale al massimo, pieno di immagini assurde e parolacce comiche tipo
//   “eccheccazz”, “azzo”, “maremma maiala”, “porca vacca” usate per far ridere, non per attaccare nessuno.
//   5–8 frasi, massimo ~150 parole, monologo esplosivo.
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

/* ========= Rimozione “prima persona” (per entrambi gli stili, con eccezioni WTF) ========= */
function stripFirstPerson(text = "", lang = "it", stile = "whatif") {
  let out = String(text || "");
  const L = normLang(lang);

  // Proteggi espressioni tipo "io ti dico" in WHAT THE F (permesse come intercalare, non narrativa)
  const tokenIoTiDico = "__IOTIDICO__";
  if (stile === "wtf" && L === "it") {
    out = out.replace(/\bio ti dico\b/gi, tokenIoTiDico);
  }

  if (L === "it") {
    // Evita solo la prima persona singolare (narrativa), per non rompere “ci / noi”
    out = out.replace(/\b(io|me|mi)\b/gi, "tu");
    out = out.replace(/\b(mio|mia|miei|mie)\b/gi, "tuo");
  } else {
    out = out.replace(
      /\b(I|I'm|I’d|I've|me|my|we|we're|we’ve|we’d|us|our|ours)\b/gi,
      "you"
    );
  }

  if (stile === "wtf" && L === "it") {
    out = out.replace(new RegExp(tokenIoTiDico, "g"), "io ti dico");
  }

  return out;
}

/* ========= WHAT IF – esempio (respiro) ========= */
const WHATIF_HYBRID_EX_IT = `Qui la tua scelta sposta davvero il peso delle giornate. Tagli rumore, recuperi tempo ed energia e inizi a vedere meglio cosa conta davvero. Cambiano le abitudini che tieni e quelle che lasci, e ti ritrovi con una routine meno scenografica ma più vivibile. Vedi quanto ti costa restare fermo, quanto ti costerebbe muoverti e cosa succede se rimandi ancora. Non è una rivoluzione da film: è manutenzione di vita, una manopola alla volta. E quando ti guardi indietro, il rimpianto fa meno rumore proprio nel punto in cui hai iniziato a scegliere in modo più onesto.`;

/* ========= WHAT IF – REGOLE (future/past, scenari + consigli) ========= */
const WHATIF_RULE_FUT_IT = `WHAT IF (italiano, FUTURO – ANALISI SCENARI + CONSIGLI):
- Tono: lucido, concreto, empatico ma fermo. Come un amico molto sveglio che ti vuole bene e non ti racconta favole.
- Compito: prima analizzi i possibili scenari legati alla scelta:
  • cosa succede se lo fai;
  • cosa succede se NON lo fai;
  • cosa succede se lo rimandi ancora;
  • eventuale scenario “via di mezzo” (lo fai in modo ridotto o diverso).
- Usa la risposta in quarta pagina come contesto mentale, ma NON citarla né riassumerla: la usi solo per capire meglio il quadro.
- Per ogni scenario guarda tempo, energie, soldi, relazioni, identità e rischi concreti.
- Dopo l’analisi, prendi posizione: spiega quale scenario ha più senso per lui/lei adesso e perché.
- Chiudi con consigli pratici su COME comportarsi nei prossimi passi (piccole azioni, paletti, segnali da tenere d’occhio).
- Linguaggio: italiano naturale, chiaro, senza fronzoli, niente coach da Instagram, niente spiritualate.
- 5–7 frasi, seconda persona, un solo paragrafo, frasi brevi (max ~20 parole), niente elenchi nel testo finale, niente emoji.
- Non usare prima persona narrativa (“io, noi, mi, ci”): la scena è sempre su chi legge.`;

const WHATIF_RULE_PAST_IT = `WHAT IF (italiano, PASSATO CONTROFATTUALE – SCENARIO ALTERNATIVO + LEZIONE):
- Tono: amico molto sincero che ti fa vedere la versione alternativa della tua vita senza schiacciarti di sensi di colpa.
- Compito: descrivi come sarebbe andata se quella scelta l’avessi fatta davvero:
  • in cosa ti saresti trovato meglio;
  • quali pesi nuovi ti saresti messo addosso;
  • cosa avresti perso rispetto a oggi.
- Usa struttura controfattuale (“se avessi…, ti saresti trovato…, avresti pagato…, ti saresti portato dietro…”).
- Usa la risposta in quarta pagina solo come bussola interna, senza citarla o riassumerla.
- Alla fine porta tutto nel presente: cosa impari da quella vita alternativa, cosa puoi ancora scegliere adesso, come ti conviene muoverti.
- Linguaggio: diretto, concreto, niente melodramma, niente giudizi morali.
- 5–7 frasi, seconda persona, un paragrafo unico, frasi brevi, niente elenchi nel testo finale, niente emoji.
- Non usare prima persona narrativa (“io, noi, mi, ci”): parla sempre dal punto di vista di chi legge.`;

/* ========= Finali “gancio” WHAT IF (solo non-IT) ========= */
const ZINGARA_ENDINGS = {
  it: {
    future: [],
    past: [],
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
  const L = normLang(lang);
  if (L === "it") return s;
  const last = (s.match(/([^.!?…]+[.!?…])\s*$/) || [])[1] || s;
  const alreadyHasHook = /(you’d notice|you’d probably feel|notarás|verras|merkst du)/i.test(last);
  if (alreadyHasHook) return s;
  const pool = ZINGARA_ENDINGS[L] || ZINGARA_ENDINGS.en;
  const bag =
    String(periodo).toLowerCase() === "past"
      ? pool.past || ZINGARA_ENDINGS.en.past
      : pool.future || ZINGARA_ENDINGS.en.future;
  const addon = pickDet(bag, hashStr((domanda || "") + s));
  if (!addon) return s;
  s = s.replace(/[.!?…]+$/, "");
  return `${s}. ${addon}`;
}

/* ========= WTF — contesto leggero (spunti) ========= */
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

/* ========= WTF: parole chiave dalla domanda (per immagini contestuali) ========= */
const WTF_STOP_IT = new Set([
  "allora",
  "perché",
  "perche",
  "quando",
  "come",
  "cosa",
  "questo",
  "questa",
  "quello",
  "quella",
  "proprio",
  "tipo",
  "solo",
  "magari",
  "forse",
  "anche",
  "molto",
  "sempre",
  "mai",
  "non",
  "che",
  "con",
  "senza",
  "fare",
  "andare",
  "stare",
  "dove",
  "se"
]);

function wtfKeywords(domanda = "") {
  const t = String(domanda || "").toLowerCase();
  const words = t
    .replace(/[.,;:!?()"'“”\[\]{}]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const w of words) {
    if (w.length < 5) continue;
    if (WTF_STOP_IT.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 6) break;
  }
  return out;
}

/* Pool di IMPRECAZIONI teatrali — spunto interno */
const WTF_IMPRE_POOL = [
  "imprecazione turboguidata che sfiora il soffitto",
  "anatema blindato a tre stadi che sposta l’aria di un metro",
  "raffica di parolacce pressurizzate con effetto sismico leggero",
  "vulcano d’anatemi in eruzione controllata ma non troppo",
  "scarica liturgica a combustione interna che mette a vibrare i vetri",
  "tsunami di improperi sussurrati ma percepibili da Marte",
  "scoppio corazzato di frasi non omologate dall’ONU",
  "supernova di imprecazioni compressa in un secondo netto",
];

/* Reazioni degli oggetti — spunto interno */
const WTF_REACT_BY_CONTEXT = {
  moto: [
    "il casco in esposizione ruota piano come se volesse vedere meglio il disastro",
    "il poster della moto da corsa piega l’angolo come per darti una pacca sulla spalla",
    "il cavalletto in vetrina scricchiola come se stesse sospirando forte",
  ],
  ufficio: [
    "la sedia girevole fa mezzo giro da sola e si ferma a guardarti",
    "la stampante tossisce due fogli bianchi e poi si rifiuta di collaborare",
    "il badge sbatte contro il lettore e il led rosso ti guarda deluso",
  ],
  casa: [
    "il divano affonda di un centimetro solo a vederti entrare",
    "la tapparella si blocca a metà, indecisa come te",
    "il frigorifero fa un ronzio lungo tipo sospiro giudicante",
  ],
  città: [
    "la fermata dell’autobus ti guarda e finge di non conoscerti",
    "un’insegna al neon sfarfalla proprio sulla parola “casa”",
    "un piccione ti osserva come un agente immobiliare stanco",
  ],
  relazione: [
    "la chat rimane incollata in alto come una spia luminosa",
    "il letto sfatto sembra avere due impronte che non si parlano",
    "il cuscino tiene una piega come se stesse conservando un posto",
  ],
  soldi: [
    "il portafoglio si chiude da solo con un piccolo scatto di difesa",
    "gli scontrini si aprono a ventaglio come un fascicolo processuale",
    "la calcolatrice del telefono mostra più zeri del dovuto solo per spaventarti",
  ],
  generico: [
    "la stanza trattiene il fiato insieme a te per un secondo buono",
    "la giacca sulla sedia alza le spalle al posto tuo",
    "il telefono a faccia in giù vibra proprio quando sarebbe meglio ignorarlo",
  ],
};

/* Bevute teatrali – spunto interno */
const WTF_DRINK_POOL = [
  "riempi un bicchiere fino al bordo e lo svuoti come se stessi spegnendo un incendio nel cervello",
  "versi da bere con troppa convinzione e lo butti giù a colpi nervosi che sembrano codice Morse",
  "prendi il bicchiere più grande che trovi e lo fai sparire come una pessima idea",
  "bevi appoggiato al lavandino guardando il pavimento, come se sotto ci fosse scritto il finale",
];

/* ========= Apertura provocatoria WHAT THE F ========= */
const WTF_OPENINGS_IT = [
  "Eccheccazz, mettiti comodo che qui c’è materiale da far sudare pure il frigo.",
  "Oh bello, già a leggere sta roba la sedia ha sospirato forte.",
  "Porca vacca filosofica, questa domanda sembra uscita da una notte insonne con troppo caffè.",
  "Azzo, aspetta che si sistema il bancone mentale perché qui si prospetta un discreto casino.",
  "Maremma maiala emotiva, questa scelta profuma di guaio interessante.",
  "Per tutti i tostapane bruciati, già si sente l’aria da decisione storta ma educativa.",
  "Oh santo boiler esploso, qui o ti sistemi la vita o la trasformi in una sitcom.",
  "Minchia santa metaforica, solo a leggere è partita un’imprecazione creativa nel cervello.",
  "Eccallà, anche oggi il cervello ha chiesto il permesso prima di risponderti.",
  "Porca vacca organizzata, questa sembra proprio la domanda che fai quando sei a metà tra fuga e upgrade.",
];

const WTF_OPENINGS_EN = [
  "Well, damn, this sounds like a premium-grade life mess already.",
  "Okay, hold on, this question walks in like a drunk plot twist.",
  "For f’s sake, even the barstool just sighed reading this.",
  "Alright, this smells like equal parts disaster and character development.",
  "Fantastic, another decision that could either fix things or set them on fire.",
];

function wtfOpening(domanda, lang = "it") {
  const L = normLang(lang);
  const pool = L === "en" ? WTF_OPENINGS_EN : WTF_OPENINGS_IT;
  if (!pool.length) return "";
  const seed = hashStr(domanda || "") || 1;
  return pool[seed % pool.length];
}

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
    const LANG_LABEL =
      L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : L === "de" ? "TEDESCO" : "ENGLISH";

    if (L === "en") {
      sys = `You are “WHAT THE F”: a rough, foul-mouthed but strangely wise bartender-philosopher.
You roast the situation, not the person, with absurd images, swearing like “what the hell”, “for f’s sake”, but never attacking groups or identities.
You’re sarcastic, loud, chaotic, but underneath you say the uncomfortable truth.

TASK:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- The question must sound like a drunk philosopher-bartender: half roast, half care, with at least one funny or absurd image.
- You can use first person, second person, whatever flows naturally, but avoid long self-focused stories.
- Do NOT insult protected categories (no racism, no homophobia, no attacks on religions).
- One sentence, max 22 words, no emojis, no bullet points.`;
      if (isPast) {
        sys += `
PAST MODE:
- The question is about a past choice or missed path.
- Explicitly point to "back then", "in that chapter", "when you stayed / didn’t move".`;
      }
    } else {
      sys = `Sei “WHAT THE F”: buzzurro grezzo, volgare ma colto e filoso incazzato.
Parli come un barista stanco della vita che però la capisce fin troppo bene.
Prendi in giro la SITUAZIONE, non la dignità di chi legge.
Usi parolacce comiche tipo “eccheccazz”, “azzo”, “maremma maiala”, “porca vacca”, ma niente insulti a categorie o identità (niente razzismo, omofobia, attacchi religiosi).
Evita di raccontarti in prima persona: niente monologhi autoreferenziali, la scena è sempre sull’utente.`;

      sys += `

COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Deve sembrare una domanda buttata lì al bancone: mezza presa in giro, mezza verità che punge.
- Infila almeno un’immagine assurda o comica (una sedia che ti guarda, un telefono in sciopero, un conto che ti giudica).
- Puoi usare prima persona solo come intercalare breve (“io ti dico”), non per raccontare la tua vita.
- Una sola frase, massimo 22 parole, niente emoji, niente elenco.`;
      if (isPast) {
        sys += `
MODALITÀ PASSATO:
- La domanda riguarda una scelta passata o una strada non presa.
- Fai capire che stai tornando “a quel periodo”, “a quel capitolo”, “quando sei rimasto lì invece di muoverti”.`;
      }
    }
  } else {
    // WHAT IF — chiarimento analitico
    if (L === "en") {
      sys = `You are “WHAT IF”: a very clear, grounded advisor.
You care about real-life constraints and want to give useful, practical advice, not poetry.

TASK:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- Focus on 1–2 key details that change the analysis: real goal, main constraint, time frame, or what “success” would look like.
- Connect explicitly to what they wrote (“in that city”, “with that job”, “with that person”).
- Calm, precise tone. One sentence, max 22 words, no emojis, no bullet points.
- Do not use first-person narration (“I, we”): keep the focus on the user, not on yourself.`;
      if (isPast) {
        sys += `
PAST MODE:
- Question is about a past choice or missed path.
- Make it clear you refer to that chapter (“back then”, “when you stayed”, “if you had moved”).`;
      }
    } else {
      const LANG_LABEL =
        L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

      sys = `Sei “WHAT IF”: voce lucida e concreta, da amico che sa ragionare bene sui pro e contro.
Ti interessa capire i vincoli veri per poter dare consigli pratici.

COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Punta su 1–2 dettagli che spostano davvero l’analisi: obiettivo reale, vincolo principale, tempi, cosa consideri “andata bene”.
- Agganciati alla scena che ha descritto: cita in poche parole la scelta o la situazione (“in quella città”, “con quel lavoro”, “con quella relazione”).
- Tono calmo, preciso, senza fronzoli. Una sola frase, massimo 22 parole, niente emoji, niente elenco.
- Evita la prima persona narrativa (“io, noi, mi, ci”): tieni il fuoco sull’utente.`;
      if (isPast) {
        sys += `
MODALITÀ PASSATO:
- La domanda riguarda una scelta passata o una strada non presa.
- Fai capire che ti riferisci a “quel periodo”, “quel capitolo”, “quando hai deciso di restare / non farlo”.`;
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
      : `„Was wäre, wenn…“-Frage des Nutzers:\n"${domanda}"\nStelle EINE Rückfrage auf DEUTSCH im oben beschriebenen Stil.`;

  return [
    { role: "system", content: sys },
    { role: "user", content: userMsg },
  ];
}

/* ========= WTF RULES (buzzurro libero, senza cazzo, oggetti contestuali, finale a bestemmia) ========= */
const WTF_RULE_IT_FUT = `Sei “WHAT THE F”: buzzurro grezzo, volgare ma colto e filoso incazzato.
Stai appoggiato al bancone mentale della vita e commenti le scelte come se fossero ordini sbagliati al bar.
Evita di raccontarti in prima persona: niente storie su di te, la telecamera è sempre puntata su chi legge.

TONO:
- ironia costante, ogni frase deve avere una battuta, un’immagine assurda o una metafora scema ma precisa;
- parolacce comiche e teatrali (“eccheccazz”, “azzo”, “maremma maiala”, “porca vacca”, “che casino fotonico”) usate per far ridere;
- non usare mai la parola “cazzo”: sostituiscila sempre con “azzo”, “ecchecazz” o varianti simili;
- usa oggetti e dettagli presi dal contesto reale della domanda (luoghi, mezzi, schermi, persone), non frigo/bollette/chat generiche buttate a caso;
- frigo, bollette, amici su WhatsApp si usano solo se compaiono davvero nella scena dell’utente.

COMPITO (FUTURO):
- Spiega cosa succede se questa scelta la fai davvero e cosa succede se continui a tirarla lunga come sempre.
- Fa vedere la scena come una piccola sitcom tragica: oggetti del suo mondo che reagiscono, notifiche che ti giudicano, conti che ti guardano storto.
- In mezzo al delirio infilaci la verità: cosa ti libera, cosa ti incastra, dove stai solo perdendo tempo.
- L’ultima frase dev’essere un consiglio secco in stile “consiglio da bestemmia creativa”: mezzo insulto, mezzo abbraccio, ma chiaro su cosa conviene fare.

FORMATO:
- 5–8 frasi, un solo paragrafo, massimo ~150 parole.
- Niente eco della domanda, niente emoji. Massima libertà lessicale, basta restare comico, affettuoso e NON discriminatorio.`;

const WTF_RULE_IT_PAST = `Sei “WHAT THE F” in modalità FLASHBACK:
commenti la puntata alternativa della serie TV della vita, quella dove hai fatto l’altra scelta.
Sempre buzzurro grezzo e filoso incazzato, ma stavolta racconti “la stagione che non è mai uscita” senza metterti al centro in prima persona.

TONO:
- ironia forte su come sarebbe andata: successi mezzi tristi, figuracce epiche, bollette (se ci sono davvero) che urlano “eccheccazz” appena le apri;
- immagini demenziali prese dal contesto della scelta (città, ufficio, casa, mezzi, oggetti reali), non frigo e chat generiche a caso;
- parolacce comiche e imprecazioni teatrali, mai contro categorie o identità;
- non usare mai la parola “cazzo”: usa sempre “azzo”, “ecchecazz” o altre varianti comiche.

COMPITO (PASSATO):
- Racconta cosa sarebbe successo se quella scelta l’avessi fatta davvero: dove ti saresti incastrato, cosa avresti guadagnato, cosa ti sei paradossalmente risparmiato.
- Trattala come una puntata che commenti al bar: “lì pensavi di spaccare il mondo e invece…”.
- L’ultima frase è la morale: consiglio diretto e un po’ bestemmiato (creativamente) su cosa ti conviene fare ADESSO.

FORMATO:
- 5–8 frasi, un solo paragrafo, massimo ~150 parole.
- Niente eco della domanda, niente emoji, ma libertà totale di stile entro i limiti del rispetto di base.`;

const WTF_RULE_EN_FUT = `You are “WHAT THE F”: a rough, foul-mouthed but very cultured and pissed-off philosopher-bartender.
You sound like someone who has seen too much life and now roasts every decision with love and swear words.
Avoid long first-person storytelling: don’t make it about you, keep the camera on the user.

TONE:
- constant irony: every sentence carries a joke, absurd image or ridiculous but accurate metaphor;
- playful swearing (“what the hell”, “for f’s sake”, “this is a majestic mess”) but never targeting groups, religions or identities;
- use concrete objects and details taken from the user’s situation (places, screens, buses, desks), not random fridges or bills;
- end with a very direct, slightly “cursed” piece of advice: harsh but caring.

TASK (FUTURE):
- Show what happens if they actually do this and what happens if they keep delaying like a procrastination grandmaster.
- Turn the scene into a tragic-comic mini-episode: objects reacting, notifications judging, bills staring like disappointed uncles.
- In the middle of the chaos, drop the real insight: what frees them, what traps them, where they’re just wasting time.
- The last sentence must be a clear piece of advice in your foul-mouthed style.

FORMAT:
- 5–8 sentences, single paragraph, max ~150 words.
- No echo of the question, no emojis, maximum stylistic freedom as long as it stays funny, warm and non-discriminatory.`;

const WTF_RULE_EN_PAST = `You are “WHAT THE F” in FLASHBACK MODE:
you’re recapping the lost season of their life where they made the other choice.
Same rough, drunk-philosopher bartender vibe, but don’t turn it into a story about yourself.

TONE:
- loud irony about how it would have gone: half-glorious, half-disaster, with bills screaming “really? that was the plan?”;
- use images built from the actual context (city, office, house, people, commute), not random cliché objects;
- swearing is colorful and playful, never aimed at groups or identities.

TASK (PAST):
- Describe what WOULD have happened if they’d gone that way: what they’d have gained, where they’d be stuck, what mess they dodged by not doing it.
- Treat it like commentary at the bar: “there you thought you’d conquer the world and instead…”.
- End by pulling them back to now: the last sentence is a blunt, foul-mouthed piece of advice about what makes sense to do today.

FORMAT:
- 5–8 sentences, single paragraph, max ~150 words.
- No echo of the question, no emojis, full freedom within basic respect.`;

/* ========= MESSAGGI RISPOSTA ========= */
function buildMessages({ domanda, clarification, lang, periodo, stile }) {
  const L = normLang(lang);
  const isWtf = stile === "wtf";
  const isPast = String(periodo).toLowerCase() === "past";
  const hasClar = clarification && String(clarification).trim().length > 0;
  const c = hasClar ? String(clarification).trim() : "";

  const baseRules = isWtf
    ? L === "en"
      ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Stay glued to the core choice. Use strong, vivid, sometimes ridiculous images. Swearing is allowed but must stay playful and never target protected groups or identities. Keep grammar readable, but you may sound drunk and theatrical on purpose. Avoid first-person storytelling: the focus stays on the user.`
      : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Resta incollato alla scelta di cui si parla. Puoi essere sboccato, teatrale, ubriaco dentro, ma leggibile. Parolacce OK, insulti a categorie o identità NO. Immagini vivide, metafore demenziali, ritmo da monologo. Evita la prima persona narrativa: niente “io” protagonista, la scena è dell’utente.`
    : L === "en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. SECOND PERSON (“you / your”) when you talk about the user. Avoid first person (“I, me, we, us”) completely. Stay close to the topic and clearly answer the core point. Short sentences (max ~20 words), clean grammar and punctuation.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Usa la seconda persona (tu / ti / te / tuo) quando ti riferisci a chi legge. Non usare prima persona narrativa (“io, noi, mi, ci”) per non spostare il focus su di te. Resta aderente al tema e rispondi in modo chiaro al punto centrale. Frasi brevi (max ~20 parole), grammatica e punteggiatura pulite.`;

  const msgs = [{ role: "system", content: baseRules }];

  if (isWtf) {
    const ctx = detectWtfContext(domanda);
    let seed = [...String(domanda || "")].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    }
    const impreSample = WTF_IMPRE_POOL[Math.floor(rnd() * WTF_IMPRE_POOL.length)];
    const reactPool = WTF_REACT_BY_CONTEXT[ctx] || WTF_REACT_BY_CONTEXT.generico;
    const shuffled = [...reactPool].sort(() => rnd() - 0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd() * 1));
    const drinkSample = WTF_DRINK_POOL[Math.floor(rnd() * WTF_DRINK_POOL.length)];
    const kw = wtfKeywords(domanda);

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
        content: `ESEMPI DI TONO (non copiare mai alla lettera, solo spunto):
- imprecazione teatrale: ${impreSample}
- oggetti che reagiscono: ${react.join(" · ")}
- scena di bevuta: ${drinkSample}`,
      }
    );

    if (kw.length && L === "it") {
      msgs.push({
        role: "system",
        content: `PAROLE CHIAVE DALLA SCENA UTENTE: ${kw.join(
          ", "
        )}. Usa almeno 2–3 di questi elementi per oggetti e metafore, così le immagini restano davvero legate alla sua situazione.`,
      });
    }
  } else {
    if (L === "it") {
      const ruleIT = isPast ? WHATIF_RULE_PAST_IT : WHATIF_RULE_FUT_IT;
      msgs.push(
        { role: "system", content: ruleIT },
        {
          role: "system",
          content: `ESEMPIO DI RESPIRO (non copiare i contenuti, solo il tono):\n${WHATIF_HYBRID_EX_IT}`,
        }
      );
    }
  }

  if (hasClar) {
    if (L === "it") {
      msgs.push({
        role: "system",
        content:
          "La risposta di quarta pagina è un contesto centrale: usala per capire meglio obiettivi e vincoli, ma NON citarla né riassumerla. Ancoraci l’analisi e i consigli.",
      });
    } else if (L === "en") {
      msgs.push({
        role: "system",
        content:
          "The fourth-page answer is central context: use it to understand goals and constraints, but do NOT quote or summarize it. Anchor your analysis and advice to it.",
      });
    } else {
      msgs.push({
        role: "system",
        content:
          "La risposta extra dell’utente è un contesto importante: usala per orientare l’analisi e i consigli, senza citarla o riassumerla in modo diretto.",
      });
    }
  }

  const ask = (function () {
    if (L === "en") {
      if (isWtf) {
        if (hasClar) {
          return `Original question (do not repeat it): "${domanda}". Extra detail from the user (FOURTH PAGE): "${c}". Write ONE absurd, brutally honest answer in ENGLISH as “WHAT THE F”. Single paragraph, 5–8 sentences, loud, sarcastic, messy but secretly wise. Show what happens if they do it and if they keep dodging it, then close with a crooked but clear piece of advice.`;
        }
        return `Question (do not repeat it): "${domanda}". Write ONE answer in ENGLISH as “WHAT THE F”. Single paragraph, 5–8 sentences, extremely ironic and over-the-top, but still answering what happens with this choice and what you’d recommend.`;
      }
      if (hasClar) {
        if (isPast) {
          return `Original question about the PAST (do not repeat it): "${domanda}". Extra detail from the user (FOURTH PAGE): "${c}". Write ONE COUNTERFACTUAL answer in ENGLISH as “WHAT IF”: describe the alternate timeline as if it had really happened, then extract what matters now and give practical advice on how to move today. Single paragraph, 5–7 short sentences.`;
        }
        return `Original question (do not repeat it): "${domanda}". Extra detail from the user (FOURTH PAGE): "${c}". Write ONE answer in ENGLISH as “WHAT IF”: first analyse different scenarios (doing it, not doing it, delaying, doing a lighter version), then clearly suggest what makes more sense and how to act. Single paragraph, 5–7 short sentences.`;
      }
      if (isPast) {
        return `Question about the PAST (do not repeat it): "${domanda}". Write ONE COUNTERFACTUAL answer in ENGLISH: show the alternate timeline and then explain what the user can learn and do now. Single paragraph.`;
      }
      return `Question (do not repeat it): "${domanda}". Write ONE answer in ENGLISH as “WHAT IF”: analyse different scenarios and then give clear, practical advice on what to do and how to behave. Single paragraph.`;
    }

    if (L === "it") {
      if (isWtf) {
        if (hasClar) {
          return `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo (quarta pagina): "${c}". Genera UNA risposta in ITALIANO come voce “WHAT THE F”: monologo da buzzurro grezzo, volgare ma filoso incazzato, super ironico e demenziale, 5–8 frasi. Mostra cosa succede se fai questa scelta e cosa succede se continui a rimandare, con oggetti, chat e conti che reagiscono in modo coerente con la scena. Chiudi con un consiglio storto ma vero su cosa ti conviene fare, in stile bestemmia creativa.`;
        }
        return `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO come voce “WHAT THE F”: monologo unico, 5–8 frasi, pieno di immagini assurde ma contestuali, parolacce comiche tipo “eccheccazz” e verità scomode. Devi far ridere ma anche dire chiaramente cosa succede con questa scelta e che direzione ha più senso prendere, chiudendo con un consiglio secco in stile bestemmia creativa.`;
      }

      if (hasClar) {
        if (isPast) {
          return `Domanda sul PASSATO (non ripeterla): "${domanda}". Dettaglio aggiuntivo (quarta pagina): "${c}". Genera UNA risposta CONTROFATTUALE in ITALIANO come “WHAT IF”: racconta come sarebbe andata davvero in quella vita alternativa e poi spiega cosa impari e come ti conviene muoverti ORA. Paragrafo unico, 5–7 frasi, analisi concreta e consigli pratici.`;
        }
        return `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo (quarta pagina): "${c}". Genera UNA risposta in ITALIANO come “WHAT IF”: prima analizzi i possibili scenari (se lo fai, se non lo fai, se lo rimandi, se lo fai in modo diverso), poi prendi posizione su cosa ha più senso e dai consigli pratici su come comportarti. Paragrafo unico, 5–7 frasi, tono lucido ma caldo.`;
      }
      if (isPast) {
        return `Domanda sul PASSATO (non ripeterla): "${domanda}". Genera UNA risposta CONTROFATTUALE in ITALIANO come “WHAT IF”: descrivi come sarebbe andata quella scelta e chiudi spiegando cosa puoi farci oggi, in modo concreto. Paragrafo unico.`;
      }
      return `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO come “WHAT IF”: analizza i diversi scenari possibili e poi dai consigli chiari su cosa fare e come comportarti nei prossimi passi. Paragrafo unico.`;
    }

    if (L === "es") {
      return hasClar
        ? `Pregunta original (no la repitas): "${domanda}". Detalle adicional del usuario: "${c}". Escribe UNA respuesta en ESPAÑOL, clara y concreta, en un solo párrafo.`
        : `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.`;
    }
    if (L === "fr") {
      return hasClar
        ? `Question originale (ne la répète pas) : « ${domanda} ». Détail supplémentaire : « ${c} ». Donne UNE réponse en FRANÇAIS, claire et concrète, en un seul paragraphe.`
        : `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.`;
    }
    return hasClar
      ? `Ursprüngliche Frage (nicht wiederholen): „${domanda}“. Zusatzdetail: „${c}“. Gib EINE klare, konkrete Antwort auf DEUTSCH, ein einziger Absatz.`
      : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.`;
  })();

  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= Server-side PCT ========= */
function computePct(domanda, stile) {
  const t = String(domanda || "").toLowerCase();
  let s = 55;

  if (/\b(7|14|21|30|60|90)\b/.test(t)) s += 10;
  if (/\b\d+([.,]\d+)?\b/.test(t)) s += 6;
  if (/budget|€|euro|spesa|max|under|sotto|prezzo|costo/.test(t)) s += 6;
  if (/senza|solo|al massimo|minimo|entro|prima delle|ogni|per/.test(t)) s += 8;
  if (/lancia|apri|impara|scrivi|chiedi|corri|studia|automatizza|testa|cambia|trasferisc/i.test(t)) s += 6;
  if (/forse|magari|maybe|quizás|chissà/.test(t)) s -= 8;
  if (!/\b\d/.test(t)) s -= 4;

  s += stile === "wtf" ? -3 : +3;

  const h = hashStr(String(domanda || "") + "|" + String(stile || ""));
  const jitter = (h % 31) - 15;
  s += jitter;

  const pct = Math.max(10, Math.min(95, Math.round(s)));
  return pct;
}

/* ========= WHAT IF: motivazione fallback (heuristica) ========= */
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

/* ========= MOTIVAZIONE LLM ========= */
async function generateMotivationLLM({ domanda, clarification, answer, lang, pct }) {
  const L = normLang(lang);

  let sys;
  if (L === "en") {
    sys = `You are the MOTIVATION MODULE of “WHAT IF”.
Write ONE short sentence that explains, in a practical way, WHY the probability is around ${pct}% for this scenario.
Be consistent with the main answer. No emojis, no lists. Max 25 words.`;
  } else if (L === "it") {
    sys = `Sei il MODULO MOTIVAZIONE di “WHAT IF”.
Scrivi UNA sola frase che spiega in modo pratico perché la probabilità è circa ${pct}% in questo scenario.
Deve essere coerente con la risposta principale. Niente emoji, niente elenco. Massimo 25 parole.`;
  } else if (L === "es") {
    sys = `Eres el MÓDULO DE MOTIVACIÓN de “WHAT IF”.
Escribe UNA sola frase que explique por qué la probabilidad es aproximadamente ${pct}% en este escenario.
Coherente con la respuesta principal, máximo 25 palabras, sin emojis.`;
  } else if (L === "fr") {
    sys = `Tu es le MODULE MOTIVATION de “WHAT IF”.
Écris UNE phrase qui explique pourquoi la probabilité est d’environ ${pct}% dans ce scénario.
Reste cohérent avec la réponse principale, max 25 mots, sans emoji.`;
  } else {
    sys = `Du bist das MOTIVATIONSMODUL von „WHAT IF“.
Schreibe EINEN Satz, der erklärt, warum die Wahrscheinlichkeit hier etwa ${pct}% ist.
Kohärent mit der Hauptantwort, max. 25 Wörter, keine Emojis.`;
  }

  const userContent =
    L === "en"
      ? `User question: "${domanda}". Extra detail: "${clarification || ""}". Main answer: "${answer}". Now write ONE motivation sentence in ENGLISH.`
      : L === "it"
      ? `Domanda: "${domanda}". Dettaglio extra: "${clarification || ""}". Risposta principale: "${answer}". Ora scrivi UNA frase di motivazione in ITALIANO.`
      : L === "es"
      ? `Pregunta: "${domanda}". Detalle extra: "${clarification || ""}". Respuesta principal: "${answer}". Escribe UNA frase de motivación en ESPAÑOL.`
      : L === "fr"
      ? `Question: « ${domanda} ». Détail extra: « ${clarification || ""} ». Réponse principale: « ${answer} ». Écris UNE phrase de motivation en FRANÇAIS.`
      : `Frage: „${domanda}“. Zusatzdetail: „${clarification || ""}“. Hauptantwort: „${answer}“. Schreibe EINEN Motivationssatz auf DEUTSCH.`;

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

  const first = m.split(/(?<=[.!?…])\s+/)[0] || m;
  return first.trim();
}

/* ========= WTF de-cliché: cambia frigo/bollette/WhatsApp se non sono nella domanda ========= */
function deClicheWtf(answer = "", domanda = "", lang = "it") {
  const L = normLang(lang);
  if (L !== "it") return answer;

  const q = String(domanda || "").toLowerCase();
  let out = String(answer || "");

  function hasWord(word) {
    return q.includes(word.toLowerCase());
  }

  let seed = hashStr(domanda + "||" + answer) || 1;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  }

  const replSets = [
    {
      check: () => !hasWord("bolletta") && !hasWord("bollette"),
      pattern: /\bbollett[ae]\b/gi,
      options: ["conto della luce", "pdf della banca", "estratto conto che ti guarda storto"],
    },
    {
      check: () => !hasWord("whatsapp"),
      pattern: /\bwhatsapp\b/gi,
      options: ["gruppo Telegram triste", "chat muta sul telefono", "notifica silenziata da mesi"],
    },
    {
      check: () => !hasWord("frigo") && !hasWord("frigorifero"),
      pattern: /\bfrigo(rifero)?\b/gi,
      options: ["forno a microonde", "dispensa mezza vuota", "armadio della cucina che sospira"],
    },
  ];

  for (const r of replSets) {
    if (!r.check()) continue;
    if (r.pattern.test(out)) {
      const opt = r.options[Math.floor(rnd() * r.options.length)];
      out = out.replace(r.pattern, opt);
    }
  }

  return out;
}

/* ========= WTF finale: consiglio da bestemmia creativa ========= */
const WTF_ENDINGS_IT = [
  "Morale: o muovi il sedere adesso o ti lamenti a vita, eccheccazz.",
  "Quindi scegli un casino solo e portalo fino in fondo, invece di collezionare rimpianti come scontrini, azzo.",
  "In sintesi: meno pippe mentali, più gesto concreto, che la vita non è una bozza infinita, ecchecazz.",
  "Conclusione spiccia: meglio una scelta storta ma tua che una vita perfetta decisa dalla paura, porca vacca lucida.",
];

const WTF_ENDINGS_EN = [
  "Bottom line: pick a mess and own it, or stay stuck in the waiting room forever.",
  "So yeah, less overthinking, more doing, before life files you under “nice potential, never used”.",
  "In short: choose one path and walk it angry, instead of politely circling the same doubt forever.",
];

function ensureWtfEnding(answer = "", lang = "it") {
  const L = normLang(lang);
  let s = String(answer || "").trim();
  if (!s) return s;

  const lastSentenceMatch = s.match(/([^.!?…]+[.!?…])\s*$/);
  const last = (lastSentenceMatch && lastSentenceMatch[1]) || s;

  // Se già finisce con un consiglio forte, lascia
  if (/\b(quindi|morale|in sintesi|conclusione|bottom line|in short|so yeah)\b/i.test(last)) {
    return s;
  }

  const pool = L === "en" ? WTF_ENDINGS_EN : WTF_ENDINGS_IT;
  if (!pool.length) return s;

  const seed = hashStr(s) || 1;
  const extra = pool[seed % pool.length];

  s = s.replace(/[.!?…]+$/, "");
  return `${s}. ${extra}`;
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
    const body = bodyRaw && typeof req.body === "string" ? JSON.parse(bodyRaw) : req.body || {};

    const {
      stage = "answer", // "clarify" | "answer"
      domanda = "",
      clarification = "",
      stile = "whatif", // "whatif" | "wtf"
      lang = "it",
      periodo = "future", // "future" | "past"
      micro = {},
    } = body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

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
      if (stile !== "wtf") {
        clarQ = stripFirstPerson(clarQ, L, stile);
      }
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

    // Post-process
    answer = stripQuestionEcho(domanda, answer);

    if (stile === "wtf") {
      answer = tightenSentences(answer, 8);
      answer = clampWords(answer, 150);
      answer = normalizeOneParagraph(answer);
    } else {
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 120);
      answer = normalizeOneParagraph(answer);
    }

    // Moderazioni leggere IT (nomi propri)
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

    // Apertura provocatoria per WHAT THE F
    if (stile === "wtf") {
      const open = wtfOpening(domanda, L);
      if (open) {
        answer = `${open} ${answer}`;
      }
    }

    // Ripristina maiuscole frasi
    answer = sentenceCaseAll(answer);

    // Elimina prima persona narrativa per entrambi gli stili (con eccezioni gestite dentro)
    answer = stripFirstPerson(answer, L, stile);

    // Safety su "cazzo" per WHAT THE F in italiano
    if (stile === "wtf" && L === "it") {
      answer = answer.replace(/\bcazzo\b/gi, "azzo");
    }

    // De-cliché su frigo/bollette/WhatsApp per WHAT THE F
    if (stile === "wtf") {
      answer = deClicheWtf(answer, domanda, L);
      // Finale in stile "consiglio da bestemmia creativa"
      answer = ensureWtfEnding(answer, L);
    }

    // Finale gancio solo per WHAT IF lingue non-IT
    if (stile === "whatif" && L !== "it") {
      answer = ensureZingaraEnding({ text: answer, lang: L, periodo, domanda });
    }

    answer = finalPunct(answer);

    // Extra payload
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
