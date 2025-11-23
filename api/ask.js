// /api/ask.js — What?f Engine (clarify + answer, v3 super demenziale)
// - WHAT IF: pratico, “zingara realista”, 70% analisi / 30% immagini, 5–6 frasi, ~110 parole.
//   Deve SEMPRE dare almeno un consiglio operativo e guardare 2–3 punti di vista.
// - WTF: ultra demenziale, sarcastico, “barista ubriaco affettuoso”: ogni frase deve far ridere
//   (oggetti che reagiscono, metafore assurde, insulti affettuosi), 5–7 frasi, ~140 parole.
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

/* ========= Rimozione “prima persona” di sicurezza — FIX anti “tuò” ========= */
// Sostituisce SOLO pronomi/parole esatte, mai parti interne: niente più "tuò".
function stripFirstPerson(text = "", lang = "it") {
  let out = String(text || "");
  const L = normLang(lang);

  if (L === "it") {
    // pronomi soggetto/oggetto
    out = out.replace(/\b(io|me|mi)\b/gi, "tu");
    out = out.replace(/\b(noi|ci)\b/gi, "tu");
    // aggettivi/possessivi (solo parole intere)
    out = out.replace(/\bnostro\b/gi, "tuo");
    out = out.replace(/\bnostra\b/gi, "tua");
    out = out.replace(/\bnostri\b/gi, "tuoi");
    out = out.replace(/\bnostre\b/gi, "tue");
  } else {
    out = out.replace(/\b(I|me|we|us|my|our|ours)\b/gi, "you");
  }

  return out;
}

/* ========= WHAT IF – esempio ========= */
const WHATIF_HYBRID_EX_IT = `Qui la tua scelta sposta davvero il peso delle giornate. Tagli rumore, recuperi pezzi di tempo che avevi sparso in giro senza accorgertene e inizi a usare meglio le energie. Cambiano le abitudini che tieni e quelle che lasci, e ti ritrovi con una routine meno scenografica ma più vivibile. Ti accorgi di quali persone reggono la nuova versione di te e di quali restano solo sulle vecchie abitudini. Non è una rivoluzione da film: è manutenzione di vita, una manopola alla volta. E quando ti guardi indietro, il rimpianto fa meno rumore proprio nel punto in cui hai iniziato a scegliere in modo più onesto.`;

/* ========= WHAT IF – REGOLE (future/past) ========= */
const WHATIF_RULE_FUT_IT = `WHAT IF (italiano, FUTURO PRATICO COMPATTO):
- Tono: “zingara realista” ma concreta, consigliere di fiducia che ti vuole bene.
- Devi dare una risposta chiarissima: cosa succede se lo fai, cosa succede se NON lo fai, cosa succede se resti fermo.
- Priorità: 70% analisi concreta (routine, tempo, soldi, energia, relazioni, rischi) + massimo 30% immagini sobrie della quotidianità.
- APRI con UNA sola frase breve che dà il quadro generale, senza ripetere la domanda.
- La SECONDA frase inizia con una delle parole: "Vedo", "Sento", "Immagino", "Intuisco", "Si apre", "Si muove".
- Mostra almeno 2–3 angoli diversi: cosa ci guadagni se lo fai, cosa rischi, cosa perdi se non ti muovi, cosa succede se tieni tutto com’è.
- Scrivi un futuro vicino che parte da ORA: usa molto “potresti”, “inizieresti”, “probabilmente ti troveresti”.
- Se esiste un dettaglio aggiuntivo dall’utente, trattalo come vincolo principale e richiamalo almeno una volta.
- ALLA FINE devi dare almeno UN consiglio operativo concreto (“se vuoi provarci, inizia da…”, “prima di muoverti, chiarisci…”).
- Linguaggio: italiano naturale, colloquiale ma non infantile, tono caldo da amico che ti dice la verità in faccia.
- Chiudi con una frase che riassume il senso della scelta e del compromesso tra rischio e beneficio.
- 5–6 frasi, seconda persona, un solo paragrafo, frasi brevi (max ~20 parole), niente elenchi, niente emoji.`;

