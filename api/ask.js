// /api/ask.js — What?f Engine completo (WhatIf + WTF + segnali giornalieri + admin stats)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const hasRedis =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = hasRedis
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

const rl = hasRedis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
    })
  : null;

// Wrapper tollerante
let rateOk = async () => true;
try {
  rateOk = async (key) => {
    if (!rl) return true;
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

/* ========= Admin Token ========= */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const headerToken = String(req.headers["x-admin-token"] || "");
  return headerToken === ADMIN_TOKEN;
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
- Tono: veggente realista, voce calda, empatica, concreta.
- 3–6 frasi, un solo paragrafo, niente elenco, niente emoji.
- APRI con UNA frase breve che sembra un’osservazione sul presente.
- La SECONDA frase inizia con "Vedo", "Sento", "Immagino", "Intuisco", "Si apre" o "Si muove".
- 60% analisi concreta (routine, tempo, costi/benefici, energia, corpo, relazioni) + 40% immagini di quotidianità.
- Futuro vicino: usa soprattutto condizionale/futuro (“potresti”, “inizierai”, “probabilmente…”).
- Mantieni la risposta aderente al tema della domanda (salute, lavoro, città, relazione, soldi…).
- Inserisci almeno UN punto non ovvio: un costo nascosto, una conseguenza pratica o un effetto su identità/relazioni.
- Pro e contro reali: non drammatizzare, ma neanche minimizzare.
- Alla fine porta uno spunto o un piccolo consiglio pratico fuso nell’ultima frase.
- Niente prima persona narrativa (“io, noi, mi”).`;

const WHATIF_RULE_PAST_IT = `WHAT IF (italiano, PASSATO CONTROFATTUALE – SCENARIO ALTERNATIVO + LEZIONE UMANA):
- Tono: amico sincero con un filo di misticismo.
- 3–6 frasi, paragrafo unico, niente elenco, niente emoji.
- Descrivi come sarebbe andata se quella scelta l’avessi fatta davvero:
  • in cosa ti saresti sentito più leggero;
  • quali pesi nuovi ti saresti messo addosso;
  • cosa avresti perso rispetto a oggi.
- Usa struttura controfattuale (“se avessi…, ti saresti trovato…, avresti pagato…”).
- Almeno un’osservazione non scontata.
- Poi porta tutto nel presente: cosa impari, cosa puoi ancora scegliere ora.
- Tono ottimista e di conforto, senza self-help stucchevole.
- L’ultima frase contiene una piccola regola concreta per le scelte future, integrata nel discorso.
- Niente prima persona narrativa (“io, noi, mi”).`;

/* ========= Finali “gancio” WHAT IF ========= */
const ZINGARA_ENDINGS = {
  it: {
    future: [
      "E piano piano ti rendi conto che conta più come ti tratti ogni giorno che la singola decisione di oggi.",
      "E quasi senza accorgertene inizi a capire che la svolta vera è nel modo in cui ti prendi cura di te.",
      "E alla fine ti accorgi che non stai salvando il mondo, ma ti stai dando un modo più gentile di viverci.",
    ],
    past: [
      "E guardando quella versione di te capisci che non era la scelta perfetta, solo un modo diverso di complicarti la vita.",
      "Da fuori ti rendi conto che non hai buttato via la vita, l’hai solo portata su un binario diverso da imparare a usare.",
      "E lì cominci a usare quel rimpianto più come un promemoria per le prossime scelte che come una condanna.",
    ],
  },
  en: {
    future: [
      "And there you notice it’s less about miracles and more about how you show up every day.",
    ],
    past: [
      "You’d probably see it wasn’t the perfect choice, just a different one you’d have to live with.",
    ],
  },
  es: {
    future: [
      "Y ahí notarás que importa más cómo vives tus días que el escenario perfecto en tu cabeza.",
    ],
    past: [
      "Y quizá hoy verías que no era la decisión perfecta, solo otra forma de complicarte distinto.",
    ],
  },
  fr: {
    future: [
      "Et là tu verras que ce qui compte surtout, c’est comment tu vis tes journées, pas le décor exact.",
    ],
    past: [
      "Et tu comprendras que ce n’était pas le “bon” choix ou le “mauvais”, juste un chemin différent à assumer.",
    ],
  },
  de: {
    future: [
      "Und dort merkst du, dass nicht der große Knall zählt, sondern wie du deinen Alltag wirklich baust.",
    ],
    past: [
      "Vielleicht spürst du dann, dass es keine perfekte Entscheidung war, sondern nur ein anderer Weg mit seinen eigenen Preisen.",
    ],
  },
};

/**
 * Finale WHAT IF:
 * - In ITALIANO lasciamo finale naturale, solo sistemiamo punteggiatura.
 * - In altre lingue possiamo aggiungere un piccolo gancio.
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

  const last =
    (s.match(/([^.!?…]+[.!?…])\s*$/) || [])[1] || s;
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
  const isSurprise =
    !!(micro && (micro.surprise === true || micro.src === "surprise"));

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
- Puoi usare UNA micro-scenetta (frigorifero che ti giudica, tazzina che vibra, sedia che ti guarda storto, vicino che alza il sopracciglio).
- Ogni volta inventi una scena nuova: NON riutilizzare sempre le stesse metafore o oggetti, e gli oggetti devono avere senso nella scena (niente citofoni nel deserto, niente ascensori in spiaggia, niente barista se non c’è un bar/locale nella domanda).
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
- Include at least ONE non-obvious angle.
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
- Inserisci almeno un dettaglio non ovvio.
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
Usa il barista o il bancone SOLO se la domanda parla davvero di bar/locale.

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
            : L === "fr"
            ? "FRANCESE"
            : "TEDESCO";

        sys = `Sei “WHAT IF”: voce lucida e concreta, da amico che sa ragionare bene sui pro e contro.
Ti interessa capire i vincoli veri per poter dare consigli pratici.
Mantieni grammatica pulita ed evita ripetizioni inutili.

COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Punta su 1–2 dettagli che spostano davvero l’analisi.
- Inserisci almeno un elemento che faccia dire “ah, non ci avevo pensato”.
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
- La prima frase è breve (max 15 parole) e va dritta alla scena.
- Seconda persona: “ti scappa”, “ti ritrovi”, “ti parte”, “resti lì come un cretino simpatico”.
- Parolacce da bar (culo, chiappe, incasinato, figuraccia, casino…), MAI insulti a gruppi, MAI usare la parola “merda”.
- Di solito UNA sola “bestemmia” narrata, creativa e tra virgolette (“bestemmia di ritorno”, ecc.) con formule vive tipo “ti parte una…”.
- Oggetti e ambiente reagiscono (divano, finestra, trolley, lampada, piccione, tazzina, porta, sedia, specchio, ascensore, pc, citofono…), massimo 3–5 elementi.
- Cambiali spesso e usali solo se hanno senso nella scena.
- Nessun motivazionalese zuccheroso, niente teoria astratta.

COMPITO (FUTURO):
- Mostra DUE film:
  • film A: cosa succede se lo fai sul serio;
  • film B: cosa succede se continui a tirarla lunga.
- I pro/contro sono dentro la scena, non in elenco: sensazioni, figuracce, piccoli sollievi.

FORMATO:
- 3–5 frasi, un paragrafo solo, circa 90–130 parole.
- Italiano da bar ma corretto, niente emoji.
- L’ULTIMA frase chiude con mini-morale sporca concreta e termina con “ecchecazz!!!”.`;

const WTF_RULE_IT_PAST = `Sei “WHAT THE F” in modalità FLASHBACK.
Racconti la vita alternativa in cui avevi fatto l’altra scelta.

TONO:
- Seconda persona (“ti saresti ritrovato”, “ti sarebbero esplose in faccia”…).
- Parolacce da bar (culo, chiappe, incasinato, figuraccia, casino…), MAI insulti a categorie, MAI usare la parola “merda”.
- Di solito UNA “bestemmia” narrata (“bestemmia nostalgica”, ecc.) con formule tipo “ti sarebbe partita una…”.
- Oggetti commentano (divano, pc, bicchiere, finestra, porta, tazzina, tv che borbotta, corridoio…).

COMPITO:
- Descrivi pro scemi ma veri e contro scemi ma pesanti.
- Porta la scena fino a oggi e guardala da fuori con ironia.
- Niente finali edificanti: consapevolezza ridendo delle tue manie.

FORMATO:
- 3–5 frasi, un solo paragrafo, circa 90–130 parole.
- Nessun elenco, nessuna emoji.
- L’ULTIMA frase chiude su un gesto/oggetto e finisce con “ecchecazz!!!”.`;

const WTF_RULE_EN_FUT = `You are “WHAT THE F”: a rough, foul-mouthed but very cultured and pissed-off narrator.
You roast every decision with love and swear words, but never attack identities or groups.

TASK (FUTURE):
- Show what happens if they actually do this and what happens if they keep delaying.
- Single mini-episode, not a novel.
- Last sentence: blunt, foul-mouthed line like a crooked summary.

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
- Parolacce leggere da bar, ma MAI bestemmie reali, MAI insulti a categorie o identità, MAI usare la parola “merda”.
- La parola “bestemmia” va usata solo in modo narrato con aggettivi creativi.
- Evita parole zuccherose e termini teorici (“mindset”, ecc.).
- Non racchiudere l’intero testo tra virgolette.`
    : L === "en"
    ? `RULES WHAT IF:
- Single paragraph, no bullets, no emojis.
- Do NOT restate the question.
- SECOND PERSON (“you / your”) for the user.
- Avoid first person (“I, me, we, us”).
- Include at least ONE non-obvious insight.
- Grammar clean, short sentences.`
    : `REGOLE WHAT IF:
- Un solo paragrafo, niente elenchi, niente emoji.
- NON ripetere la domanda.
- Usa la seconda persona (tu / ti / te / tuo).
- Evita la prima persona narrativa (“io, noi, mi”).
- Inserisci almeno un elemento che faccia dire “cavolo, non ci avevo pensato”.`;

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
        )}. Usa 1–2 di questi elementi per immagini e metafore.
Evita di fissarti sempre sugli stessi oggetti: varia spesso le cose che reagiscono nella scena e scegli oggetti che abbiano senso nella situazione descritta.`,
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
        return `Original question (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE answer in ENGLISH as “WHAT IF”: first analyse different scenarios, then clearly suggest what makes more sense and how to act, and add at least one non-obvious insight.`;
      }
      if (isPast) {
        return `Question about the PAST (do not repeat it): "${domanda}". Write ONE COUNTERFACTUAL answer in ENGLISH, including at least one hidden trade-off or consequence the user is likely overlooking.`;
      }
      return `Question (do not repeat it): "${domanda}". Write ONE answer in ENGLISH as “WHAT IF”: analyse different scenarios and then give clear, practical advice, adding at least one surprising but realistic angle the user might have missed.`;
    }

    if (L === "it") {
      if (isWtf) {
        if (hasClar) {
          return `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo: "${c}".
Genera UNA risposta in ITALIANO come voce “WHAT THE F”, nello stesso stile degli esempi:
- monologo unico, 3–5 frasi, circa 90–130 parole;
- apertura che ti prende per il culo;
- mostra DUE film: se fai davvero questa scelta e se resti fermo;
- pro/contro dentro le scenette;
- chiusura secca con “ecchecazz!!!”.`;
        }
        return `Domanda (non ripeterla): "${domanda}".
Genera UNA risposta in ITALIANO come voce “WHAT THE F”, con il respiro degli esempi:
- monologo unico, 3–5 frasi;
- apertura da presa in giro;
- fai vedere cosa succede se lo fai e se continui a tirarla lunga;
- chiudi con colpo secco e “ecchecazz!!!”.`;
      }

      if (hasClar) {
        if (isPast) {
          return `Domanda sul PASSATO (non ripeterla): "${domanda}". Dettaglio aggiuntivo: "${c}". Genera UNA risposta CONTROFATTUALE in ITALIANO come “WHAT IF”: racconta come sarebbe andata quella vita alternativa, porta almeno un dettaglio non ovvio e chiudi collegando la lezione al presente in modo concreto e gentile.`;
        }
        return `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo: "${c}". Genera UNA risposta in ITALIANO come “WHAT IF”: pochi scenari concreti, pro e contro reali, almeno un punto non ovvio, chiusura con spunto pratico dentro l’ultima frase.`;
      }
      if (isPast) {
        return `Domanda sul PASSATO (non ripeterla): "${domanda}". Genera UNA risposta CONTROFATTUALE in ITALIANO come “WHAT IF”: descrivi come sarebbe andata quella scelta (pro e contro reali), porta almeno un dettaglio inaspettato e chiudi collegando la lezione al presente.`;
      }
      return `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO come “WHAT IF”: apri con un’osservazione sul presente, mostra cosa succede se fai questa scelta e se resti fermo, evidenzia pro/contro reali e chiudi con uno spunto pratico nell’ultima frase.`;
    }

    if (L === "es") {
      return hasClar
        ? `Pregunta original (no la repitas): "${domanda}". Detalle adicional: "${c}". Escribe UNA respuesta en ESPAÑOL, clara y concreta, en un solo párrafo, con al menos un ángulo no obvio.`
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

/* ========= SEGNALI GIORNO (mattina/pomeriggio/sera) ========= */
/**
 * buildSignalMessages:
 * - morning: phase 1 WHAT IF (frase BREVE di visione/consiglio), phase 2 WTF (roast dopo 5 min)
 * - afternoon:
 *    phase 1 WHAT IF: domanda breve sul MOOD ("come va il pomeriggio?")
 *    phase 2 WHAT IF: mini-consiglio sul pomeriggio in base al mood
 *    phase 2 WTF: commento cazzaro sul pomeriggio
 * - evening: phase 1 WHAT IF (consiglio finale + invito a parlarne), phase 2 WTF (chiusura da bar)
 */
function buildSignalMessages({
  slot = "morning",
  phase = 1,
  mood = null,
  lang = "it",
  stile = "whatif",
  domanda = "",
}) {
  const L = normLang(lang);
  const s = String(slot || "morning").toLowerCase();
  const ph = Number(phase) || 1;
  const isPhase1 = ph === 1;
  const moodLabel = (mood || "").toString().toLowerCase();

  let sys;
  let user;

  if (L === "it") {
    // ========== MATTINO ==========
    if (s === "morning") {
      if (stile === "whatif" && isPhase1) {
        sys = `Sei “WHAT IF” in MODALITÀ CONSIGLIO DEL MATTINO.
REGOLE:
- Frase o due FRASI BREVI: massimo 35–40 parole in totale.
- Non inventare diagnosi (“sei distrutto”, “sei felice”), ma resta neutro.
- Dai una micro-visione di come POTREBBE andare la giornata se ti tratti bene (energia, tempo, confini).
- Tono: calmo, concreto, rassicurante.
- Nell’ultima parte inserisci un invito leggerissimo a chiedere di più se vuole guardare meglio la situazione.
- Nessuna emoji, nessun elenco.`;
        user = `Scrivi il consiglio del mattino in ITALIANO: 1–2 frasi brevi, una piccola visione sul tono della giornata e un invito morbido a parlarne meglio se serve.`;
      } else if (stile === "wtf" && !isPhase1) {
        sys = `Sei “WHAT THE F” in MODALITÀ ROAST DEL MATTINO.
REGOLE:
- Commenti in modo sarcastico il fatto che prima è arrivato un “consiglio del mattino” sensato.
- 2 frasi, massimo 60 parole totali, un solo paragrafo.
- Tono: narratore da bancone, affettuosamente cattivo.
- Parolacce leggere da bar ok, MAI bestemmie reali, MAI insulti a categorie, MAI usare la parola “merda”.
- Puoi nominare “bestemmia” solo in senso narrato.
- Chiudi sempre con una mini-morale storta tipo “o ti muovi un minimo o ti ritrovi a litigare col cuscino” e termina con “ecchecazz!!!”.`;
        user = `Scrivi il commento di WHAT THE F in ITALIANO sul consiglio del mattino: 2 frasi, tono da bar, finale con colpo secco e “ecchecazz!!!”.`;
      } else {
        sys = `Sei “WHAT IF” in modalità segnale del mattino di fallback.`;
        user = `Scrivi una sola frase di consiglio semplice in ITALIANO.`;
      }
    }

    // ========== POMERIGGIO ==========
    else if (s === "afternoon") {
      // Phase 1: domanda MOOD
      if (stile === "whatif" && isPhase1) {
        sys = `Sei “WHAT IF” in MODALITÀ DOMANDA MOOD POMERIGGIO.
REGOLE:
- Una sola frase, massimo 20 parole.
- Chiedi come sta andando il pomeriggio, con tono leggero e pratico.
- La frase deve preparare ai bottoni di umore (bene / così così / a pezzi, ecc.).
- Niente emoji, niente elenco.`;
        user = `Scrivi UNA frase breve in ITALIANO per chiedere all’utente come sta andando il pomeriggio, in modo leggero e concreto, pronta ad avere i bottoni di umore sotto.`;
      }
      // Phase 2: risposta sul pomeriggio (WHAT IF)
      else if (stile === "whatif" && !isPhase1) {
        const moodHint = moodLabel
          ? `L’utente ha scelto un umore: "${moodLabel}". Usa il tono coerente (più morbido se è giù, più diretto se è carico).`
          : `Non conosci il dettaglio preciso dell’umore, sai solo che è un check-in di metà giornata.`;

        sys = `Sei “WHAT IF” in MODALITÀ RISPOSTA POMERIGGIO.
${moodHint}
REGOLE:
- 2–3 frasi brevi, massimo 70 parole.
- Prima riconosci il tipo di pomeriggio, senza psicodrammi.
- Poi dai 1–2 micro-aggiustamenti pratici (cosa alleggerire, dove non strafare, cosa proteggere fino a stasera).
- Tono concreto, gentile, senza slogan motivazionali.
- Nell’ultima frase puoi suggerire che, se vuole, può approfondire meglio la situazione.`;
        user = `Scrivi la risposta di CHECK-IN del pomeriggio in ITALIANO, 2–3 frasi brevi, usando l’umore scelto per dare un mini-aggiustamento pratico al resto della giornata.`;
      }
      // WTF pomeriggio (phase 2)
      else if (stile === "wtf" && !isPhase1) {
        const moodPart = moodLabel
          ? `Hai solo questa etichetta di umore: "${moodLabel}".`
          : `Sai solo che è un check-in di metà giornata.`;

        sys = `Sei “WHAT THE F” in MODALITÀ COMMENTO POMERIGGIO.
${moodPart}
REGOLE:
- 2–3 frasi, un solo paragrafo, massimo 80 parole.
- Descrivi la scena del pomeriggio come un cliente abituale appoggiato al bancone o alla scrivania.
- Oggetti quotidiani che reagiscono (scrivania, pc, tram, tazzina, divano, corridoio…).
- Parolacce leggere da bar ok, MAI bestemmie reali, MAI insulti a categorie, MAI usare la parola “merda”.
- Una sola “bestemmia” narrata, se serve.
- Chiudi con mini-morale storta e invito cazzaro ma affettuoso a “non far finta di niente” e parlarne meglio, con finale “ecchecazz!!!”.`;
        user = `Scrivi il commento di WHAT THE F sul pomeriggio in ITALIANO, 2–3 frasi, tono da bar, chiusura con mini-morale e “ecchecazz!!!”.`;
      } else {
        sys = `Sei “WHAT IF” in modalità segnale pomeriggio di fallback.`;
        user = `Scrivi una breve frase neutra di check-in in ITALIANO.`;
      }
    }

    // ========== SERA ==========
    else if (s === "evening") {
      if (stile === "whatif" && isPhase1) {
        sys = `Sei “WHAT IF” in MODALITÀ CHIUSURA SERALE.
REGOLE:
- 2–3 frasi brevi, massimo 70 parole.
- Riconosci che la giornata sta chiudendo senza fare poesia.
- Aiuta a mettere a fuoco UNA cosa che ha senso tenere o mollare per domani.
- Nell’ultima frase inserisci un invito gentile a parlarne meglio o a fare una domanda più precisa se vuole scaricare la testa.
- Niente emoji, niente elenco.`;
        user = `Scrivi il messaggio serale in ITALIANO: 2–3 frasi brevi, una chiusura concreta della giornata e un invito leggero a parlarne meglio se ne sente il bisogno.`;
      } else if (stile === "wtf" && !isPhase1) {
        sys = `Sei “WHAT THE F” in MODALITÀ CHIUSURA SERALE.
REGOLE:
- 2–3 frasi, 60–100 parole, un solo paragrafo.
- Racconti la fine della giornata come l’ultimo giro al bancone o davanti al frigo aperto.
- Oggetti da sera (divano, piatti nel lavandino, luce del frigo, corridoio, pigiama, tram vuoto, tazzina, bicchiere…).
- Parolacce leggere ok, MAI bestemmie reali, MAI insulti a categorie, MAI usare la parola “merda”.
- Una sola “bestemmia” narrata se serve.
- Chiudi con una mini-morale storta tipo “almeno non fai finta che sia tutto ok” e un invito a svuotare il cestino mentale, con finale “ecchecazz!!!”.`;
        user = `Scrivi il messaggio di chiusura serale in ITALIANO come WHAT THE F, in un solo paragrafo, chiudendo con invito a “svuotare il cestino mentale” e “ecchecazz!!!”.`;
      } else {
        sys = `Sei “WHAT IF” in modalità serale di fallback.`;
        user = `Scrivi una sola frase serale neutra in ITALIANO.`;
      }
    }

    // ========== fallback generico IT ==========
    else {
      sys = `Sei “WHAT IF”. Modalità segnale generica. Una frase breve e neutra, tono pratico.`;
      user = `Scrivi una sola frase in ITALIANO.`;
    }
  } else if (L === "en") {
    // Versione semplice EN
    if (s === "morning" && stile === "whatif" && isPhase1) {
      sys = `You are “WHAT IF” in MORNING ADVICE mode.
Give 1–2 short, concrete sentences to start the day lighter and clearer, and end with a soft invitation to go deeper if they want. No emojis, no bullets.`;
      user = `Write the morning advice in ENGLISH, following the rules above.`;
    } else if (s === "morning" && stile === "wtf" && !isPhase1) {
      sys = `You are “WHAT THE F” reacting to a previous smart morning tip.
Roast the idea of “fixing life with one notification”, then end with a crooked invitation to talk more. 2–3 sentences, one paragraph.`;
      user = `Write the WHAT THE F morning follow-up in ENGLISH.`;
    } else {
      sys = `You are in signal mode. Write one short, neutral sentence.`;
      user = `Write one short sentence in ENGLISH.`;
    }
  } else {
    // altre lingue: fallback semplice
    sys = `You are in signal mode. Short answer, one paragraph, no emojis.`;
    user = `Write one short sentence for a daily signal in the appropriate language.`;
  }

  return [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];
}

/* ========= Server-side PCT ========= */
function computePct(domanda, stile) {
  const t = String(domanda || "").toLowerCase();
  let s = 55;

  if (/\b(7|14|21|30|60|90)\b/.test(t)) s += 10;
  if (/\b\d+([.,]\d+)?\b/.test(t)) s += 6;
  if (/budget|€|euro|spesa|max|under|sotto|prezzo|costo/.test(t)) s += 6;
  if (/senza|solo|al massimo|minimo|entro|prima delle|ogni|per/.test(t)) s += 8;
  if (/lancia|apri|impara|scrivi|chiedi|corri|studia|automatizza|testa|cambia|trasferisc/i.test(t))
    s += 6;
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

  const hasTime = /\b(7|14|21|30|60|90|giorn|settiman|mes|mesi|anni|days?|weeks?|months?|years?)\b/.test(
    t
  );
  const hasBudget = /(budget|€|euro|spesa|costo|prezzo|max|under|sotto|caparra|cost|money)/.test(
    t
  );
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
async function generateMotivationLLM({
  domanda,
  clarification,
  answer,
  lang,
  pct,
}) {
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
      ? `Pregunta: "${domanda}". Detalle extra: "${clarification || ""}". Respuesta principale: "${answer}". Escribe UNA frase de motivación en ESPAÑOL.`
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
- NON ammorbidire il lessico;
- correggi solo errori grammaticali evidenti, concordanze, ripetizioni troppo ravvicinate;
- non cambiare pronomi o persona verbale, a meno che la frase non sia davvero scorretta;
- mantieni lunghezza simile e un unico paragrafo;
- NON trasformare “bestemmia” in bestemmie reali o riferimenti religiosi;
- non racchiudere tutto il testo tra virgolette.`
        : `Sei un correttore di bozze.
Prendi il testo seguente e:
- mantieni intatto senso e tono;
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

  // togli virgolette all'inizio/fine del blocco
  s = s.replace(/^["“”']+/, "").replace(/["“”']+$/, "").trim();

  // togli eventuali ecchecazz duplicati già presenti
  s = s.replace(/\s*ecchecazz!+$/gi, "");

  // togli eventuali "ecc" finali
  s = s.replace(/\s*ecc[.,!?…]*$/gi, "");

  // togli punti finali, spazi e segni vari
  s = s.replace(/[\s.!?…]+$/g, "").trim();
  if (!s) return "ecchecazz!!!";

  return `${s}, ecchecazz!!!`;
}

/* ========= WTF: aggiustamento oggetti in base al contesto ========= */
function adjustWtfContextObjects(answer = "", domanda = "") {
  let s = String(answer || "");
  const q = String(domanda || "").toLowerCase();

  // Contesto bar / locale
  const isBarContext = /\b(bar|locale|pub|osteria|taverna|spritz|aperitivo|cocktail|birra|vino|caff[èe]|cappuccino|bancone)\b/.test(
    q
  );
  if (isBarContext) return s; // in questo caso il barista è ok

  // Contesto casa
  const isHome =
    /\b(casa|divano|salotto|soggiorno|letto|camera|cucina|netflix|playstation|console|pigiama)\b/.test(
      q
    );

  // Contesto ufficio / lavoro
  const isOffice =
    /\b(ufficio|lavoro|riunione|call|zoom|teams|azienda|open space|scrivania|collega|capo|deadline)\b/.test(
      q
    );

  // Contesto spostamenti / viaggio
  const isTravel =
    /\b(treno|stazione|metro|metropolitana|autobus|bus|tram|macchina|auto|traffico|volo|aereo|aeroporto)\b/.test(
      q
    );

  // Contesto palestra / sport
  const isGym =
    /\b(palestra|allenamento|correre|corsa|pes[ie]|tapis roulant|bike|sport|partita|campo)\b/.test(
      q
    );

  // Contesto studio / esami
  const isStudy =
    /\b(scuola|università|uni\b|esame|esami|studio|biblioteca|tesi|compiti|compito|interrogazione|concorso)\b/.test(
      q
    );

  const homeOpts = [
    "divano",
    "telecomando",
    "frigorifero",
    "lampada",
    "gatto",
    "piatti nel lavandino",
  ];
  const officeOpts = [
    "collega",
    "scrivania",
    "monitor",
    "stampante",
    "badge",
    "macchinetta del caffè",
  ];
  const travelOpts = [
    "passeggero",
    "controllore",
    "sedile del treno",
    "finestrino",
    "valigia",
    "altoparlante della stazione",
  ];
  const gymOpts = [
    "panca",
    "tappetino",
    "specchio della sala pesi",
    "armadietto",
    "bilanciere",
    "tapis roulant",
  ];
  const studyOpts = [
    "scrivania ingombra",
    "libro aperto",
    "evidenziatore",
    "zaino buttato per terra",
    "pc portatile",
    "lampada da tavolo",
  ];
  const defaultOpts = [
    "tazzina",
    "divano",
    "scrivania",
    "telefono",
    "pc",
    "frigorifero",
    "citofono",
    "corridoio",
  ];

  let pool = defaultOpts;
  if (isHome) pool = homeOpts;
  else if (isOffice) pool = officeOpts;
  else if (isTravel) pool = travelOpts;
  else if (isGym) pool = gymOpts;
  else if (isStudy) pool = studyOpts;

  // sostituisci "barista" solo se NON siamo in contesto bar
  s = s.replace(/\b[Bb]arista\b/g, (m) => {
    const idx = hashStr(domanda + m) % pool.length;
    return pool[idx];
  });

  return s;
}

/* ========= LOGGING SU REDIS (semplice) ========= */

async function logRequestMeta(meta) {
  if (!hasRedis || !redis) return;
  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10); // UTC va comunque bene per contare al giorno
    const statsKey = `whatif:stats:${day}`;
    const logKey = `whatif:log:${day}`;

    const styleField = `style:${meta.stile || "unknown"}`;

    await redis.hincrby(statsKey, "total", 1);
    await redis.hincrby(statsKey, styleField, 1);
    if (meta.src === "signal") {
      await redis.hincrby(statsKey, "signals", 1);
    }

    const entry = {
      ts: now.toISOString(),
      stage: meta.stage || "answer",
      style: meta.stile || "whatif",
      lang: meta.lang || "it",
      periodo: meta.periodo || "future",
      src: meta.src || null,
      domanda: String(meta.domanda || "").slice(0, 140),
      pct: typeof meta.pct === "number" ? meta.pct : null,
    };

    await redis.lpush(logKey, JSON.stringify(entry));
    await redis.ltrim(logKey, 0, 49); // ultime 50
    await redis.expire(statsKey, 60 * 60 * 24 * 15);
    await redis.expire(logKey, 60 * 60 * 24 * 15);
  } catch {
    // non bloccare la risposta se logging fallisce
  }
}

async function handleAdminStats(req, res) {
  if (!isAdmin(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!hasRedis || !redis) {
    return res.status(500).json({ error: "no_redis", detail: "Redis non configurato" });
  }
  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const statsKey = `whatif:stats:${day}`;
    const logKey = `whatif:log:${day}`;

    const stats = (await redis.hgetall(statsKey)) || {};
    const raw = (await redis.lrange(logKey, 0, 49)) || [];

    const last = raw
      .map((x) => {
        try {
          return JSON.parse(x);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return res.status(200).json({
      mode: "admin_stats",
      date: day,
      stats: {
        total: Number(stats.total || 0),
        whatif: Number(stats["style:whatif"] || 0),
        wtf: Number(stats["style:wtf"] || 0),
        signals: Number(stats.signals || 0),
      },
      last,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ error: "admin_stats_error", detail: String(e?.message || e) });
  }
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    const ip = (
      req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      "unknown"
    )
      .toString()
      .split(",")[0]
      .trim();
    const ok = await rateOk(`ask:${ip}`);
    if (!ok) return res.status(429).json({ error: "rate_limited_minute" });

    const bodyRaw =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    const body =
      bodyRaw && typeof req.body === "string"
        ? JSON.parse(bodyRaw)
        : req.body || {};

    const {
      admin = null,
      stage = "answer", // "clarify" | "answer"
      domanda = "",
      clarification = "",
      stile = "whatif", // "whatif" | "wtf"
      lang = "it",
      periodo = "future", // "future" | "past"
      micro = {},
    } = body || {};

    const L = normLang(lang);
    const isSignal = micro && micro.src === "signal";

    /* ====== ADMIN: STATS ====== */
    if (admin === "stats") {
      return await handleAdminStats(req, res);
    }

    // Per le chiamate normali chiediamo una domanda vera.
    // Per i segnali, basta un placeholder non vuoto.
    if (!domanda || typeof domanda !== "string") {
      return res
        .status(400)
        .json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ====== STAGE: CLARIFY ====== */
    if (stage === "clarify") {
      const messages = buildClarifyMessages({
        domanda,
        stile,
        lang: L,
        periodo,
        micro,
      });

      const isSurprise =
        micro && (micro.surprise === true || micro.src === "surprise");

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

      await logRequestMeta({
        stage: "clarify",
        stile,
        lang: L,
        periodo,
        src: micro?.src || null,
        domanda,
      });

      return res.status(200).json({
        mode: "clarify",
        clarifyingQuestion: clarQ,
        style: stile,
        lang: L,
        periodo,
        model: MODEL,
      });
    }

    /* ====== STAGE: ANSWER / SIGNAL ====== */
    let messages;
    if (isSignal) {
      const slot = micro.slot || micro.time || micro.timeOfDay || "morning";
      const phase = micro.phase ?? micro.step ?? 1;

      messages = buildSignalMessages({
        slot,
        phase,
        mood: micro.mood || null,
        lang: L,
        stile,
        domanda,
      });
    } else {
      // Flusso normale: risposta alla domanda
      messages = buildMessages({
        domanda,
        clarification,
        lang: L,
        periodo,
        stile,
      });
    }

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

    // Rimuovi eco domanda (solo se non è un segnale)
    if (!isSignal) {
      answer = stripQuestionEcho(domanda, answer);
    }

    // Polish grammaticale
    answer = await polishAnswer({ text: answer, lang: L, stile });

    // Limita frasi e parole, normalizza
    if (stile === "wtf") {
      answer = tightenSentences(answer, 5); // max 5 frasi
      answer = clampWords(answer, 130);
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
      answer = answer.replace(/\bcoccol\w*/gi, "botta");
      answer = answer.replace(/\bprocrastinazion\w*/gi, "tirarla lunga");
      answer = answer.replace(/\bmagari domani\b/gi, "poi, poi, poi");
      answer = answer.replace(/\bvivere vuol dire[^.?!]*[.?!]/gi, "");
      answer = answer.replace(/\bvuol dire che[^.?!]*[.?!]/gi, "");
      answer = answer.replace(/\bsignifica che[^.?!]*[.?!]/gi, "");
      answer = answer.replace(/\brimando\b/gi, "tirarla lunga");
      answer = answer.replace(
        /\bviaggiatore della nostalgia\b/gi,
        "turista del destino"
      );
      answer = answer.replace(
        /\ballegria nel cuore\b/gi,
        "quella voglia storta di rimetterti in gioco"
      );
      answer = answer.replace(/\bmadò\b/gi, "");
      answer = answer.replace(/\bspippolat\w*/gi, "rimuginata");
    }

    // Strip prima persona per WHAT IF
    if (stile !== "wtf") {
      answer = stripFirstPerson(answer, L, stile);
    }

    // Sostituisci “cazzo” con “azzo”
    if (stile === "wtf" && L === "it") {
      answer = answer.replace(/\bcazz\w*/gi, (m) =>
        m.replace(/cazz/gi, "azz")
      );
    }

    // Rimuovi qualsiasi "merd*" residuo
    if (stile === "wtf" && L === "it") {
      answer = answer.replace(/\bmerd\w*\b/gi, "schifo");
    }

    // Evita fissazione sui “lampioni”
    if (stile === "wtf" && L === "it") {
      let count = 0;
      answer = answer.replace(/\blampion[ei]\b/gi, (m) => {
        count += 1;
        return count > 1 ? "semaforo" : m;
      });
    }

    // Aggiusta oggetti fuori contesto (es. barista senza bar)
    if (stile === "wtf" && L === "it") {
      answer = adjustWtfContextObjects(answer, domanda);
    }

    const isSurprise =
      !!(micro && (micro.surprise === true || micro.src === "surprise"));

    // Se in WTF IT non c'è nessuna "bestemmia" narrata, aggiungine UNA a volte
    if (stile === "wtf" && L === "it" && !/bestemmi\w*/i.test(answer)) {
      const seed = hashStr(String(domanda || "") + "|" + String(answer || ""));
      if (seed % 100 < 65) {
        answer =
          answer.replace(/\s*[.!?…]*$/, "") +
          `, e ti scappa una "bestemmia di manutenzione" che fa vibrare pure la tazzina sul tavolo`;
      }
    }

    // Finale “ecchecazz!!!” per WTF
    if (stile === "wtf") {
      answer = ensureWtfEcchecazzEnding(answer, L);
    }

    // Finale “gancio zíngara” per WHAT IF
    if (stile === "whatif") {
      answer = ensureZingaraEnding({ text: answer, lang: L, periodo, domanda });
    }

    answer = finalPunct(answer);

    // Se è un SEGNALE, non calcoliamo pct/motivation/scientific.
    if (isSignal) {
      const slot = micro.slot || micro.time || micro.timeOfDay || "morning";
      const phase = micro.phase ?? micro.step ?? 1;

      await logRequestMeta({
        stage: "signal",
        stile,
        lang: L,
        periodo,
        src: micro?.src || "signal",
        domanda,
      });

      return res.status(200).json({
        mode: "signal",
        time: slot,
        slot,
        phase,
        mood: micro.mood || null,
        style: stile,
        lang: L,
        periodo,
        model: MODEL,
        answer,
      });
    }

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

    await logRequestMeta({
      stage: "answer",
      stile,
      lang: L,
      periodo,
      src: micro?.src || null,
      domanda,
      pct,
    });

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
