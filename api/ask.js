// /api/ask.js — What?f Engine (clarify + answer + polish + daily signals static)
// - WHATIF: analisi scenari + consigli pratici, con almeno un punto NON ovvio che fa riflettere.
// - WTF: narratore/comico da pub, volgare ma affettuoso, stile “turista del destino”.
// - SORPRENDIMI: domande assurde “intelligenti”, varie, non ripetute.
// - SIGNAL (mattina/pomeriggio/sera): frasi statiche, senza chiamare OpenAI, in tutte le lingue.

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

// Wrapper tollerante
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
function pickRandom(arr = []) {
  if (!arr || !arr.length) return "";
  const i = Math.floor(Math.random() * arr.length);
  return arr[i];
}

/* ========= Rimozione prima persona (WHAT IF) ========= */
function stripFirstPerson(text = "", lang = "it", stile = "whatif") {
  if (stile === "wtf") return text;
  let out = String(text || "");
  const L = normLang(lang);

  if (L === "it") {
    out = out.replace(/\b(io|me|mi)\b/gi, "tu");
  } else {
    out = out.replace(/\b(I|I'm|I’d|I've|me|my)\b/gi, "you");
  }

  return out;
}

/* ========= WHAT IF – esempio ========= */
const WHATIF_HYBRID_EX_IT = `Da come lo racconti sembra che dentro di te qualcosa si stia muovendo piano. Vedo le giornate che si aggiustano un po alla volta: togli rumore, recuperi fiato e inizi a capire dove ti consumi davvero. Immagino piccole scelte ripetute, meno scenografiche ma più vivibili, che spostano il peso dalle promesse alle abitudini. Intuisco che restare fermo ti costerebbe soprattutto in pensieri riciclati e sonno leggero, mentre muoverti avrebbe il prezzo di guardare in faccia qualche paura. Si muove una routine nuova, non perfetta ma più onesta, proprio nel punto in cui smetti di cercare la svolta magica e ti permetti di fare un passo alla volta.`;

/* ======= WHAT IF RULES (IT) ======= */
const WHATIF_RULE_FUT_IT = `WHAT IF (italiano, FUTURO VICINO — MISTICA MA UMANA):
- Tono: veggente/zíngara realista, voce calda, empatica, concreta. Non teatrale, non solenne: sembri una persona vera che “sente” la scena.
- APRI con UNA sola frase breve e naturale che suona come un’osservazione sul presente dell’utente (es. “Da come lo racconti, oggi la tua energia si muove in modo diverso.”). Nessun “shh”, nessun effetto sonoro, nessuna domanda retorica.
- La SECONDA frase deve INIZIARE con una di queste parole, scegliendo quella più adatta alla domanda: "Vedo", "Sento", "Immagino", "Intuisco", "Si apre", "Si muove".
- 60% analisi concreta (routine, tempo, costi/benefici, energia, corpo, relazioni) + 40% immagini sobrie della quotidianità (casa, mezzi, messaggi, piccoli gesti).
- Scrivi un futuro vicino che parte da ADESSO: usa soprattutto condizionale e futuro semplice (“potresti”, “inizierai”, “probabilmente”, “finisci per…”).
- Mantieni la risposta aderente al motivo espresso nella domanda:
  • se l’utente parla di salute o “non mi sento bene”, concentrati su corpo, riposo, limiti, comunicazione onesta, NON inventare reputazione o drammi coi colleghi;
  • se parla di lavoro, città, relazione, soldi, resta agganciato a quel tema senza deragliare.
- Inserisci almeno UN punto non ovvio: un costo nascosto, una conseguenza pratica o un effetto su identità/relazioni che l’utente tende a non considerare.
- I contro devono essere REALI: non minimizzare se c’è qualcosa di pesante, ma raccontalo con uno sguardo comunque ottimista e di conforto (tipo “fa paura, ma è gestibile se…”).
- I pro devono includere anche aspetti emotivi: sollievo, pace mentale, spazio per respirare, non solo “successo”.
- Linguaggio: italiano naturale, frasi semplici, nessun tono da manuale motivazionale. Evita frasi tipo “la vita ti sta chiamando”, “il destino ti guida”.
- Alla fine porta sempre uno spunto o un piccolo consiglio pratico, ma FUSO dentro l’ultima frase, senza stacchi tipo “E lì capisci che…”. Deve sembrare il naturale finale del discorso.
- Di solito 3–6 frasi, un solo paragrafo, niente elenchi, niente emoji.
- Niente prima persona narrativa (“io, noi, mi”).`;

const WHATIF_RULE_PAST_IT = `WHAT IF (italiano, PASSATO CONTROFATTUALE – SCENARIO ALTERNATIVO + LEZIONE UMANA):
- Tono: amico sincero con un filo di misticismo, che ti fa vedere la versione alternativa senza schiacciarti di sensi di colpa.
- Parla come se osservassi “quell’altro film” della sua vita da un gradino di lato, con calma.
- Compito: descrivi come sarebbe andata se quella scelta l’avessi fatta davvero:
  • in cosa ti saresti sentito più leggero;
  • quali pesi nuovi ti saresti messo addosso;
  • cosa avresti perso rispetto a oggi, anche in termini di identità o libertà.
- Usa struttura controfattuale (“se avessi…, ti saresti trovato…, avresti pagato…”).
- Porta almeno UN’osservazione non scontata: un compromesso che oggi ti starebbe stretto, una rinuncia che all’epoca non vedevi, o un vantaggio che non è così brillante da vicino.
- Poi porta tutto nel presente: cosa impari, cosa puoi ancora scegliere, come ti conviene muoverti ORA, in modo pratico e gentile.
- Tono sempre ottimista e di conforto: riconosci il rimpianto, ma non lo trasformi in condanna.
- Linguaggio: diretto, concreto, senza melodramma, senza frasi generiche da self-help.
- L’ultimo periodo porta uno spunto o una piccola regola concreta per le scelte future, integrato nel discorso, non come frase separata.
- Di solito 3–6 frasi, un paragrafo unico, niente elenchi, niente emoji.
- Niente prima persona narrativa (“io, noi, mi”).`;

/* ========= Finali “gancio” WHAT IF ========= */
const ZINGARA_ENDINGS = {
  it: {
    future: [
      "E piano piano ti rendi conto che conta più come ti tratti ogni giorno che la singola decisione di oggi.",
      "E quasi senza accorgertene inizi a capire che la svolta vera è nel modo in cui ti prendi cura di te.",
      "E alla fine ti accorgi che non stai salvando il mondo, ma ti stai dando un modo più gentile di viverci."
    ],
    past: [
      "E guardando quella versione di te capisci che non era la scelta perfetta, solo un modo diverso di complicarti la vita.",
      "Da fuori ti rendi conto che non hai buttato via la vita, l’hai solo portata su un binario diverso da imparare a usare.",
      "E lì cominci a usare quel rimpianto più come un promemoria per le prossime scelte che come una condanna."
    ],
  },
  en: {
    future: ["And there you notice it’s less about miracles and more about how you show up every day."],
    past: ["You’d probably see it wasn’t the perfect choice, just a different one you’d have to live with."],
  },
  es: {
    future: ["Y ahí notarás que importa más cómo vives tus días que el escenario perfecto en tu cabeza."],
    past: ["Y quizá hoy verías que no era la decisión perfecta, solo otra forma de complicarte distinto."],
  },
  fr: {
    future: ["Et là tu verras que ce qui compte surtout, c’est comment tu vis tes journées, pas le décor exact."],
    past: ["Et tu comprendras que ce n’était pas le “bon” choix ou le “mauvais”, juste un chemin différent à assumer."],
  },
  de: {
    future: ["Und dort merkst du, dass nicht der große Knall zählt, sondern wie du deinen Alltag wirklich baust."],
    past: ["Vielleicht spürst du dann, dass es keine perfekte Entscheidung war, sondern nur ein anderer Weg mit seinen eigenen Preisen."],
  },
};