const WHATIF_RULE_PAST_IT = `WHAT IF (italiano, PASSATO CONTROFATTUALE PRATICO COMPATTO):
- Tono: amico lucidissimo, zero sensi di colpa, tanta chiarezza.
- Scopo: mostrare cosa sarebbe cambiato davvero se quella scelta passata fosse andata diversamente, senza drammatizzare né minimizzare.
- Usa struttura controfattuale: "se avessi…, ti saresti trovato…, avresti vissuto…, ti sarebbe costato…, avresti pagato…".
- Usa quasi solo tempi controfattuali: condizionale passato e trapassato ("ti saresti ritrovato", "ti sarebbe rimasto addosso", "avresti perso"); torna al presente solo nell’ultima frase.
- 70% analisi concreta (tempo, soldi, relazioni, identità, stress) + 30% immagini sobrie di quella vita alternativa.
- APRI con UNA frase che fa capire che stai parlando di una versione parallela di te, senza giudizio.
- Seconda frase con "Vedo", "Sento", "Immagino", "Intuisco", "Si sarebbe aperto", "Si sarebbe mosso".
- Mostra almeno 2–3 punti di vista: cosa sarebbe andato meglio, cosa ti avrebbe pesato di più, cosa avresti perso rispetto a oggi.
- Se esiste un dettaglio aggiuntivo dall’utente, trattalo come vincolo principale e richiamalo almeno una volta.
- Nessuna data inventata o evento storico specifico: resta sul tipo di esperienza.
- Alla fine riportalo dolcemente al presente: 1–2 suggerimenti concreti su cosa puoi fare adesso con quella consapevolezza.
- Linguaggio: italiano naturale, diretto, empatico ma fermo, da consigliere che ti aiuta a smettere di frullare nella testa.
- 5–6 frasi, seconda persona, un solo paragrafo, frasi brevi (max ~20 parole), niente elenchi, niente emoji. Risposta chiara, poca fuffa, molta sostanza.`;

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

/* ========= WTF — contesto leggero ========= */
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

/* Pool di IMPRECAZIONI teatrali — soft */
const WTF_IMPRE_POOL = [
  "imprecazione turboguidata che sfiora il soffitto",
  "anatema blindato a tre stadi che sposta l’aria di un metro",
  "raffica di parolacce pressurizzate con effetto sismico leggero",
  "vulcano d’anatemi in eruzione controllata ma non troppo",
  "scarica liturgica a combustione interna che mette a vibrare i vetri",
  "tsunami di improperi sussurrati ma udibili da Marte",
  "scoppio corazzato di frasi non omologate dall’ONU",
  "supernova di imprecazioni compressa in un secondo netto",
];

/* Reazioni degli oggetti — spunto interno */
const WTF_REACT_BY_CONTEXT = {
  moto: [
    "il casco in esposizione ruota piano come per vedere meglio il disastro",
    "il poster della moto piega l’angolo come per darti una pacca",
    "il cavalletto in vetrina scricchiola come un vecchio che sospira",
  ],
  ufficio: [
    "la sedia girevole fa mezzo giro da sola e si ferma a guardarti",
    "la stampante tossisce due fogli bianchi e poi sciopera",
    "il badge sbatte sul lettore e il led rosso ti guarda deluso",
  ],
  casa: [
    "il divano affonda di un centimetro solo a vederti entrare",
    "la tapparella si blocca a metà, indecisa come te",
    "il frigo ronza lungo tipo sospiro giudicante",
  ],
  città: [
    "la fermata dell’autobus finge di non conoscerti",
    "l’insegna al neon sfarfalla proprio su “casa”",
    "un piccione ti osserva come un agente immobiliare stanco",
  ],
  relazione: [
    "la chat resta incollata in alto come una spia",
    "il letto sfatto tiene due impronte che non si parlano",
    "il cuscino conserva una piega come se tenesse il posto",
  ],
  soldi: [
    "il portafoglio si chiude da solo con un colpo secco",
    "gli scontrini si aprono a ventaglio come un fascicolo",
    "la calcolatrice mostra più zeri del dovuto solo per spaventarti",
  ],
  generico: [
    "la stanza trattiene il fiato insieme a te per un secondo",
    "la giacca sulla sedia alza le spalle al posto tuo",
    "il telefono a faccia in giù vibra proprio quando non dovrebbe",
  ],
};

