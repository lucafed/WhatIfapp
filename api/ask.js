// /api/ask.js — What?f Engine (versione C: oggetti dinamici + chiarimento + anti-ripetizione)

//  STILI
//  - WHAT IF: analisi scenari + probabilità + motivazione pratica
//  - WHAT THE F: barista filoso incazzato, sboccato ma affettuoso, con oggetti sempre diversi

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

// rate limit tollerante
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

/* ========= Helpers base ========= */
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
function sentenceCaseAll(s = "") {
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g, (m, prefix, chr) => prefix + chr.toUpperCase());
}
function finalPunct(s = "") {
  return /[.!?…]$/.test(s) ? s : s + ".";
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

/* ========= Prima persona (evita “io” protagonista) ========= */
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

/* ========= WHAT IF – regole sintetiche ========= */
const WHATIF_RULE_FUT_IT = `Sei “WHAT IF”: voce lucida, concreta, da amico sveglio.
Analizza 3–4 scenari (se lo fai, se non lo fai, se lo rimandi, se lo fai in modo diverso).
Guarda tempo, energie, soldi, relazioni, identità, rischi.
Poi prendi posizione: cosa ha più senso ORA per chi legge e perché.
Chiudi con 1–2 consigli pratici per i prossimi passi (azioni piccole ma chiare).
Niente eco della domanda, niente motivazione spirituale, niente prima persona narrativa.`;

const WHATIF_RULE_PAST_IT = `Sei “WHAT IF” in modalità PASSATO.
Descrivi come sarebbe andata quella scelta se l’avesse davvero fatta: cosa andava meglio, cosa si incastrava, cosa perdeva.
Poi porta tutto sull’oggi: cosa si impara, cosa può ancora scegliere adesso, come gli conviene muoversi.
Tono diretto, niente melodramma, niente colpa infinita. Nessuna prima persona narrativa.`;

function ensureZingaraEnding({ text, lang, periodo, domanda }) {
  let s = String(text || "").trim();
  const L = normLang(lang);
  if (L === "it") return s;
  const endings = {
    en: {
      future: ["And there you’d see you don’t need drama, just a cleaner choice."],
      past: ["You’d probably feel it: it wasn’t fate, just a different script you didn’t pick."],
    },
    es: {
      future: ["Y ahí verás que no hace falta un giro épico, solo una decisión más honesta."],
      past: ["Y hoy notarías que no era destino, era otro guion posible que no elegiste."],
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
  const pool = endings[L] || endings.en;
  const bag = String(periodo).toLowerCase() === "past" ? pool.past : pool.future;
  const already = /(you’d notice|you’d probably feel|notarás|verras|merkst du)/i.test(s);
  if (already || !bag?.length) return s;
  const addon = pickDet(bag, hashStr((domanda || "") + s));
  s = s.replace(/[.!?…]+$/, "");
  return `${s}. ${addon}`;
}

/* ========= WHAT THE F – materiale di base ========= */
const WTF_OPENINGS_IT = [
  "Eccheccazz, mettiti comodo che qui c’è materiale da far sudare pure il frigo mentale.",
  "Oh bello, già a leggere sta storia il tuo calendario ha chiesto il TFR.",
  "Porca vacca filosofica, questa domanda sembra uscita da una notte con troppo caffè e poca dignità.",
  "Azzo, qui non è un bivio, è una rotonda emotiva senza uscite chiare.",
  "Maremma maiala emotiva, questa scelta profuma di guaio interessante e crescita forzata.",
  "Per tutti i tostapane bruciati del destino, qui la vita ti ha messo un quiz a risposta multipla.",
  "Oh santo boiler esploso, qui o sistemi il cervello o ti iscrivi a una sitcom.",
  "Minchia santa metaforica, solo a leggere è partita un’imprecazione creativa nel cervello.",
  "Eccallà, anche oggi il cervello ha mandato la PEC al cuore.",
  "Porca vacca organizzata, questa è la domanda che fai quando sei a metà tra fuga e upgrade.",
];

const WTF_OPENINGS_EN = [
  "Well, damn, this already sounds like a premium-grade life mess.",
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

/* ========= STOPWORDS per oggetti dinamici ========= */
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

/* ========= Cliché da evitare SEMPRE ========= */
const HARDCODED_CLICHES = [
  "sedia",
  "sedie",
  "frigo",
  "frigorifero",
  "chat di gruppo",
  "whatsapp",
  "bollette",
  "meme di gatti",
  "divano giudicante",
  "tostapane bruciato",
];

/* ========= Anti-ripetizione giornaliera/“settimanale” ========= */
let DAILY_BLACKLIST = new Set();
let MONTH_BLACKLIST = new Set();
let LAST_DAY = null;
let LAST_MONTH = null;

function rotateBlacklists() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  if (LAST_DAY !== day) {
    DAILY_BLACKLIST = new Set();
    LAST_DAY = day;
  }
  if (LAST_MONTH !== month) {
    MONTH_BLACKLIST = new Set();
    LAST_MONTH = month;
  }
}

function commitObjects(objs) {
  for (const o of objs) {
    DAILY_BLACKLIST.add(o);
    MONTH_BLACKLIST.add(o);
  }
}

/* ========= Generatore di oggetti dinamici per WHAT THE F ========= */
async function generateDynamicObjects(domanda, clarification, lang = "it") {
  const L = normLang(lang);
  const kw = wtfKeywords(domanda).join(", ");
  const basePromptIT = `
Genera 20 oggetti/metafore concrete per una scena comica e un po' sboccata.
Regole:
- Devono avere senso nel CONTENUTO della domanda e del chiarimento.
- Evita assolutamente: sedie, frigo, frigorifero, chat di gruppo, WhatsApp, bollette, meme di gatti.
- Ogni oggetto 2–6 parole, nessuna frase lunga.
- Niente numeri di elenco, solo una lista riga per riga.

Domanda: "${domanda}"
Dettaglio utente: "${clarification}"
Parole chiave: ${kw || "—"}
  `.trim();

  const basePromptEN = `
Generate 20 concrete objects/metaphors for a darkly funny scene.
Rules:
- They must fit the MEANING of the question and clarification.
- Avoid chairs, fridge, WhatsApp chats, bills, cat memes.
- Each object 2–6 words, no full sentences.
- No bullet numbers, one item per line.

Question: "${domanda}"
Extra detail: "${clarification}"
Keywords: ${kw || "—"}
  `.trim();

  const content = L === "en" ? basePromptEN : basePromptIT;

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.9,
    top_p: 0.95,
    max_tokens: 220,
    messages: [
      {
        role: "system",
        content: "Sei un generatore di oggetti di scena comici. Zero cliché ripetuti.",
      },
      { role: "user", content },
    ],
  });

  let text = completion?.choices?.[0]?.message?.content || "";
  let lines = text
    .split("\n")
    .map((x) => x.replace(/^\s*[-*\d.]+\s*/, "").trim().toLowerCase())
    .filter(Boolean);

  lines = lines.filter(
    (l) =>
      !HARDCODED_CLICHES.some((c) => l.includes(c)) &&
      !DAILY_BLACKLIST.has(l) &&
      !MONTH_BLACKLIST.has(l)
  );

  if (!lines.length) {
    lines = [
      "calendario appeso in sciopero",
      "bancomat che fa finta di non vederti",
      "zaino pieno di decisioni rimandate",
      "specchio del bagno troppo sincero",
      "scarpe da ginnastica stanche di aspettare",
    ];
  }

  const pick = lines.slice(0, 10 + Math.min(10, Math.floor(lines.length / 2)));
  commitObjects(pick);

  return pick;
}

/* ========= Bestemmia creativa finale ========= */
const WTF_ENDINGS_IT = [
  "Morale: o muovi il sedere adesso o ti lamenti a vita, eccheccazz.",
  "Quindi scegli un casino solo e portalo fino in fondo, invece di collezionare rimpianti come scontrini, azzo.",
  "In sintesi: meno pippe mentali, più gesto concreto, che la vita non è una bozza infinita, ecchecazz.",
  "Conclusione spiccia: meglio una scelta storta ma tua che una vita perfetta decisa dalla paura, porca vacca lucida.",
];
const WTF_ENDINGS_EN = [
  "Bottom line: pick one mess and own it, or stay stuck in the waiting room forever.",
  "So yeah, less overthinking, more doing, before life files you under “nice potential, never used”.",
  "In short: choose one path and walk it angry, instead of politely circling the same doubt forever.",
];

function ensureWtfEnding(answer = "", lang = "it") {
  const L = normLang(lang);
  let s = String(answer || "").trim();
  if (!s) return s;
  const lastMatch = s.match(/([^.!?…]+[.!?…])\s*$/);
  const last = (lastMatch && lastMatch[1]) || s;
  if (/\b(quindi|morale|in sintesi|conclusione|bottom line|in short|so yeah)\b/i.test(last)) {
    return s;
  }
  const pool = L === "en" ? WTF_ENDINGS_EN : WTF_ENDINGS_IT;
  if (!pool?.length) return s;
  const extra = pool[hashStr(s) % pool.length];
  s = s.replace(/[.!?…]+$/, "");
  return `${s}. ${extra}`;
}

/* ========= Safety “cazzo” ========= */
function sanitizeCazzo(s = "") {
  return String(s)
    .replace(/\bcazzo\b/gi, "azzo")
    .replace(/\bcazzi\b/gi, "azzi")
    .replace(/\bcazz\b/gi, "azz");
}

/* ========= WTF de-cliché: frigo / bollette / WhatsApp solo se nella domanda ========= */
function deClicheWtf(answer = "", domanda = "") {
  const L = normLang("it");
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
      options: [
        "pdf della banca che ti guarda storto",
        "conto della luce con sopracciglio alzato",
        "estratto conto che sospira forte",
      ],
    },
    {
      check: () => !hasWord("whatsapp"),
      pattern: /\bwhatsapp\b/gi,
      options: [
        "gruppo Telegram triste",
        "chat muta sul telefono",
        "notifica silenziata da mesi",
      ],
    },
    {
      check: () => !hasWord("frigo") && !hasWord("frigorifero"),
      pattern: /\bfrigo(rifero)?\b/gi,
      options: [
        "dispensa mezza vuota che ti scruta",
        "armadio della cucina che sospira",
        "microonde che giudica in silenzio",
      ],
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

/* ========= PCT “probabilità” server-side ========= */
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

/* ========= Motivazione WHAT IF (fallback) ========= */
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

  function pickSentences(it, en, es, fr, de) {
    if (L === "en") return en;
    if (L === "es") return es;
    if (L === "fr") return fr;
    if (L === "de") return de;
    return it;
  }

  const pros = [];
  const cons = [];

  if (hasTime) {
    pros.push(
      pickSentences(
        "la timeline è gestibile se spezzetti il percorso",
        "the timeline is realistic if you break it into small chunks",
        "el tiempo es manejable si divides el camino",
        "le calendrier reste gérable si tu découpes en petites étapes",
        "der Zeitplan ist machbar, wenn du ihn in kleine Schritte teilst"
      )
    );
    cons.push(
      pickSentences(
        "se non proteggi il tempo rischi di rimandare all’infinito",
        "if you don’t protect time you’ll keep postponing quietly",
        "si no proteges tu tiempo acabarás posponiéndolo siempre",
        "sans temps protégé tu repousseras sans fin",
        "ohne geschützte Zeit wirst du es immer wieder verschieben"
      )
    );
  }
  if (hasBudget) {
    pros.push(
      pickSentences(
        "puoi tenere i costi sotto controllo fissando un tetto chiaro",
        "you can keep costs under control with a clear cap",
        "puedes mantener los costes bajo control con un límite claro",
        "tu peux contenir les coûts avec un plafond clair",
        "mit einem klaren Kostenlimit bleibt das Budget unter Kontrolle"
      )
    );
    cons.push(
      pickSentences(
        "se sottostimi le spese la pressione economica può frenarti",
        "underestimating expenses can add pressure and slow you down",
        "si infravaloras los gastos la presión económica te frena",
        "si tu sous-estimes les dépenses la pression financière te freine",
        "wenn du Ausgaben unterschätzt entsteht Druck der dich bremst"
      )
    );
  }
  if (hasDeadline) {
    pros.push(
      pickSentences(
        "una scadenza esplicita ti aiuta a decidere prima",
        "an explicit deadline helps you decide sooner",
        "un plazo definido empuja a decidir antes",
        "une échéance claire aide à trancher plus vite",
        "eine klare Deadline zwingt zu früheren Entscheidungen"
      )
    );
    cons.push(
      pickSentences(
        "se la scadenza è vaga tenderai a spostarla in avanti",
        "a fuzzy deadline tends to drift and weaken commitment",
        "si el plazo es difuso se irá moviendo hacia adelante",
        "une date floue glisse facilement et affaiblit ton engagement",
        "eine vage Frist rutscht leicht nach hinten"
      )
    );
  }
  if (action) {
    pros.push(
      pickSentences(
        "hai una leva concreta su cui agire ogni giorno",
        "you have a concrete lever you can pull every day",
        "tienes una palanca concreta para avanzar cada día",
        "tu as un levier concret à actionner chaque jour",
        "du hast einen konkreten Hebel, den du täglich bewegen kannst"
      )
    );
  }
  if (riskHedging) {
    pros.push(
      pickSentences(
        "puoi limitare il rischio con poche regole semplici",
        "simple constraints can cap the downside",
        "puedes limitar el riesgo con reglas sencillas",
        "quelques règles simples peuvent limiter le risque",
        "einfache Regeln können das Risiko begrenzen"
      )
    );
    cons.push(
      pickSentences(
        "se cerchi rischio zero rischi di non muoverti mai",
        "chasing zero risk can keep you stuck at the start line",
        "buscar riesgo cero puede dejarte inmóvil",
        "viser le risque zéro peut te figer",
        "wenn du null Risiko willst kommst du vielleicht nie in Gang"
      )
    );
  }

  if (!pros.length) {
    pros.push(
      pickSentences(
        "la vera leva è la routine: piccoli passi costanti battono le grandi intenzioni",
        "the real lever is routine: small consistent steps beat big intentions",
        "la palanca real es la rutina: pasos constantes vencen a los grandes planes",
        "le vrai levier c’est la routine: de petits pas réguliers dépassent les grandes intentions",
        "der wahre Hebel ist Routine: kleine konstante Schritte schlagen große Vorsätze"
      )
    );
  }
  if (!cons.length) {
    cons.push(
      pickSentences(
        "il collo di bottiglia è la tua energia più che la fortuna",
        "your main bottleneck is energy and focus, not luck",
        "el cuello de botella es tu energía y foco, no la suerte",
        "le principal goulot d’étranglement est ton énergie, pas la chance",
        "der Engpass ist deine Energie und Fokussierung, nicht das Schicksal"
      )
    );
  }

  const pSentence = pickSentences(
    `Probabilità circa ${pct}%.`,
    `Estimated probability around ${pct}%.`,
    `Probabilidad aproximada ${pct}%.`,
    `Probabilité estimée autour de ${pct}%.`,
    `Geschätzte Wahrscheinlichkeit etwa ${pct}%.`
  );
  const proConSentence = pickSentences(
    `A favore: ${pros[0]}. Contro: ${cons[0]}.`,
    `Pros: ${pros[0]}. Cons: ${cons[0]}.`,
    `A favor: ${pros[0]}. En contra: ${cons[0]}.`,
    `Atouts: ${pros[0]}. Freins: ${cons[0]}.`,
    `Dafür: ${pros[0]}. Dagegen: ${cons[0]}.`
  );
  return `${pSentence} ${proConSentence}`.trim();
}

/* ========= Motivazione via LLM (se possibile) ========= */
async function generateMotivationLLM({ domanda, clarification, answer, lang, pct }) {
  const L = normLang(lang);
  let sys;
  if (L === "en") {
    sys = `You are the MOTIVATION MODULE of “WHAT IF”.
Write ONE short sentence that explains, in a practical way, WHY the probability is around ${pct}% for this scenario.
No emojis, no list, max 25 words.`;
  } else if (L === "it") {
    sys = `Sei il MODULO MOTIVAZIONE di “WHAT IF”.
Scrivi UNA sola frase che spiega in modo pratico perché la probabilità è circa ${pct}% in questo scenario.
Niente emoji, niente elenco, massimo 25 parole.`;
  } else {
    sys = `Write ONE short sentence that explains why the probability is around ${pct}% for this scenario.
No emojis, no list, max 25 words.`;
  }

  const userContent =
    L === "en"
      ? `User question: "${domanda}". Extra detail: "${clarification || ""}". Main answer: "${answer}".`
      : `Domanda: "${domanda}". Dettaglio extra: "${clarification || ""}". Risposta principale: "${answer}".`;

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

/* ========= Rapporto scientifico demenziale per WHAT THE F ========= */
function scientificReportDemenziale(domanda = "", lang = "it") {
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

  if (lang === "en") {
    return `Scientific-ish report: ${u} (n=${n}) found that a “${e}” improves decision clarity (${m}). Peer-reviewed by ${j}, allegedly.`;
  }
  return `Rapporto scientifico (più o meno): ${u} (n=${n}) rileva che “${e}” migliora la chiarezza decisionale (${m}). Revisione a cura di ${j}, forse.`;
}

/* ========= CLARIFY: messaggi per domanda di chiarimento ========= */
function buildClarifyMessages({ domanda, stile, lang, periodo }) {
  const L = normLang(lang);
  const isPast = String(periodo).toLowerCase() === "past";

  let sys;
  if (stile === "wtf") {
    const LANG_LABEL =
      L === "it"
        ? "ITALIANO"
        : L === "es"
        ? "SPAGNOLO"
        : L === "fr"
        ? "FRANCESE"
        : L === "de"
        ? "TEDESCO"
        : "ENGLISH";

    if (L === "en") {
      sys = `You are “WHAT THE F”: a rough, foul-mouthed but wise bartender-philosopher.
Roast the situation, not the person, with absurd images and playful swearing.
TASK:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- Use a fresh, concrete image every time (never always the same chair or the same object).
- One sentence, max 22 words, no emojis, no bullet points.`;
    } else {
      sys = `Sei “WHAT THE F”: buzzurro grezzo, volgare ma colto e filoso incazzato.
Prendi in giro la SITUAZIONE, non la dignità di chi legge.
Usi parolacce comiche tipo “eccheccazz”, “azzo”, “maremma maiala”, “porca vacca”.
NON usare sempre la stessa sedia o gli stessi oggetti di scena: ogni domanda deve avere un oggetto diverso (una vetrina, un bidone, un telecomando, una scarpa, ecc.), mai ripetuto in modo identico.`;

      sys += `

COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Mezza presa in giro, mezza verità che punge.
- Usa un SOLO oggetto assurdo scelto adesso (diverso da sedie e soliti cliché), legato alla scena.
- Una frase, massimo 22 parole, niente emoji, niente elenco.`;
    }
  } else {
    if (L === "en") {
      sys = `You are “WHAT IF”: a very clear, grounded advisor.
TASK:
- Ask EXACTLY ONE clarifying question in ENGLISH.
- Focus on 1–2 key details that change the analysis (goal, constraint, timeframe, definition of “it went well”).
- One sentence, max 22 words, no emojis. No first-person narration.`;
    } else {
      const LANG_LABEL =
        L === "it" ? "ITALIANO" : L === "es" ? "SPAGNOLO" : L === "fr" ? "FRANCESE" : "TEDESCO";

      sys = `Sei “WHAT IF”: voce lucida e concreta, da amico che ragiona bene sui pro e contro.
COMPITO:
- Fai ESATTAMENTE UNA domanda di chiarimento in ${LANG_LABEL}.
- Punta su 1–2 dettagli che cambiano il quadro: obiettivo reale, vincolo principale, tempi, cosa consideri “andata bene”.
- Una frase, massimo 22 parole, niente emoji, niente elenco, niente prima persona narrativa.`;
    }
  }

  const userMsg =
    L === "en"
      ? `User "what if" question:\n"${domanda}"\nAsk ONE clarifying question in ENGLISH, following the style rules above.`
      : L === "it"
      ? `Domanda "e se" dell’utente:\n"${domanda}"\nFai UNA sola domanda di chiarimento in ITALIANO, seguendo le regole di stile sopra.`
      : `Question:\n"${domanda}"\nAsk ONE clarifying question in ${L.toUpperCase()}, following the style rules above.`;

  return [
    { role: "system", content: sys },
    { role: "user", content: userMsg },
  ];
}

/* ========= BUILD MESSAGES per risposta finale ========= */
function buildAnswerMessages({ domanda, clarification, lang, periodo, stile, oggetti }) {
  const L = normLang(lang);
  const isPast = String(periodo).toLowerCase() === "past";
  const hasClar = clarification && String(clarification).trim().length > 0;
  const c = hasClar ? String(clarification).trim() : "";

  const msgs = [];

  if (stile === "wtf") {
    let rule;
    if (L === "en") {
      rule = `
You are “WHAT THE F”: a rough, foul-mouthed but warm bartender-philosopher.
Roast the situation, not the person. Use vivid, absurd images grounded in real life.
Use some playful swearing (“what the hell”, “for f’s sake”, “this majestic mess”), never against groups/identities.
Avoid first-person storytelling; focus on “you”.
Use the provided objects as props in the scene. Never reuse fridge, bills, Whatsapp chats unless they appear in the question itself.
One paragraph, 5–8 sentences, no emojis, no bullet points.`;
    } else {
      rule = `
Sei “WHAT THE F”: buzzurro grezzo ma colto, barista filoso incazzato.
Prendi in giro la SCENA, non la persona.
Parolacce comiche (“eccheccazz”, “azzo”, “maremma maiala”, “porca vacca”) per far ridere, mai contro categorie o identità.
Evita la narrativa in prima persona, la telecamera è sempre sull’utente.
Usa gli oggetti di scena che ti vengono passati: infilali nella scena in modo naturale, mai tutti in fila.
Niente frigo/bollette/chat WhatsApp generici a meno che non siano davvero nella domanda.`;
      if (isPast) {
        rule += `
Modalità PASSATO: racconti la stagione alternativa della sua vita (se avesse fatto quella scelta), e poi lo riporti all’oggi.`;
      }
    }

    msgs.push({ role: "system", content: rule });

    const objLine =
      oggetti && oggetti.length
        ? `Oggetti/metafore da usare (non tutti, ma almeno 3–4 diversi):\n${oggetti
            .map((o) => "- " + o)
            .join("\n")}`
        : "";

    const userPrompt =
      L === "en"
        ? `Question (do NOT repeat it): "${domanda}".
Extra detail: "${c}".
${objLine}
Write ONE loud, sarcastic, messy but secretly wise answer as “WHAT THE F”.
Show what happens if they do it and if they keep dodging it, then close with a crooked but clear piece of advice.`
        : `Domanda (non ripeterla): "${domanda}".
Dettaglio extra: "${c}".
${objLine}
Scrivi UNA risposta in italiano come voce “WHAT THE F”: monologo unico, 5–8 frasi, pieno di immagini assurde ma legate davvero alla scena.
Mostra cosa succede se fa questa scelta e cosa succede se continua a rimandare, e chiudi con un consiglio secco in stile bestemmia creativa.`;

    msgs.push({ role: "user", content: userPrompt });
    return msgs;
  }

  // WHAT IF
  let rule;
  if (L === "it") {
    rule = isPast ? WHATIF_RULE_PAST_IT : WHATIF_RULE_FUT_IT;
  } else if (L === "en") {
    rule =
      "You are “WHAT IF”: clear, grounded advisor. Analyse 3–4 realistic scenarios, then pick what makes most sense now and give practical next steps. No first-person narration.";
  } else {
    rule =
      "You are a clear, grounded advisor. Analyse realistic scenarios, then give practical suggestions. No first-person narration, no echo of the question.";
  }

  msgs.push({ role: "system", content: rule });

  let ask;
  if (L === "it") {
    if (isPast) {
      ask = `Domanda sul PASSATO (non ripeterla): "${domanda}".
Dettaglio extra: "${c}".
Genera UNA risposta CONTROFATTUALE: descrivi come sarebbe andata davvero quella scelta, poi spiega cosa impari e come ti conviene muoverti ORA. Paragrafo unico, 5–7 frasi.`;
    } else {
      ask = `Domanda originale (non ripeterla): "${domanda}".
Dettaglio extra: "${c}".
Genera UNA risposta: prima analizzi i possibili scenari (se lo fai, se non lo fai, se lo rimandi, se lo fai in modo diverso), poi prendi posizione su cosa ha più senso e dai consigli pratici su come comportarti. Paragrafo unico, 5–7 frasi.`;
    }
  } else if (L === "en") {
    ask = isPast
      ? `Original question about the PAST (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE COUNTERFACTUAL answer: describe the alternate timeline as if it had really happened, then extract what matters now and give practical advice for today. Single paragraph, 5–7 sentences.`
      : `Original question (do not repeat it): "${domanda}". Extra detail: "${c}". Write ONE answer as “WHAT IF”: first analyse different scenarios (doing it, not doing it, delaying, doing a lighter version), then clearly suggest what makes more sense and how to act. Single paragraph, 5–7 sentences.`;
  } else {
    ask = `Question (do not repeat it): "${domanda}". Extra detail: "${c}". Give ONE clear, practical answer in ${L.toUpperCase()}, one paragraph.`;
  }

  msgs.push({ role: "user", content: ask });
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

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
    rotateBlacklists();

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

    /* ====== STAGE: ANSWER ====== */
    let dynamicObjects = [];
    if (stile === "wtf") {
      try {
        dynamicObjects = await generateDynamicObjects(domanda, clarification, L);
      } catch (e) {
        dynamicObjects = [
          "calendario appeso in sciopero",
          "bancomat che fa finta di non vederti",
          "zaino pieno di decisioni rimandate",
        ];
      }
    }

    const messages = buildAnswerMessages({
      domanda,
      clarification,
      lang: L,
      periodo,
      stile,
      oggetti: dynamicObjects,
    });

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

    answer = stripQuestionEcho(domanda, answer);

    if (stile === "wtf") {
      answer = tightenSentences(answer, 8);
      answer = clampWords(answer, 150);
      answer = normalizeOneParagraph(answer);
      const open = wtfOpening(domanda, L);
      if (open) answer = `${open} ${answer}`;
      answer = sentenceCaseAll(answer);
      answer = stripFirstPerson(answer, L, stile);
      answer = sanitizeCazzo(answer);
      answer = deClicheWtf(answer, domanda);
      answer = ensureWtfEnding(answer, L);
    } else {
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 120);
      answer = normalizeOneParagraph(answer);
      answer = sentenceCaseAll(answer);
      answer = stripFirstPerson(answer, L, stile);
      if (L !== "it") {
        answer = ensureZingaraEnding({ text: answer, lang: L, periodo, domanda });
      }
    }

    answer = finalPunct(answer);

    const pct = computePct(domanda, stile);
    let motivation = null;
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