/**
 * Finale WHAT IF:
 * - Per ITALIANO ora NON forziamo più nessuna frase standard.
 * - Per le altre lingue manteniamo un possibile gancio.
 */
function ensureZingaraEnding({ text, lang, periodo, domanda }) {
  let s = String(text || "").trim();
  const L = normLang(lang);
  if (!s) return s;

  if (L === "it") {
    return finalPunct(s);
  }

  const seed = hashStr(String(domanda || "") + "|" + s);
  if (seed % 100 >= 70) {
    return finalPunct(s);
  }

  const last = (s.match(/([^.!?…]+[.!?…])\s*$/) || [])[1] || s;
  const alreadyHasHook = /(ti accorgi che|ti rendi conto che|vedi che|capisci che|you’d notice|you’d probably feel|notarás|verras|merkst du)/i.test(
    last
  );
  if (alreadyHasHook) return finalPunct(s);

  const pool = ZINGARA_ENDINGS[L] || ZINGARA_ENDINGS.en;
  const bag =
    String(periodo).toLowerCase() === "past"
      ? pool.past || ZINGARA_ENDINGS.en.past
      : pool.future || ZINGARA_ENDINGS.en.future;
  const addon = pickDet(bag, seed);
  if (!addon) return finalPunct(s);

  s = s.replace(/[.!?…]+$/, "");
  return finalPunct(`${s}. ${addon}`);
}

/* ========= WTF: stile ufficiale (few-shot) ========= */

const WTF_STYLE_EXAMPLES_IT = `Esempio 1:
"Oh, eccoci, centauro dell’inferno. Casco lucido, petto in fuori e cervello rimasto indietro di due curve. Parti, il vento ti fa sentire un dio… poi un’ape ti punta il collo come se avessi firmato un contratto. Ti scappa un “bestemmione a motore caldo!” così forte che il semaforo si mette al rosso da solo e un cane attraversa la strada cambiando idea sulla sua vita. Ti fermi, respiri, e ne lasci andare un’altra più piccola, quasi affettuosa, tipo rito di purificazione. Al bar ordini “qualcosa per sciacquare la bestemmia” e il barista annuisce come uno che ha visto troppo, ecchecazz!!!"

Esempio 2:
"Ah, Luisa… eccoci di nuovo, come una ferita che ha nostalgia del coltello. Ci ricaschi: ti lanci nel suo buco nero emotivo e poi ti spaventi dell’eco. Lei ti visualizza, poi sparisce, e ti sale la pressione come una pentola col coperchio che urla. Ti parte una “bestemmia della miseria incrociata” talmente sincera che la lampada sfarfalla e il bicchiere applaude. Il gatto scappa, Alexa finge un aggiornamento, e tu lasci cadere un’altra imprecazione che sembra una preghiera marcia. Bevi un sorso di rosso e riconosci che ogni storia finisce così: una bestemmia e un brindisi storto — ma almeno il vino lo scegli tu, ecchecazz!!!"

Esempio 3:
"Oh, eccoci, turista del destino con la valigia piena di “poi vediamo”. Torni in città e ti parte una “bestemmia di ritorno” così tonda che perfino il piccione sul cornicione fa finta di non conoscerti. Il barista ti piazza il bicchiere davanti senza chiedere niente, come se stesse timbrando il tuo rientro nella vita vera. Se fai il passo, i vicoli ti si appiccicano addosso e il divano resta vuoto; se resti dove sei, passi le sere a fissare il muro mentre il citofono tace per imbarazzo. Morale storta: o rientri nel film o resti la comparsa dei tuoi stessi pensieri, ecchecazz!!!"`;

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

        sys = `Sei “WHAT THE F”: narratore/comico da pub, volgare ma affettuoso, nello stesso respiro degli esempi (Motociclista, Luisa, Turista del destino).
Prendi in giro la scena e la persona, ma senza umiliarla davvero.
Puoi usare parolacce leggere da bar (culo, chiappe, incasinato, figura barbina, ecc.), MAI insulti a gruppi o identità, MAI usare la parola “merda”.
Puoi nominare la parola “bestemmia” in modo narrato, ma MAI bestemmie reali o riferimenti religiosi.

MODALITÀ SORPRENDIMI (DOMANDA ASSURDA “INTELLIGENTE”):
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- La domanda deve essere assurda ma non gratuita: scena strana, oggetti che reagiscono, però legata alla scelta vera.
- Puoi usare UNA micro-scenetta (frigorifero che ti giudica, tazzina che vibra, sedia che ti guarda storto, barista che alza il sopracciglio).
- Ogni volta inventi una scena nuova: NON riutilizzare sempre le stesse metafore o oggetti, e gli oggetti devono avere senso nella scena (niente citofoni nel deserto, niente ascensori in spiaggia).
- Niente morale, niente consigli: solo una domanda.
- Una sola frase, massimo 22 parole, niente emoji, niente elenco.
- NON chiudere con “ecchecazz!!!”.`;
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
- Include at least ONE non-obvious angle (a hidden constraint, a trade-off, or a question about who they become if they choose this).
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

        sys = `Sei “WHAT IF”: voce lucida e concreta, da amico che ragiona bene sui pro e contro.
Ti interessano vincoli veri e consigli pratici.

MODALITÀ SORPRENDIMI:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Deve essere concreta ma con un angolo insolito che l’utente da solo non si chiederebbe.
- Evita frasi da self-help tipo “cosa vuoi davvero”.
- Concentrati su UNA leva (tempo, soldi, energia, identità, relazioni, rischio).
- Inserisci almeno un dettaglio non ovvio: un rischio nascosto, un costo energetico o un effetto sui rapporti che l’utente tende a sottovalutare.
- Una sola frase, tono calmo, massimo 22 parole, niente emoji, niente elenco.
- Evita la prima persona narrativa (“io, noi, mi”).`;
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
        sys = `Sei “WHAT THE F”: narratore comico da pub nello stesso tono degli esempi (Motociclista, Luisa, Turista del destino).
Parli come se fossi al bancone: prendi in giro, esageri le immagini, fai ridere ma dici la verità.
Puoi usare parolacce leggere da bar (culo, chiappe, incasinato, figuraccia, ecc.), MAI bestemmie reali, MAI insulti a categorie o identità, MAI usare la parola “merda”.
Puoi citare la parola “bestemmia” in modo narrato (“ti parte una bestemmia cosmica”), ma senza riferimenti religiosi.

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
- Include at least ONE angle the user is probably not paying attention to (time, money, energy, identity, relationships, risk).
- Avoid first-person narration (“I, we”).
- Calm, precise tone. One sentence, max 22 words, no emojis, no bullets.`;
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
            : L === "FR"
            ? "FRANCESE"
            : "TEDESCO";

        sys = `Sei “WHAT IF”: voce lucida e concreta, da amico che sa ragionare bene sui pro e contro.
Ti interessa capire i vincoli veri per poter dare consigli pratici.
Mantieni grammatica pulita ed evita ripetizioni inutili.

COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Punta su 1–2 dettagli che spostano davvero l’analisi.
- Inserisci almeno un elemento che faccia dire “ah, non ci avevo pensato”: un compromesso nascosto, un limite di energia, o un impatto su relazioni/identità.
- Tono calmo, preciso, senza fronzoli. Una sola frase, massimo 22 parole, niente emoji, niente elenco.
- Evita la prima persona narrativa (“io, noi, mi”).`;
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