/* Bevute teatrali – spunti */
const WTF_DRINK_POOL = [
  "riempi un bicchiere fino al bordo e lo svuoti come se spegnessi un incendio nel cervello",
  "versi da bere con troppa convinzione, poi giù a colpi nervosi in codice Morse",
  "prendi il bicchiere più grande e lo fai sparire come una pessima idea",
  "bevi appoggiato al lavandino guardando il pavimento, come se sotto ci fosse il finale",
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
    // WHAT THE F — domanda demenziale a grammatica pulita
    if (L === "en") {
      sys = `You are “WHAT THE F”: absurd, sarcastic and weirdly caring, like a slightly drunk bartender.
You ALWAYS speak in SECOND PERSON and never use first or third person for the user.

TASK:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- Roast the SITUATION, not the person; use one silly visual and one mild swear (“what the heck”, “for real now”).
- Anchor to the specific scene (“when you stayed there”, “with that job/city”).
- ONE clean sentence; in PAST MODE keep verbs in past/counterfactual past; ONE question mark only.
- Max 20–22 words; no emojis, no lists.`;
      if (isPast) {
        sys += `
PAST MODE:
- The user refers to a past choice.
- Phrase strictly in past/counterfactual past (“back then”, “when you decided to stay”, “if you had moved”).`;
      }
    } else {
      const LANG_LABEL =
        L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

      sys = `Sei “WHAT THE F”: voce ultra demenziale, sarcastica e affettuosa, barista mezzo ubriaco.
Parli SOLO in seconda persona; vietata la prima persona e vietata la terza.

COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Prendi in giro la SITUAZIONE, non la persona; inserisci un’immagine comica e una imprecazione soft (“azz”, “porca miseria”, “che cavolo”).
- Aggancia la scena (“quando sei rimasto lì”, “con quella città”, “con quel lavoro”).
- Scrivi UNA sola frase semplice, verbi coerenti, UN solo punto interrogativo.
- Max 20–22 parole, niente emoji.`;
      if (isPast) {
        sys += `
MODALITÀ PASSATO:
- La domanda riguarda una scelta passata.
- Usa passato o controfattuale (“all’epoca”, “quando hai deciso di restare”, “se allora ti fossi mosso”).
- Mantieni i verbi nello stesso tempo; evita presente/futuro nella stessa frase.`;
      }
    }
  } else {
    // WHAT IF — chiarimento pratico
    if (L === "en") {
      sys = `You are “WHAT IF”: practical and concrete, trusted advisor energy.
SECOND PERSON only, no first or third person.

TASK:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- Target 1–2 missing details that change the answer most; anchor to the user’s scene.
- One sentence, 20–22 words max.`;
      if (isPast) {
        sys += `
PAST MODE:
- Phrase in past/counterfactual past and make clear you’re reopening that chapter.`;
      }
    } else {
      const LANG_LABEL =
        L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

      sys = `Sei “WHAT IF”: zingara realista, concreta. Seconda persona, niente prima/terza.

COMPITO:
- Fai UNA sola domanda di chiarimento in ${LANG_LABEL}.
- Punta ai dettagli che cambiano davvero la risposta (vincoli, orizzonte, obiettivo).
- Cita esplicitamente la scena (“quando sei rimasto lì”, “con quella relazione”, “con quel lavoro”).
- Una frase, 20–22 parole, niente emoji.`;
      if (isPast) {
        sys += `
MODALITÀ PASSATO:
- Formula la domanda in passato/controfattuale e indica che riapri quel capitolo preciso, non “la vita in generale”.`;
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

/* ========= WTF RULES (super demenziale, stesso tono anche al passato) ========= */
const WTF_RULE_IT_FUT = `Sei “WHAT THE F”: demenziale, sboccato ma affettuoso, barista mezzo ubriaco appoggiato al bancone.
Seconda persona SEMPRE; vietata la prima persona e vietata la terza sull’utente.

TONO:
- sarcasmo TOTALE sulla SITUAZIONE, mai sulla dignità di chi legge;
- imprecazioni comiche soft (“azz”, “porca miseria”, “che diamine”, “che casino”) usate per far ridere, non per insultare davvero;
- sembri un filosofo ubriaco che spiega la vita con paragoni assurdi ma chiarissimi.

STILE:
- monologo narrativo scorrevole, niente elenchi;
- OGNI FRASE deve contenere almeno UN elemento comico forte: oggetto che reagisce, metafora sfasata, paragone idiota ma geniale, ribaltamento improvviso;
- in almeno DUE frasi deve comparire un oggetto o luogo che reagisce (divano, telefono, sedia, città, ufficio, ecc.);
- frasi brevi e dritte; se si incastrano, spezzale.

COMPITO (FUTURO):
- Spiega da SUBITO cosa succede se ti muovi e cosa succede se resti lì come un vaso da fiori confuso.
- Mentre descrivi la scena, infila consigli storti ma utili (“se devi sbagliare, fallo con stile tuo”, “scegli il casino che puoi sopportare”).

CHIUSURA:
- Le ultime DUE frasi dicono chiaramente che casino rischi se resti fermo e cosa guadagni se ti muovi, con una battuta che prende in giro e abbraccia insieme.

FORMATO:
- 5–7 frasi, un solo paragrafo, massimo ~140 parole, niente emoji.`;

const WTF_RULE_IT_PAST = `Sei “WHAT THE F” in modalità FLASHBACK: stessa energia demenziale del futuro, ma commenti la PUNTATA PERDUTA della tua vita in PASSATO CONTROFATTUALE.
Seconda persona SEMPRE; niente prima persona e niente terza sull’utente.

REGOLE:
- Racconti una timeline alternativa usando condizionale passato e trapassato: “se ti fossi mosso”, “ti saresti ritrovato”, “avresti combinato”, “ti sarebbe esploso”.
- NON usare presente o futuro per quella timeline; puoi tornare al presente solo nelle ultime UNA-DUE frasi quando tiri le somme.
- OGNI FRASE deve far ridere: oggetti che reagiscono, paragoni assurdi, insulti affettuosi tipo “direttore generale del casino”.
- In almeno DUE frasi deve comparire un oggetto o luogo che reagisce (divano, chat, scrivania, autobus, portafoglio, ecc.).
- Frasi brevi e lineari; se una frase suona contorta, spezzala e fai due battute invece di una.

COMPITO (PASSATO):
- Racconti cosa SAREBBE successo davvero nella vita alternativa, come se commentassi una puntata di serie TV vista dal bancone.
- Devi far capire cosa ti saresti portato di buono e quale casino extra ti saresti tirato sulle spalle.

CHIUSURA:
- Le ultime DUE frasi spiegano che casino in più avresti pagato e cosa puoi imparare ORA, con una morale storta ma buona.

FORMATO:
- 5–7 frasi, un paragrafo unico, massimo ~140 parole, timeline alternativa rigorosamente al passato/controfattuale, niente emoji.`;

const WTF_RULE_EN_FUT = `You are “WHAT THE F”: absurd, foul-mouthed-but-kind bartender.
SECOND PERSON only. No first/third person.

Every sentence must have at least ONE strong comic element: reacting object, ridiculous metaphor, dumb-brilliant comparison, or warm insult about the SITUATION.
In at least TWO sentences, an object or place reacts (chair, phone, city, fridge, office, etc.).

TASK (FUTURE):
- Make it obvious what happens if they move and if they stay frozen like confused furniture.
- Drop crooked but useful advice.
- Last TWO sentences: risk of staying, gain of moving, with a warm roast.
- 5–7 sentences, ~140 words, single paragraph, no emojis.`;

const WTF_RULE_EN_PAST = `You are “WHAT THE F” in FLASHBACK MODE: same chaotic bartender, but describing an ALTERNATE TIMELINE in COUNTERFACTUAL PAST.
Use “if you had…, you would have…” and keep that tense for the alternate life.
Every sentence must be funny or absurd, with at least one strong comic element; in at least TWO sentences, an object or place reacts.

TASK (PAST):
- Describe what WOULD have unfolded in that lost episode: good baggage and extra chaos.
- Last TWO sentences say clearly which extra mess that path would have brought and what you can learn NOW, with a hug-disguised-as-insult tone.
- 5–7 sentences, ~140 words, one paragraph, no emojis.`;

/* ========= MESSAGGI RISPOSTA ========= */
function buildMessages({ domanda, clarification, lang, periodo, stile }) {
  const L = normLang(lang);
  const baseRules =
    L === "en"
      ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. SECOND PERSON ONLY (“you / your”) when you talk about the user. No first or third person. Keep grammar tight; short sentences (max ~20 words).`
      : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona (tu / ti / te / tuo) quando parli dell’utente. Vietata la prima e la terza persona. Grammatica pulita; frasi brevi (max ~20 parole). Lascia comunque un po’ di libertà alla AI per gestire immagini e ritmo, purché resti nel tono richiesto.`;

  const msgs = [{ role: "system", content: baseRules }];

  const hasClar = clarification && String(clarification).trim().length > 0;
  const c = hasClar ? String(clarification).trim() : "";
  const isPast = String(periodo).toLowerCase() === "past";

  if (stile === "wtf") {
    // seed deterministico per spunti di scena
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
        content: `ESEMPI DI TONO (spunti, non copiare):\n- imprecazione teatrale: ${impreSample}\n- oggetti che reagiscono: ${react.join(
          " · "
        )}\n- scena di bevuta: ${drinkSample}`,
      },
      {
        role: "system",
        content:
          "NEL TESTO FINALE DI WHAT THE F: usa almeno DUE oggetti o luoghi che reagiscono alla scena e fai in modo che OGNI frase contenga almeno un elemento comico evidente (immagine assurda, paragone storto, insulto affettuoso o commento sarcastico). Resti comunque aderente alla domanda e dai una risposta vera, non solo battute.",
      }
    );
  } else {
    // WHATIF consigliere di fiducia
    if (L === "it") {
      const ruleIT = isPast ? WHATIF_RULE_PAST_IT : WHATIF_RULE_FUT_IT;
      msgs.push(
        { role: "system", content: ruleIT },
        {
          role: "system",
          content:
            "NEL TESTO FINALE DI WHAT IF: mostra almeno due o tre punti di vista sulla scelta e chiudi sempre con almeno un consiglio pratico concreto, senza togliere libertà alla AI su immagini e tono finché resta realistico.",
        },
        { role: "system", content: `ESEMPIO (tono, non vincolante):\n${WHATIF_HYBRID_EX_IT}` }
      );
    }
  }

  if (hasClar) {
    if (L === "en") {
      msgs.push({
        role: "system",
        content:
          "Use the extra detail as a central constraint; do NOT repeat it verbatim. Let it make the answer sharper, not longer.",
      });
    } else {
      msgs.push({
        role: "system",
        content:
          "Usa il dettaglio aggiuntivo come vincolo centrale; NON ripeterlo parola per parola: sfruttalo per rendere la risposta più precisa, non più prolissa.",
      });
    }
  }

  // Utente finale
  const ask = (function () {
    if (L === "en") {
      if (hasClar) {
        if (isPast) {
          return `Original question about the PAST (do not repeat it): "${domanda}". Extra detail from the user (FOURTH PAGE): "${c}". Produce ONE COUNTERFACTUAL answer in ENGLISH, one paragraph. WHAT IF: 5–6 short sentences with alternate past, multiple angles and a present takeaway. WHAT THE F: 5–7 short absurd sentences in full counterfactual style, every sentence funny and the last two clearly answering the core with a warm roast.`;
        }
        return `Original question (do not repeat it): "${domanda}". Extra detail (FOURTH PAGE): "${c}". Produce ONE answer in ENGLISH, one paragraph. WHAT IF: 5–6 short sentences, several viewpoints and a clear recommendation. WHAT THE F: 5–7 short sentences, every sentence funny but still giving real advice.`;
      }
      if (isPast) {
        return `Question about the PAST (do not repeat it): "${domanda}". Produce ONE COUNTERFACTUAL answer in ENGLISH: describe the alternate timeline as if it had really happened, then extract what matters now. One paragraph.`;
      }
      return `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH. One paragraph.`;
    }
    if (L === "it") {
      if (hasClar) {
        if (isPast) {
          return `Domanda sul PASSATO (non ripeterla): "${domanda}". Dettaglio (fourth): "${c}". Genera UNA risposta CONTROFATTUALE in ITALIANO: descrivi la vita alternativa con “se avessi…, ti saresti trovato…, avresti…”, mostra più punti di vista e poi collega all’oggi. WHAT IF: 5–6 frasi; WHAT THE F: 5–7 frasi demenziali controfattuali, ogni frase deve far ridere e le ultime due devono rispondere secche al cuore della domanda.`;
        }
        return `Domanda (non ripeterla): "${domanda}". Dettaglio (fourth): "${c}". Genera UNA risposta in ITALIANO, un paragrafo. WHAT IF: 5–6 frasi, più angoli e un consiglio finale concreto. WHAT THE F: 5–7 frasi, ogni frase è una battuta ma resta attaccata alla scelta e offre comunque una direzione.`;
      }
      if (isPast) {
        return `Domanda sul PASSATO (non ripeterla): "${domanda}". Genera UNA risposta CONTROFATTUALE in ITALIANO e chiudi con cosa puoi fare oggi. Un paragrafo.`;
      }
      return `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Un paragrafo.`;
    }
    if (L === "es") {
      return hasClar
        ? `Pregunta (no la repitas): "${domanda}". Detalle (fourth): "${c}". Respuesta en ESPAÑOL, un párrafo.`
        : `Pregunta (no la repitas): "${domanda}". Respuesta en ESPAÑOL, un párrafo.`;
    }
    if (L === "fr") {
      return hasClar
        ? `Question (ne la répète pas) : « ${domanda} ». Détail (fourth) : « ${c} ». Réponse en FRANÇAIS, un seul paragraphe.`
        : `Question (ne la répète pas) : « ${domanda} ». Réponse en FRANÇAIS, un seul paragraphe.`;
    }
    // de
    return hasClar
      ? `Ursprüngliche Frage (nicht wiederholen): „${domanda}“. Zusatzdetail: „${c}“. Eine klare Antwort auf DEUTSCH, ein Absatz.`
      : `Frage (nicht wiederholen): „${domanda}“. Eine Antwort auf DEUTSCH, ein Absatz.`;
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
  const jitter = (h % 31) - 15; // -15..+15
  s += jitter;

  const pct = Math.max(10, Math.min(95, Math.round(s)));
  return pct;
}

/* ========= WHAT IF: motivazione fallback ========= */
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

    if (!pros.length) pros.push("la leva vera è la routine: piccoli passi costanti battono le grandi intenzioni");
    if (!cons.length) cons.push("il collo di bottiglia è la tua energia più che la fortuna");

    const pSentence = `Probabilità circa ${pct}%.`;
    const proConSentence = `A favore: ${pros[0]}. Contro: ${cons[0]}.`;

    return `${pSentence} ${proConSentence}`.trim();
  }

  if (L === "en") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push("the timeline is realistic if you break it into small chunks");
      cons.push("without protected time, you’ll quietly postpone it forever");
    }
    if (hasBudget) {
      pros.push("you can keep costs under control with a clear cap");
      cons.push("underestimating expenses adds pressure and slows you down");
    }
    if (hasDeadline) {
      pros.push("an explicit deadline helps you decide sooner");
      cons.push("a fuzzy deadline tends to drift");
    }
    if (action) pros.push("you have a concrete lever you can pull daily");
    if (riskHedging) {
      pros.push("simple constraints can cap the downside");
      cons.push("chasing zero risk can keep you stuck");
    }

    if (!pros.length) pros.push("the real lever is routine: small consistent steps beat big intentions");
    if (!cons.length) cons.push("your main bottleneck is energy and focus, not luck");

    const pSentence = `Estimated probability around ${pct}%.`;
    const proConSentence = `Pros: ${pros[0]}. Cons: ${cons[0]}.`;

    return `${pSentence} ${proConSentence}`.trim();
  }

  if (L === "es") {
    const pros = [];
    const cons = [];
    if (hasTime) {
      pros.push("el calendario es manejable si lo partes en pasos");
      cons.push("si no proteges tu tiempo, lo pospondrás sin fin");
    }
    if (hasBudget) {
      pros.push("puedes controlar costes con un límite claro");
      cons.push("si infravaloras los gastos, la presión te frenará");
    }
    if (hasDeadline) {
      pros.push("un plazo definido empuja a decidir");
      cons.push("un plazo difuso se desplaza");
    }
    if (action) pros.push("tienes una palanca concreta cada día");
    if (riskHedging) {
      pros.push("reglas simples limitan el riesgo");
      cons.push("buscar riesgo cero te inmoviliza");
    }
    if (!pros.length) pros.push("la rutina es la palanca real");
    if (!cons.length) cons.push("el cuello de botella es tu energía");

    return `Probabilidad aproximada ${pct}%. A favor: ${pros[0]}. En contra: ${cons[0]}.`;
  }

  if (L === "fr") {
    const pros = [];
    const cons = [];
    if (hasTime) {
      pros.push("le calendrier reste gérable si tu découpes en étapes");
      cons.push("sans temps protégé, tu repousseras à l’infini");
    }
    if (hasBudget) {
      pros.push("un plafond clair contient les coûts");
      cons.push("sous-estimer les dépenses ajoute de la pression");
    }
    if (hasDeadline) {
      pros.push("une échéance claire aide à trancher");
      cons.push("une date floue glisse facilement");
    }
    if (action) pros.push("tu as un levier concret chaque jour");
    if (riskHedging) {
      pros.push("quelques règles simples limitent le risque");
      cons.push("viser le risque zéro te fige");
    }
    if (!pros.length) pros.push("le vrai levier, c’est la routine");
    if (!cons.length) cons.push("le goulot, c’est l’énergie, pas la chance");

    return `Probabilité estimée autour de ${pct}%. Atouts: ${pros[0]}. Freins: ${cons[0]}.`;
  }

  if (L === "de") {
    const pros = [];
    const cons = [];
    if (hasTime) {
      pros.push("der Zeitplan ist machbar in kleinen Schritten");
      cons.push("ohne geschützte Zeit verschiebst du es ewig");
    }
    if (hasBudget) {
      pros.push("mit klarem Limit bleiben Kosten im Rahmen");
      cons.push("Unterschätzung erzeugt Druck");
    }
    if (hasDeadline) {
      pros.push("klare Deadline hilft früher zu entscheiden");
      cons.push("vage Frist rutscht leicht");
    }
    if (action) pros.push("du hast einen konkreten Hebel täglich");
    if (riskHedging) {
      pros.push("einfache Regeln begrenzen das Risiko");
      cons.push("Null-Risiko blockiert dich");
    }
    if (!pros.length) pros.push("der wahre Hebel ist Routine");
    if (!cons.length) cons.push("Engpass ist Energie, nicht Glück");

    return `Geschätzte Wahrscheinlichkeit etwa ${pct}%. Dafür: ${pros[0]}. Dagegen: ${cons[0]}.`;
  }

  return buildWhatIfMotivation(domanda, "it", pct);
}

