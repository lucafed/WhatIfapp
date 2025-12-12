// /api/ask.js — What?f Engine (clarify + answer + polish + daily signals statici)
// - WHATIF: analisi scenari + consigli pratici, con almeno un punto NON ovvio che fa riflettere.
// - WTF: narratore/comico da pub, volgare ma affettuoso, stile “turista del destino”.
// - SORPRENDIMI: domande assurde “intelligenti”, varie, non ripetute.
// - SIGNAL: frasi giornaliere (mattina/pomeriggio/sera) SENZA usare token OpenAI.

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
  const alreadyHasHook = /(ti accorgi che|ti rendi conto che|vedi che|capisci che|you’d notice|you’d probably feel|notarás|verras|merkst du)/i.test(last);
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
"Og, eccoci, turista del destino con la valigia piena di “poi vediamo”. Torni in città e ti parte una “bestemmia di ritorno” così tonda che perfino il piccione sul cornicione fa finta di non conoscerti. Il barista ti piazza il bicchiere davanti senza chiedere niente, come se stesse timbrando il tuo rientro nella vita vera. Se fai il passo, i vicoli ti si appiccicano addosso e il divano resta vuoto; se resti dove sei, passi le sere a fissare il muro mentre il citofono tace per imbarazzo. Morale storta: o rientri nel film o resti la comparsa dei tuoi stessi pensieri, ecchecazz!!!"`;

/* ========= WTF: stop words & keyword helper ========= */
const WTF_STOP_IT = new Set([
  "allora","perché","perche","quando","come","cosa","questo","questa","quello","quella",
  "proprio","tipo","solo","magari","forse","anche","molto","sempre","mai","non","che","con","senza",
  "fare","andare","stare","dove","se",
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
          L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

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
          L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

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
          L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

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
      ? `Question "et si..." de l’utilisateur :\n"${domanda}"\nPose UNE seule question de clarification en FRANÇAIS, selon les règles de stile ci-dessus.`
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
- Last sentence: blunt, foul-mouthed line about what makes sense today.

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
      if (isWtf) {
        if (hasClar) {
          return `Original question (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE absurd, brutally honest answer in ENGLISH as “WHAT THE F”. Single paragraph, 3–5 sentences, loud, sarcastic, messy but secretly wise. Show what happens if they do it and if they keep dodging it, then close with a crooked but clear piece of advice.`;
        }
        return `Question (do not repeat it): "${domanda}". Write ONE answer in ENGLISH as “WHAT THE F”. Single paragraph, 3–5 sentences, extremely ironic and over-the-top, but still answering what happens with this choice and what you’d recommend.`;
      }
      if (hasClar) {
        if (isPast) {
          return `Original question about the PAST (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE COUNTERFACTUAL answer in ENGLISH as “WHAT IF”: describe the alternate timeline, then extract what matters now and give practical advice, including at least one angle they probably haven’t considered.`;
        }
        return `Original question (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE answer in ENGLISH as “WHAT IF”: first analyse different scenarios, then clearly suggest what makes more sense and how to act, and add at least one non-obvious insight that makes the user think “oh, right, I hadn’t seen that”.`;
      }
      if (isPast) {
        return `Question about the PAST (do not repeat it): "${domanda}". Write ONE COUNTERFACTUAL answer in ENGLISH, including at least one hidden trade-off or consequence the user is likely overlooking.`;
      }
      return `Question (do not repeat it): "${domanda}". Write ONE answer in ENGLISH as “WHAT IF”: analyse different scenarios and then give clear, practical advice, adding at least one surprising but realistic angle the user might have missed.`;
    }

    if (L === "it") {
      if (isWtf) {
        if (hasClar) {
          return `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo (quarta pagina): "${c}".
Genera UNA risposta in ITALIANO come voce “WHAT THE F”, nello stesso stile degli esempi (Motociclista, Luisa, Turista del destino):
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
        if (isPast) {
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
      if (isPast) {
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

/* ========= SEGNALI GIORNO (STATICI, NO AI) ========= */
/**
 * REGOLE FINALI:
 * - WHAT IF: SOLO MATTINA (contesto + domanda reale "Ti sei mai chiesto se...")
 * - WHAT THE F: SOLO SERA (le 10 frasi APPROVATE, fisse)
 * - Rotazione diversa per utente: micro.userKey (fallback ip)
 * - Deterministico: stesso utente stessa frase per giorno+slot, cambia giorno => cambia frase.
 */

function normSignalSlot(raw = "") {
  const s = String(raw || "").toLowerCase();
  if (/pom|after/.test(s)) return "afternoon";
  if (/sera|even|night/.test(s)) return "evening";
  return "morning";
}

/* --- WHAT IF (domande reali approvate) --- */
const WHATIF_Q_IT = [
  // Vita / scelte
  "Ti sei mai chiesto se cambiassi lavoro?",
  "Ti sei mai chiesto se mollassi tutto per un periodo?",
  "Ti sei mai chiesto se provassi a vivere da un’altra parte?",
  "Ti sei mai chiesto se restassi dove sei ancora per anni?",
  "Ti sei mai chiesto se stessi sprecando tempo?",
  "Ti sei mai chiesto se stessi davvero facendo quello che vuoi?",
  "Ti sei mai chiesto se fosse il momento di cambiare aria?",
  "Ti sei mai chiesto se smettessi di rimandare?",
  "Ti sei mai chiesto se scegliessi diversamente da come si aspettano gli altri?",
  // Relazioni
  "Ti sei mai chiesto se dicessi quello che pensi davvero?",
  "Ti sei mai chiesto se restassi solo?",
  "Ti sei mai chiesto se chiudessi una relazione?",
  "Ti sei mai chiesto se scrivessi a quella persona?",
  "Ti sei mai chiesto se non rispondessi più?",
  "Ti sei mai chiesto se stessi con qualcuno solo per abitudine?",
  "Ti sei mai chiesto se meritassi di più?",
  "Ti sei mai chiesto se smettessi di giustificare gli altri?",
  // Soldi / lavoro
  "Ti sei mai chiesto se guadagnassi in un altro modo?",
  "Ti sei mai chiesto se cambiassi settore?",
  "Ti sei mai chiesto se chiedessi più soldi?",
  "Ti sei mai chiesto se lavorassi meno?",
  "Ti sei mai chiesto se investissi su di te?",
  "Ti sei mai chiesto se smettessi di fare un lavoro che non ti piace?",
  "Ti sei mai chiesto se rischiassi di più?",
  "Ti sei mai chiesto se stessi puntando troppo basso?",
  // Libertà / desideri
  "Ti sei mai chiesto se comprassi una moto?",
  "Ti sei mai chiesto se facessi un viaggio da solo?",
  "Ti sei mai chiesto se cambiassi completamente routine?",
  "Ti sei mai chiesto se provassi qualcosa di nuovo?",
  "Ti sei mai chiesto se dicessi sì invece di no?",
  "Ti sei mai chiesto se dicessi no invece di sì?",
  "Ti sei mai chiesto se seguissi un’idea folle?",
  "Ti sei mai chiesto se smettessi di avere paura?",
  // Identità / vita vera
  "Ti sei mai chiesto se fossi diventato un’altra persona?",
  "Ti sei mai chiesto se stessi vivendo come vuoi tu?",
  "Ti sei mai chiesto se stessi solo resistendo?",
  "Ti sei mai chiesto se fossi più coraggioso di quanto pensi?",
  "Ti sei mai chiesto se ti stessi accontentando?",
  "Ti sei mai chiesto se stessi aspettando il momento giusto?",
  "Ti sei mai chiesto se il momento giusto fosse adesso?",
];

const WHATIF_CTX_IT = [
  "Oggi probabilmente ti aspettano lavoro, messaggi, persone che vogliono qualcosa da te e un pensiero che torna sempre.",
  "Stamattina il mondo riparte prima di te: notifiche, cose da fare, facce da gestire… e tu che cerchi un filo.",
  "C’è una parte di te che fa tutto ‘giusto’, e un’altra che non si sente mai davvero a casa in questa routine.",
  "Tra una cosa da sistemare e una da fingere, oggi rischi di andare avanti per inerzia senza accorgertene.",
  "Sembra una mattina normale, ma sotto c’è quella voglia sottile di cambiare qualcosa, anche solo di un grado.",
  "Hai presente quando fai mille cose eppure ti rimane addosso una sensazione non detta? Ecco, oggi può essere così.",
  "Oggi la testa corre più veloce del corpo: non è stanchezza, è rumore che chiede spazio.",
  "Ci sono giorni in cui ti svegli già ‘in dovere’: e invece basterebbe una domanda giusta per spostare il peso.",
  "Stamattina potresti sentirti in mezzo: tra ciò che mostri e ciò che vorresti davvero vivere.",
  "Oggi ti muovi come sempre… ma c’è un punto in cui non stai scegliendo, stai solo continuando.",
  "Prima che la giornata ti prenda in ostaggio, fermati un secondo: non per decidere tutto, solo per vedere chi sei.",
  "Non serve una svolta teatrale: a volte basta una domanda semplice che ti mette davanti allo specchio, piano.",
];

/* Traduzioni “stesse frasi” (fedeli) */
const WHATIF_Q = {
  it: WHATIF_Q_IT,
  en: WHATIF_Q_IT.map((q) =>
    q
      .replace(/^Ti sei mai chiesto se /, "Have you ever wondered if you ")
      .replace(/\?$/, "?")
      .replace("cambiassi lavoro", "changed jobs")
      .replace("mollassi tutto per un periodo", "dropped everything for a while")
      .replace("provassi a vivere da un’altra parte", "tried living somewhere else")
      .replace("restassi dove sei ancora per anni", "stayed where you are for years")
      .replace("stessi sprecando tempo", "were wasting time")
      .replace("stessi davvero facendo quello che vuoi", "were truly doing what you want")
      .replace("fosse il momento di cambiare aria", "it was time to change air")
      .replace("smettessi di rimandare", "stopped postponing")
      .replace("scegliessi diversamente da come si aspettano gli altri", "chose differently than others expect")
      .replace("dicessi quello che pensi davvero", "said what you truly think")
      .replace("restassi solo", "stayed alone")
      .replace("chiudessi una relazione", "ended a relationship")
      .replace("scrivessi a quella persona", "texted that person")
      .replace("non rispondessi più", "stopped replying")
      .replace("stessi con qualcuno solo per abitudine", "were with someone just out of habit")
      .replace("meritassi di più", "deserved more")
      .replace("smettessi di giustificare gli altri", "stopped excusing others")
      .replace("guadagnassi in un altro modo", "earned money in a different way")
      .replace("cambiassi settore", "changed industry")
      .replace("chiedessi più soldi", "asked for more money")
      .replace("lavorassi meno", "worked less")
      .replace("investissi su di te", "invested in yourself")
      .replace("smettessi di fare un lavoro che non ti piace", "stopped doing a job you don’t like")
      .replace("rischiassi di più", "took more risks")
      .replace("stessi puntando troppo basso", "were aiming too low")
      .replace("comprassi una moto", "bought a motorcycle")
      .replace("facessi un viaggio da solo", "took a trip alone")
      .replace("cambiassi completamente routine", "changed your routine completely")
      .replace("provassi qualcosa di nuovo", "tried something new")
      .replace("dicessi sì invece di no", "said yes instead of no")
      .replace("dicessi no invece di sì", "said no instead of yes")
      .replace("seguissi un’idea folle", "followed a crazy idea")
      .replace("smettessi di avere paura", "stopped being afraid")
      .replace("fossi diventato un’altra persona", "had become a different person")
      .replace("stessi vivendo come vuoi tu", "were living the way you want")
      .replace("stessi solo resistendo", "were just enduring")
      .replace("fossi più coraggioso di quanto pensi", "were braver than you think")
      .replace("ti stessi accontentando", "were settling")
      .replace("stessi aspettando il momento giusto", "were waiting for the right moment")
      .replace("il momento giusto fosse adesso", "the right moment was now")
  ),
  es: WHATIF_Q_IT.map((q) =>
    q.replace(/^Ti sei mai chiesto se /, "¿Alguna vez te has preguntado si ")
     .replace(/\?$/, "?")
  ),
  fr: WHATIF_Q_IT.map((q) =>
    q.replace(/^Ti sei mai chiesto se /, "T’es-tu déjà demandé si ")
     .replace(/\?$/, " ?")
  ),
  de: WHATIF_Q_IT.map((q) =>
    q.replace(/^Ti sei mai chiesto se /, "Hast du dich jemals gefragt, ob du ")
     .replace(/\?$/, "?")
  ),
};

const WHATIF_CTX = {
  it: WHATIF_CTX_IT,
  en: [
    "Today you’ll probably face work, messages, people wanting something from you—and a thought that keeps coming back.",
    "This morning the world starts before you do: notifications, to-dos, faces to manage… and you looking for one thread.",
    "Part of you does everything ‘right’, and another part never feels truly at home inside this routine.",
    "Between fixing things and pretending you’re fine, today you could drift on autopilot without noticing.",
    "It looks like a normal morning, but underneath there’s that thin urge to change something, even by one degree.",
    "You know that feeling when you do a thousand things but still carry an unsaid weight? Today can feel like that.",
    "Your mind is running faster than your body: it’s not tiredness, it’s noise asking for space.",
    "Some days you wake up already ‘on duty’: one good question can shift the weight.",
    "This morning you might feel in-between: between what you show and what you actually want to live.",
    "You move like always… but there’s a point where you’re not choosing, you’re just continuing.",
    "Before the day takes you hostage, stop for a second: not to decide everything—just to see who you are.",
    "You don’t need a dramatic turning point: sometimes you just need a simple question that holds up a mirror.",
  ],
  es: [
    "Hoy probablemente te esperan trabajo, mensajes, gente que quiere algo de ti y un pensamiento que vuelve siempre.",
    "Esta mañana el mundo arranca antes que tú: notificaciones, cosas por hacer, caras que gestionar… y tú buscando un hilo.",
    "Hay una parte de ti que hace todo ‘bien’, y otra que nunca se siente en casa dentro de esta rutina.",
    "Entre arreglar cosas y fingir, hoy puedes seguir por inercia sin darte cuenta.",
    "Parece una mañana normal, pero debajo hay esa ganas finas de cambiar algo, aunque sea un grado.",
    "¿Conoces esa sensación de hacer mil cosas y aun así llevarte encima algo no dicho? Hoy puede ser así.",
    "La cabeza corre más rápido que el cuerpo: no es cansancio, es ruido pidiendo espacio.",
    "Hay días en los que te despiertas ya ‘en modo deber’: una pregunta buena te cambia el peso.",
    "Esta mañana puedes sentirte en medio: entre lo que muestras y lo que querrías vivir.",
    "Hoy te mueves como siempre… pero hay un punto donde no eliges, solo continúas.",
    "Antes de que el día te tome de rehén, párate un segundo: no para decidirlo todo, solo para verte.",
    "No hace falta una gran vuelta de guion: a veces basta una pregunta simple que te pone delante del espejo.",
  ],
  fr: [
    "Aujourd’hui tu auras sûrement le travail, les messages, des gens qui veulent quelque chose de toi, et une pensée qui revient toujours.",
    "Ce matin le monde démarre avant toi : notifications, choses à faire, visages à gérer… et toi qui cherches un fil.",
    "Il y a une part de toi qui fait tout ‘bien’, et une autre qui ne se sent jamais vraiment chez elle dans cette routine.",
    "Entre réparer et faire semblant, tu risques d’avancer par inertie sans t’en rendre compte.",
    "Ça ressemble à un matin normal, mais dessous il y a ce petit besoin de changer quelque chose, même d’un degré.",
    "Tu connais ce sentiment de faire mille choses et de garder quand même un poids non dit ? Aujourd’hui peut ressembler à ça.",
    "La tête va plus vite que le corps : ce n’est pas la fatigue, c’est le bruit qui demande de la place.",
    "Il y a des jours où tu te réveilles déjà ‘en service’ : une bonne question peut déplacer le poids.",
    "Ce matin tu peux te sentir entre deux : entre ce que tu montres et ce que tu veux vraiment vivre.",
    "Tu bouges comme d’habitude… mais il y a un moment où tu ne choisis pas, tu continues.",
    "Avant que la journée te prenne en otage, arrête-toi une seconde : pas pour tout décider, juste pour te voir.",
    "Pas besoin d’un grand tournant théâtral : parfois une question simple suffit, comme un miroir.",
  ],
  de: [
    "Heute warten wahrscheinlich Arbeit, Nachrichten, Leute die etwas von dir wollen – und ein Gedanke, der immer wiederkommt.",
    "Heute Morgen startet die Welt vor dir: Benachrichtigungen, To-dos, Menschen… und du suchst einen Faden.",
    "Ein Teil von dir macht alles ‘richtig’, und ein anderer fühlt sich in dieser Routine nie wirklich zuhause.",
    "Zwischen Reparieren und So-tun-als-ob kannst du heute aus Gewohnheit weiterlaufen, ohne es zu merken.",
    "Es wirkt wie ein normaler Morgen, aber darunter ist dieser leise Drang, etwas zu ändern – auch nur um ein Grad.",
    "Kennst du das: du machst tausend Dinge und trägst trotzdem etwas Ungesagtes? Heute kann so sein.",
    "Der Kopf rennt schneller als der Körper: das ist nicht nur Müdigkeit, das ist Lärm, der Platz will.",
    "Manche Tage wachst du schon ‘im Pflichtmodus’ auf: eine gute Frage verschiebt das Gewicht.",
    "Heute Morgen kannst du dich dazwischen fühlen: zwischen dem, was du zeigst, und dem, was du leben willst.",
    "Du bewegst dich wie immer… aber es gibt einen Punkt, da wählst du nicht, du machst nur weiter.",
    "Bevor dich der Tag als Geisel nimmt: stopp eine Sekunde – nicht um alles zu entscheiden, nur um dich zu sehen.",
    "Du brauchst keinen dramatischen Umbruch: manchmal reicht eine einfache Frage wie ein Spiegel.",
  ],
};

/* --- WTF SERA (approvato, NON toccare) --- */
const WTF_EVENING_IT = [
  "Che giornata clamorosa eh. Sbatti di qua, sbatti di là, una “bestemmia di manutenzione” ogni tre ore… e ora sei qui che fissi il vuoto. Dai, racconta com’è andata che la sistemiamo insieme, ecchecazz!!!",
  "Complimenti davvero: anche oggi il caos non si è fatto mancare niente. Ora però dimmi tutto, che due risate e una svolta gliela troviamo, ecchecazz!!!",
  "Giornata da incorniciare… e buttare subito nel cassonetto. Prima di andare a dormire storto, raccontami che è successo, ecchecazz!!!",
  "Tra figuracce, pensieri a caso e una “bestemmia creativa” qua e là, direi giornata completa. Dai, dimmi da dove è partita che la raddrizziamo, ecchecazz!!!",
  "Se oggi fosse una serie, sarebbe già alla terza stagione di casino. Riassunto veloce: che è successo? Poi ci pensiamo, ecchecazz!!!",
  "Hai superato pure oggi senza lanciare oggetti pesanti, quindi già vittoria. Ora dimmi tutto e vediamo che ci tiriamo fuori, ecchecazz!!!",
  "Che capolavoro di giornata: stress, sbatti, e quel momento in cui ti parte una “bestemmia di sopravvivenza”. Dai, racconta tutto che la giriamo, ecchecazz!!!",
  "Oggi sembrava andare bene… poi no. Classico. Prima di chiudere gli occhi dimmi com’è finita davvero, ecchecazz!!!",
  "Tra cose fatte male e cose non fatte proprio, direi serata perfetta per parlarne. Sputa il rospo, ecchecazz!!!",
  "Se anche oggi ti ha lasciato la testa in lavatrice, fermati un attimo: dimmi che è successo e ci ridiamo sopra, ecchecazz!!!",
];

const WTF_EVENING = {
  it: WTF_EVENING_IT,
  en: [
    "What a legendary day, huh. Running around, getting hit by life, one “maintenance-blessing swear” every three hours… now tell me how it went, what the f.",
    "Congrats: today chaos didn’t miss a single appointment. Now spill it all—we’ll find a laugh and a turn, what the f.",
    "A day to frame… and toss straight in the trash. Before you sleep crooked, tell me what happened, what the f.",
    "Between awkward moments, random thoughts, and a “creative survival swear” here and there… complete day. Start from the spark, what the f.",
    "If today were a series, it’s already season three of mess. Quick recap: what happened? Then we deal with it, what the f.",
    "You survived today without throwing heavy objects, so that’s already a win. Now tell me everything, what the f.",
    "Masterpiece of a day: stress, hustle, and that moment a “survival swear” escapes you. Tell me the whole thing, what the f.",
    "It looked like it was going fine… then nope. Classic. Before you close your eyes, tell me how it really ended, what the f.",
    "Between things done badly and things not done at all, tonight is perfect to talk. Spit it out, what the f.",
    "If today left your brain in a washing machine, stop a second: tell me what happened and we’ll laugh it back into place, what the f.",
  ],
  es: [
    "Vaya día, eh. De un lado a otro, y una “maldición de mantenimiento” cada tres horas… ahora cuéntame cómo te fue, qué carajo.",
    "Felicidades: hoy el caos no se ha perdido nada. Ahora suéltalo todo, que le encontramos la vuelta, qué carajo.",
    "Un día para enmarcar… y tirar al cubo. Antes de dormir torcido, dime qué pasó, qué carajo.",
    "Entre metidas de pata, pensamientos al azar y una “maldición creativa” por ahí… día completo. Empieza por el principio, qué carajo.",
    "Si hoy fuera una serie, ya iría por la tercera temporada de lío. Resumen rápido: ¿qué pasó? Luego lo arreglamos, qué carajo.",
    "Has sobrevivido sin tirar objetos pesados, así que ya es victoria. Ahora cuéntamelo todo, qué carajo.",
    "Obra maestra de día: estrés, lío, y ese momento en que te sale una “maldición de supervivencia”. Cuéntame todo, qué carajo.",
    "Parecía que iba bien… y luego no. Clásico. Antes de cerrar los ojos, dime cómo terminó de verdad, qué carajo.",
    "Entre cosas mal hechas y cosas ni hechas, hoy es noche perfecta para hablar. Suéltalo, qué carajo.",
    "Si hoy te dejó la cabeza en lavadora, para un segundo: dime qué pasó y nos reímos, qué carajo.",
  ],
  fr: [
    "Quelle journée, hein. À courir partout, et une “bestemmia de maintenance” toutes les trois heures… maintenant raconte-moi, bordel.",
    "Bravo : aujourd’hui le chaos n’a rien raté. Vas-y, dis-moi tout, on va lui trouver un angle, bordel.",
    "Une journée à encadrer… et à jeter direct. Avant de dormir de travers, raconte-moi ce qui s’est passé, bordel.",
    "Entre petites humiliations, pensées en vrac et une “bestemmia créative” par-ci par-là… journée complète. Commence au début, bordel.",
    "Si aujourd’hui était une série, on serait déjà à la saison 3 du bazar. Résumé : qu’est-ce qui s’est passé ? Bordel.",
    "Tu as survécu sans lancer d’objets lourds, donc déjà victoire. Maintenant dis-moi tout, bordel.",
    "Chef-d’œuvre de journée : stress, galère, et ce moment où sort une “bestemmia de survie”. Raconte tout, bordel.",
    "On dirait que ça allait… puis non. Classique. Avant de fermer les yeux, dis-moi comment ça a fini, bordel.",
    "Entre trucs mal faits et trucs pas faits du tout, ce soir est parfait pour en parler. Crache-le, bordel.",
    "Si ta tête est restée dans la machine à laver, stop une seconde : raconte-moi et on s’en marre, bordel.",
  ],
  de: [
    "Was für ein Tag. Hin und her, und alle drei Stunden eine „Wartungs-Bestemmia“… jetzt erzähl’s mir, verdammt nochmal.",
    "Glückwunsch: Heute hat das Chaos keinen Termin ausgelassen. Jetzt raus damit—wir drehen’s irgendwie, verdammt nochmal.",
    "Ein Tag zum Einrahmen… und sofort wegwerfen. Bevor du schief einschläfst: Was ist passiert? Verdammt nochmal.",
    "Zwischen Peinlichkeiten, Zufallsgedanken und einer „kreativen Bestemmia“ hier und da… kompletter Tag. Wo ging’s los? Verdammt nochmal.",
    "Wenn heute eine Serie wäre, wären wir schon Staffel 3 vom Chaos. Kurzer Recap: Was war los? Verdammt nochmal.",
    "Du hast überlebt, ohne schwere Dinge zu werfen—schon Sieg. Jetzt erzähl alles, verdammt nochmal.",
    "Meisterwerk-Tag: Stress, Hektik, und der Moment, wo dir eine „Überlebens-Bestemmia“ rausrutscht. Erzähl’s, verdammt nochmal.",
    "Es sah so aus, als würde es laufen… dann doch nicht. Klassiker. Bevor du die Augen zumachst: Wie endete es wirklich? Verdammt nochmal.",
    "Zwischen schlecht gemacht und gar nicht gemacht: perfekter Abend zum Reden. Raus damit, verdammt nochmal.",
    "Wenn dein Kopf heute in der Waschmaschine gelandet ist: Halt kurz an—erzähl, und wir lachen drüber, verdammt nochmal.",
  ],
};

function buildWhatIfMorningSignal({ lang, slotKey, seed }) {
  const L = normLang(lang);
  const ctxLib = WHATIF_CTX[L] || WHATIF_CTX.it;
  const qLib = WHATIF_Q[L] || WHATIF_Q.it;

  const ctx = ctxLib[seed % ctxLib.length] || ctxLib[0] || "";
  const q = qLib[(seed >>> 1) % qLib.length] || qLib[0] || "";

  // piccolo tweak: se non è morning, lo stesso formato ma senza cambiare “stamattina”
  const txt = `${ctx} ${q}`.trim();
  return finalPunct(sentenceCaseAll(normalizeOneParagraph(txt)));
}

function buildWtfEveningSignal({ lang, seed }) {
  const L = normLang(lang);
  const lib = WTF_EVENING[L] || WTF_EVENING.it;
  const t = lib[seed % lib.length] || lib[0] || "";
  return finalPunct(sentenceCaseAll(normalizeOneParagraph(t)));
}

function pickSignalPhrase({ stile, lang, slot, mood, domanda, userKey }) {
  const L = normLang(lang);
  const slotKey = normSignalSlot(slot);

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const u = String(userKey || "anon").slice(0, 120);

  // ✅ seed condiviso (non include stile) ma include userKey => diverso per utente
  const seedBase = `${L}|${slotKey}|${mood || ""}|${today}|${u}|${domanda || ""}`;
  const seed = hashStr(seedBase);

  // WHAT IF: SOLO MATTINA (se chiamano other slot: fallback mattina)
  if (String(stile) !== "wtf") {
    return buildWhatIfMorningSignal({ lang: L, slotKey, seed });
  }

  // WTF: SOLO SERA (se chiamano other slot: fallback sera)
  return buildWtfEveningSignal({ lang: L, seed });
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

  return Math.max(10, Math.min(95, Math.round(s)));
}

/* ========= WHAT IF: motivazione fallback ========= */
function buildWhatIfMotivation(domanda, lang = "it", pct = 60) {
  const L = (lang || "it").slice(0, 2);
  const t = String(domanda || "").toLowerCase();

  const hasTime = /\b(7|14|21|30|60|90|giorn|settiman|mes|mesi|anni|days?|weeks?|months?|years?)\b/.test(t);
  const hasBudget = /(budget|€|euro|spesa|costo|prezzo|max|under|sotto|caparra|cost|money)/.test(t);
  const hasDeadline = /(entro|prima|scadenza|deadline|by\s+\d|before\s+\d)/.test(t);
  const action =
    /(apri|lancia|impara|studia|scrivi|automatizza|testa|cambia|trova|assumi|costruisci|crea|launch|start|learn|build|create)/.test(t);
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
    if (action) pros.push("hai una leva concreta su cui agire ogni giorno");
    if (riskHedging) {
      pros.push("puoi limitare il rischio con poche regole semplici");
      cons.push("se cerchi rischio zero potresti non muoverti mai davvero");
    }

    if (!pros.length) pros.push("la vera leva è la routine: piccoli passi costanti battono le grandi intenzioni");
    if (!cons.length) cons.push("il collo di bottiglia è la tua energia più che la fortuna");

    return `Probabilità circa ${pct}%. A favore: ${pros[0]}. Contro: ${cons[0]}.`.trim();
  }

  // fallback generico per altre lingue: mantengo la tua logica originale
  return `Estimated probability around ${pct}%.`.trim();
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
    const isSignal = micro && micro.src === "signal";

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ====== STAGE: SIGNAL (NO AI) ====== */
    if (stage === "signal" || isSignal) {
      const slot = micro.slot || micro.timeOfDay || micro.time || "morning";
      const mood = micro.mood || null;
      const userKey = micro.userKey || micro.uid || micro.user || ip || "anon";

      const text = pickSignalPhrase({
        stile,
        lang: L,
        slot,
        mood,
        domanda,
        userKey,
      });

      return res.status(200).json({
        mode: "signal",
        time: normSignalSlot(slot),
        style: stile,
        lang: L,
        periodo,
        model: "signal-local-v2",
        answer: text,
      });
    }

    /* ====== STAGE: CLARIFY ====== */
    if (stage === "clarify") {
      const messages = buildClarifyMessages({ domanda, stile, lang: L, periodo, micro });

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
      if (stile !== "wtf") clarQ = stripFirstPerson(clarQ, L, stile);
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
          if (["Ah","Oh","Ehi","Sai","Occhio","Piano","Fermati","Aspetta","La","Le","Una","Il","Qui","Tu"].includes(m)) return m;
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
    }

    if (stile === "wtf" && L === "it") {
      let count = 0;
      answer = answer.replace(/\blampion[ei]\b/gi, (m) => {
        count += 1;
        return count > 1 ? "semaforo" : m;
      });
      answer = answer.replace(/\bspippolat\w*/gi, "rimuginata");
    }

    const isSurprise = !!(micro && (micro.surprise === true || micro.src === "surprise"));
    if (stile === "wtf" && L === "it" && !/bestemmi\w*/i.test(answer)) {
      const seed = hashStr(String(domanda || "") + "|" + String(answer || ""));
      if (seed % 100 < 65) {
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
      } catch {
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
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
                  }