const WTF_RULE_IT_FUT = `Sei “WHAT THE F”: narratore/comico da pub che parla ESATTAMENTE con il respiro degli esempi seguenti (non copiare frasi, imita ritmo, voce, struttura):

${WTF_STYLE_EXAMPLES_IT}

TONO:
- Apertura che prende in giro (“Oh, eccoci…”, “Ah, guarda chi si rivede…”).
- La prima frase è breve (massimo 15 parole) e va dritta alla scena, niente teoria.
- Seconda persona: “ti scappa”, “ti ritrovi”, “ti parte”, “resti lì come un cretino simpatico”.
- Puoi usare parolacce leggere da bar (culo, chiappe, incasinato, figuraccia, casino, ecc.), MAI parole d’odio, MAI insulti a gruppi o identità, MAI usare la parola “merda”.
- Di solito inserisci UNA sola “bestemmia” narrata, creativa e tra virgolette (“bestemmia di ritorno”, “bestemmia mal calibrata”, ecc.) e falla uscire con formule vive tipo “ti parte una…”, “ti scappa una…”, “ti esce una…”, variandole ogni volta.
- Oggetti e ambiente reagiscono (divano, barista, finestra, trolley, lampada, piccione, tazzina, porta, sedia, specchio, ascensore, bicchiere…), massimo 3–5 elementi, e CAMBIALI spesso: non usare sempre gli stessi, e devono avere senso nella scena (niente oggetti a caso fuori contesto).
- Il cuore comico sono i tuoi pro e contro: devono sembrare scemi, da bar, ma con un fondo di verità (es. pro = ti senti di nuovo vivo, contro = ti incasini con la logistica come sempre).
- Nessun motivazionalese zuccheroso, niente frasi tipo "la vita ti chiama", niente teoria astratta (“vivere vuol dire…”).

COMPITO (FUTURO):
- Devi mostrare DUE film:
  • film A: cosa succede se lo fai DAVVERO (torni, cambi, ti butti);
  • film B: cosa succede se resti fermo e continui a tirarla lunga.
- Nei film il “pro” e il “contro” sono dentro la scena, NON come elenco: sensazioni, figuracce, piccoli sollievi.
- La voce è convinta di quello che dice: parla come uno che ti conosce da anni e sa già dove ti incarti.

FORMATO:
- 3–5 frasi, un solo paragrafo, circa 90–130 parole.
- Italiano da bar ma corretto, niente elenchi, niente emoji.
- L’ULTIMA frase chiude con una mini-morale sporca ma concreta e termina con “ecchecazz!!!” (tutto attaccato, tre punti esclamativi).`;

const WTF_RULE_IT_PAST = `Sei “WHAT THE F” in modalità FLASHBACK, stessa voce da comico da pub, ma applicata alla vita alternativa in cui avevi fatto l’altra scelta.

TONO:
- Racconti quella stagione come una serie che è già andata in onda: mezzo epica, mezzo disastro, molto umana.
- Seconda persona: “ti saresti ritrovato”, “ti sarebbero esplose in faccia”, “avresti passato le sere…”.
- Puoi usare parolacce leggere da bar (culo, chiappe, incasinato, figuraccia, casino, ecc.), MAI parole d’odio, MAI insulti a gruppi o identità, MAI usare la parola “merda”.
- Di solito inserisci UNA “bestemmia” solo narrata, con aggettivi strani (“bestemmia nostalgica”, “bestemmia di bilancio”, ecc.) e falla uscire con formule tipo “ti sarebbe partita una…”, “ti sarebbe scappata una…”, “ti sarebbe uscita una…”, sempre diverse ma comprensibili.
- Oggetti e ambiente commentano: divano, pc, bicchiere, barista, finestra, porta, tazzina, sedie, corridoio, tapparelle, tv che borbotta, giubbotto buttato sulla sedia.

COMPITO (PASSATO):
- Descrivi come sarebbe andata se quella scelta l’avessi fatta: quali pro scemi ma veri avresti avuto, quali contro altrettanto scemi ma pesanti (routine, chiappe incollate, drammi da salotto).
- Porta la scena fino a oggi: guardi quella vita alternativa da fuori e capisci qualcosa, ma in modo cazzaro, non romantico.
- Niente finali edificanti: la consapevolezza arriva ridendo delle tue stesse manie.

FORMATO:
- 3–5 frasi, un solo paragrafo, circa 90–130 parole.
- Nessun elenco, nessuna emoji.
- L’ULTIMA frase chiude con una riga secca legata a un gesto/oggetto e finisce con “ecchecazz!!!”.`;

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
- Puoi usare parolacce leggere da bar (culo, chiappe, incasinato, figuraccia, casino, ecc.), ma MAI bestemmie reali, MAI insulti a categorie o identità, MAI usare la parola “merda”.
- La parola “bestemmia” va usata solo in modo narrato con aggettivi creativi, come negli esempi, facendo uscire la scena con formule vive tipo “ti parte una…”, “ti scappa una…”, sempre diverse.
- Evita parole zuccherose (“abbraccio dell’universo”, “gocce di libertà”, “anima che si apre”, ecc.).
- Evita termini teorici come “procrastinazione”, “mindset”, “accettazione radicale”.
- Non usare “rimando” come sostantivo.
- Non racchiudere l’intero testo tra virgolette: usa le virgolette solo su bestemmie narrate o frasi riportate.
- Non inventare parole senza senso: se usi espressioni strane devono essere comprensibili dal contesto.`
    : L === "en"
    ? `RULES WHAT IF:
- Single paragraph, no bullets, no emojis.
- Do NOT restate the question.
- SECOND PERSON (“you / your”) for the user.
- Avoid first person (“I, me, we, us”).
- Include at least ONE non-obvious insight: a hidden trade-off, a blind spot, or a consequence they’re likely underestimating.
- Grammar clean, few repetitions, short sentences (~20 words max).`
    : `REGOLE WHAT IF:
