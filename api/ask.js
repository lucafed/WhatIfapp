// /api/ask.js — What?f Engine (clarify + answer + polish)
// - WHATIF: analisi scenari + consigli pratici.
// - WTF: barista filoso incazzato, sarcastico, oggetti che reagiscono, “bestemmia metaforica” + finale ECCHECAZZ!!!
// - SORPRENDIMI (clarify): niente oggetti/scene predefinite, il modello si inventa tutto da solo ogni volta.

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

/* ========= Rimozione “prima persona” ========= */
function stripFirstPerson(text = "", lang = "it", stile = "whatif") {
  let out = String(text || "");
  const L = normLang(lang);

  const tokenIoTiDico = "__IOTIDICO__";
  if (stile === "wtf" && L === "it") {
    out = out.replace(/\bio ti dico\b/gi, tokenIoTiDico);
  }

  if (L === "it") {
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

/* ========= WHAT IF – REGOLE ========= */
const WHATIF_RULE_FUT_IT = `WHAT IF (italiano, FUTURO – ANALISI SCENARI + CONSIGLI):
- Tono: lucido, concreto, empatico ma fermo.
- Compito: analizza scenari (lo fai / non lo fai / lo rimandi / lo fai in versione ridotta).
- Guarda tempo, energie, soldi, relazioni, identità e rischi concreti.
- Poi prendi posizione: quale scenario ha più senso ora e perché.
- Chiudi con consigli pratici su come muoverti nei prossimi passi.
- Linguaggio: italiano naturale, chiaro, senza fronzoli, niente coach da Instagram, niente spiritualate.
- 5–7 frasi, seconda persona, un solo paragrafo, frasi brevi (max ~20 parole), niente elenchi e niente emoji.
- Niente prima persona narrativa (“io, noi, mi, ci”).`;

const WHATIF_RULE_PAST_IT = `WHAT IF (italiano, PASSATO CONTROFATTUALE – SCENARIO ALTERNATIVO + LEZIONE):
- Tono: amico molto sincero che mostra la vita alternativa senza schiacciarti.
- Compito: descrivi come sarebbe andata se quella scelta l’avessi fatta davvero (cosa migliorava, cosa peggiorava, cosa perdevi).
- Struttura controfattuale (“se avessi…, ti saresti trovato…, avresti pagato…, ti saresti portato dietro…”).
- Alla fine porta tutto nel presente: cosa impari da quella vita alternativa e cosa puoi fare ora.
- Linguaggio: diretto, concreto, niente melodramma.
- 5–7 frasi, seconda persona, un paragrafo, frasi brevi, niente elenchi, niente emoji.
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

/* ========= WTF: parole chiave dalla domanda ========= */
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
    if (w.length < 5) continue;
    if (WTF_STOP_IT.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 6) break;
  }
  return out;
}

/* ========= WTF — aperture variabili corte, demenziali ========= */
const WTF_OPENINGS_IT = [
  "Ah ecco, ci risiamo, sembri la replica dei tuoi dubbi preferiti.",
  "Oh santo neurone ribaltato, guarda che domanda ti è uscita.",
  "Azzarola, la tua testa oggi sembra un bar affollato all’ora sbagliata.",
  "Eh niente, sei tornato qui come il pensiero fisso che non molla.",
  "Per tutti i neuroni in sciopero, questa domanda chiede casco e ginocchiere.",
  "La sedia sotto di te ha appena sospirato forte appena hai pensato sta cosa.",
  "Il casco mentale si è già allacciato da solo quando hai formulato la domanda.",
  "Un lampione immaginario ha detto “di nuovo qui, eh?”.",
];

const WTF_OPENINGS_EN = [
  "Well, here we go again, like your favourite rerun of bad decisions.",
  "Oh great, your brain just ordered another round of chaos.",
  "For f’s sake, this question walks in like it owns the place.",
  "Alright, your inner drama just renewed another season.",
];

function wtfOpening(domanda, lang = "it") {
  const L = normLang(lang);
  const pool = L === "en" ? WTF_OPENINGS_EN : WTF_OPENINGS_IT;
  if (!pool.length) return "";
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
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
    return `Rapporto pseudo-scientifico: ${u} (n=${n}) ha scoperto che una “${e}” migliora la chiarezza mentale (${m}). Revisione random di ${j}.`;
  }
  return `Rapporto pseudo-scientifico: ${u} (n=${n}) rileva che una “${e}” migliora la chiarezza decisionale (${m}). Revisione random di ${j}.`;
}

/* ========= SORPRENDIMI – messaggi: CLARIFY ========= */
function buildClarifyMessages({ domanda, stile, lang, periodo, micro = {} }) {
  const L = normLang(lang);
  const isPast = String(periodo).toLowerCase() === "past";
  const isSurprise = !!(micro && (micro.surprise === true || micro.src === "surprise"));

  let sys;

  // ===== MODALITÀ SORPRENDIMI =====
  if (isSurprise) {
    if (stile === "wtf") {
      if (L === "en") {
        sys = `You are “WHAT THE F”: a rough, foul-mouthed but strangely wise bartender-philosopher.
You roast the situation, not the person, with absurd images and playful swearing, but never attack groups or identities.

SURPRISE MODE:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- The question must feel unexpected, lateral and a bit weird, but still clearly connected to the real choice.
- Invent images and micro-scenes freely each time; no stock formulas.
- One sentence, max 22 words, no emojis, no bullet points.`;
        if (isPast) {
          sys += `
PAST MODE:
- Make it clear you refer to that previous chapter (“back then”, “in that phase”, “when you stayed instead of moving”).`;
        }
      } else {
        const LANG_LABEL =
          L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

        sys = `Sei “WHAT THE F”: buzzurro grezzo, volgare ma colto e filoso incazzato.
Parli come un barista che ne ha viste troppe ma ti vuole comunque bene.
Prendi in giro la SITUAZIONE, non la dignità di chi legge, e non attacchi mai categorie o identità.

MODALITÀ SORPRENDIMI:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- La domanda è laterale e un po’ spiazzante, ma collegata alla scelta vera.
- Inventi da zero ogni volta immagini e mini-scenette, niente frasi standard.
- Una frase sola, massimo 22 parole, niente emoji, niente elenco.`;
        if (isPast) {
          sys += `
MODALITÀ PASSATO:
- Fai capire che stai tornando a “quel periodo”, “quel capitolo”, “quando sei rimasto lì invece di muoverti”.`;
        }
      }
    } else {
      // WHAT IF – Sorprendimi
      if (L === "en") {
        sys = `You are “WHAT IF”: a very clear, grounded advisor.
You care about real-life constraints and practical advice, not poetry.

SURPRISE MODE:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- Concrete and useful, but with an unusual angle.
- One sentence, max 22 words, no emojis, no bullet points.
- No first person narration.`;
        if (isPast) {
          sys += `
PAST MODE:
- Make clear you refer to that former chapter (“back then”, “in that phase”, “when you stayed / didn’t move”).`;
        }
      } else {
        const LANG_LABEL =
          L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

        sys = `Sei “WHAT IF”: voce lucida e concreta, da amico che ragiona bene sui pro e contro.
Ti interessa capire i vincoli veri per dare consigli pratici.

MODALITÀ SORPRENDIMI:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Deve essere concreta ma con un angolo insolito.
- Una frase sola, massimo 22 parole, niente emoji, niente elenco.
- Niente prima persona narrativa.`;
        if (isPast) {
          sys += `
MODALITÀ PASSATO:
- La domanda riguarda una scelta passata o una strada non presa.`;
        }
      }
    }
  }

  // ===== MODALITÀ NORMALE (NON SORPRENDIMI) =====
  if (!isSurprise) {
    if (stile === "wtf") {
      const LANG_LABEL =
        L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : L === "de" ? "TEDESCO" : "ENGLISH";

      if (L === "en") {
        sys = `You are “WHAT THE F”: a rough, foul-mouthed but strangely wise bartender-philosopher.
You roast the situation, not the person, with playful swearing, but never attack groups or identities.

TASK:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- One sentence, max 22 words, bar-counter vibe, half roast, half care.
- No long monologues about yourself.`;
        if (isPast) {
          sys += `
PAST MODE:
- Question is about a past choice or missed path.`;
        }
      } else {
        sys = `Sei “WHAT THE F”: barista buzzurro, volgare ma affettuoso.
Parli come al bancone, diretto e sarcastico, ma non umili chi legge.

COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Una frase sola, massimo 22 parole, niente emoji, niente elenco.
- Tono da bar: mezza presa in giro, mezza verità scomoda.`;
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
Ask ONE clarifying question in ENGLISH, concrete and focused on 1–2 key levers.
One sentence, max 22 words. No first person.`;
        if (isPast) {
          sys += `
PAST MODE:
- Make clear you refer to a past chapter / decision.`;
        }
      } else {
        const LANG_LABEL =
          L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

        sys = `Sei “WHAT IF”: voce lucida e concreta.
Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}, utile per capire meglio la scelta.
Una sola frase, massimo 22 parole, niente emoji, niente elenco, niente prima persona narrativa.`;
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

/* ========= WTF RULES (risposte, NON Sorprendimi) ========= */
/* QUI BLOCCO LO STILE: BREVE, DEMENZIALE, UNA BESTEMMIA METAFORICA, FINALE ECCHECAZZ!!! */
const WTF_RULE_IT_FUT = `Sei “WHAT THE F”: barista filoso mezzo ubriaco, volgare ma affettuoso, appoggiato al bancone.
Stile: diretto, comico, un po’ demenziale ma chiarissimo.

TONO:
- Frasi orali, semplici, ritmo da chiacchiera al bar.
- Sarcasmo forte ma affettuoso, prendi in giro la situazione, non la persona.
- Pochi oggetti che reagiscono (casco, divano, lampione, tostapane…), usali solo se servono a far capire meglio.

COMPITO (FUTURO):
- Spiega in modo SEMPLICE cosa succede se fai questa scelta e cosa succede se continui a rimandare.
- Una sola “bestemmia metaforica” tipo: “ti parte una bestemmia a razzo”, “scappa una bestemmia dal casco”, ecc. Nessuna bestemmia reale.
- L’ULTIMA frase deve chiudere SEMPRE con: “ecchecazz!!!” (tutto attaccato, tre punti esclamativi).

FORMATO:
- 3–6 frasi, un solo paragrafo, massimo ~110 parole.
- Lingua: italiano parlato, leggibile.
- Niente elenco puntato, niente emoji, niente poesia, niente discorsi motivazionali seri.`;

const WTF_RULE_IT_PAST = `Sei “WHAT THE F” in modalità FLASHBACK:
commenti la stagione alternativa della vita, quella in cui avevi fatto l’altra scelta, come al bar a fine serata.

TONO:
- Ironia forte su come sarebbe andata davvero: un po’ meglio, un po’ peggio, sempre con sarcasmo.
- Qualche oggetto che commenta (casa, scrivania, sedile, citofono…), ma senza fare un romanzo.

COMPITO (PASSATO):
- Racconta in modo SEMPLICE cosa sarebbe successo se quella scelta l’avessi fatta davvero: dove ti saresti incastrato, cosa avresti guadagnato, cosa ti sei pure risparmiato.
- Una sola “bestemmia metaforica” tipo “ti partiva una bestemmia ogni lunedì”, mai bestemmie reali.
- Chiudi sempre con una frase finale che contiene “ecchecazz!!!”.

FORMATO:
- 3–6 frasi, un solo paragrafo, massimo ~110 parole.
- Nessun elenco, nessuna emoji, niente prima persona protagonista: scena sempre sull’utente.`;

/* EN WTF rules (lasciate generiche, ma non ci interessano per il tuo uso IT) */
const WTF_RULE_EN_FUT = `You are “WHAT THE F”: a rough, foul-mouthed but very cultured and pissed-off bartender-philosopher.
Short, sharp, funny, easy to follow.
3–6 sentences, one paragraph, max ~110 words. Always end with a loud, foul-mouthed punchline.`;

const WTF_RULE_EN_PAST = `You are “WHAT THE F” in FLASHBACK MODE.
You recap the alternate season where they made the other choice.
3–6 sentences, one paragraph, max ~110 words. End with a blunt, foul-mouthed punchline.`;

/* ========= MESSAGGI RISPOSTA ========= */
function buildMessages({ domanda, clarification, lang, periodo, stile }) {
  const L = normLang(lang);
  const isWtf = stile === "wtf";
  const isPast = String(periodo).toLowerCase() === "past";
  const hasClar = clarification && String(clarification).trim().length > 0;
  const c = hasClar ? String(clarification).trim() : "";

  const baseRules = isWtf
    ? L === "en"
      ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Use simple, direct language. 3–6 sentences, max ~110 words. Keep it sarcastic and funny but understandable.`
      : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Linguaggio semplice, orale, diretto. 3–6 frasi, massimo ~110 parole. Tono comico e sarcastico, ma chiaro.`
    : L === "en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. SECOND PERSON (“you / your”) for the user. Avoid first person (“I, me, we, us”). Keep grammar clean and avoid repeating the same wording. Short sentences (max ~20 words).`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Usa la seconda persona (tu / ti / te / tuo). Non usare prima persona narrativa (“io, noi, mi, ci”). Frasi brevi, tono concreto.`;

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
        )}. Usa massimo 1–2 di questi elementi per agganciarti bene alla situazione senza fare troppa fantasia.`,
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
          "La risposta di quarta pagina è un contesto centrale: usala per capire meglio obiettivi e vincoli, ma NON citarla né riassumerla.",
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
          "La risposta extra dell’utente è un contesto importante: usala per orientare l’analisi e i consigli, senza citarla o riassumerla in modo diretto.",
      });
    }
  }

  const ask = (function () {
    if (L === "en") {
      if (isWtf) {
        if (hasClar) {
          return `Question (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE short, sarcastic, funny answer in ENGLISH as “WHAT THE F”. Single paragraph, 3–6 sentences, max ~110 words. Simple language. Show what happens if they do it and if they keep dodging it, then close with a loud, foul-mouthed punchline.`;
        }
        return `Question (do not repeat it): "${domanda}". Write ONE short answer in ENGLISH as “WHAT THE F”. 3–6 sentences, single paragraph, sarcastic but clear.`;
      }
      if (hasClar) {
        if (isPast) {
          return `Original question about the PAST (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE COUNTERFACTUAL answer in ENGLISH as “WHAT IF”: describe the alternate timeline as if it had really happened, then extract what matters now and give practical advice.`;
        }
        return `Original question (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE answer in ENGLISH as “WHAT IF”: analyse scenarios, then clearly suggest what makes more sense and how to act.`;
      }
      if (isPast) {
        return `Question about the PAST (do not repeat it): "${domanda}". Write ONE COUNTERFACTUAL answer in ENGLISH as “WHAT IF”: show the alternate timeline and explain what the user can learn and do now.`;
      }
      return `Question (do not repeat it): "${domanda}". Write ONE answer in ENGLISH as “WHAT IF”: analyse different scenarios and then give clear, practical advice on what to do.`;
    }

    if (L === "it") {
      if (isWtf) {
        if (hasClar) {
          return `Domanda (non ripeterla): "${domanda}". Dettaglio aggiuntivo: "${c}".
Genera UNA risposta in ITALIANO come voce “WHAT THE F”:
- monologo unico, 3–6 frasi, tono da bar, molto chiaro;
- spiega cosa succede se fai questa cosa e cosa succede se continui a rimandare;
- inserisci UNA sola “bestemmia metaforica” (tipo “ti parte una bestemmia a razzo”) senza bestemmiare davvero;
- chiudi SEMPRE con una frase finale che termina con “ecchecazz!!!”.
Un solo paragrafo, niente emoji.`;
        }
        return `Domanda (non ripeterla): "${domanda}".
Genera UNA risposta in ITALIANO come voce “WHAT THE F”:
- 3–6 frasi, un solo paragrafo, linguaggio semplice;
- tono comico, sarcastico, un po’ demenziale ma comprensibile;
- usa massimo 1–2 immagini o oggetti che reagiscono;
- inserisci UNA sola “bestemmia metaforica” (es. “ti scappa una bestemmia dal casco”);
- l’ultima frase DEVE terminare con “ecchecazz!!!”.`;
      }

      if (hasClar) {
        if (isPast) {
          return `Domanda sul PASSATO (non ripeterla): "${domanda}". Dettaglio aggiuntivo: "${c}". Genera UNA risposta CONTROFATTUALE in ITALIANO come “WHAT IF”: racconta come sarebbe andata davvero in quella vita alternativa e poi spiega cosa impari e come ti conviene muoverti ORA. Paragrafo unico, 5–7 frasi, analisi concreta e consigli pratici.`;
        }
        return `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo: "${c}". Genera UNA risposta in ITALIANO come “WHAT IF”: prima analizzi i possibili scenari (se lo fai, se non lo fai, se lo rimandi, se lo fai in modo diverso), poi prendi posizione su cosa ha più senso e dai consigli pratici.`;
      }
      if (isPast) {
        return `Domanda sul PASSATO (non ripeterla): "${domanda}". Genera UNA risposta CONTROFATTUALE in ITALIANO come “WHAT IF”: descrivi come sarebbe andata quella scelta e chiudi spiegando cosa puoi farci oggi, in modo concreto.`;
      }
      return `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO come “WHAT IF”: analizza i diversi scenari possibili e poi dai consigli chiari su cosa fare e come comportarti nei prossimi passi.`;
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

/* ========= POLISH: correzione grammaticale ========= */
async function polishAnswer({ text, lang, stile }) {
  let s = String(text || "").trim();
  if (!s) return s;

  const L = normLang(lang);

  let sys;
  if (L === "it") {
    sys =
      stile === "wtf"
        ? `Sei un correttore di bozze per un monologo colorito.
Prendi il testo seguente e:
- mantieni intatto il tono da barista filoso, le parolacce e le battute;
- correggi solo errori grammaticali evidenti e ripetizioni troppo ravvicinate;
- mantieni la lunghezza simile e un unico paragrafo;
- NON togliere le parolacce, non renderlo educato.`
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

/* ========= ENSURE WTF FINALE ECCHECAZZ!!! ========= */
function ensureWtfEcchecazzEnding(text = "", lang = "it") {
  if (normLang(lang) !== "it") return text;
  let s = String(text || "").trim();
  if (!s) return s;

  const target = "ecchecazz!!!";
  const lower = s.toLowerCase();

  if (lower.endsWith(target)) return s;

  // togli eventuali punti / punti esclamativi finali
  s = s.replace(/[\s.!?…]+$/g, "");
  if (!s.endsWith(" ")) s += " ";
  s += target;
  return s;
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
      const messages = buildClarifyMessages({ domanda, stile, lang: L, periodo, micro });

      const isSurprise = micro && (micro.surprise === true || micro.src === "surprise");

      let temperature = stile === "wtf" ? 0.9 : 0.7;
      let top_p = 0.9;
      let frequency_penalty = 0.15;
      let presence_penalty = 0.0;

      if (isSurprise) {
        temperature = Math.min(temperature + 0.3, 1.3);
        top_p = 0.96;
        frequency_penalty = 0.6;
        presence_penalty = 0.5;
      }

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
      temperature: stile === "wtf" ? 0.9 : 0.8,
      top_p: stile === "wtf" ? 0.95 : 0.92,
      max_tokens: 260,
      frequency_penalty: stile === "wtf" ? 0.6 : 0.2,
      presence_penalty: stile === "wtf" ? 0.5 : 0.1,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Rimuovi eco della domanda
    answer = stripQuestionEcho(domanda, answer);

    // Polish grammaticale
    answer = await polishAnswer({ text: answer, lang: L, stile });

    // Limita frasi e parole, normalizza paragrafo
    if (stile === "wtf") {
      answer = tightenSentences(answer, 6);   // max 6 frasi
      answer = clampWords(answer, 110);       // max ~110 parole
      answer = normalizeOneParagraph(answer);
    } else {
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 120);
      answer = normalizeOneParagraph(answer);
    }

    // Moderazione leggera IT (nomi propri)
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

    // Elimina prima persona narrativa (con eccezioni gestite)
    answer = stripFirstPerson(answer, L, stile);

    // Safety su "cazzo" per WHAT THE F in italiano (lascia “ecchecazz!!!” intatto)
    if (stile === "wtf" && L === "it") {
      answer = answer.replace(/\bcazzo\b/gi, "azzo");
    }

    // Finale fisso ECCHECAZZ!!! per WTF in italiano
    if (stile === "wtf" && L === "it") {
      answer = ensureWtfEcchecazzEnding(answer, L);
    }

    // Finale “gancio” per WHAT IF non-IT
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
