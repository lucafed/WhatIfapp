// /api/ask.js — What?f Engine (clarify + answer + polish + daily signals statici)
// - WHATIF: analisi scenari + consigli pratici, con almeno un punto NON ovvio che fa riflettere.
// - WTF: narratore/comico da pub, volgare ma affettuoso, stile “turista del destino”.
// - SORPRENDIMI: domande assurde “intelligenti”, varie, non ripetute.
// - SIGNAL: frasi giornaliere (mattina/sera) SENZA usare token OpenAI.
//
// ✅ FIX 100%:
// - Lingue: IT/EN/ES/FR/DE coerenti in clarify/answer/motivation/polish/signals.
// - Nessun mix di lingue: la lingua arriva da body.lang o micro.lang o header, con fallback robusto.
// - Body parsing robusto (string/object) + no crash.
// - Chiusure / braces corrette (il tuo file aveva una graffa in più).
// - WTF ending: “ecchecazz!!!” SOLO per IT (come richiesto).
// - WHAT IF: niente prima persona in tutte le lingue (non solo IT/EN).
// - Clarify: 1 frase max 22 parole in TUTTE le lingue, incluse ES/FR/DE (prima era “label in IT” ma spesso sys in IT).

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
function guessLangFromHeader(req) {
  const raw = String(req.headers["accept-language"] || "").toLowerCase();
  for (const code of SUP_LANGS) {
    // match "it-IT", "it;q=0.8"
    if (raw.includes(code)) return code;
  }
  return "it";
}
function safeJsonParse(maybeJson) {
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
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
  // Uppercase after start or punctuation; works decently for ES/FR/DE too.
  return String(s).replace(
    /(^|[.!?…]\s+)([a-zà-ÿäöüßœçñ])/gim,
    (m, prefix, chr) => prefix + chr.toUpperCase()
  );
}
function finalPunct(s = "") {
  return /[.!?…]$/.test(String(s).trim()) ? String(s).trim() : String(s).trim() + ".";
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
  const L = normLang(lang);
  let out = String(text || "");

  // ⚠️ Non perfetto linguisticamente (senza NLP), ma evita l’effetto “io”.
  // IT
  if (L === "it") {
    out = out
      .replace(/\b(io)\b/gi, "tu")
      .replace(/\b(mi|me)\b/gi, "ti")
      .replace(/\b(mio|mia|miei|mie)\b/gi, "tuo")
      .replace(/\b(sono)\b/gi, "sei"); // grossolano, ma in pratica riduce "io sono"
  }
  // EN
  else if (L === "en") {
    out = out
      .replace(/\b(i)\b/gi, "you")
      .replace(/\b(i'm)\b/gi, "you're")
      .replace(/\b(i am)\b/gi, "you are")
      .replace(/\b(me)\b/gi, "you")
      .replace(/\b(my)\b/gi, "your")
      .replace(/\b(mine)\b/gi, "yours");
  }
  // ES
  else if (L === "es") {
    out = out
      .replace(/\b(yo)\b/gi, "tú")
      .replace(/\b(me|mí)\b/gi, "te")
      .replace(/\b(mi|mis)\b/gi, "tu")
      .replace(/\b(conmigo)\b/gi, "contigo");
  }
  // FR
  else if (L === "fr") {
    out = out
      .replace(/\b(je)\b/gi, "tu")
      .replace(/\b(moi)\b/gi, "toi")
      .replace(/\b(mon|ma|mes)\b/gi, "ton")
      .replace(/\b(avec moi)\b/gi, "avec toi");
  }
  // DE
  else {
    out = out
      .replace(/\b(ich)\b/gi, "du")
      .replace(/\b(mich|mir)\b/gi, "dich")
      .replace(/\b(mein|meine|meinen|meinem|meiner)\b/gi, "dein");
  }

  return out;
}

/* ========= WHAT IF – esempio ========= */
const WHATIF_HYBRID_EX_IT = `Da come lo racconti sembra che dentro di te qualcosa si stia muovendo piano. Vedo le giornate che si aggiustano un po alla volta: togli rumore, recuperi fiato e inizi a capire dove ti consumi davvero. Immagino piccole scelte ripetute, meno scenografiche ma più vivibili, che spostano il peso dalle promesse alle abitudini. Intuisco che restare fermo ti costerebbe soprattutto in pensieri riciclati e sonno leggero, mentre muoverti avrebbe il prezzo di guardare in faccia qualche paura. Si muove una routine nuova, non perfetta ma più onesta, proprio nel punto in cui smetti di cercare la svolta magica e ti permetti di fare un passo alla volta.`;

/* ======= WHAT IF RULES (multi-lingua) ======= */
const WHATIF_RULE_FUT = {
  it: `WHAT IF (italiano, FUTURO VICINO — MISTICA MA UMANA):
- Tono: veggente/zíngara realista, voce calda, empatica, concreta. Non teatrale, non solenne.
- APRI con UNA sola frase breve e naturale che suona come un’osservazione sul presente dell’utente. Nessuna domanda retorica.
- La SECONDA frase deve INIZIARE con: "Vedo" o "Sento" o "Immagino" o "Intuisco" o "Si apre" o "Si muove".
- 60% analisi concreta + 40% immagini sobrie della quotidianità.
- Futuro vicino che parte da ADESSO: usa soprattutto condizionale e futuro semplice.
- Inserisci almeno UN punto non ovvio: costo nascosto / conseguenza pratica / effetto su identità-relazioni.
- Niente motivazionalese, niente frasi tipo “il destino ti guida”.
- Alla fine inserisci un micro-consiglio pratico fuso nell’ultima frase (senza elenco).
- 3–6 frasi, un paragrafo unico, niente elenchi, niente emoji.
- Niente prima persona narrativa (“io, noi, mi”).`,
  en: `WHAT IF (English, NEAR-FUTURE — grounded but gently intuitive):
- Warm, practical voice. Not theatrical.
- Start with ONE short, natural observation about the user’s present (no rhetorical question).
- Second sentence MUST start with: "I see" / "I sense" / "I imagine" / "I suspect" / "A shift opens" / "Something moves".
- 60% concrete constraints + 40% everyday imagery.
- Use mostly conditional and near-future ("you might", "you’ll probably", "you may end up").
- Include ONE non-obvious insight: hidden cost / identity effect / relationship trade-off.
- End with a tiny practical nudge blended into the final sentence (no bullet points).
- 3–6 sentences, one paragraph, no emojis, no lists.
- Avoid first-person narration beyond the required starter phrases (do not talk about yourself).`,
  es: `WHAT IF (español, FUTURO CERCANO — intuitivo pero práctico):
- Voz cálida y realista, nada teatral.
- Abre con UNA frase corta observando el presente del usuario (sin pregunta retórica).
- La segunda frase DEBE empezar con: "Veo" / "Siento" / "Imagino" / "Intuyo" / "Se abre" / "Se mueve".
- 60% análisis concreto + 40% imágenes de vida diaria.
- Usa condicional y futuro cercano ("podrías", "probablemente", "acabarás").
- Incluye UN punto no obvio: costo oculto / impacto en identidad-relaciones / un riesgo práctico.
- Cierra con un micro-consejo práctico integrado en la última frase (sin lista).
- 3–6 frases, un párrafo, sin emojis, sin viñetas.
- Sin primera persona narrativa.`,
  fr: `WHAT IF (français, FUTUR PROCHE — intuitif mais concret):
- Voix chaleureuse et lucide, pas théâtrale.
- Ouvre par UNE phrase courte sur le présent de l’utilisateur (pas de question rhétorique).
- La deuxième phrase DOIT commencer par : "Je vois" / "Je sens" / "J’imagine" / "J’intuis" / "Quelque chose s’ouvre" / "Quelque chose bouge".
- 60% concret + 40% images du quotidien.
- Utilise surtout conditionnel et futur proche.
- Ajoute UN point non évident : coût caché / impact identité-relations / contrainte pratique.
- Finis avec un micro-conseil intégré dans la dernière phrase (pas de liste).
- 3–6 phrases, un paragraphe, sans emoji, sans listes.
- Pas de première personne narrative.`,
  de: `WHAT IF (Deutsch, NAHE ZUKUNFT — ruhig, menschlich, praktisch):
- Warm und klar, nicht pathetisch.
- Starte mit EINEM kurzen Satz über die Gegenwart (keine rhetorische Frage).
- Der zweite Satz MUSS beginnen mit: "Ich sehe" / "Ich spüre" / "Ich stelle mir vor" / "Ich ahne" / "Es öffnet sich" / "Etwas bewegt sich".
- 60% konkret + 40% Alltagsbilder.
- Nutze vor allem Konjunktiv/Modalformen und nahe Zukunft.
- Baue EINEN nicht offensichtlichen Punkt ein: versteckter Preis / Identität/Beziehungen / praktischer Engpass.
- Ende mit einem kleinen praktischen Impuls im letzten Satz (keine Liste).
- 3–6 Sätze, ein Absatz, keine Emojis, keine Listen.
- Keine Ich-Erzählung (außer als fester Starter im 2. Satz).`,
};

const WHATIF_RULE_PAST = {
  it: `WHAT IF (italiano, PASSATO CONTROFATTUALE):
- Voce umana, gentile, concreta. Niente sensi di colpa.
- Descrivi “l’altro film” se avessi fatto quella scelta: sollievi + pesi nuovi + cosa avresti perso rispetto a oggi.
- Struttura controfattuale ("se avessi..., ti saresti..., avresti...").
- Inserisci UN compromesso non scontato.
- Riporta al presente: cosa impari e cosa puoi scegliere ORA, pratico.
- 3–6 frasi, un paragrafo, niente elenchi, niente emoji.
- Niente prima persona narrativa.`,
  en: `WHAT IF (English, COUNTERFACTUAL PAST):
- Calm, honest, kind. No guilt-tripping.
- Show the “other timeline”: reliefs + new burdens + what they’d lose vs today.
- Use counterfactual structure ("if you had..., you would have...").
- Add ONE non-obvious trade-off.
- Bring it back to now: a practical, gentle rule for next steps.
- 3–6 sentences, one paragraph, no emojis, no lists.
- Avoid first-person narration.`,
  es: `WHAT IF (español, PASADO CONTRAFACTUAL):
- Calmo, honesto, sin culpa.
- Muestra “la otra película”: alivios + cargas nuevas + lo que perderías frente a hoy.
- Estructura contra factual ("si hubieras..., habrías...").
- Un compromiso no obvio.
- Vuelve al presente con una regla práctica.
- 3–6 frases, un párrafo, sin emojis, sin lista.
- Sin primera persona narrativa.`,
  fr: `WHAT IF (français, PASSÉ CONTREFACTUEL):
- Calme, honnête, sans culpabiliser.
- Montre “l’autre film” : soulagements + nouveaux poids + ce que tu perdrais vs aujourd’hui.
- Structure ("si tu avais..., tu aurais...").
- Un compromis non évident.
- Retour au présent avec une règle pratique.
- 3–6 phrases, un paragraphe, sans emoji, sans listes.
- Pas de première personne narrative.`,
  de: `WHAT IF (Deutsch, KONTRAFAKTISCHE VERGANGENHEIT):
- Ruhig, ehrlich, ohne Schuld.
- Zeige die “andere Timeline”: Erleichterungen + neue Lasten + was heute fehlen würde.
- Kontrafaktisch ("wenn du..., hättest du...").
- Ein nicht offensichtlicher Kompromiss.
- Zurück ins Jetzt mit einer praktischen Regel.
- 3–6 Sätze, ein Absatz, keine Emojis, keine Listen.
- Keine Ich-Erzählung.`,
};

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
    future: ["And you notice it’s less about miracles and more about how you show up every day."],
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

  // IT: niente gancio fisso, finale naturale (già “voce”)
  if (L === "it") return finalPunct(s);

  const seed = hashStr(String(domanda || "") + "|" + s);
  if (seed % 100 >= 70) return finalPunct(s);

  const last = (s.match(/([^.!?…]+[.!?…])\s*$/) || [])[1] || s;
  const alreadyHasHook = /(you notice|you’d probably see|notarás|verras|merkst du|tu verras|verías)/i.test(
    last
  );
  if (alreadyHasHook) return finalPunct(s);

  const pool = ZINGARA_ENDINGS[L] || ZINGARA_ENDINGS.en;
  const bag = String(periodo).toLowerCase() === "past" ? pool.past : pool.future;
  const addon = pickDet(bag || [], seed);
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

  const L = normLang(lang);
  if (L === "en") {
    return `Scientific-ish report: ${u} (n=${n}) found that one “${e}” boosts decision clarity (${m}). Reviewed by ${j}, sort of.`;
  }
  if (L === "es") {
    return `Informe científico (más o menos): ${u} (n=${n}) dice que una “${e}” mejora la claridad (${m}). Revisado por ${j}, supuestamente.`;
  }
  if (L === "fr") {
    return `Rapport scientifique (plus ou moins) : ${u} (n=${n}) dit qu’un “${e}” améliore la clarté (${m}). Relu par ${j}, paraît-il.`;
  }
  if (L === "de") {
    return `Wissenschaftsbericht (so ungefähr): ${u} (n=${n}) meint, ein “${e}” verbessert die Klarheit (${m}). Geprüft von ${j}, angeblich.`;
  }
  return `Rapporto scientifico (più o meno): ${u} (n=${n}) rileva che una “${e}” migliora la chiarezza decisionale (${m}). Revisione a cura di ${j}, forse.`;
}

/* ========= SORPRENDIMI – messaggi: CLARIFY ========= */
function buildClarifyMessages({ domanda, stile, lang, periodo, micro = {} }) {
  const L = normLang(lang);
  const isPast = String(periodo).toLowerCase() === "past";
  const isSurprise = !!(micro && (micro.surprise === true || micro.src === "surprise"));

  const L_LABEL =
    L === "it" ? "ITALIANO" : L === "en" ? "ENGLISH" : L === "es" ? "ESPAÑOL" : L === "fr" ? "FRANÇAIS" : "DEUTSCH";

  let sys;

  const commonSafety = `- Never attack protected groups or identities.
- No slurs, no hate.`;

  // ===== SURPRISE MODE =====
  if (isSurprise) {
    if (stile === "wtf") {
      sys = `You are “WHAT THE F”: a rough, foul-mouthed but affectionate pub narrator.
You roast the situation, not the person. ${commonSafety}

SURPRISE MODE (ABSURD SMART QUESTION):
- Ask EXACTLY ONE clarifying question in ${L_LABEL}.
- Weird, playful, slightly surreal, but still connected to the real decision.
- Use at most ONE tiny scene with objects reacting (bar, fridge, lamp, phone…), like a snapshot.
- Invent from scratch every time: do NOT reuse the same metaphors.
- One sentence, max 22 words. No emojis. No bullet points.
- Do NOT end with “ecchecazz!!!”.`;
      if (isPast) sys += `\nPAST MODE: Make it clear you refer back to that previous chapter / missed path.`;
    } else {
      sys = `You are “WHAT IF”: a clear, grounded advisor.
You care about real-life constraints, not poetry. ${commonSafety}

SURPRISE MODE:
- Ask EXACTLY ONE clarifying question in ${L_LABEL}.
- Concrete and useful, with a slightly unusual angle the user wouldn’t consider alone.
- Focus on ONE lever: time, money, energy, identity, relationships, or risk.
- Include ONE non-obvious angle (hidden constraint / trade-off / identity impact).
- One calm, precise sentence, max 22 words. No emojis. No bullet points.
- Avoid first-person narration (“I, we”).`;
      if (isPast) sys += `\nPAST MODE: Make clear it’s about that past chapter / road not taken.`;
    }
  }
  // ===== NORMAL CLARIFY =====
  else {
    if (stile === "wtf") {
      sys = `You are “WHAT THE F”: a pub narrator with love and bite, like the provided examples (rhythm, not phrases).
Keep it playful, never hateful. ${commonSafety}

TASK:
- Ask EXACTLY ONE clarifying question in ${L_LABEL}.
- Sounds like a half-roast, half-care line thrown across the counter.
- One sentence, max 22 words. No emojis. No bullet points.
- Do NOT end with “ecchecazz!!!”.`;
      if (isPast) sys += `\nPAST MODE: Question refers to a past choice / missed path.`;
    } else {
      sys = `You are “WHAT IF”: clear and practical, like a friend who reasons well.
You want 1–2 details that truly change the analysis. ${commonSafety}

TASK:
- Ask EXACTLY ONE clarifying question in ${L_LABEL}.
- Include ONE non-obvious angle (hidden compromise / energy limit / identity or relationship impact).
- Calm, precise. One sentence, max 22 words. No emojis. No bullet points.
- Avoid first-person narration (“I, we”).`;
      if (isPast) sys += `\nPAST MODE: Question is about a past choice / missed path.`;
    }
  }

  const userMsg =
    L === "en"
      ? `User "what if" question:\n"${domanda}"\nAsk ONE clarifying question in ENGLISH, following the style rules above.`
      : L === "it"
      ? `Domanda "e se" dell’utente:\n"${domanda}"\nFai UNA sola domanda di chiarimento in ITALIANO, seguendo le regole di stile sopra.`
      : L === "es"
      ? `Pregunta "¿y si...?" del usuario:\n"${domanda}"\nHaz UNA sola pregunta de aclaración en ESPAÑOL, siguiendo las reglas de estilo de arriba.`
      : L === "fr"
      ? `Question "et si..." de l’utilisateur :\n"${domanda}"\nPose UNE seule question de clarification en FRANÇAIS, selon les règles ci-dessus.`
      : `„Was wäre, wenn…“-Frage des Nutzers:\n"${domanda}"\nStelle EINE Rückfrage auf DEUTSCH gemäß den obigen Regeln.`;

  return [
    { role: "system", content: sys },
    { role: "user", content: userMsg },
  ];
}

/* ========= WTF RULES (risposte) ========= */
const WTF_RULE_IT_FUT = `Sei “WHAT THE F”: narratore/comico da pub che parla ESATTAMENTE con il respiro degli esempi seguenti (non copiare frasi, imita ritmo, voce, struttura):

${WTF_STYLE_EXAMPLES_IT}

TONO:
- Apertura che prende in giro (“Oh, eccoci…”, “Ah, guarda chi si rivede…”).
- La prima frase è breve (massimo 15 parole) e va dritta alla scena, niente teoria.
- Seconda persona.
- Parolacce leggere da bar ok, MAI bestemmie reali, MAI insulti a categorie o identità, MAI usare la parola “merda”.
- UNA “bestemmia” solo narrata e creativa tra virgolette, con formule vive (“ti parte…”, “ti scappa…”, “ti esce…”), variando.
- Oggetti e ambiente reagiscono, massimo 3–5 elementi, cambiali spesso.
- Pro/contro dentro la scena, niente elenco.
- Niente motivazionalese.

COMPITO (FUTURO):
- Due film: A (lo fai) e B (rimandi/resti fermo).
- 3–5 frasi, un paragrafo, 90–130 parole.
- L’ULTIMA frase termina con “ecchecazz!!!”.`;

const WTF_RULE_IT_PAST = `Sei “WHAT THE F” in modalità FLASHBACK, stessa voce da comico da pub, applicata alla vita alternativa in cui avevi fatto l’altra scelta.

TONO:
- Seconda persona in condizionale/passato (“ti saresti…”, “avresti…”).
- Parolacce leggere ok, MAI bestemmie reali, MAI insulti a categorie o identità, MAI usare la parola “merda”.
- UNA “bestemmia” solo narrata e creativa.

COMPITO (PASSATO):
- Descrivi come sarebbe andata se quella scelta l’avessi fatta.
- Porta la scena fino a oggi: capisci qualcosa ma in modo cazzaro, non romantico.

FORMATO:
- 3–5 frasi, un paragrafo, 90–130 parole.
- L’ULTIMA frase finisce con “ecchecazz!!!”.`;

const WTF_RULE_NONIT = {
  en: {
    fut: `You are “WHAT THE F”: rough, foul-mouthed but affectionate. Roast the situation, not identities.
TASK (FUTURE): Show two timelines: do it vs keep delaying. Vivid images, one paragraph, 3–5 sentences, <=120 words, no emojis, no question-echo.`,
    past: `You are “WHAT THE F” in FLASHBACK MODE.
TASK (PAST): Show what WOULD have happened if they chose that path, then snap back to now. One paragraph, 3–5 sentences, <=120 words, no emojis, no echo.`,
  },
  es: {
    fut: `Eres “WHAT THE F”: de bar, bruto pero cariñoso. Te ríes de la escena, no de identidades.
TAREA (FUTURO): Dos películas: hacerlo vs seguir posponiendo. Imágenes vivas, un párrafo, 3–5 frases, <=120 palabras, sin emojis, sin repetir la pregunta.`,
    past: `Eres “WHAT THE F” en modo FLASHBACK.
TAREA (PASADO): Qué habría pasado si tomabas ese camino y luego vuelves al presente. Un párrafo, 3–5 frases, <=120 palabras, sin emojis, sin repetir la pregunta.`,
  },
  fr: {
    fut: `Tu es “WHAT THE F”: de comptoir, cru mais affectueux. Tu te moques de la scène, pas des identités.
TÂCHE (FUTUR): Deux films: le faire vs continuer à remettre. Images vives, un paragraphe, 3–5 phrases, <=120 mots, sans emoji, sans répéter la question.`,
    past: `Tu es “WHAT THE F” en mode FLASHBACK.
TÂCHE (PASSÉ): Ce qui se serait passé si tu prenais ce chemin, puis retour au présent. Un paragraphe, 3–5 phrases, <=120 mots, sans emoji, sans répétition.`,
  },
  de: {
    fut: `Du bist “WHAT THE F”: Tresen-Stimme, derb aber herzlich. Du roastest die Situation, nicht Identitäten.
AUFGABE (ZUKUNFT): Zwei Filme: machen vs weiter aufschieben. Bildhaft, 1 Absatz, 3–5 Sätze, <=120 Wörter, keine Emojis, Frage nicht wiederholen.`,
    past: `Du bist “WHAT THE F” im FLASHBACK.
AUFGABE (VERGANGENHEIT): Was wäre passiert, wenn du diesen Weg gewählt hättest, dann zurück ins Jetzt. 1 Absatz, 3–5 Sätze, <=120 Wörter, keine Emojis, kein Echo.`,
  },
};

/* ========= MESSAGGI RISPOSTA ========= */
function buildMessages({ domanda, clarification, lang, periodo, stile }) {
  const L = normLang(lang);
  const isWtf = stile === "wtf";
  const isPast = String(periodo).toLowerCase() === "past";
  const hasClar = clarification && String(clarification).trim().length > 0;
  const c = hasClar ? String(clarification).trim() : "";

  const baseRules = isWtf
    ? L === "it"
      ? `REGOLE GENERALI WTF:
- Un solo paragrafo, niente elenchi, niente emoji.
- NON ripetere la domanda.
- Seconda persona protagonista.
- Parolacce leggere ok, MAI bestemmie reali, MAI insulti a categorie o identità, MAI usare la parola “merda”.
- “Bestemmia” solo narrata e creativa, come negli esempi.
- Evita motivazionalese e teoria astratta.`
      : `GENERAL WTF RULES:
- One paragraph, no lists, no emojis.
- Do NOT restate the question.
- Second person.
- Playful swearing is fine; never hateful, never targeting protected groups or identities.
- Vivid, ridiculous-but-true imagery; avoid abstract theory.`
    : L === "it"
    ? `REGOLE WHAT IF:
- Un solo paragrafo, niente elenchi, niente emoji.
- NON ripetere la domanda.
- Usa la seconda persona.
- Evita la prima persona narrativa.
- Inserisci almeno un punto non ovvio (costo nascosto / impatto identità-relazioni / vincolo energia).`
    : `WHAT IF RULES:
- One paragraph, no lists, no emojis.
- Do NOT restate the question.
- Second person.
- Avoid first-person narration.
- Include at least ONE non-obvious insight (hidden cost / identity/relationship trade-off / energy constraint).`;

  const msgs = [{ role: "system", content: baseRules }];

  if (isWtf) {
    if (L === "it") {
      msgs.push({ role: "system", content: isPast ? WTF_RULE_IT_PAST : WTF_RULE_IT_FUT });
      const kw = wtfKeywords(domanda);
      if (kw.length) {
        msgs.push({
          role: "system",
          content: `PAROLE CHIAVE DALLA SCENA UTENTE: ${kw.join(
            ", "
          )}. Usa 1–2 elementi per immagini/metafore; varia spesso gli oggetti che reagiscono nella scena.`,
        });
      }
    } else {
      const rulePack = WTF_RULE_NONIT[L] || WTF_RULE_NONIT.en;
      msgs.push({ role: "system", content: isPast ? rulePack.past : rulePack.fut });
    }
  } else {
    const rulePack = isPast ? WHATIF_RULE_PAST[L] : WHATIF_RULE_FUT[L];
    msgs.push({ role: "system", content: rulePack || WHATIF_RULE_FUT.en });

    if (L === "it") {
      msgs.push({
        role: "system",
        content: `ESEMPIO DI RESPIRO (non copiare i contenuti, solo il tono):\n${WHATIF_HYBRID_EX_IT}`,
      });
    }
  }

  if (hasClar) {
    const ctxLine =
      L === "it"
        ? "La risposta di quarta pagina è contesto centrale: usala per capire obiettivi e vincoli, ma NON citarla né riassumerla."
        : L === "en"
        ? "The fourth-page answer is central context: use it to understand goals and constraints, but do NOT quote or summarize it."
        : L === "es"
        ? "La respuesta extra es contexto central: úsala para entender objetivos y límites, pero NO la cites ni la resumas."
        : L === "fr"
        ? "La réponse extra est un contexte central : utilise-la pour comprendre objectifs et contraintes, mais NE la cite pas."
        : "Die Zusatzantwort ist zentraler Kontext: nutze sie für Ziele/Constraints, aber zitiere oder fasse sie NICHT zusammen.";
    msgs.push({ role: "system", content: ctxLine });
  }

  const ask =
    L === "en"
      ? hasClar
        ? `Original question (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE answer in ENGLISH as “${isWtf ? "WHAT THE F" : "WHAT IF"}”.`
        : `Question (do not repeat it): "${domanda}". Write ONE answer in ENGLISH as “${isWtf ? "WHAT THE F" : "WHAT IF"}”.`
      : L === "it"
      ? hasClar
        ? `Domanda originale (non ripeterla): "${domanda}". Dettaglio aggiuntivo (quarta pagina): "${c}". Genera UNA risposta in ITALIANO come “${isWtf ? "WHAT THE F" : "WHAT IF"}”.`
        : `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO come “${isWtf ? "WHAT THE F" : "WHAT IF"}”.`
      : L === "es"
      ? hasClar
        ? `Pregunta original (no la repitas): "${domanda}". Detalle: "${c}". Escribe UNA respuesta en ESPAÑOL como “${isWtf ? "WHAT THE F" : "WHAT IF"}”.`
        : `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL como “${isWtf ? "WHAT THE F" : "WHAT IF"}”.`
      : L === "fr"
      ? hasClar
        ? `Question originale (ne la répète pas) : « ${domanda} ». Détail : « ${c} ». Donne UNE réponse en FRANÇAIS comme “${isWtf ? "WHAT THE F" : "WHAT IF"}”.`
        : `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS comme “${isWtf ? "WHAT THE F" : "WHAT IF"}”.`
      : hasClar
      ? `Ursprüngliche Frage (nicht wiederholen): „${domanda}“. Zusatz: „${c}“. Gib EINE Antwort auf DEUTSCH als “${isWtf ? "WHAT THE F" : "WHAT IF"}”.`
      : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH als “${isWtf ? "WHAT THE F" : "WHAT IF"}”.`;

  msgs.push({ role: "user", content: ask });
  return msgs;
}

/* ========= SEGNALI GIORNO (STATICI, NO AI) ========= */
/**
 * REGOLE FINALI:
 * - WHAT IF: SOLO MATTINA (contesto + domanda reale "Ti sei mai chiesto se...")
 * - WHAT THE F: SOLO SERA (le 10 frasi APPROVATE)
 * - Rotazione diversa per utente: micro.userKey (fallback ip)
 * - Deterministico: stesso utente stessa frase per giorno+slot, cambia giorno => cambia frase.
 */
function normSignalSlot(raw = "") {
  const s = String(raw || "").toLowerCase();
  if (/sera|even|night/.test(s)) return "evening";
  return "morning";
}

/* --- WHAT IF (domande reali approvate) --- */
const WHATIF_Q = {
  it: [
    "Ti sei mai chiesto se cambiassi lavoro?",
    "Ti sei mai chiesto se mollassi tutto per un periodo?",
    "Ti sei mai chiesto se provassi a vivere da un’altra parte?",
    "Ti sei mai chiesto se restassi dove sei ancora per anni?",
    "Ti sei mai chiesto se stessi sprecando tempo?",
    "Ti sei mai chiesto se stessi davvero facendo quello che vuoi?",
    "Ti sei mai chiesto se fosse il momento di cambiare aria?",
    "Ti sei mai chiesto se smettessi di rimandare?",
    "Ti sei mai chiesto se scegliessi diversamente da come si aspettano gli altri?",
    "Ti sei mai chiesto se dicessi quello che pensi davvero?",
    "Ti sei mai chiesto se restassi solo?",
    "Ti sei mai chiesto se chiudessi una relazione?",
    "Ti sei mai chiesto se scrivessi a quella persona?",
    "Ti sei mai chiesto se non rispondessi più?",
    "Ti sei mai chiesto se stessi con qualcuno solo per abitudine?",
    "Ti sei mai chiesto se meritassi di più?",
    "Ti sei mai chiesto se smettessi di giustificare gli altri?",
    "Ti sei mai chiesto se guadagnassi in un altro modo?",
    "Ti sei mai chiesto se cambiassi settore?",
    "Ti sei mai chiesto se chiedessi più soldi?",
    "Ti sei mai chiesto se lavorassi meno?",
    "Ti sei mai chiesto se investissi su di te?",
    "Ti sei mai chiesto se smettessi di fare un lavoro che non ti piace?",
    "Ti sei mai chiesto se rischiassi di più?",
    "Ti sei mai chiesto se stessi puntando troppo basso?",
    "Ti sei mai chiesto se comprassi una moto?",
    "Ti sei mai chiesto se facessi un viaggio da solo?",
    "Ti sei mai chiesto se cambiassi completamente routine?",
    "Ti sei mai chiesto se provassi qualcosa di nuovo?",
    "Ti sei mai chiesto se dicessi sì invece di no?",
    "Ti sei mai chiesto se dicessi no invece di sì?",
    "Ti sei mai chiesto se seguissi un’idea folle?",
    "Ti sei mai chiesto se smettessi di avere paura?",
    "Ti sei mai chiesto se fossi diventato un’altra persona?",
    "Ti sei mai chiesto se stessi vivendo come vuoi tu?",
    "Ti sei mai chiesto se stessi solo resistendo?",
    "Ti sei mai chiesto se fossi più coraggioso di quanto pensi?",
    "Ti sei mai chiesto se ti stessi accontentando?",
    "Ti sei mai chiesto se stessi aspettando il momento giusto?",
    "Ti sei mai chiesto se il momento giusto fosse adesso?",
  ],

  // ✅ più naturale (non “if you changed jobs?” letterale)
  en: [
    "Have you ever wondered what would change if you switched jobs?",
    "Have you ever wondered what would happen if you dropped everything for a while?",
    "Have you ever wondered what life would feel like if you lived somewhere else?",
    "Have you ever wondered what it would cost you to stay where you are for years?",
    "Have you ever wondered if you’re wasting time without noticing?",
    "Have you ever wondered if you’re actually doing what you want?",
    "Have you ever wondered if it’s time for a clean change of air?",
    "Have you ever wondered what would shift if you stopped postponing?",
    "Have you ever wondered what happens if you choose differently than people expect?",
    "Have you ever wondered what changes if you say what you really think?",
    "Have you ever wondered what it would be like to stay alone for a while?",
    "Have you ever wondered what happens if you end a relationship?",
    "Have you ever wondered what happens if you text that person today?",
    "Have you ever wondered what happens if you stop replying?",
    "Have you ever wondered if you’re with someone out of habit?",
    "Have you ever wondered if you deserve more than you’re accepting?",
    "Have you ever wondered what changes if you stop excusing others?",
    "Have you ever wondered how you could earn money differently?",
    "Have you ever wondered what you’d gain (and lose) by changing industries?",
    "Have you ever wondered what happens if you ask for more money?",
    "Have you ever wondered what happens if you work less?",
    "Have you ever wondered what changes if you invest in yourself first?",
    "Have you ever wondered what it costs to keep a job you don’t like?",
    "Have you ever wondered what happens if you take a bigger risk?",
    "Have you ever wondered if you’re aiming too low without realizing?",
    "Have you ever wondered what would shift if you bought a motorcycle?",
    "Have you ever wondered what you’d discover on a solo trip?",
    "Have you ever wondered what changes if you rebuild your routine from scratch?",
    "Have you ever wondered what happens if you try something new this week?",
    "Have you ever wondered what changes if you say yes instead of no?",
    "Have you ever wondered what changes if you say no instead of yes?",
    "Have you ever wondered what happens if you follow a “crazy” idea?",
    "Have you ever wondered what changes if you stop being afraid on purpose?",
    "Have you ever wondered who you become if you change one big habit?",
    "Have you ever wondered if you’re living your life—or just managing it?",
    "Have you ever wondered if you’re only enduring lately?",
    "Have you ever wondered if you’re braver than you think?",
    "Have you ever wondered if you’re settling to stay safe?",
    "Have you ever wondered if the “right moment” is a myth?",
    "Have you ever wondered if the right moment is actually now?",
  ],

  es: [
    "¿Alguna vez te has preguntado qué cambiaría si cambiaras de trabajo?",
    "¿Alguna vez te has preguntado qué pasaría si lo dejaras todo por un tiempo?",
    "¿Alguna vez te has preguntado cómo sería vivir en otro lugar?",
    "¿Alguna vez te has preguntado qué te costaría quedarte donde estás durante años?",
    "¿Alguna vez te has preguntado si estás perdiendo tiempo sin notarlo?",
    "¿Alguna vez te has preguntado si de verdad estás haciendo lo que quieres?",
    "¿Alguna vez te has preguntado si es momento de cambiar de aire?",
    "¿Alguna vez te has preguntado qué pasaría si dejaras de posponer?",
    "¿Alguna vez te has preguntado qué pasa si eliges distinto a lo que esperan los demás?",
    "¿Alguna vez te has preguntado qué cambia si dices lo que piensas de verdad?",
    "¿Alguna vez te has preguntado cómo sería quedarte solo por un tiempo?",
    "¿Alguna vez te has preguntado qué pasa si cierras una relación?",
    "¿Alguna vez te has preguntado qué pasa si le escribes a esa persona hoy?",
    "¿Alguna vez te has preguntado qué pasa si dejas de responder?",
    "¿Alguna vez te has preguntado si estás con alguien solo por costumbre?",
    "¿Alguna vez te has preguntado si mereces más de lo que aceptas?",
    "¿Alguna vez te has preguntado qué cambia si dejas de justificar a los demás?",
    "¿Alguna vez te has preguntado cómo ganar dinero de otra manera?",
    "¿Alguna vez te has preguntado qué ganarías (y qué perderías) cambiando de sector?",
    "¿Alguna vez te has preguntado qué pasa si pides más dinero?",
    "¿Alguna vez te has preguntado qué pasa si trabajas menos?",
    "¿Alguna vez te has preguntado qué cambia si inviertes en ti primero?",
    "¿Alguna vez te has preguntado qué cuesta seguir en un trabajo que no te gusta?",
    "¿Alguna vez te has preguntado qué pasa si arriesgas más?",
    "¿Alguna vez te has preguntado si estás apuntando demasiado bajo?",
    "¿Alguna vez te has preguntado qué cambiaría si compraras una moto?",
    "¿Alguna vez te has preguntado qué descubrirías en un viaje a solas?",
    "¿Alguna vez te has preguntado qué cambia si reconstruyes tu rutina desde cero?",
    "¿Alguna vez te has preguntado qué pasa si pruebas algo nuevo esta semana?",
    "¿Alguna vez te has preguntado qué cambia si dices sí en vez de no?",
    "¿Alguna vez te has preguntado qué cambia si dices no en vez de sí?",
    "¿Alguna vez te has preguntado qué pasa si sigues una idea “loca”?",
    "¿Alguna vez te has preguntado qué cambia si decides dejar de tener miedo?",
    "¿Alguna vez te has preguntado quién serías si cambias un hábito grande?",
    "¿Alguna vez te has preguntado si estás viviendo—o solo gestionando?",
    "¿Alguna vez te has preguntado si solo estás aguantando últimamente?",
    "¿Alguna vez te has preguntado si eres más valiente de lo que crees?",
    "¿Alguna vez te has preguntado si te conformas por seguridad?",
    "¿Alguna vez te has preguntado si el “momento correcto” es un mito?",
    "¿Alguna vez te has preguntado si el momento correcto es ahora?",
  ],

  fr: [
    "T’es-tu déjà demandé ce qui changerait si tu changeais de travail ?",
    "T’es-tu déjà demandé ce qui se passerait si tu lâchais tout un moment ?",
    "T’es-tu déjà demandé ce que ça ferait de vivre ailleurs ?",
    "T’es-tu déjà demandé ce que ça te coûterait de rester comme ça des années ?",
    "T’es-tu déjà demandé si tu perds du temps sans t’en rendre compte ?",
    "T’es-tu déjà demandé si tu fais vraiment ce que tu veux ?",
    "T’es-tu déjà demandé si c’était le moment de changer d’air ?",
    "T’es-tu déjà demandé ce qui changerait si tu arrêtais de remettre ?",
    "T’es-tu déjà demandé ce qui arrive si tu choisis autrement que ce qu’on attend ?",
    "T’es-tu déjà demandé ce qui change si tu dis ce que tu penses vraiment ?",
    "T’es-tu déjà demandé ce que ça ferait de rester seul un moment ?",
    "T’es-tu déjà demandé ce qui arrive si tu mets fin à une relation ?",
    "T’es-tu déjà demandé ce qui arrive si tu écris à cette personne aujourd’hui ?",
    "T’es-tu déjà demandé ce qui arrive si tu ne réponds plus ?",
    "T’es-tu déjà demandé si tu restes avec quelqu’un par habitude ?",
    "T’es-tu déjà demandé si tu mérites plus que ce que tu acceptes ?",
    "T’es-tu déjà demandé ce qui change si tu arrêtes d’excuser les autres ?",
    "T’es-tu déjà demandé comment gagner ta vie autrement ?",
    "T’es-tu déjà demandé ce que tu gagnes (et perds) en changeant de secteur ?",
    "T’es-tu déjà demandé ce qui arrive si tu demandes plus d’argent ?",
    "T’es-tu déjà demandé ce qui arrive si tu travailles moins ?",
    "T’es-tu déjà demandé ce qui change si tu investis en toi d’abord ?",
    "T’es-tu déjà demandé ce que ça coûte de garder un boulot que tu n’aimes pas ?",
    "T’es-tu déjà demandé ce qui arrive si tu prends plus de risques ?",
    "T’es-tu déjà demandé si tu vises trop bas sans le voir ?",
    "T’es-tu déjà demandé ce qui changerait si tu achetais une moto ?",
    "T’es-tu déjà demandé ce que tu découvrirais en voyageant seul ?",
    "T’es-tu déjà demandé ce qui change si tu refais ta routine à zéro ?",
    "T’es-tu déjà demandé ce qui arrive si tu essaies un truc nouveau cette semaine ?",
    "T’es-tu déjà demandé ce qui change si tu dis oui au lieu de non ?",
    "T’es-tu déjà demandé ce qui change si tu dis non au lieu de oui ?",
    "T’es-tu déjà demandé ce qui arrive si tu suis une idée “folle” ?",
    "T’es-tu déjà demandé ce qui change si tu décides d’arrêter d’avoir peur ?",
    "T’es-tu déjà demandé qui tu deviens si tu changes une grande habitude ?",
    "T’es-tu déjà demandé si tu vis—ou si tu gères juste ?",
    "T’es-tu déjà demandé si tu ne fais que tenir en ce moment ?",
    "T’es-tu déjà demandé si tu es plus courageux que tu ne le crois ?",
    "T’es-tu déjà demandé si tu te contentes par sécurité ?",
    "T’es-tu déjà demandé si le “bon moment” est un mythe ?",
    "T’es-tu déjà demandé si le bon moment, c’est maintenant ?",
  ],

  de: [
    "Hast du dich je gefragt, was sich ändern würde, wenn du den Job wechselst?",
    "Hast du dich je gefragt, was passiert, wenn du für eine Weile alles hinschmeißt?",
    "Hast du dich je gefragt, wie es wäre, woanders zu leben?",
    "Hast du dich je gefragt, was es dich kostet, jahrelang so weiterzumachen?",
    "Hast du dich je gefragt, ob du Zeit verlierst, ohne es zu merken?",
    "Hast du dich je gefragt, ob du wirklich tust, was du willst?",
    "Hast du dich je gefragt, ob es Zeit ist, frischen Wind reinzulassen?",
    "Hast du dich je gefragt, was sich ändert, wenn du aufhörst aufzuschieben?",
    "Hast du dich je gefragt, was passiert, wenn du anders wählst als andere erwarten?",
    "Hast du dich je gefragt, was sich ändert, wenn du sagst, was du wirklich denkst?",
    "Hast du dich je gefragt, wie es wäre, eine Weile allein zu sein?",
    "Hast du dich je gefragt, was passiert, wenn du eine Beziehung beendest?",
    "Hast du dich je gefragt, was passiert, wenn du dieser Person heute schreibst?",
    "Hast du dich je gefragt, was passiert, wenn du einfach nicht mehr antwortest?",
    "Hast du dich je gefragt, ob du nur aus Gewohnheit mit jemandem zusammen bist?",
    "Hast du dich je gefragt, ob du mehr verdienst als du gerade akzeptierst?",
    "Hast du dich je gefragt, was sich ändert, wenn du aufhörst, andere zu entschuldigen?",
    "Hast du dich je gefragt, wie du anders Geld verdienen könntest?",
    "Hast du dich je gefragt, was du gewinnst (und verlierst), wenn du die Branche wechselst?",
    "Hast du dich je gefragt, was passiert, wenn du mehr Geld verlangst?",
    "Hast du dich je gefragt, was passiert, wenn du weniger arbeitest?",
    "Hast du dich je gefragt, was sich ändert, wenn du zuerst in dich investierst?",
    "Hast du dich je gefragt, was es kostet, einen Job zu behalten, den du nicht magst?",
    "Hast du dich je gefragt, was passiert, wenn du mehr riskierst?",
    "Hast du dich je gefragt, ob du zu niedrig zielst, ohne es zu merken?",
    "Hast du dich je gefragt, was sich ändern würde, wenn du dir ein Motorrad kaufst?",
    "Hast du dich je gefragt, was du auf einer Solo-Reise entdecken würdest?",
    "Hast du dich je gefragt, was sich ändert, wenn du deine Routine neu baust?",
    "Hast du dich je gefragt, was passiert, wenn du diese Woche etwas Neues ausprobierst?",
    "Hast du dich je gefragt, was sich ändert, wenn du ja statt nein sagst?",
    "Hast du dich je gefragt, was sich ändert, wenn du nein statt ja sagst?",
    "Hast du dich je gefragt, was passiert, wenn du einer “verrückten” Idee folgst?",
    "Hast du dich je gefragt, was sich ändert, wenn du bewusst aufhörst, Angst zu haben?",
    "Hast du dich je gefragt, wer du wirst, wenn du eine große Gewohnheit änderst?",
    "Hast du dich je gefragt, ob du lebst—oder nur verwaltest?",
    "Hast du dich je gefragt, ob du gerade nur durchhältst?",
    "Hast du dich je gefragt, ob du mutiger bist, als du denkst?",
    "Hast du dich je gefragt, ob du dich aus Sicherheit mit weniger zufriedengibst?",
    "Hast du dich je gefragt, ob der “richtige Moment” ein Mythos ist?",
    "Hast du dich je gefragt, ob der richtige Moment jetzt ist?",
  ],
};

const WHATIF_CTX = {
  it: [
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
  ],
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
    "Parece una mañana normal, pero debajo hay esas ganas finas de cambiar algo, aunque sea un grado.",
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

/* --- WTF SERA (approvato, NON toccare per IT) --- */
const WTF_EVENING = {
  it: [
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
  ],
  en: [
    "What a legendary day, huh. Running around, getting hit by life… now tell me how it went, what the f.",
    "Congrats: today chaos didn’t miss a single appointment. Now spill it all—we’ll find a laugh and a turn, what the f.",
    "A day to frame… and toss straight in the trash. Before you sleep crooked, tell me what happened, what the f.",
    "Between awkward moments, random thoughts, and a creative survival swear here and there… complete day. Start from the spark, what the f.",
    "If today were a series, it’s already season three of mess. Quick recap: what happened? Then we deal with it, what the f.",
    "You survived today without throwing heavy objects, so that’s already a win. Now tell me everything, what the f.",
    "Masterpiece of a day: stress, hustle, and that moment a survival swear escapes you. Tell me the whole thing, what the f.",
    "It looked like it was going fine… then nope. Classic. Before you close your eyes, tell me how it really ended, what the f.",
    "Between things done badly and things not done at all, tonight is perfect to talk. Spit it out, what the f.",
    "If today left your brain in a washing machine, stop a second: tell me what happened and we’ll laugh it back into place, what the f.",
  ],
  es: [
    "Vaya día, eh. De un lado a otro… ahora cuéntame cómo te fue, qué carajo.",
    "Felicidades: hoy el caos no se ha perdido nada. Ahora suéltalo todo, que le encontramos la vuelta, qué carajo.",
    "Un día para enmarcar… y tirar al cubo. Antes de dormir torcido, dime qué pasó, qué carajo.",
    "Entre metidas de pata, pensamientos al azar y una maldición de supervivencia por ahí… día completo. Empieza por el principio, qué carajo.",
    "Si hoy fuera una serie, ya iría por la tercera temporada de lío. Resumen rápido: ¿qué pasó? Luego lo arreglamos, qué carajo.",
    "Has sobrevivido sin tirar objetos pesados, así que ya es victoria. Ahora cuéntamelo todo, qué carajo.",
    "Obra maestra de día: estrés, lío, y ese momento en que te sale una maldición de supervivencia. Cuéntame todo, qué carajo.",
    "Parecía que iba bien… y luego no. Clásico. Antes de cerrar los ojos, dime cómo terminó de verdad, qué carajo.",
    "Entre cosas mal hechas y cosas ni hechas, hoy es noche perfecta para hablar. Suéltalo, qué carajo.",
    "Si hoy te dejó la cabeza en lavadora, para un segundo: dime qué pasó y nos reímos, qué carajo.",
  ],
  fr: [
    "Quelle journée, hein. À courir partout… maintenant raconte-moi, bordel.",
    "Bravo : aujourd’hui le chaos n’a rien raté. Vas-y, dis-moi tout, on lui trouve une sortie, bordel.",
    "Une journée à encadrer… et à jeter direct. Avant de dormir de travers, raconte-moi ce qui s’est passé, bordel.",
    "Entre moments gênants, pensées en vrac et un juron de survie… journée complète. Commence au début, bordel.",
    "Si aujourd’hui était une série, on serait déjà à la saison 3 du bazar. Résumé : qu’est-ce qui s’est passé ? Bordel.",
    "Tu as survécu sans lancer d’objets lourds, donc déjà victoire. Maintenant dis-moi tout, bordel.",
    "Chef-d’œuvre de journée : stress, galère, et ce moment où sort un juron de survie. Raconte tout, bordel.",
    "On dirait que ça allait… puis non. Classique. Avant de fermer les yeux, dis-moi comment ça a fini, bordel.",
    "Entre trucs mal faits et trucs pas faits du tout, ce soir est parfait pour en parler. Crache-le, bordel.",
    "Si ta tête est restée dans la machine à laver, stop une seconde : raconte-moi et on s’en marre, bordel.",
  ],
  de: [
    "Was für ein Tag. Hin und her… jetzt erzähl’s mir, verdammt nochmal.",
    "Glückwunsch: Heute hat das Chaos keinen Termin ausgelassen. Jetzt raus damit—wir drehen’s irgendwie, verdammt nochmal.",
    "Ein Tag zum Einrahmen… und sofort wegwerfen. Bevor du schief einschläfst: Was ist passiert? Verdammt nochmal.",
    "Zwischen Peinlichkeiten, Zufallsgedanken und einem Überlebensfluch… kompletter Tag. Wo ging’s los? Verdammt nochmal.",
    "Wenn heute eine Serie wäre, wären wir schon Staffel 3 vom Chaos. Kurzer Recap: Was war los? Verdammt nochmal.",
    "Du hast überlebt, ohne schwere Dinge zu werfen—schon Sieg. Jetzt erzähl alles, verdammt nochmal.",
    "Meisterwerk-Tag: Stress, Hektik, und der Moment, wo dir ein Überlebensfluch rausrutscht. Erzähl’s, verdammt nochmal.",
    "Es sah so aus, als würde es laufen… dann doch nicht. Klassiker. Bevor du die Augen zumachst: Wie endete es wirklich? Verdammt nochmal.",
    "Zwischen schlecht gemacht und gar nicht gemacht: perfekter Abend zum Reden. Raus damit, verdammt nochmal.",
    "Wenn dein Kopf heute in der Waschmaschine gelandet ist: Halt kurz an—erzähl, und wir lachen drüber, verdammt nochmal.",
  ],
};

function buildWhatIfMorningSignal({ lang, seed }) {
  const L = normLang(lang);
  const ctxLib = WHATIF_CTX[L] || WHATIF_CTX.it;
  const qLib = WHATIF_Q[L] || WHATIF_Q.it;

  const ctx = ctxLib[seed % ctxLib.length] || ctxLib[0] || "";
  const q = qLib[(seed >>> 1) % qLib.length] || qLib[0] || "";

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

  const seedBase = `${L}|${slotKey}|${mood || ""}|${today}|${u}|${domanda || ""}`;
  const seed = hashStr(seedBase);

  // WHAT IF: SOLO MATTINA
  if (String(stile) !== "wtf") {
    return buildWhatIfMorningSignal({ lang: L, seed });
  }
  // WTF: SOLO SERA
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

/* ========= WHAT IF: motivazione fallback (multi-lingua) ========= */
function buildWhatIfMotivation(domanda, lang = "it", pct = 60) {
  const L = normLang(lang);
  if (L === "it") return `Probabilità circa ${pct}%. Regge se proteggi tempo ed energia; cala se resti nel rumore e nell’autopilota.`;
  if (L === "en") return `Estimated probability around ${pct}%. It holds if you protect time and energy; it drops if you stay on autopilot.`;
  if (L === "es") return `Probabilidad aproximada ${pct}%. Funciona si proteges tiempo y energía; baja si sigues en piloto automático.`;
  if (L === "fr") return `Probabilité estimée autour de ${pct}%. Ça tient si tu protèges ton temps et ton énergie; ça baisse en mode automatique.`;
  return `Geschätzte Wahrscheinlichkeit etwa ${pct}%. Es hält eher, wenn du Zeit und Energie schützt; es sinkt im Autopilot.`;
}

/* ========= MOTIVAZIONE LLM ========= */
async function generateMotivationLLM({ domanda, clarification, answer, lang, pct }) {
  const L = normLang(lang);

  const sys =
    L === "it"
      ? `Sei il MODULO MOTIVAZIONE di “WHAT IF”.
Scrivi UNA sola frase che spiega in modo pratico perché la probabilità è circa ${pct}% in questo scenario.
Coerente con la risposta principale. Niente emoji, niente elenco. Massimo 25 parole.`
      : L === "en"
      ? `You are the MOTIVATION MODULE of “WHAT IF”.
Write ONE short sentence explaining, practically, why probability is around ${pct}% here.
Consistent with the main answer. No emojis, no lists. Max 25 words.`
      : L === "es"
      ? `Eres el MÓDULO DE MOTIVACIÓN de “WHAT IF”.
Escribe UNA sola frase práctica explicando por qué la probabilidad es aproximadamente ${pct}%.
Coherente con la respuesta principal. Sin emojis, sin lista. Máximo 25 palabras.`
      : L === "fr"
      ? `Tu es le MODULE MOTIVATION de “WHAT IF”.
Écris UNE phrase pratique expliquant pourquoi la probabilité est d’environ ${pct}%.
Cohérent avec la réponse. Sans emoji, sans liste. Max 25 mots.`
      : `Du bist das MOTIVATIONSMODUL von „WHAT IF“.
Schreibe EINEN praktischen Satz, warum die Wahrscheinlichkeit etwa ${pct}% ist.
Kohärent mit der Antwort. Keine Emojis, keine Liste. Max 25 Wörter.`;

  const userContent =
    L === "it"
      ? `Domanda: "${domanda}". Dettaglio extra: "${clarification || ""}". Risposta: "${answer}". Ora UNA frase di motivazione in ITALIANO.`
      : L === "en"
      ? `Question: "${domanda}". Extra detail: "${clarification || ""}". Main answer: "${answer}". Now ONE motivation sentence in ENGLISH.`
      : L === "es"
      ? `Pregunta: "${domanda}". Detalle: "${clarification || ""}". Respuesta: "${answer}". Ahora UNA frase de motivación en ESPAÑOL.`
      : L === "fr"
      ? `Question: « ${domanda} ». Détail: « ${clarification || ""} ». Réponse: « ${answer} ». Maintenant UNE phrase de motivation en FRANÇAIS.`
      : `Frage: „${domanda}“. Zusatz: „${clarification || ""}“. Antwort: „${answer}“. Jetzt EIN Motivationssatz auf DEUTSCH.`;

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

  const sys =
    stile === "wtf"
      ? L === "it"
        ? `Sei un correttore di bozze per un monologo colorito.
Correggi solo errori evidenti e ripetizioni, senza cambiare tono o immagini. Un paragrafo.`
        : `You are a copy editor for a rough pub-style monologue. Fix only clear errors and repetition. Keep one paragraph.`
      : L === "it"
      ? `Sei un correttore di bozze.
Correggi errori e ripetizioni senza cambiare senso o tono. Un paragrafo.`
      : `You are a copy editor. Fix only clear errors and repetition. Keep one paragraph.`;

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
  if (!s) return normLang(lang) === "it" ? "ecchecazz!!!" : "what the f.";

  s = s.replace(/^["“”']+/, "").replace(/["“”']+$/, "").trim();
  s = s.replace(/\s*ecchecazz!+$/gi, "");
  s = s.replace(/\s*ecc[.,!?…]*$/gi, "");
  s = s.replace(/[\s.!?…]+$/g, "").trim();
  if (!s) return normLang(lang) === "it" ? "ecchecazz!!!" : "what the f.";

  // Solo IT chiude sempre con ecchecazz!!!
  if (normLang(lang) === "it") return `${s}, ecchecazz!!!`;
  return finalPunct(s);
}

/* =======================================================================
   ✅ LOG STATS + RECENT (solo manual / surprise / hint; NO signal)
   ======================================================================= */
const RECENT_KEY = "logs:ask:recent";
const STATS_ALL_KEY = "stats:ask:all";
const STATS_LAST_TS = "stats:ask:last_ts";
const STATS_LAST_DAY = "stats:ask:last_day";
const STATS_LAST_MONTH = "stats:ask:last_month";
const STATS_TZ = "Europe/Rome";

// Solo queste sorgenti devono apparire in admin + contatori
const COUNT_SOURCES = new Set(["manual", "surprise", "hint"]);

function dayKeyFromTs(ts, tz = STATS_TZ) {
  const d = new Date(Number(ts || 0));
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // YYYY-MM-DD
}
function monthKeyFromTs(ts, tz = STATS_TZ) {
  const d = new Date(Number(ts || 0));
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).format(d); // YYYY-MM
}

function resolveSource({ stage, micro }) {
  if (stage === "signal" || micro?.src === "signal") return "signal";
  if (micro?.surprise === true || micro?.src === "surprise") return "surprise";
  if (micro?.src === "hint" || micro?.hint === true || micro?.usedHint === true) return "hint";
  return "manual";
}

async function logRecentAndStats({ ts, style, periodo, lang, user_type, source, usedHint, surprise }) {
  try {
    if (String(source) === "signal") return;
    if (!COUNT_SOURCES.has(String(source))) return;

    const dayKey = dayKeyFromTs(ts, STATS_TZ);
    const monthKey = monthKeyFromTs(ts, STATS_TZ);
    if (!dayKey || !monthKey) return;

    const dayStatsKey = `stats:ask:day:${dayKey}`;
    const monthStatsKey = `stats:ask:month:${monthKey}`;

    const recentItem = {
      ts,
      style,
      periodo,
      lang,
      user_type,
      source,
      surprise: !!surprise,
      usedHint: !!usedHint,
    };

    const cmds = [
      ["LPUSH", RECENT_KEY, JSON.stringify(recentItem)],
      ["LTRIM", RECENT_KEY, "0", "199"],

      ["HINCRBY", dayStatsKey, "total", 1],
      ["HINCRBY", monthStatsKey, "total", 1],
      ["HINCRBY", STATS_ALL_KEY, "total", 1],

      ["HINCRBY", dayStatsKey, `style:${style}`, 1],
      ["HINCRBY", monthStatsKey, `style:${style}`, 1],
      ["HINCRBY", STATS_ALL_KEY, `style:${style}`, 1],

      ["HINCRBY", dayStatsKey, `periodo:${periodo}`, 1],
      ["HINCRBY", monthStatsKey, `periodo:${periodo}`, 1],
      ["HINCRBY", STATS_ALL_KEY, `periodo:${periodo}`, 1],

      ["HINCRBY", dayStatsKey, `matrix:${style}:${periodo}`, 1],
      ["HINCRBY", monthStatsKey, `matrix:${style}:${periodo}`, 1],
      ["HINCRBY", STATS_ALL_KEY, `matrix:${style}:${periodo}`, 1],

      ["HINCRBY", dayStatsKey, `source:${source}`, 1],
      ["HINCRBY", monthStatsKey, `source:${source}`, 1],
      ["HINCRBY", STATS_ALL_KEY, `source:${source}`, 1],

      ["SET", STATS_LAST_TS, String(ts)],
      ["SET", STATS_LAST_DAY, dayKey],
      ["SET", STATS_LAST_MONTH, monthKey],
    ];

    await redis.pipeline(cmds);
  } catch (e) {
    console.error("logRecentAndStats error:", e);
  }
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

    // ✅ robust body parse
    let body = req.body || {};
    if (typeof body === "string") {
      body = safeJsonParse(body) || {};
    } else if (typeof body === "object" && body && typeof body.body === "string") {
      // some proxies wrap it
      body = safeJsonParse(body.body) || body;
    }

    const stage = String(body.stage || "answer"); // "clarify" | "answer" | "signal"
    const domanda = String(body.domanda || "");
    const clarification = String(body.clarification || "");
    const stile = String(body.stile || "whatif"); // "whatif" | "wtf"
    const periodo = String(body.periodo || "future"); // "future" | "past"
    const micro = body.micro || {};

    // ✅ lingua coerente con pagina: priorità micro.lang > body.lang > header > it
    const L = normLang(micro?.lang || body.lang || guessLangFromHeader(req));

    const isSignal = stage === "signal" || micro?.src === "signal";

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const tsNow = Date.now();
    const source = resolveSource({ stage, micro });
    const user_type = micro?.pro ? "pro" : (micro?.user_type || "free");

    /* ====== STAGE: SIGNAL (NO AI) ====== */
    if (isSignal) {
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
        model: "signal-local-final",
        answer: text,
      });
    }

    /* ====== STAGE: CLARIFY ====== */
    if (stage === "clarify") {
      const messages = buildClarifyMessages({ domanda, stile, lang: L, periodo, micro });

      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: stile === "wtf" ? 1.0 : 0.7,
        top_p: 0.96,
        max_tokens: 80,
        frequency_penalty: stile === "wtf" ? 0.8 : 0.2,
        presence_penalty: stile === "wtf" ? 0.7 : 0.1,
        messages,
      });

      let clarQ = completion?.choices?.[0]?.message?.content?.trim() || "";
      clarQ = normalizeOneParagraph(clarQ);
      clarQ = sentenceCaseAll(clarQ);

      // WHAT IF: niente prima persona (tutte lingue)
      if (stile !== "wtf") clarQ = stripFirstPerson(clarQ, L, stile);

      // sicurezza: 1 frase max 22 parole (se il modello sfora)
      clarQ = clarQ.split(/\s+/).slice(0, 22).join(" ");
      clarQ = finalPunct(clarQ);

      await logRecentAndStats({
        ts: tsNow,
        style: stile,
        periodo,
        lang: L,
        user_type,
        source,
        usedHint: !!(micro?.hint || micro?.src === "hint" || micro?.usedHint),
        surprise: !!(micro?.surprise || micro?.src === "surprise"),
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

    // Safety nomi propri IT (come avevi)
    if (L === "it") {
      const d = String(domanda || "");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion = new Set(d.match(nameRx) || []);
      answer = answer.replace(nameRx, (m) => {
        if (["Ah","Oh","Ehi","Sai","Occhio","Piano","Fermati","Aspetta","La","Le","Una","Il","Qui","Tu"].includes(m)) return m;
        return inQuestion.has(m) ? m : m.toLowerCase();
      });
    }

    answer = sentenceCaseAll(answer);

    // Filtri WTF IT
    if (stile === "wtf" && L === "it") {
      answer = answer.replace(/\bprocrastinazion\w*/gi, "tirarla lunga");
      answer = answer.replace(/\brimando\b/gi, "tirarla lunga");
      answer = answer.replace(/\bmagari domani\b/gi, "poi, poi, poi");
      answer = answer.replace(/\bmerd\w*\b/gi, "schifo");
      answer = answer.replace(/\bcazz\w*/gi, (m) => m.replace(/cazz/gi, "azz"));
    }

    // Strip prima persona per WHAT IF (tutte lingue)
    if (stile !== "wtf") {
      answer = stripFirstPerson(answer, L, stile);
    }

    // Finale WTF (ecchecazz solo IT)
    if (stile === "wtf") {
      answer = ensureWtfEcchecazzEnding(answer, L);
    }

    // Finale WHAT IF (gancio multi-lingua, IT neutro)
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
    const isSurprise = !!(micro && (micro.surprise === true || micro.src === "surprise"));
    if (stile === "wtf" && !isSurprise) {
      const seedSci = hashStr(String(domanda || "") + "|scientific");
      if (seedSci % 100 < 70) {
        scientific = scientificReportDemenziale(domanda, L);
      }
    }

    await logRecentAndStats({
      ts: tsNow,
      style: stile,
      periodo,
      lang: L,
      user_type,
      source,
      usedHint: !!(micro?.hint || micro?.src === "hint" || micro?.usedHint),
      surprise: !!(micro?.surprise || micro?.src === "surprise"),
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
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
    }
