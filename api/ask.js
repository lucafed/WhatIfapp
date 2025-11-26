// /api/ask.js — What?f Engine (clarify + answer + polish)
// - WHATIF: analisi scenari + consigli pratici (veggente zingaro di strada).
// - WTF: narratore/barista filoso incazzato, stile esempi (Motociclista, Luisa, Turista del destino).
// - SORPRENDIMI: domande assurde “intelligenti”, varie, non ripetute.

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
  if (!/[.!?…]$/.test(t) && t) t += ".";
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

/* ========= Rimozione “prima persona” (solo WHAT IF) ========= */
function stripFirstPerson(text = "", lang = "it", stile = "whatif") {
  if (stile === "wtf") return text;
  let out = String(text || "");
  const L = normLang(lang);

  if (L === "it") {
    out = out.replace(/\b(io|me|mi|noi|ci)\b/gi, "tu");
    out = out.replace(/\b(mio|mia|miei|mie|nostro|nostra|nostri|nostre)\b/gi, "tuo");
  } else {
    out = out.replace(
      /\b(I|I'm|I’d|I've|me|my|we|we're|we’ve|we’d|us|our|ours)\b/gi,
      "you"
    );
  }

  return out;
}

/* ========= WHAT IF – esempio (veggente zingaro di strada) ========= */
const WHATIF_HYBRID_EX_IT = `Da come si muove questa scelta si sente che non è solo un capriccio di giornata. Se ti ci buttassi davvero, la routine cambierebbe ritmo, taglieresti rumore e ti accorgeresti di quanta energia stavi sprecando a tenerla in sospeso. Se invece la lasciassi lì a galleggiare, resterebbe come una sedia vuota in mezzo alla stanza: non rovina tutto, ma ti intralcia ogni passo. Alla fine la vista è semplice: meno scenografia, più vita gestibile, e una versione di te che fa meno finta di niente.`;

/* ========= WHAT IF – REGOLE (veggente zingaro) ========= */
const WHATIF_RULE_FUT_IT = `WHAT IF (italiano, FUTURO – VEGGENTE ZINGARO DI STRADA: SCENARI + CONSIGLI):
- Tono: veggente zingaro di strada, diretto e concreto, con una sensibilità che “vede dietro” le situazioni ma resta coi piedi per terra.
- Apertura: le prime parole commentano ciò che percepisci dalla domanda o dall’aria della situazione (“Da come la racconti si sente che…”, “Qui si vede subito che…”). Varia sempre la formula, non usare frasi fisse.
- Compito: prima analizzi gli scenari:
  • cosa succede se lo fai;
  • cosa succede se NON lo fai;
  • cosa succede se lo rimandi ancora;
  • eventuale scenario “via di mezzo”.
- Guarda l’impatto su tempo, energie, soldi, relazioni, identità e rischi concreti, come uno che la vita l’ha vista da vicino.
- Poi prendi posizione: spiega quale scenario ha più senso adesso e perché, senza girarci intorno.
- Chiudi con 2–3 consigli pratici su come muoverti nei prossimi passi, in stile “regole semplici da rispettare”.
- Linguaggio: italiano naturale, zero frasi spiritualone generiche e zero motivazionalese da poster; se dici che “senti” o “vedi” qualcosa, aggancialo sempre a dettagli concreti.
- 5–7 frasi, un paragrafo, frasi brevi (~20 parole max), niente elenchi, niente emoji.
- Niente prima persona narrativa (“io, noi, mi, ci”).`;

const WHATIF_RULE_PAST_IT = `WHAT IF (italiano, PASSATO CONTROFATTUALE – VEGGENTE ZINGARO: SCENARIO ALTERNATIVO + LEZIONE):
- Tono: veggente zingaro di strada che ti fa vedere il film alternativo senza schiacciarti di sensi di colpa.
- Apertura: parti da quello che percepisci dalla storia (“Raccontata così, quella scelta avrebbe cambiato parecchio l’aria intorno a te…”), in modo naturale.
- Compito: descrivi come sarebbe andata se quella scelta l’avessi fatta davvero:
  • in cosa ti saresti trovato meglio;
  • quali pesi nuovi ti saresti messo addosso;
  • cosa avresti perso rispetto a oggi.
- Usa in modo costante la struttura controfattuale (“se avessi…, ti saresti trovato…, avresti pagato…, ti saresti ritrovato…”).
- Poi porta tutto nel presente: cosa impari guardando quel film alternativo, cosa puoi ancora scegliere adesso, come ti conviene muoverti per non ripetere lo stesso schema.
- Linguaggio: diretto, concreto, niente melodramma, niente giudizi morali da tribunale.
- 5–7 frasi, un paragrafo, frasi brevi, niente elenchi, niente emoji.
- Niente prima persona narrativa (“io, noi, mi, ci”).`;

/* ========= Finali “gancio” WHAT IF (solo non-IT) ========= */
const ZINGARA_ENDINGS = {
  it: { future: [], past: [] },
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

/* ========= WTF: stile ufficiale (few-shot) ========= */

const WTF_STYLE_EXAMPLES_IT = `Esempio 1:
"Ah, eccoci, centauro dell’inferno. Casco lucido, petto in fuori e cervello rimasto indietro di due curve. Parti, il vento ti fa sentire un dio… poi un’ape ti punta il collo come se avessi firmato un contratto. Ti scappa una “bestemmia a motore caldo!” così forte che il semaforo cambia colore per rispetto. Torni al bar, ordini qualcosa che lavi via la giornata, e il barista annuisce come uno che ha visto troppo, ecchecazz!!!"

Esempio 2:
"Oh, Luisa… eccoci, come una cicatrice che si diverte a riaprirsi. Lei visualizza, poi sparisce, e a te sale una “bestemmia della miseria incrociata” che fa tremare la lampada. Il bicchiere applaude, il gatto cambia stanza, Alexa finge un aggiornamento. Finisci il sorso, guardi il vuoto, e riconosci che certe storie sono fatte per finire con un brindisi storto, ecchecazz!!!"

Esempio 3:
"Oh, eccoti, turista del destino con la valigia piena di ‘poi vediamo’. Torni a casa e ti parte una “bestemmia di ritorno” così rotonda che il piccione sul cornicione smette di giudicarti. Il barista ti serve il bicchiere come se timbrasse il cartellino del tuo rientro nella vita vera. Se fai il passo i vicoli ti si appiccicano addosso; se resti dov’eri, passi le sere a fissare il muro mentre il citofono tace apposta. O rientri nel film o resti la comparsa dei tuoi stessi pensieri, ecchecazz!!!"`;

/* ========= WTF: stop words & keyword helper ========= */
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
  "se",
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
    if (w.length < 4) continue;
    if (WTF_STOP_IT.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 6) break;
  }
  return out;
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
    return `Rapporto scientific-ish: ${u} (n=${n}) ha scoperto che una “${e}” migliora la chiarezza decisionale (${m}). Revisionato da ${j}, più o meno.`;
  }
  return `Rapporto scientifico (più o meno): ${u} (n=${n}) rileva che una “${e}” migliora la chiarezza decisionale (${m}). Revisione a cura di ${j}, forse.`;
}