- Un solo paragrafo, niente elenchi, niente emoji.
- NON ripetere la domanda.
- Usa la seconda persona (tu / ti / te / tuo).
- Evita la prima persona narrativa (“io, noi, mi”).
- Inserisci almeno un elemento che faccia dire all’utente “cavolo, non ci avevo pensato”: un costo nascosto, un limite di energia, un impatto su identità o relazioni.
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
        )}. Usa 1–2 di questi elementi per immagini e metafore, nello stile degli esempi (Motociclista, Luisa, Turista del destino). Evita di fissarti sempre sugli stessi oggetti, varia spesso le cose che reagiscono nella scena (tazzina, porta, tapparelle, corridoio, bicchiere, divano, finestra, sedia, zaino, ecc.) e scegli oggetti che abbiano senso nella situazione descritta.`,
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
      const isPastLower = isPast;
      if (isWtf) {
        if (hasClar) {
          return `Original question (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE absurd, brutally honest answer in ENGLISH as “WHAT THE F”. Single paragraph, 3–5 sentences, loud, sarcastic, messy but secretly wise. Show what happens if they do it and if they keep dodging it, then close with a crooked but clear piece of advice.`;
        }
        return `Question (do not repeat it): "${domanda}". Write ONE answer in ENGLISH as “WHAT THE F”. Single paragraph, 3–5 sentences, extremely ironic and over-the-top, but still answering what happens with this choice and what you’d recommend.`;
      }
      if (hasClar) {
        if (isPastLower) {
          return `Original question about the PAST (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE COUNTERFACTUAL answer in ENGLISH as “WHAT IF”: describe the alternate timeline, then extract what matters now and give practical advice, including at least one angle they probably haven’t considered.`;
        }
        return `Original question (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE answer in ENGLISH as “WHAT IF”: first analyse different scenarios, then clearly suggest what makes more sense and how to act, and add at least one non-obvious insight that makes the user think “oh, right, I hadn’t seen that”.`;
      }
      if (isPastLower) {
        return `Question about the PAST (do not repeat it): "${domanda}". Write ONE COUNTERFACTUAL answer in ENGLISH, including at least one hidden trade-off or consequence the user is likely overlooking.`;
      }
      return `Question (do not repeat it): "${domanda}". Write ONE answer in ENGLISH as “WHAT IF”: analyse different scenarios and then give clear, practical advice, adding at least one surprising but realistic angle the user might have missed.`;
    }

    if (L === "it") {
      const isPastLower = isPast;
      if (isWtf) {
        if (hasClar) {
          return `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo (quarta pagina): "${c}".
Genera UNA risposta in ITALIANO come voce “WHAT THE F”, nello stesso stile degli esempi (Motociclista, Luisa, Turista del destino, turista del destino all’Aquila):
- monologo unico, 3–5 frasi, circa 90–130 parole;
- apertura che ti prende per il culo;
- mostra DUE film: se fai davvero questa scelta e se resti fermo a tirarla lunga;
- i pro e i contro devono essere dentro le scene, scemi e demenziali ma con un fondo di verità (routine, chiappe, ansia, piccole libertà);
- usa 2–4 oggetti che reagiscono (bicchiere, divano, finestra, trolley, barista, piccione, porta, tazzina, tapparelle…), cambiandoli spesso e facendoli sembrare credibili nella scena;
- inserisci di solito UNA sola “bestemmia” narrata, creativa e tra virgolette, che esce con formule tipo “ti parte una…”, “ti scappa una…”, “ti esce una…”, sempre diverse e senza riferimenti religiosi;
- niente motivazionalese, niente “vivere vuol dire…”, niente poesia romantica;
- finale cazzaro ma centrato, che chiude con “ecchecazz!!!”.
Paragrafo unico, niente emoji.`;
        }
        return `Domanda (non ripeterla): "${domanda}".
Genera UNA risposta in ITALIANO come voce “WHAT THE F”, identica come respiro agli esempi (Motociclista, Luisa, Turista del destino):
- monologo unico, 3–5 frasi, circa 90–130 parole;
- apertura da presa in giro;
- fai vedere cosa succede se lo fai davvero e cosa succede se resti a tirarla lunga (pro e contro dentro le scenette, stupidi ma veri);
- pochi oggetti ma molto vivi che reagiscono (lampada, bicchiere, barista, divano, finestra, porta, sedia, specchio, tazzina…), e non sempre gli stessi: scegli cose che abbiano senso nel contesto della domanda;
- inserisci di solito UNA sola “bestemmia” narrata, mai reale, che esce con formule tipo “ti parte una…”, “ti scappa una…”, sempre diversa e senza religione;
- linguaggio da bar, anche volgare ma non gratuito, niente teoria astratta;
- l’ULTIMA frase chiude la scena con un colpo secco e finisce con “ecchecazz!!!”.
Paragrafo unico, niente emoji.`;
      }

      if (hasClar) {
        if (isPastLower) {
          return `Domanda sul PASSATO (non ripeterla): "${domanda}". Dettaglio aggiuntivo (quarta pagina): "${c}". Genera UNA risposta CONTROFATTUALE in ITALIANO come “WHAT IF”: racconta come sarebbe andata davvero in quella vita alternativa, porta almeno un dettaglio non ovvio (un compromesso, una rinuncia o un vantaggio strano da immaginare) e poi spiega cosa impari e come ti conviene muoverti ORA, in modo pratico e gentile. Paragrafo unico, 3–6 frasi, tono empatico e concreto.`;
        }
        return `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo (quarta pagina): "${c}". Genera UNA risposta in ITALIANO come “WHAT IF”:
- apri con una frase naturale che aggancia come ti sta dicendo la cosa adesso;
- poi analizzi pochi scenari concreti (se lo fai, se non lo fai, se lo fai in modo diverso);
- tieni conto del motivo esplicito della domanda (salute, lavoro, città, relazione, soldi…) senza inventare drammi laterali;
- dai uno sguardo sia ai pro (sollievo, spazio mentale, opportunità) che ai contro reali (impegno, energia, conseguenze pratiche), con tono ottimista ma onesto;
- inserisci almeno un punto non ovvio che faccia davvero ragionare;
- chiudi con uno spunto o un consiglio pratico fuso nell’ultima frase, senza frasi staccate tipo “e lì capisci che…”.
Paragrafo unico, 3–6 frasi, tono caldo ma lucido.`;
      }
      if (isPastLower) {
        return `Domanda sul PASSATO (non ripeterla): "${domanda}". Genera UNA risposta CONTROFATTUALE in ITALIANO come “WHAT IF”: descrivi come sarebbe andata quella scelta (pro e contro reali), porta almeno un dettaglio inaspettato e chiudi collegando la lezione al presente in modo concreto e gentile, dentro l’ultima frase. Paragrafo unico, 3–6 frasi.`;
      }
      return `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO come “WHAT IF”:
- apri con una frase naturale che sembra un’osservazione su come sei messo adesso;
- descrivi cosa succede se fai davvero questa scelta e cosa succede se resti fermo;
- resta aderente al tema (salute, lavoro, soldi, relazione, città…) senza inventare problemi che l’utente non ha nominato;
- evidenzia pro e contro reali, con tono ottimista ma non ingenuo;
- inserisci almeno un’osservazione non banale che faccia cambiare prospettiva;
- chiudi con uno spunto pratico o di consapevolezza integrato nel discorso, non come slogan.
Paragrafo unico, 3–6 frasi.`;
    }

    if (L === "es") {
      return hasClar
        ? `Pregunta original (no la repitas): "${domanda}". Detalle adicional del usuario: "${c}". Escribe UNA respuesta en ESPAÑOL, clara y concreta, en un solo párrafo, incluyendo al menos un ángulo no obvio que haga pensar al usuario.`
        : `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, en un solo párrafo, con al menos una observación inesperada pero realista.`;
    }
    if (L === "fr") {
      return hasClar
        ? `Question originale (ne la répète pas) : « ${domanda} ». Détail supplémentaire : « ${c} ». Donne UNE réponse en FRANÇAIS, claire et concrète, en un seul paragraphe, avec au moins un point de vue auquel l’utilisateur ne pense pas spontanément.`
        : `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, en un seul paragraphe, avec au moins un angle surprenant mais crédible.`;
    }
    return hasClar
      ? `Ursprüngliche Frage (nicht wiederholen): „${domanda}“. Zusatzdetail: „${c}“. Gib EINE klare, konkrete Antwort auf DEUTSCH, ein einziger Absatz, mit mindestens einem unerwarteten, aber realistischen Blickwinkel.`
      : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz, mit mindestens einer nicht offensichtlichen, aber plausiblen Beobachtung.`;
  })();

  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= SEGNALI GIORNO: NORMALIZZAZIONE SLOT ========= */
function normalizeSlot(slot = "morning") {
  const raw = String(slot || "").toLowerCase();

  if (raw.includes("matt") || raw.includes("morn")) return "morning";
  if (raw.includes("pom") || raw.includes("after")) return "afternoon";
  if (
    raw.includes("sera") ||
    raw.includes("even") ||
    raw.includes("night") ||
    raw.includes("notte")
  )
    return "evening";

  return "morning";
}

/* ========= SEGNALI GIORNO: LISTE STATICHE MULTILINGUA ========= */
/*
  Struttura:
  DAILY_TEXT[lang][stile][slot] = [frasi...]

  - lang: it | en | es | fr | de
  - stile: whatif | wtf
  - slot: morning | afternoon | evening
*/

const DAILY_TEXT = {
  it: {
    whatif: {
      morning: [
        "Stamattina hai più spazio di quanto credi: scegli una cosa che ti facilita la giornata e, se ti va, raccontamela in due parole.",
        "Oggi parti meglio se scegli un passo semplice e lo fai senza correre: qual è il tuo primo passo? Scrivilo al volo.",
        "La giornata gira subito se togli un piccolo peso all’inizio: quale vuoi alleggerire stamattina? Dimmi la prima cosa che ti viene in mente.",
        "Questa mattina non serve fare tutto: serve fare bene una cosa sola. Se vuoi, dimmi quale scegli così ci lavoriamo intorno."
      ],
      afternoon: [
        "È metà giornata: cos’è che ti sta pesando e cos’è che ti sta aiutando? Se ti va, raccontamelo in una frase così capiamo come chiuderla meglio.",
        "Siamo nel pomeriggio: stai andando più in spinta o più in difesa oggi? Rispondimi al volo, così vediamo come regolarci per il resto.",
        "A metà giornata puoi ancora sistemare la rotta: come sta andando davvero finora? Dimmi la versione sincera, anche se è storta.",
        "Nel pomeriggio spesso si decide il tono della serata: in questo momento ti senti più scarico o più in controllo? Se vuoi, scrivimelo in due parole."
      ],
      evening: [
        "A fine giornata conta cosa ti tieni e cosa lasci andare: cosa resta davvero di oggi? Se ti va, raccontamelo in una frase.",
        "Stasera puoi guardare la giornata senza farti la guerra: com’è andata, a grandi linee? Se vuoi, ti aiuto a leggerla meglio.",
        "Prima di chiudere, c’è qualcosa che oggi ti ha chiarito un pezzo di te? Se ti va, scrivilo qui e ci ragioniamo insieme.",
        "La sera serve a fare ordine, non a giudicarsi: qual è il pensiero con cui vuoi chiudere oggi? Puoi dirmelo e lo sistemiamo un po."
      ],
    },
    wtf: {
      morning: [
        "Ah, senti che roba… WHAT IF ti parla di “partire bene”, e tu stai ancora litigando con il cuscino. Dai, dimmi che disastro è sto risveglio, ecchecazz!!!",
        "Il collega zen dice “primo passo”… peccato che il tuo primo passo sia inciampare nelle ciabatte. Raccontami come sono andati i primi 10 minuti, ecchecazz!!!",
        "WHAT IF ti vende la “calma mattutina”, mentre tu cerchi il caffè come fosse un Pokémon raro. Com’è andato il safari stamattina? ecchecazz!!!",
        "Lui parla di “ordine”, tu hai già perso il telefono nel letto. Confessa: che casino hai combinato prima ancora di aprire gli occhi? ecchecazz!!!"
      ],
      afternoon: [
        "WHAT IF ti chiede come va il pomeriggio… io voglio sapere da quanto fissi lo schermo senza concludere niente. Raccontami il coma operativo, ecchecazz!!!",
        "Il collega poetico parla di “aggiustare la rotta”. Ma quale rotta, se sei parcheggiato alla scrivania dal pranzo? Dimmi la scena vera, ecchecazz!!!",
        "Lui dice che “puoi recuperare”. Io direi che puoi almeno non addormentarti in call. Scrivimi il livello di sonno professionale, ecchecazz!!!",
        "WHAT IF vuole capire il “ritmo”, ma oggi sembri wifi scadente: parti, cadi, riparti. Raccontami come stai sopravvivendo al pomeriggio, ecchecazz!!!"
      ],
      evening: [
        "WHAT IF vuole sapere cosa ti tieni dalla giornata. Io voglio sapere come hai perso la dignità litigando col microonde. Sputa il resoconto, ecchecazz!!!",
        "Il collega saggio parla di “bilanci serali”. Il tuo bilancio: 1 caffè, 3 errori, 7 sospiri. Fammi l’inventario onesto, ecchecazz!!!",
        "Lui dice “chiudi con calma”, ma il divano ti ha inghiottito come un parente disperato. Com’è il finale della puntata di oggi? ecchecazz!!!",
        "WHAT IF vuole lezioni profonde, io voglio il momento più tragicomico della giornata. Raccontami la scena top del disastro, ecchecazz!!!"
      ],
    },
  },

  en: {
    whatif: {
      morning: [
        "This morning you don’t have to fix everything: pick one thing that would make your day lighter and, if you want, tell me which.",
        "Today flows better if you start with one small, clear win. What could that be for you? Say it in one line if you like.",
        "You can make the day simpler by removing just one useless weight. If you want, tell me which one you’d cut first.",
        "You don’t need a perfect morning, just a realistic one: choose one priority and, if it helps, write it here in two words."
      ],
      afternoon: [
        "Midday check: what’s draining you and what’s actually helping? If you want, tell me both in one sentence and we adjust the rest.",
        "It’s afternoon: are you more in attack mode or just surviving? Drop me a quick line so we can tune the pace.",
        "You still have time to turn the day a bit: how is it really going so far? Be honest if you feel like it.",
        "The afternoon often decides the tone of your evening: do you feel more scattered or focused? If you want, put it into a short sentence."
      ],
      evening: [
        "By the end of the day, what really stays with you and what can go? If you want, tell me the first thing that comes up.",
        "Tonight you can review the day without beating yourself up: overall, how did it go? Share it in a line if it helps.",
        "Before you sleep, is there one thing today that showed you something about yourself? You can write it here and we look at it calmly.",
        "Evening is for sorting, not judging: what’s the thought you’d like to end the day with? If you want, tell me and we anchor it."
      ],
    },
    wtf: {
      morning: [
        "Oh look, WHAT IF wants you to “start strong” while you’re wrestling with your pillow like it’s a boss fight. Tell me the chaos level, ecchecazz!!!",
        "The wise colleague says “first step”, but your first step was tripping over your socks. Describe the mess of your morning launch, ecchecazz!!!",
        "WHAT IF preaches “calm morning”, and you’re hunting coffee like rare loot. How did that epic quest go today, ecchecazz!!!",
        "They talk about “intentions”, you’re just trying not to send messages to the wrong chat. Tell me the first screw-up, ecchecazz!!!"
      ],
      afternoon: [
        "WHAT IF asks how your afternoon is going, I ask how long you’ve been staring at the same email. Tell me the damage, ecchecazz!!!",
        "The poetic colleague talks about “course correction”. Buddy, you’re docked at the desk since lunch. Give me the real picture, ecchecazz!!!",
        "They say “you can still recover”, but you’re negotiating with the chair not to fall asleep. Rate your zombie mode, ecchecazz!!!",
        "WHAT IF wants your “rhythm”, but your rhythm is buffering. Share the most tragicomic moment of this afternoon, ecchecazz!!!"
      ],
      evening: [
        "WHAT IF wants highlights of the day, I want the part where you argued with the microwave. Drop tonight’s blooper, ecchecazz!!!",
        "The wise one talks about “evening balance”. Your balance is snacks, regrets and one tiny win. List them honestly, ecchecazz!!!",
        "They say “close the day with peace”, but your sofa swallowed you whole. What’s the last ridiculous scene of today, ecchecazz!!!",
        "WHAT IF hunts for lessons, I hunt for survival stories. Tell me the most chaotic moment you survived today, ecchecazz!!!"
      ],
    },
  },

  es: {
    whatif: {
      morning: [
        "Esta mañana no tienes que arreglarlo todo: elige una cosa que haga el día más ligero y, si quieres, cuéntamela en una frase.",
        "El día arranca mejor si consigues una pequeña victoria clara al principio. ¿Cuál podría ser? Escríbela rápido si te apetece.",
        "Puedes mejorar el día quitando solo un peso tonto. Si quieres, dime cuál sería el primero en desaparecer.",
        "No necesitas una mañana perfecta, solo una manejable: elige una prioridad y, si te ayuda, escríbela en pocas palabras."
      ],
      afternoon: [
        "Es mitad de día: ¿qué te está agotando y qué te está sosteniendo? Si quieres, cuéntamelo en una frase y ajustamos el resto.",
        "Ya es tarde: ¿hoy estás más en modo ataque o en modo aguantar? Dímelo rápido y vemos cómo seguir.",
        "Todavía puedes corregir la ruta: ¿cómo va de verdad el día hasta ahora? Si te apetece, sé sincero en una línea.",
        "La tarde suele marcar el tono de la noche: ¿te sientes más disperso o más centrado? Escríbelo si quieres ponerle nombre."
      ],
      evening: [
        "Al final del día importa qué te quedas y qué dejas ir: ¿qué se queda de hoy? Cuéntamelo en una frase si te ayuda.",
        "Esta noche puedes mirar el día sin machacarte: en general, ¿cómo ha ido? Si quieres, escríbelo y lo miramos juntos.",
        "Antes de dormir, ¿hay algo de hoy que te haya aclarado un poco quién eres? Puedes contarlo aquí sin filtro.",
        "La noche sirve para ordenar, no para juzgar: ¿con qué pensamiento quieres cerrar el día? Escríbelo si te apetece."
      ],
    },
    wtf: {
      morning: [
        "WHAT IF habla de “empezar bien” y tú sigues peleando con la almohada. Venga, cuéntame el nivel de desastre matutino, ecchecazz!!!",
        "El colega zen dice “primer paso”… y tu primer paso fue tropezarte descalzo. Descríbeme el show de esta mañana, ecchecazz!!!",
        "WHAT IF vende calma y tú buscas café como si fuera tesoro. ¿Cómo fue la expedición hoy? ecchecazz!!!",
        "Ellos hablan de intención, tú solo intentas no contestar al grupo equivocado. Suelta la primera cagada del día, ecchecazz!!!"
      ],
      afternoon: [
        "WHAT IF pregunta cómo va la tarde, yo pregunto cuánto llevas mirando la misma pantalla. Cuéntame el coma productivo, ecchecazz!!!",
        "El colega poético dice “ajustar rumbo”. ¿Qué rumbo, si llevas aparcado en la silla desde la comida? Dime la verdad, ecchecazz!!!",
        "Dicen que “aún puedes remontar” y tú luchas por no dormirte. Pon nota a tu modo zombi, ecchecazz!!!",
        "WHAT IF quiere tu “ritmo”, pero hoy vas a golpes de wifi. Cuéntame el momento más tragicómico de la tarde, ecchecazz!!!"
      ],
      evening: [
        "WHAT IF quiere lecciones del día, yo quiero saber cuándo discutiste con el microondas. Suelta la escena, ecchecazz!!!",
        "Hablan de “balance nocturno”: el tuyo es snacks, cansancio y alguna victoria rara. Hazme la lista sincera, ecchecazz!!!",
        "Te dicen que cierres el día con calma y tú te has fusionado con el sofá. ¿Cómo termina el capítulo de hoy? ecchecazz!!!",
        "WHAT IF busca profundidad, yo busco el momento más ridículo que has sobrevivido. Cuéntamelo sin filtro, ecchecazz!!!"
      ],
    },
  },

  fr: {
    whatif: {
      morning: [
        "Ce matin tu n’as pas besoin de tout régler: choisis une chose qui allégerait ta journée et, si tu veux, dis-moi laquelle.",
        "La journée démarre mieux si tu valides une petite victoire claire au début. Laquelle pourrait être la tienne? Écris-la en une phrase.",
        "Tu peux améliorer ton jour en enlevant juste un poids inutile. Si tu veux, dis-moi lequel tu laisserais tomber en premier.",
        "Pas besoin d’une matinée parfaite, juste gérable: choisis une priorité et, si ça t’aide, mets-la en mots ici."
      ],
      afternoon: [
        "Milieu de journée: qu’est-ce qui te vide et qu’est-ce qui t’aide vraiment? Si tu veux, résume-le en une phrase et on ajuste.",
        "Cet après-midi, tu es plutôt en mode attaque ou survie? Dis-le-moi vite et on voit comment gérer la suite.",
        "Tu peux encore corriger le tir: comment ça se passe vraiment jusqu’ici? Si tu veux, sois honnête en deux lignes.",
        "L’après-midi prépare souvent ta soirée: tu te sens plutôt dispersé ou posé? Mets-le en mots si tu veux y voir plus clair."
      ],
      evening: [
        "En fin de journée, l’important c’est ce que tu gardes et ce que tu lâches: qu’est-ce qui reste de ce jour? Dis-le-moi en une phrase.",
        "Ce soir tu peux regarder ta journée sans te juger: globalement, comment ça s’est passé? Si tu veux, écris-le et on le relit ensemble.",
        "Avant de dormir, y a-t-il quelque chose aujourd’hui qui t’a fait comprendre un peu mieux comment tu fonctionnes? Tu peux me le raconter ici.",
        "Le soir sert à ranger, pas à t’enfoncer: avec quelle pensée tu aimerais finir la journée? Écris-la si tu veux l’ancrer un peu."
      ],
    },
    wtf: {
      morning: [
        "WHAT IF parle de “bien commencer”, toi tu te bats encore avec la couette. Allez, raconte-moi le carnage du réveil, ecchecazz!!!",
        "Le collègue zen dit “premier pas” et ton premier pas, c’est marcher sur ton chargeur. Décris-moi la scène, ecchecazz!!!",
        "WHAT IF vend une matinée calme, toi tu chasses le café comme un animal rare. Comment s’est passée la chasse aujourd’hui? ecchecazz!!!",
        "On parle d’intentions, toi tu essaies juste de ne pas répondre au mauvais groupe. Donne-moi la première bourde du jour, ecchecazz!!!"
      ],
      afternoon: [
        "WHAT IF demande comment va ton après-midi, moi je demande depuis combien de temps tu fixes le même mail. Raconte, ecchecazz!!!",
        "Le poète du comptoir dit “corriger la trajectoire”. Quelle trajectoire, si tu es soudé à ta chaise depuis midi? Dis la vérité, ecchecazz!!!",
        "On te dit que “tu peux encore rattraper”, alors que tu luttes pour ne pas t’endormir. Note ton mode zombie, ecchecazz!!!",
        "WHAT IF veut ton “rythme”, mais tu es en mode wifi instable. Donne-moi le moment le plus tragicomique de l’après-midi, ecchecazz!!!"
      ],
      evening: [
        "WHAT IF veut savoir ce que tu retiens de la journée, moi je veux savoir quand tu t’es engueulé avec ton micro-ondes. Lâche l’anecdote, ecchecazz!!!",
        "On parle de “bilan du soir”: le tien, c’est grignotage, soupirs et une mini-victoire. Fais la liste honnête, ecchecazz!!!",
        "On te dit de finir la journée en paix, toi tu es fusionné avec ton canapé. Comment se termine l’épisode d’aujourd’hui? ecchecazz!!!",
        "WHAT IF cherche des leçons, moi je cherche le moment le plus absurde que tu as survécu. Raconte sans filtre, ecchecazz!!!"
      ],
    },
  },

  de: {
    whatif: {
      morning: [
        "Heute Morgen musst du nicht alles lösen: such dir eine Sache aus, die den Tag leichter macht, und erzähl sie mir, wenn du magst.",
        "Der Tag startet besser, wenn du dir gleich am Anfang einen kleinen klaren Erfolg holst. Welcher könnte das sein? Schreib ihn kurz auf.",
        "Du kannst den Tag verbessern, indem du nur ein unnötiges Gewicht loslässt. Wenn du willst, sag mir, welches zuerst fliegen würde.",
        "Du brauchst keinen perfekten Morgen, nur einen machbaren: wähle eine Priorität und formulier sie in ein paar Worten, wenn es hilft."
      ],
      afternoon: [
        "Mitte des Tages: was zieht dich runter und was trägt dich noch? Wenn du magst, fass es in einem Satz zusammen.",
        "Es ist Nachmittag: bist du heute eher im Angriffsmodus oder im Überlebensmodus? Schreib’s mir kurz, dann justieren wir den Rest.",
        "Du kannst den Kurs immer noch leicht korrigieren: wie läuft der Tag wirklich bisher? Wenn du willst, sei ehrlich in einer Zeile.",
        "Der Nachmittag legt oft die Stimmung für den Abend fest: fühlst du dich eher zerstreut oder fokussiert? Formulier es, wenn du Klarheit willst."
      ],
      evening: [
        "Am Ende des Tages zählt, was du behältst und was du loslässt: was bleibt heute übrig? Erzähl es mir in einem Satz.",
        "Heute Abend kannst du auf den Tag schauen, ohne dich fertig zu machen: wie war er insgesamt? Schreib’s, wenn du willst.",
        "Bevor du schlafen gehst: gab es heute etwas, das dir gezeigt hat, wie du eigentlich tickst? Du kannst es hier festhalten.",
        "Der Abend ist zum Sortieren da, nicht zum Verurteilen: mit welchem Gedanken willst du den Tag beenden? Schreib ihn, wenn du magst."
      ],
    },
    wtf: {
      morning: [
        "WHAT IF redet von “gut starten”, du kämpfst noch mit der Decke wie im Wrestling. Erzähl mir das Morgenchaos, ecchecazz!!!",
        "Der Zen-Kollege sagt “erster Schritt” und dein erster Schritt ist auf den Stecker. Beschreib mir die Szene, ecchecazz!!!",
        "WHAT IF verkauft einen ruhigen Morgen, du jagst den Kaffee wie ein seltenes Tier. Wie lief die Jagd heute? ecchecazz!!!",
        "Alle reden von Intention, du versuchst nur, keine Nachricht an den falschen Chat zu schicken. Erste Panne des Tages, los, ecchecazz!!!"
      ],
      afternoon: [
        "WHAT IF fragt, wie dein Nachmittag läuft, ich frage, wie lange du schon denselben Tab anstarrst. Erzähl mir den Produktivitätskoma, ecchecazz!!!",
        "Der Theoretiker sagt “Kurs korrigieren”. Welcher Kurs, wenn du seit Mittag an den Stuhl geschweißt bist? Sei ehrlich, ecchecazz!!!",
        "Sie sagen, du kannst noch “aufholen”, während du gegen das Eindösen kämpfst. Bewerte deinen Zombie-Modus, ecchecazz!!!",
        "WHAT IF will deinen “Rhythmus”, aber du lädst dauernd nach. Verrat mir den tragikomischsten Moment des Nachmittags, ecchecazz!!!"
      ],
      evening: [
        "WHAT IF will die Lehren des Tages, ich will wissen, wann du dich mit der Mikrowelle gestritten hast. Raus mit der Story, ecchecazz!!!",
        "Alle reden von “Abendbilanz”: deine ist Snacks, Müdigkeit und ein schiefer kleiner Sieg. Mach die ehrliche Liste, ecchecazz!!!",
        "Sie sagen, du sollst den Tag in Ruhe beenden, du bist mit dem Sofa verschmolzen. Wie endet die Folge heute? ecchecazz!!!",
        "WHAT IF sucht Tiefe, ich suche deinen chaotischsten Überlebensmoment. Schreib ihn mir, ungefiltert, ecchecazz!!!"
      ],
    },
  },
};

/* ========= COSTRUTTORE FRASE GIORNALIERA ========= */
function buildDailyStaticSignal({ slot = "morning", stile = "whatif", lang = "it" }) {
  const L = normLang(lang);
  const s = normalizeSlot(slot);

  const langPack = DAILY_TEXT[L] || DAILY_TEXT.it;
  const styleKey = stile === "wtf" ? "wtf" : "whatif";
  const stylePack = langPack[styleKey] || langPack.whatif;

  const arr =
    s === "afternoon"
      ? stylePack.afternoon || stylePack.morning
      : s === "evening"
      ? stylePack.evening || stylePack.morning
      : stylePack.morning;

  return pickRandom(arr);
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
- mantieni intatto il tono da narratore comico da pub, le parolacce e le immagini;
- NON ammorbidire il lessico: lascia le parti grezze e un po’ volgari;
- correggi solo errori grammaticali evidenti, concordanze, doppioni di parole, ripetizioni troppo ravvicinate;
- NON aggiungere nuove metafore;
- non cambiare pronomi o persona verbale, a meno che la frase non sia davvero scorretta;
- mantieni lunghezza simile e un unico paragrafo;
- NON trasformare “bestemmia” in bestemmie reali o riferimenti religiosi;
- non racchiudere tutto il testo tra virgolette.`
        : `Sei un correttore di bozze.
Prendi il testo seguente e:
- mantieni intatto senso e tono, anche il lato un po’ mistico ma umano;
- correggi errori grammaticali e ripetizioni inutili;
- non cambiare pronomi o persona verbale, a meno che la frase non sia proprio scorretta;
- mantieni un unico paragrafo e lunghezza simile.`;
  } else if (L === "en") {
    sys =
      stile === "wtf"
        ? `You are a copy editor for a foul-mouthed monologue.
Keep the same tone and swearing, only fix clear grammar issues and obvious word repetition. Do not change pronouns or person unless the sentence is clearly wrong. Keep it one paragraph, similar length.`
        : `You are a copy editor.
Keep the same meaning and tone, fix grammar and useless repetitions. Avoid changing pronouns or person unless absolutely necessary. Keep it one paragraph, similar length.`;
  } else {
    sys = `You are a copy editor.
Keep the same tone and meaning, fix obvious grammar errors and unnecessary repetitions.
Avoid changing pronouns or verb person unless the sentence is clearly wrong.
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

  s = s.replace(/^["“”']+/, "").replace(/["“”']+$/, "").trim();
  s = s.replace(/\s*ecchecazz!+$/gi, "");
  s = s.replace(/\s*ecc[.,!?…]*$/gi, "");
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
      stage = "answer", // "clarify" | "answer" | "signal"
      domanda = "",
      clarification = "",
      stile = "whatif", // "whatif" | "wtf"
      lang = "it",
      periodo = "future", // "future" | "past"
      micro = {},
    } = body || {};

    const L = normLang(lang);
    const isSignal = (micro && micro.src === "signal") || stage === "signal";

    // ====== SEGNALI GIORNO: NO OPENAI, SOLO LISTE STATICHE ======
    if (isSignal) {
      const slotRaw = micro.slot || micro.timeOfDay || micro.time || "morning";
      const slot = normalizeSlot(slotRaw);
      const answer = buildDailyStaticSignal({ slot, stile, lang: L }) || "";

      return res.status(200).json({
        mode: "signal",
        time: slotRaw,
        slot,
        style: stile,
        lang: L,
        periodo,
        model: "static",
        answer,
      });
    }

    // Per le chiamate normali serve una domanda vera
    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

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

    /* ====== STAGE: ANSWER (normale, con OpenAI) ====== */
    const messages = buildMessages({ domanda, clarification, lang: L, periodo, stile });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.8,
      top_p: stile === "wtf" ? 0.96 : 0.92,
      max_tokens: stile === "wtf" ? 320 : 260,
      frequency_penalty: stile === "wtf" ? 0.6 : 0.2,
      presence_penalty: stile === "wtf" ? 0.4 : 0.1,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    answer = stripQuestionEcho(domanda, answer);

    answer = await polishAnswer({ text: answer, lang: L, stile });

    if (stile === "wtf") {
      answer = tightenSentences(answer, 5);
      answer = clampWords(answer, 130);
      answer = normalizeOneParagraph(answer);
    } else {
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 130);
      answer = normalizeOneParagraph(answer);
    }

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

    answer = sentenceCaseAll(answer);

    if (stile === "wtf" && L === "it") {
      answer = answer.replace(/\bcoccol\w*/gi, "botta");
      answer = answer.replace(/\bprocrastinazion\w*/gi, "tirarla lunga");
      answer = answer.replace(/\bmagari domani\b/gi, "poi, poi, poi");

      answer = answer.replace(/\bvivere vuol dire[^.?!]*[.?!]/gi, "");
      answer = answer.replace(/\bvuol dire che[^.?!]*[.?!]/gi, "");
      answer = answer.replace(/\bsignifica che[^.?!]*[.?!]/gi, "");

      answer = answer.replace(/\brimando\b/gi, "tirarla lunga");

      answer = answer.replace(
        /come se stesse versando la vita dentro il tuo bicchiere/gi,
        "come se ti tirasse addosso una sveglia liquida"
      );

      answer = answer.replace(/\bviaggiatore della nostalgia\b/gi, "turista del destino");
      answer = answer.replace(/\ballegria nel cuore\b/gi, "quella voglia storta di rimetterti in gioco");

      answer = answer.replace(/\bmadò\b/gi, "");
    }

    if (stile !== "wtf") {
      answer = stripFirstPerson(answer, L, stile);
    }

    if (stile === "wtf" && L === "it") {
      answer = answer.replace(/\bcazz\w*/gi, (m) => m.replace(/cazz/gi, "azz"));
      answer = answer.replace(/\bmerd\w*\b/gi, "schifo");

      let count = 0;
      answer = answer.replace(/\blampion[ei]\b/gi, (m) => {
        count += 1;
        return count > 1 ? "semaforo" : m;
      });
      answer = answer.replace(/\bspippolat\w*/gi, "rimuginata");
    }

    const isSurprise = !!(micro && (micro.surprise === true || micro.src === "surprise"));
    if (stile === "wtf" && L === "it" && !/bestemmi\w*/i.test(answer) && !isSurprise) {
      const seedSci = hashStr(String(domanda || "") + "|" + String(answer || ""));
      if (seedSci % 100 < 65) {
        answer =
          answer.replace(/\s*[.!?…]*$/, "") +
          `, e ti scappa una "bestemmia di manutenzione" che fa vibrare pure la tazzina sul tavolo`;
      }
    }

    if (stile === "wtf") {
      answer = ensureWtfEcchecazzEnding(answer, L);
    }

    if (stile === "whatif") {
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

    let scientific;
    if (stile === "wtf" && !isSurprise) {
      const seedSci = hashStr(String(domanda || "") + "|scientific");
      if (seedSci % 100 < 70) {
        scientific = scientificReportDemenziale(domanda, L);
      }
    }

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
    return res
      .status(500)
      .json({ error: "server_error", detail: String(err?.message || err) });
  }
        }