/* ========= MOTIVAZIONE LLM ========= */
async function generateMotivationLLM({ domanda, clarification, answer, lang, pct }) {
  const L = normLang(lang);

  let sys;
  if (L === "en") {
    sys = `You are the MOTIVATION MODULE of “WHAT IF”.
Write ONE short sentence explaining why the probability is around ${pct}%.
Keep it consistent with the main answer. Max 25 words.`;
  } else if (L === "it") {
    sys = `Sei il MODULO MOTIVAZIONE di “WHAT IF”.
Scrivi UNA sola frase che spiega perché la probabilità è circa ${pct}%.
Deve essere coerente con la risposta principale. Max 25 parole.`;
  } else if (L === "es") {
    sys = `Eres el MÓDULO DE MOTIVACIÓN de “WHAT IF”.
Escribe UNA sola frase que justifique aproximadamente ${pct}%.
Debe ser coherente con la respuesta principal. Máx 25 palabras.`;
  } else if (L === "fr") {
    sys = `Tu es le MODULE MOTIVATION de “WHAT IF”.
Écris UNE seule phrase expliquant pourquoi la probabilité est d’environ ${pct}%.
Cohérente avec la réponse principale. Max 25 mots.`;
  } else {
    sys = `Du bist das MOTIVATIONSMODUL von „WHAT IF“.
Schreibe EINEN Satz, der etwa ${pct}% begründet.
Er muss zum Haupttext passen. Maximal 25 Wörter.`;
  }

  const userContent =
    L === "en"
      ? `User question: "${domanda}". Extra detail: "${clarification || ""}". Main answer: "${answer}". Now write ONE motivation sentence in ENGLISH.`
      : L === "it"
      ? `Domanda dell’utente: "${domanda}". Dettaglio aggiuntivo: "${clarification || ""}". Risposta principale: "${answer}". Ora scrivi UNA frase di motivazione in ITALIANO.`
      : L === "es"
      ? `Pregunta del usuario: "${domanda}". Detalle adicional: "${clarification || ""}". Respuesta principal: "${answer}". Ahora escribe UNA frase de motivación en ESPAÑOL.`
      : L === "fr"
      ? `Question de l’utilisateur : « ${domanda} ». Détail complémentaire : « ${clarification || ""} ». Réponse principale : « ${answer} ». Écris maintenant UNE phrase de motivation en FRANÇAIS.`
      : `Frage des Nutzers: „${domanda}“. Zusatzdetail: „${clarification || ""}“. Hauptantwort: „${answer}“. Schreibe jetzt EINEN Motivationssatz auf DEUTSCH.`;

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
      clarQ = stripFirstPerson(clarQ, L);
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

    /* ====== STAGE: ANSWER ====== */
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
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 140);
      answer = normalizeOneParagraph(answer);
    } else {
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

    // Strip di sicurezza della prima persona — FIX evita “tuò”
    answer = stripFirstPerson(answer, L);

    // Finale “hook” per WHAT IF non-italiano
    if (stile === "whatif" && L !== "it") {
      answer = ensureZingaraEnding({ text: answer, lang: L, periodo, domanda });
    }

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