/* ========= SORPRENDIMI – messaggi: CLARIFY ========= */
function buildClarifyMessages({ domanda, stile, lang, periodo, micro = {} }) {
  const L = normLang(lang);
  const isPast = String(periodo).toLowerCase() === "past";
  const isSurprise = !!(micro && (micro.surprise === true || micro.src === "surprise"));

  let sys;

  if (isSurprise) {
    if (stile === "wtf") {
      if (L === "en") {
        sys = `You are “WHAT THE F”: a rough, foul-mouthed but strangely wise narrator.
You roast the situation, not the person, with absurd images and playful swearing, never attacking groups or identities.

SURPRISE MODE (ABSURD SMART QUESTION):
- Ask EXACTLY ONE clarifying question in ENGLISH.
- It must be weird, playful, almost surreal, but still secretly connected to the real decision.
- Use at most ONE tiny scene with objects reacting (bar, fridge, lamp, phone…), like a snapshot.
- Every time, invent from scratch: do NOT reuse the same metaphors or formulas.
- One sentence, max 22 words, no emojis, no bullet points.
- Do NOT end with “ecchecazz!!!”.`;
        if (isPast) {
          sys += `
PAST MODE:
- Make it clear you’re pointing back to that previous chapter (“back then”, “in that phase”, etc.).`;
        }
      } else {
        const LANG_LABEL =
          L === "it"
            ? "ITALIANO"
            : L === "es"
            ? "SPAGNOLO"
            : L === "fr"
            ? "FRANCESE"
            : "TEDESCO";

        sys = `Sei “WHAT THE F”: narratore/barista filoso incazzato, nello stesso tono degli esempi qui sotto (NON copiare le frasi, imita solo il respiro):

${WTF_STYLE_EXAMPLES_IT}

MODALITÀ SORPRENDIMI (DOMANDA ASSURDA “INTELLIGENTE”):
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- La domanda deve essere assurda ma non gratuita: scena strana, oggetti che reagiscono, però legata alla scelta vera.
- Puoi usare UNA micro-scenetta (es. frigorifero che ti giudica, citofono che sospira, barista che alza il sopracciglio).
- Ogni volta devi inventare una scena nuova: NON riutilizzare le stesse metafore, oggetti o formule.
- Niente morale, niente “consigli”: solo una domanda.
- Una sola frase, massimo 22 parole, niente emoji, niente elenco.
- NON chiudere con “ecchecazz!!!”.
- Puoi nominare la parola “bestemmia” in modo narrato, ma MAI bestemmie reali o riferimenti religiosi.`;
        if (isPast) {
          sys += `
MODALITÀ PASSATO:
- Fai capire che ti riferisci a “quel periodo”, “quel capitolo” o alla strada non presa.`;
        }
      }
    } else {
      // WHAT IF – Sorprendimi
      if (L === "en") {
        sys = `You are “WHAT IF”: a very clear, grounded advisor.
You care about real-life constraints and practical advice, not poetry.

SURPRISE MODE:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- Concrete and useful, but with a slightly unusual angle the user wouldn’t normally consider alone.
- Avoid cliché patterns like “what do you really want”.
- Focus on ONE main lever: time, money, energy, identity, relationships or risk.
- One calm, precise sentence, max 22 words, no emojis, no bullets.
- Do not use first-person narration (“I, we”).`;
        if (isPast) {
          sys += `
PAST MODE:
- Make clear you refer to that former chapter or missed path.`;
        }
      } else {
        const LANG_LABEL =
          L === "it"
            ? "ITALIANO"
            : L === "es"
            ? "SPAGNOLO"
            : L === "fr"
            ? "FRANCESE"
            : "TEDESCO";

        sys = `Sei “WHAT IF”: veggente zingaro di strada, diretto ma concreto. Vedi dietro le scelte, ma ti interessano i vincoli veri e i consigli pratici.

MODALITÀ SORPRENDIMI:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Deve essere concreta ma con un angolo insolito che l’utente da solo non si chiederebbe.
- Evita frasi da self-help tipo “cosa vuoi davvero”.
- Concentrati su UNA leva (tempo, soldi, energia, identità, relazioni, rischio).
- Una sola frase, tono calmo, massimo 22 parole, niente emoji, niente elenco.
- Evita la prima persona narrativa (“io, noi, mi, ci”).`;
        if (isPast) {
          sys += `
MODALITÀ PASSATO:
- La domanda riguarda una scelta passata o una strada non presa.`;
        }
      }
    }
  }

  if (!isSurprise) {
    if (stile === "wtf") {
      if (L === "en") {
        sys = `You are “WHAT THE F”: a rough, foul-mouthed but strangely wise narrator.
You roast the situation, not the person, with absurd images and playful swearing, never attacking identities or groups.

TASK:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- It should sound like a half-roast, half-care line thrown across the counter.
- One sentence, max 22 words, no emojis, no bullets.
- Do NOT end with “ecchecazz!!!”.`;
        if (isPast) {
          sys += `
PAST MODE:
- The question is about a past choice or missed path.`;
        }
      } else {
        sys = `Sei “WHAT THE F”: narratore filoso incazzato nello stesso tono degli esempi (Motociclista, Luisa, Turista del destino).
Parli come se stessi raccontando la scena della vita di chi legge, con immagini esagerate e oggetti che reagiscono.
Prendi in giro la SITUAZIONE, non la dignità di chi legge.
Puoi citare la parola “bestemmia” in modo narrato (“ti parte una bestemmia cosmica”), ma NON scrivere bestemmie reali o riferimenti religiosi.
Niente “madò”.

COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ITALIANO.
- Deve sembrare una domanda buttata lì al bancone: mezza presa in giro, mezza verità che punge.
- Una frase sola, massimo 22 parole, niente emoji, niente elenco.
- Non chiudere con “ecchecazz!!!”.`;
        if (isPast) {
          sys += `
MODALITÀ PASSATO:
- La domanda riguarda una scelta passata o una strada non presa.`;
        }
      }
    } else {
      // WHAT IF normale
      if (L === "en") {
        sys = `You are “WHAT IF”: a very clear, grounded advisor.
You care about real-life constraints and want to give useful, practical advice, not poetry.

TASK:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- Focus on 1–2 key details that change the analysis.
- Calm, precise tone. One sentence, max 22 words, no emojis, no bullets.
- Do not use first-person narration (“I, we”).`;
        if (isPast) {
          sys += `
PAST MODE:
- Question is about a past choice or missed path.`;
        }
      } else {
        const LANG_LABEL =
          L === "it"
            ? "ITALIANO"
            : L === "es"
            ? "SPAGNOLO"
            : L === "fr"
            ? "FRANCESE"
            : "TEDESCO";

        sys = `Sei “WHAT IF”: veggente zingaro di strada che ragiona bene sui pro e contro.
Vedi cosa c’è dietro la scena, ma ne parli in modo semplice e concreto.
Mantieni grammatica pulita ed evita ripetizioni inutili.

COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Punta su 1–2 dettagli che spostano davvero l’analisi.
- Tono calmo, preciso, senza fronzoli. Una sola frase, massimo 22 parole, niente emoji, niente elenco.
- Evita la prima persona narrativa (“io, noi, mi, ci”).`;
        if (isPast) {
          sys += `
MODALITÀ PASSATO:
- La domanda riguarda una scelta passata o una strada non presa.`;
        }
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

/* ========= WTF RULES (risposte, non Sorprendimi) ========= */

const WTF_RULE_IT_FUT = `Sei “WHAT THE F”: narratore/barista filoso incazzato che parla ESATTAMENTE con il respiro degli esempi seguenti (non copiare frasi, imita ritmo, voce, struttura):

${WTF_STYLE_EXAMPLES_IT}

TONO:
- Apertura teatrale che chiama in causa (“Oh, eccoci…”, “Ah, …eccoci di nuovo…”).
- Seconda persona: “ti scappa”, “ti parte”, “ti ritrovi”, “resti fermo”, “ogni giorno che perdi…”.
- Oggetti e ambiente reagiscono (semaforo, bicchiere, lampada, cane, Alexa, barista, citofono, piazza, piccione…), massimo 3 elementi per risposta.
- Una sola “bestemmia” narrata, creativa e tra virgolette (“bestemmia di ritorno”, “bestemmia della miseria incrociata”), MAI bestemmie reali.
- Nessun riferimento religioso diretto (niente dio, santi, madonne, cristi, ecc.).
- NON racchiudere l’intera risposta fra virgolette: usa le virgolette solo intorno alla bestemmia narrata o a battute/frasette citate.
- Evita parole zuccherose o da coach tipo “abbraccio dell’universo”, “coccola inaspettata”, “gocce di libertà”, “anima che si apre”, “allegria nel cuore”.
- Evita termini teorici come “procrastinazione”, “mindset”, “accettazione radicale”.
- Non usare “rimando” come sostantivo.
- Sarcasmo affettuoso: prendi a schiaffi la SITUAZIONE, non la dignità di chi legge.
- Zero insulti a categorie o identità, zero odio, niente “madò”.
- Non inventare parole senza senso: se usi termini strani, devono essere comprensibili dal contesto (es. “bestemmia di ritorno”).

COMPITO (FUTURO):
- Devi SEMPRE mostrare DUE film distinti:
  • cosa succede se fai DAVVERO questa scelta (es. torni all’Aquila, cambi lavoro, ti butti);
  • cosa succede se resti dove sei e continui a tirarla lunga.
- Nei due film devono cambiare ambienti, gesti e sensazioni: non basta cambiare aggettivi.
- Usa immagini fisiche (piazza, casa, bar, divano, citofono, vicoli, autobus, corridoi) per rendere la differenza tra muoverti e restare fermo.
- La morale finale resta dentro la scena (rumore di fondo, doppia fila emotiva, ospite nella tua vita), non in teoria astratta.

FORMATO:
- 3–4 frasi, un solo paragrafo, circa 70–95 parole.
- Italiano parlato ma corretto, niente elenchi, niente emoji.
- L’ULTIMA frase chiude con una mini-morale cinica ma concreta legata a un gesto/oggetto e termina con “ecchecazz!!!” (tutto attaccato, tre punti esclamativi).`;

const WTF_RULE_IT_PAST = `Sei “WHAT THE F” in modalità FLASHBACK, stessa voce degli esempi (Motociclista, Luisa, Turista del destino), ma applicata alla vita alternativa in cui avevi fatto l’altra scelta.

TONO:
- Racconti quella stagione come una serie già uscita: mezzo epica, mezzo disastro.
- Seconda persona: “ti saresti ritrovato”, “ti sarebbero esplose in faccia”, “avresti passato le sere…”.
- Oggetti e ambiente fanno coro (scrivania, divano, bicchiere, telefono, pianta grassa, citofono, semaforo, barista…).
- 1 “bestemmia” solo narrata, con aggettivi strani (“bestemmia nostalgica”, “bestemmia di bilancio”), mai reale.
- NESSUN riferimento religioso diretto.
- Virgolette solo intorno alla bestemmia narrata o battute, mai intorno a tutto il testo.
- Evita frasi zuccherose o spiritualone.
- Niente “procrastinazione”, niente definizioni astratte del tipo “vivere vuol dire… / significa che…”.
- Non usare “rimando” come sostantivo.
- Sarcasmo forte ma non spietato: si ride del casino, non della persona.
- Non inventare parole a caso: se crei espressioni, devono avere senso (es. “bestemmia di bilancio”).

COMPITO (PASSATO):
- Descrivi come sarebbe andata se quella scelta l’avessi fatta: cosa avresti guadagnato, dove ti saresti incastrato, cosa ti sei pure risparmiato.
- Usa sempre un registro controfattuale coerente (“se avessi…, ti saresti ritrovato…, avresti passato…, ti sarebbero piovute addosso…”).
- Porta la scena fino a oggi: guardi quella vita alternativa da fuori e capisci qualcosa.
- L’ULTIMA frase chiude con consapevolezza appoggiata a una scena concreta e finisce con “ecchecazz!!!”.

FORMATO:
- 3–4 frasi, un solo paragrafo, circa 70–95 parole.
- Nessun elenco, nessuna emoji.`;

const WTF_RULE_EN_FUT = `You are “WHAT THE F”: a rough, foul-mouthed but very cultured and pissed-off narrator.
You roast every decision with love and swear words, but never attack identities or groups.

TASK (FUTURE):
- Show what happens if they actually do this and what happens if they keep delaying.
- Turn the scene into a mini-episode, not a novel.
- Last sentence: blunt, foul-mouthed, like a crooked summary.

FORMAT:
- 3–5 sentences, one paragraph, max ~120 words.
- No echo of the question, no emojis.`;

const WTF_RULE_EN_PAST = `You are “WHAT THE F” in FLASHBACK MODE:
you’re recapping the lost season of their life where they made the other choice.

TASK (PAST):
- Describe what WOULD have happened if they’d gone that way.
- End with a blunt, foul-mouthed line about what makes sense today.

FORMAT:
- 3–5 sentences, one paragraph, max ~120 words.
- No echo of the question, no emojis.`;

/* ========= MESSAGGI RISPOSTA ========= */
function buildMessages({ domanda, clarification, lang, periodo, stile }) {
  const L = normLang(lang);
  const isWtf = stile === "wtf";
  const isPast = String(periodo).toLowerCase() === "past";
  const hasClar = clarification && String(clarification).trim().length > 0;
  const c = hasClar ? String(clarification).trim() : "";

  const baseRules = isWtf
    ? L === "en"
      ? `RULES WTF:
- Single paragraph, no bullets, no emojis.
- Do NOT restate the question.
- Strong, vivid, sometimes ridiculous images.
- Swearing allowed but playful, never hateful, never targeting protected groups or identities.
- Keep grammar readable and avoid repeating the same word too many times.`
      : `REGOLE GENERALI WTF:
- Un solo paragrafo, niente elenchi, niente emoji.
- NON ripetere la domanda.
- Seconda persona protagonista (“ti scappa”, “ti parte”, “ti ritrovi…”).
- Puoi usare parolacce generiche, ma MAI bestemmie reali: solo la parola “bestemmia” con aggettivi creativi, come negli esempi.
- Nessun insulto a categorie o identità, zero odio.
- Evita parole zuccherose (“abbraccio”, “coccola”, “gocce di libertà”, “anima che si apre”, “allegria nel cuore”).
- Evita termini come “procrastinazione”, “mindset”, “accettazione radicale”.
- Non usare “rimando" come sostantivo.
- Non racchiudere l’intero testo tra virgolette: usa le virgolette solo su bestemmie narrate o frasi riportate.
- Non inventare parole senza senso (niente “toenassi”): qualsiasi espressione strana deve essere chiara dal contesto (es. “bestemmia di ritorno”).`
    : L === "en"
    ? `RULES WHAT IF:
- Single paragraph, no bullets, no emojis.
- Do NOT restate the question.
- SECOND PERSON (“you / your”) for the user.
- Avoid first person (“I, me, we, us”).
- Grammar clean, few repetitions, short sentences (~20 words max).`
    : `REGOLE WHAT IF:
- Un solo paragrafo, niente elenchi, niente emoji.
- NON ripetere la domanda.
- Usa la seconda persona (tu / ti / te / tuo).
- Niente prima persona narrativa (“io, noi, mi, ci”).
- Frasi brevi (~20 parole), grammatica pulita, poche ripetizioni.`;

  const msgs = [{ role: "system", content: baseRules }];

  if (isWtf) {
    const kw = wtfKeywords(domanda);

    const wtfRule =
      L === "en"
        ? isPast
          ? WTF_RULE_EN_PAST
          : WTF_RULE_EN_FUT
        : isPast
        ? WTF_RULE_IT_PAST
        : WTF_RULE_IT_FUT;

    msgs.push({ role: "system", content: wtfRule });

    if (kw.length && L === "it") {
      msgs.push({
        role: "system",
        content: `PAROLE CHIAVE DALLA SCENA UTENTE: ${kw.join(
          ", "
        )}. Usa 1–2 di questi elementi per immagini e metafore, nello stile degli esempi (Motociclista, Luisa, Turista del destino). Evita di fissarti sempre sugli stessi oggetti.`,
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
          "La risposta di quarta pagina è contesto centrale: usala per capire obiettivi e vincoli, ma NON citarla né riassumerla.",
      });
    } else if (L === "en") {
      msgs.push({
        role: "system",
        content:
          "The fourth-page answer is central context: use it to understand goals and constraints, but do NOT quote or summarize it.",
      });
    } else {
      msgs.push({
        role: "system",
        content:
          "La risposta extra dell’utente è contesto importante: usala per orientare l’analisi, senza citarla o riassumerla in modo diretto.",
      });
    }
  }

  const ask = (function () {
    if (L === "en") {
      if (isWtf) {
        if (hasClar) {
          return `Original question (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE absurd, brutally honest answer in ENGLISH as “WHAT THE F”. Single paragraph, 3–5 sentences, loud, sarcastic, messy but secretly wise. Show what happens if they do it and if they keep dodging it, then close with a crooked but clear piece of advice.`;
        }
        return `Question (do not repeat it): "${domanda}". Write ONE answer in ENGLISH as “WHAT THE F”. Single paragraph, 3–5 sentences, extremely ironic and over-the-top, but still answering what happens with this choice and what you’d recommend.`;
      }
      if (hasClar) {
        if (isPast) {
          return `Original question about the PAST (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE COUNTERFACTUAL answer in ENGLISH as “WHAT IF”: describe the alternate timeline, then extract what matters now and give practical advice.`;
        }
        return `Original question (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE answer in ENGLISH as “WHAT IF”: first analyse different scenarios, then clearly suggest what makes more sense and how to act.`;
      }
      if (isPast) {
        return `Question about the PAST (do not repeat it): "${domanda}". Write ONE COUNTERFACTUAL answer in ENGLISH.`;
      }
      return `Question (do not repeat it): "${domanda}". Write ONE answer in ENGLISH as “WHAT IF”: analyse different scenarios and then give clear, practical advice.`;
    }

    if (L === "it") {
      if (isWtf) {
        if (hasClar) {
          return `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo (quarta pagina): "${c}".
Genera UNA risposta in ITALIANO come voce “WHAT THE F”, nello stesso stile degli esempi (Motociclista, Luisa, Turista del destino):
- monologo unico, 3–4 frasi, circa 70–95 parole;
- apertura teatrale che chiama in causa chi legge;
- DEVI mostrare due film distinti: uno in cui fai davvero questa scelta, uno in cui resti fermo e continui a tirarla lunga;
- usa 2–3 oggetti/elementi dell’ambiente che reagiscono (bicchiere, lampada, cane, Alexa, semaforo, barista, piazza, citofono, divano…);
- inserisci UNA sola “bestemmia” narrata, creativa e tra virgolette, senza riferimenti religiosi reali;
- niente parole zuccherose né frasi teoriche tipo “vivere vuol dire / significa che…”;
- niente parole inventate senza senso, niente “rimando” come sostantivo;
- l’ULTIMA frase chiude con una mini-morale concreta legata a una scena e termina con “ecchecazz!!!”.
Paragrafo unico, niente emoji.`;
        }
        return `Domanda (non ripeterla): "${domanda}".
Genera UNA risposta in ITALIANO come voce “WHAT THE F”, identica come tono agli esempi (Motociclista, Luisa, Turista del destino):
- monologo unico, 3–4 frasi, circa 70–95 parole;
- tu sei il narratore che racconta la vita di chi legge in seconda persona;
- DEVI far vedere il film di cosa succede se lo fai e il film di cosa succede se continui a tirarla lunga;
- usa pochi oggetti ma molto vivi che reagiscono (lampada, bicchiere, cane, Alexa, citofono, piazza, barista…);
- inserisci UNA sola “bestemmia” narrata, mai reale, senza religione;
- niente motivazionalese, niente “procrastinazione”, niente “rimando” come sostantivo, niente “vivere vuol dire…”;
- nessuna parola inventata senza senso;
- l’ULTIMA frase chiude la scena con una riga secca e finisce con “ecchecazz!!!”.
Paragrafo unico, niente emoji.`;
      }

      if (hasClar) {
        if (isPast) {
          return `Domanda sul PASSATO (non ripeterla): "${domanda}". Dettaglio aggiuntivo (quarta pagina): "${c}". Genera UNA risposta CONTROFATTUALE in ITALIANO come “WHAT IF” (veggente zingaro di strada): racconta come sarebbe andata davvero in quella vita alternativa e poi spiega cosa impari e come ti conviene muoverti ORA. Paragrafo unico, 5–7 frasi, analisi concreta e consigli pratici.`;
        }
        return `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo (quarta pagina): "${c}". Genera UNA risposta in ITALIANO come “WHAT IF” (veggente zingaro di strada): prima analizzi i possibili scenari (se lo fai, se non lo fai, se lo rimandi, se lo fai in modo diverso), poi prendi posizione su cosa ha più senso e dai consigli pratici su come comportarti. Paragrafo unico, 5–7 frasi, tono diretto ma con una sensibilità che “vede dietro” le cose.`;
      }
      if (isPast) {
        return `Domanda sul PASSATO (non ripeterla): "${domanda}". Genera UNA risposta CONTROFATTUALE in ITALIANO come “WHAT IF” (veggente zingaro di strada): descrivi come sarebbe andata quella scelta e chiudi spiegando cosa puoi farci oggi, in modo concreto. Paragrafo unico.`;
      }
      return `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO come “WHAT IF” (veggente zingaro di strada): analizza i diversi scenari possibili e poi dai consigli chiari su cosa fare e come comportarti nei prossimi passi. Paragrafo unico.`;
    }

    if (L === "es") {
      return hasClar
        ? `Pregunta original (no la repitas): "${domanda}". Detalle adicional del usuario: "${c}". Escribe UNA respuesta en ESPAÑOL, clara y concreta, en un solo párrafo.`
        : `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, en un solo párrafo.`;
    }
    if (L === "fr") {
      return hasClar
        ? `Question originale (ne la répète pas) : « ${domanda} ». Détail supplémentaire : « ${c} ». Donne UNE réponse en FRANÇAIS, claire et concrète, en un seul paragraphe.`
        : `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, en un seul paragraphe.`;
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
      cons.push("se non proteggi il tempo, rischi di tirarla lunga all’infinito");
    }
    if (hasBudget) {
      pros.push("puoi tenere i costi sotto controllo fissando un tetto chiaro");
      cons.push("se sottostimi le spese, la pressione economica può frenarti");
    }
    if (hasDeadline) {
      pros.push("una scadenza esplicita ti aiuta a decidere prima");
      cons.push("se la scadenza è vaga tenderai a spostarla sempre più avanti");
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

/* ========= POLISH ========= */
async function polishAnswer({ text, lang, stile }) {
  let s = String(text || "").trim();
  if (!s) return s;

  const L = normLang(lang);

  let sys;
  if (L === "it") {
    sys =
      stile === "wtf"
        ? `Sei un correttore di bozze per un monologo colorito nello stile degli esempi (Motociclista, Luisa, Turista del destino).
Prendi il testo seguente e:
- mantieni intatto il tono da narratore filoso incazzato, le parolacce e le immagini;
- correggi solo errori grammaticali evidenti, concordanze, doppioni di parole, ripetizioni troppo ravvicinate;
- NON aggiungere nuove metafore;
- mantieni lunghezza simile e un unico paragrafo;
- NON trasformare “bestemmia” in bestemmie reali o riferimenti religiosi;
- non racchiudere tutto il testo tra virgolette.`
        : `Sei un correttore di bozze.
Prendi il testo seguente e:
- mantieni intatto senso e tono;
- correggi errori grammaticali e ripetizioni inutili;
- mantieni un unico paragrafo e lunghezza simile.`;
  } else if (L === "en") {
    sys =
      stile === "wtf"
        ? `You are a copy editor for a foul-mouthed monologue.
Keep the same tone and swearing, only fix clear grammar issues and obvious word repetition. Keep it one paragraph, similar length.`
        : `You are a copy editor.
Keep the same meaning and tone, fix grammar and useless repetitions. Keep it one paragraph, similar length.`;
  } else {
    sys = `You are a copy editor.
Keep the same tone and meaning, fix obvious grammar errors and unnecessary repetitions.
Keep it one paragraph and roughly the same length.`;
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: s.split(/\s+/).length + 80,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: s },
    ],
  });

  let out = completion?.choices?.[0]?.message?.content?.trim() || s;
  out = normalizeOneParagraph(out);
  return out;
}

/* ========= Finale WTF con ecchecazz!!! + pulizia virgolette ========= */
function ensureWtfEcchecazzEnding(text = "", lang = "it") {
  let s = String(text || "").trim();
  if (!s) return "ecchecazz!!!";

  // togli virgolette all'inizio/fine del blocco
  s = s.replace(/^["“”']+/, "").replace(/["“”']+$/, "").trim();

  // togli eventuali ecchecazz duplicati già presenti
  s = s.replace(/\s*ecchecazz!+$/gi, "");

  // togli eventuali "ecc" / "ecc." finali tipo "ecc," "ecc."
  s = s.replace(/\s*ecc[.,!?…]*$/gi, "");

  // togli punti finali, spazi e segni vari
  s = s.replace(/[\s.!?…]+$/g, "").trim();
  if (!s) return "ecchecazz!!!";

  return `${s}, ecchecazz!!!`;
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

    if (!domаnda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const L = normLang(lang);

    /* ====== STAGE: CLARIFY ====== */
    if (stage === "clarify") {
      const messages = buildClarifyMessages({ domanda, stile, lang: L, periodo, micro });

      const isSurprise = micro && (micro.surprise === true || micro.src === "surprise");

      let temperature = stile === "wtf" ? 1.0 : 0.7;
      let top_p = 0.96;
      let frequency_penalty = stile === "wtf" ? 0.8 : 0.2;
      let presence_penalty = stile === "wtf" ? 0.7 : 0.1;

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature,
        top_p,
        max_tokens: 80,
        frequency_penalty,
        presence_penalty,
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

    /* ====== STAGE: ANSWER ====== */
    const messages = buildMessages({ domanda, clarification, lang: L, periodo, stile });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.8,
      top_p: stile === "wtf" ? 0.96 : 0.92,
      max_tokens: 260,
      frequency_penalty: stile === "wtf" ? 0.6 : 0.2,
      presence_penalty: stile === "wtf" ? 0.4 : 0.1,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Rimuovi eco domanda
    answer = stripQuestionEcho(domanda, answer);

    // Polish grammaticale
    answer = await polishAnswer({ text: answer, lang: L, stile });

    // Limita frasi e parole, normalizza
    if (stile === "wtf") {
      answer = tightenSentences(answer, 4); // massimo 4 frasi
      answer = clampWords(answer, 95);
      answer = normalizeOneParagraph(answer);
    } else {
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 130);
      answer = normalizeOneParagraph(answer);
    }

    // Safety nomi propri IT
    if (L === "it") {
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

    // Filtro anti-coach + anti-italiano rotto per WTF IT
    if (stile === "wtf" && L === "it") {
      // meno zucchero, più botte
      answer = answer.replace(/\bcoccol\w*/gi, "botta");
      answer = answer.replace(/\bprocrastinazion\w*/gi, "tirarla lunga");
      answer = answer.replace(/\bmagari domani\b/gi, "poi, poi, poi");

      // togli frasi teoriche tipo "vivere vuol dire..."
      answer = answer.replace(/\bvivere vuol dire[^.?!]*[.?!]/gi, "");
      answer = answer.replace(/\bvuol dire che[^.?!]*[.?!]/gi, "");
      answer = answer.replace(/\bsignifica che[^.?!]*[.?!]/gi, "");

      // pulizia parole sbagliate tipo "toenassi"
      answer = answer.replace(/\btoenassi\b/gi, "tornassi");

      // vieta "rimando" come sostantivo
      answer = answer.replace(/\brimando\b/gi, "tirarla lunga");

      // fix “che aspettati?”
      answer = answer.replace(/\bche aspettati\?/gi, "che aspetti?");

      // frasi troppo liriche standard
      answer = answer.replace(
        /come se stesse versando la vita dentro il tuo bicchiere/gi,
        "come se ti tirasse addosso una sveglia liquida"
      );

      // fix eventuali mostri tipo "di si appiccicano addosso"
      answer = answer.replace(/\bdi si appiccicano addosso\b/gi, "di qualcosa che ti si attacca addosso");

      // evita frasi troppo poetiche/generiche
      answer = answer.replace(/\bviaggiatore della nostalgia\b/gi, "turista del destino");
      answer = answer.replace(/\bnomade dell'aquila\b/gi, "turista del destino");
      answer = answer.replace(/\bscossa di energia\b/gi, "botta sul casco");
      answer = answer.replace(/\bti ricorda chi eri\b/gi, "ti ricorda che sei ancora vivo");
      answer = answer.replace(/\brincorsa contro il tempo\b/gi, "giro dell’oca sempre uguale");
      answer = answer.replace(/\bsegreti dimenticati\b/gi, "occasioni lasciate lì a marcire");
      answer = answer.replace(/\bmemoria distorta\b/gi, "testa che si racconta storie a caso");

      // evita "allegria nel cuore"
      answer = answer.replace(/\ballegria nel cuore\b/gi, "la voglia storta di rimetterti in gioco");
    }

    // Strip prima persona per WHAT IF
    if (stile !== "wtf") {
      answer = stripFirstPerson(answer, L, stile);
    }

    // Sostituisci “cazzo” con “azzo”
    if (stile === "wtf" && L === "it") {
      answer = answer.replace(/\bcazzo\b/gi, "azzo");
    }

    // Evita fissazione sui “lampioni”
    if (stile === "wtf" && L === "it") {
      let count = 0;
      answer = answer.replace(/\blampion[ei]\b/gi, (m) => {
        count += 1;
        return count > 1 ? "semaforo" : m;
      });
      // evita “spippolata”
      answer = answer.replace(/\bspippolat\w*/gi, "rimuginata");
      // evita "madò"
      answer = answer.replace(/\bmadò\b/gi, "");
    }

    // Finale “ecchecazz!!!” per WTF
    if (stile === "wtf") {
      answer = ensureWtfEcchecazzEnding(answer, L);
    }

    // Finale “gancio” per WHAT IF non-IT
    if (stile === "whatif" && L !== "it") {
      answer = ensureZingaraEnding({ text: answer, lang: L, periodo, domanda });
    }

    answer = finalPunct(answer);

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
