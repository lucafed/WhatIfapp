// /api/ask.js — What?f Engine (Zingara-Realista WHATIF + Friendly-WTF Demenziale)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate (opzionale) ========= */
let rateOk = async () => true;

(() => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return; // niente rate limit se non configurato

  try {
    const redis = new Redis({ url, token });
    const rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
    });

    rateOk = async (key) => {
      try {
        const { success } = await rl.limit(key);
        return !!success;
      } catch {
        return true; // se Upstash dà errore, non bloccare
      }
    };
  } catch {
    // se anche solo creare Redis fallisce, ignora rate limit
    rateOk = async () => true;
  }
})();

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
    .replace(/[.,;:!?()-—]+$/g, "")
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
    seen.add(n);
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
  const m = slice.match(/([\s\S]*?[.!?…])(?![\s\S][.!?…])/);
  return m ? m[1] : slice + "…";
}

function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.{3,}/g, "…")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t
    .slice(0, Math.min(t.length, d.length + 12))
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .trim();
  const rx = /^(?:e\sse|what\sif|domanda:|q:)[^.!?…]*[.!?…]\s+/i;

  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  t = t.replace(rx, "");
  return t;
}

function sentenceCaseAll(s = "") {
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g, (m, prefix, chr) => {
    return prefix + chr.toUpperCase();
  });
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
  if (!arr || !arr.length) return "";
  return arr[seed % arr.length] || "";
}

/* ========= WHAT IF – esempio di respiro ========= */
const WHATIF_HYBRID_EX_IT = `La linea del tuo destino qui si fa più spessa del resto. Vedi una scelta che alleggerisce le tue giornate: meno rumore, più tempo che torna davvero tuo. Senti le abitudini stringersi e poi allentarsi, finché trovi un ritmo più umano. Non è fuga né eroismo: è manutenzione di vita, dove sposti peso tra lavoro, relazioni ed energia. In fondo, non insegui più la vetrina: ti scegli una stanza in cui respirare meglio. E quando ti volterai, capirai che il rimpianto ha perso voce proprio dove hai iniziato a scegliere te.`;

/* ======= WHAT IF RULES (IT) ======= */
const WHATIF_RULE_FUT_IT = `WHAT IF (italiano, FUTURO):

Tono: veggente/zíngara realista, mistica ma concreta.

APRI con UNA sola riga breve e intensa, come se leggessi il destino: niente onomatopee tipo "shh", "mmm", niente ripetizione della domanda.

La SECONDA frase deve INIZIARE con una di queste parole, scegliendo quella più adatta alla domanda: "Vedo", "Sento", "Immagino", "Intuisco", "Si apre", "Si muove".

60% analisi concreta (routine, tempo, costi/benefici, energia, relazioni) + 40% immagini sobrie della quotidianità.

Scrivi un futuro vicino che inizia adesso: usa futuro/condizionale semplice ("potresti", "inizierai", "probabilmente").

Mantieni la risposta aderente al tema della domanda (città, relazione, lavoro, ecc.), senza esempi generici fuori contesto.

Chiudi con una frase che lasci una sensazione chiara e un piccolo gancio di curiosità.

8–10 frasi, seconda persona, un paragrafo unico, NON ripetere la domanda, niente elenchi, niente emoji. Linguaggio semplice, concreto, coinvolgente.`;

const WHATIF_RULE_PAST_IT = `WHAT IF (italiano, PASSATO CONTROFATTUALE):

Tono: veggente/zíngara che rilegge una vita alternativa, mistica ma concreta.

APRI con UNA riga breve e intensa, come se indicassi una vita che non è stata vissuta.

La SECONDA frase deve INIZIARE con "Vedo", "Sento", "Immagino", "Intuisco", "Si sarebbe aperto", "Si sarebbe mosso" (usa forma naturale).

Scrivi in chiave controfattuale: "se avessi…, avresti…", "ti saresti trovato…", "avresti sentito…".

Nessuna data o fatto reale non fornito; resta fedele al tema della domanda (relazione, scelta, città, lavoro, ecc.).

60% analisi concreta + 40% immagini sobrie di quella vita alternativa.

Chiudi con sensazione + micro-gancio che riporti dolcemente al presente ("non sarebbe stato un errore, sarebbe stata un'altra versione di te", ecc.).

8–10 frasi, seconda persona, un paragrafo unico, NON ripetere la domanda, niente elenchi, niente emoji. Linguaggio semplice, concreto, coinvolgente.`;

/* ========= Incipit dinamici ========= */
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
    "Qui il destino non urla: sussurra, ma con una precisione ostinata.",
  ],
  en: [
    "The line of your fate thickens right here.",
    "The cards of your path are turning as you speak.",
    "A thin fold in your story is asking to be read.",
  ],
  es: [
    "La línea de tu destino se marca justo aquí.",
    "Las cartas de tu camino se están girando ahora.",
  ],
  fr: [
    "La ligne de ton destin se souligne précisément ici.",
    "Les cartes de ta route sont en train de tourner.",
  ],
  de: [
    "Die Linie deines Weges wird genau hier deutlicher.",
    "Die Karten deines Weges wenden sich in diesem Moment.",
  ],
};

/* ========= Finali “gancio” ========= */
const ZINGARA_ENDINGS = {
  it: {
    future: [
      "E lì ti accorgerai che non serve correre: basta scegliere bene.",
      "E proprio lì capirai che la calma non è rinuncia, è margine.",
      "Da quel punto sentirai la vita rispondere semplice: poco, ma tuo.",
      "E quando ti volterai, vedrai che la fatica stava solo aprendo spazio.",
    ],
    past: [
      "Forse oggi lo sentiresti nelle ossa: non era destino, era ritmo.",
      "E ti verrebbe voglia di chiederti un’altra volta: e se lo facessi adesso?",
      "Ti ritroveresti a pensare che alcune strade restano aperte, anche tardi.",
      "E capirai che quel rimpianto non morde: invita a provare meglio, adesso.",
    ],
  },
  en: {
    future: [
      "And there you’ll notice you don’t need speed, just a good angle.",
    ],
    past: ["Maybe you’d feel it in your bones: it wasn’t fate, just timing."],
  },
  es: {
    future: [
      "Y ahí notarás que no hace falta correr, solo elegir bien.",
    ],
    past: ["Y quizá hoy lo sentirías: no era destino, era ritmo."],
  },
  fr: {
    future: [
      "Et là tu verras: pas besoin de courir, juste de choisir juste.",
    ],
    past: [
      "Et peut-être que tu le saurais: ce n’était pas le destin, mais le tempo.",
    ],
  },
  de: {
    future: [
      "Und dort merkst du: Tempo ist egal, der Winkel zählt.",
    ],
    past: ["Vielleicht spürst du heute: kein Schicksal, nur Timing."],
  },
};

function ensureZingaraEnding({ text, lang, periodo, domanda }) {
  let s = String(text || "").trim();
  const last = (s.match(/([^.!?…]+[.!?…])\s*$/) || [])[1] || s;
  const alreadyHasHook = /(ti accorgerai|capirai|ti verrà voglia|ti ritroverai|e lì|e proprio lì|da quel punto|forse oggi|maybe you’d feel|and there you’ll notice)/i.test(
    last
  );
  if (alreadyHasHook) return s;

  const L = normLang(lang);
  const pool = ZINGARA_ENDINGS[L] || ZINGARA_ENDINGS.it;
  const bag =
    String(periodo).toLowerCase() === "past"
      ? pool.past || ZINGARA_ENDINGS.it.past
      : pool.future || ZINGARA_ENDINGS.it.future;

  const addon = pickDet(bag, hashStr(String(domanda || "") + s));
  if (!addon) return s;

  s = s.replace(/[.!?…]+$/g, "");
  return `${s}. ${addon}`;
}

/* ========= WTF ========= */
const WTF_IMPRE = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "vulcano d’anatemi",
  "tromba d’aria di improperi",
];

const WTF_REACT = [
  "la moka ti fa una standing ovation e chiede l’autografo",
  "il POS entra in modalità testimone di nozze e benedice la carta",
  "la tapparella si abbassa per pudore e poi sbircia curiosa",
  "la lampada lampeggia in Morse “ti capisco”",
  "Alexa finge un aggiornamento e scappa in modalità monaco",
  "il frigorifero sospira e decide di diventare minimalista",
  "il campanello suona da solo per solidarietà e poi si pente",
  "la pianta applaude con le foglie e ti chiede un drink",
  "il ventilatore gira al contrario “per rispetto”",
  "il citofono fa un trillo come un amen stonato",
];

const WTF_DRINK = [
  "ti versi un amaro doppio e metti in riga i pensieri",
  "fai un sorso corto e il mondo rientra nei bordi",
  "alzi un bicchiere piccolo: brindisi di manutenzione",
  "bevi un dito di coraggio e respiri più largo",
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }) {
  const L = normLang(lang);

  const baseRules =
    L === "en"
      ? "RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only. Stay close to the topic of the question."
      : "REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona. Resta aderente al tema della domanda.";

  const msgs = [{ role: "system", content: baseRules }];

  if (stile === "wtf") {
    let seed = [...String(domanda)].reduce((a, c) => a + c.charCodeAt(0), 0);
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    }

    const impre =
      WTF_IMPRE[Math.floor(rnd() * WTF_IMPRE.length)] || WTF_IMPRE[0];
    const shuffled = [...WTF_REACT].sort(() => rnd() - 0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd() * 2));
    const drink =
      WTF_DRINK[Math.floor(rnd() * WTF_DRINK.length)] || WTF_DRINK[0];

    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Struttura OBBLIGATORIA: presa in giro affettuosa (max 2 frasi) → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”, narrato, mai insulto a persone) → SUBITO ${react.length} reazioni di oggetti esilaranti → drink (“${drink}”) → 1–2 frasi che rispondono davvero → morale calda e ironica. 6–8 frasi.`;
    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). STRICT sequence: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” (narrated, never insulting people) → THEN ${react.length} absurd object reactions → drink (“${drink}”) → 1–2 lines that truly answer → warm ironic moral. 6–8 sentences.`;

    msgs.push(
      { role: "system", content: L === "en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content: `IMPRECATION: ${impre}` },
      { role: "system", content: `REACTIONS:\n- ${react.join("\n- ")}` },
      { role: "system", content: `DRINK: ${drink}` },
      {
        role: "system",
        content: `ESEMPI VINCOLANTI (tono/ritmo IT):

Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.

Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.

Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
      }
    );
  } else {
    if (L === "it") {
      const ruleIT =
        String(periodo).toLowerCase() === "past"
          ? WHATIF_RULE_PAST_IT
          : WHATIF_RULE_FUT_IT;
      msgs.push(
        { role: "system", content: ruleIT },
        {
          role: "system",
          content: `ESEMPIO (respiro e tono, non vincolante nei contenuti):\n${WHATIF_HYBRID_EX_IT}`,
        }
      );
    }
  }

  let ask;
  if (L === "en") {
    ask = `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH. Single paragraph.`;
  } else if (L === "it") {
    ask = `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico.`;
  } else if (L === "es") {
    ask = `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.`;
  } else if (L === "fr") {
    ask = `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.`;
  } else {
    ask = `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.`;
  }

  msgs.push({ role: "user", content: ask });
  return msgs;
}

/* ========= Server-side PCT ========= */
function computePct(domanda, stile) {
  const t = String(domanda || "").toLowerCase();
  let s = 50;

  if (/\b(7|14|21|30|60|90)\b/.test(t)) s += 12;
  if (/\b\d+([.,]\d+)?\b/.test(t)) s += 8;
  if (/budget|€|euro|spesa|max|under|sotto/.test(t)) s += 6;
  if (/senza|solo|al massimo|minimo|entro|prima delle|ogni|per/.test(t))
    s += 8;
  if (/lancia|apri|impara|scrivi|chiedi|corri|studia|automatizza|testa/.test(t))
    s += 6;
  if (/forse|magari|maybe|quizás/.test(t)) s -= 8;
  if (!/\b\d/.test(t)) s -= 6;
  s += stile === "wtf" ? -4 : 2;

  const pct = Math.max(25, Math.min(92, Math.round(s)));
  return pct;
}

/* ========= WHAT IF: motivazione sintetica ========= */
function buildWhatIfMotivation(domanda, lang = "it", pct = 60) {
  const L = (lang || "it").slice(0, 2).toLowerCase();
  const t = String(domanda || "").toLowerCase();

  const hasTime = /\b(7|14|21|30|60|90|giorn|settiman|mes|mesi|anni|days?|weeks?|months?|years?)\b/.test(
    t
  );
  const hasBudget = /(budget|€|euro|spesa|costo|prezzo|max|under|sotto|caparra|cost|money)/.test(
    t
  );
  const hasDeadline = /(entro|prima|scadenza|deadline|by\s+\d|before\s+\d)/.test(
    t
  );
  const action = /(apri|lancia|impara|studia|scrivi|automatizza|testa|cambia|trova|assumi|costruisci|crea|launch|start|learn|build|create)/.test(
    t
  );
  const riskHedging = /(senza|solo|al massimo|minimo|rischio|risk|minimize|hedge)/.test(
    t
  );

  if (L === "it") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push("la timeline è gestibile se spezzetti il percorso");
      cons.push(
        "se non proteggi il tempo, rischi di rimandare all’infinito"
      );
    }
    if (hasBudget) {
      pros.push(
        "puoi tenere i costi sotto controllo fissando un tetto chiaro"
      );
      cons.push(
        "se sottostimi le spese, la pressione economica può frenarti"
      );
    }
    if (hasDeadline) {
      pros.push("una scadenza esplicita ti aiuta a decidere prima, non meglio");
      cons.push(
        "se la scadenza è vaga, tenderai a spostarla sempre un po’ più avanti"
      );
    }
    if (action) {
      pros.push("hai una leva concreta su cui agire ogni giorno");
    }
    if (riskHedging) {
      pros.push("puoi limitare il rischio con poche regole semplici");
      cons.push(
        "se cerchi rischio zero, potresti non muoverti mai davvero"
      );
    }

    if (!pros.length) {
      pros.push(
        "la vera leva è la routine: piccoli passi costanti battono le grandi intenzioni"
      );
    }
    if (!cons.length) {
      cons.push(
        "il collo di bottiglia è la tua energia: se allarghi troppo lo scope, ti blocchi"
      );
    }

    const pSentence = `Probabilità circa ${pct}%.`;
    const proSentence = `A favore: ${pros.slice(0, 2).join(", ")}.`;
    const conSentence = `Contro: ${cons.slice(0, 2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  if (L === "en") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push(
        "the timeline is realistic if you break it into small chunks"
      );
      cons.push(
        "if you don’t protect time, you’ll quietly postpone it forever"
      );
    }
    if (hasBudget) {
      pros.push("you can keep costs under control with a clear cap");
      cons.push(
        "underestimating expenses can add pressure and slow you down"
      );
    }
    if (hasDeadline) {
      pros.push(
        "an explicit deadline helps you decide sooner, not necessarily better"
      );
      cons.push(
        "a fuzzy deadline tends to drift and weaken your commitment"
      );
    }
    if (action) {
      pros.push("you have a concrete lever you can pull every day");
    }
    if (riskHedging) {
      pros.push("simple constraints can cap the downside");
      cons.push(
        "chasing zero risk can keep you stuck at the start line"
      );
    }

    if (!pros.length) {
      pros.push(
        "the real lever is routine: small consistent steps beat big intentions"
      );
    }
    if (!cons.length) {
      cons.push("your main bottleneck is energy and focus, not luck");
    }

    const pSentence = `Estimated probability around ${pct}%.`;
    const proSentence = `Pros: ${pros.slice(0, 2).join(", ")}.`;
    const conSentence = `Cons: ${cons.slice(0, 2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  if (L === "es") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push(
        "el tiempo es manejable si divides el camino en pasos pequeños"
      );
      cons.push(
        "si non proteges tu tiempo, acabarás posponiéndolo una y otra vez"
      );
    }
    if (hasBudget) {
      pros.push(
        "puedes mantener los costes bajo control con un límite claro"
      );
      cons.push(
        "si infravaloras los gastos, la presión económica puede frenarte"
      );
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
      pros.push(
        "la palanca real es la rutina: pequeños pasos constantes vencen a los grandes planes"
      );
    }
    if (!cons.length) {
      cons.push(
        "el cuello de botella es tu energía y foco, no la suerte"
      );
    }

    const pSentence = `Probabilidad aproximada ${pct}%.`;
    const proSentence = `A favor: ${pros.slice(0, 2).join(", ")}.`;
    const conSentence = `En contra: ${cons.slice(0, 2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  if (L === "fr") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push(
        "le calendrier reste gérable si tu découpes en petites étapes"
      );
      cons.push(
        "sans temps protégé, tu repousseras discrètement sans fin"
      );
    }
    if (hasBudget) {
      pros.push(
        "tu peux contenir les coûts avec un plafond clair"
      );
      cons.push(
        "si tu sous-estimes les dépenses, la pression financière peut te freiner"
      );
    }
    if (hasDeadline) {
      pros.push("une échéance claire aide à trancher più vite");
      cons.push(
        "une date floue glisse facilement et affaiblit ton engagement"
      );
    }
    if (action) {
      pros.push("tu as un levier concret à actionner chaque jour");
    }
    if (riskHedging) {
      pros.push("quelques règles simples peuvent limiter le risque");
      cons.push(
        "viser le risque zéro risque justement de t’immobiliser"
      );
    }

    if (!pros.length) {
      pros.push(
        "le vrai levier, c’est la routine: de petits pas réguliers dépassent les grandes intentions"
      );
    }
    if (!cons.length) {
      cons.push(
        "le principal goulot d’étranglement est ton énergie et ta clarté, pas la chance"
      );
    }

    const pSentence = `Probabilité estimée autour de ${pct}%.`;
    const proSentence = `Atouts: ${pros.slice(0, 2).join(", ")}.`;
    const conSentence = `Freins: ${cons.slice(0, 2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  if (L === "de") {
    const pros = [];
    const cons = [];

    if (hasTime) {
      pros.push(
        "der Zeitplan ist machbar, wenn du ihn in kleine Schritte teilst"
      );
      cons.push(
        "ohne geschützte Zeit wirst du es immer wieder verschieben"
      );
    }
    if (hasBudget) {
      pros.push(
        "mit einem klaren Kostenlimit bleibt das Budget unter Kontrolle"
      );
      cons.push(
        "wenn du Ausgaben unterschätzt, entsteht Druck, der dich bremst"
      );
    }
    if (hasDeadline) {
      pros.push(
        "eine klare Deadline zwingt zu früheren Entscheidungen"
      );
      cons.push("eine vage Frist rutscht leicht nach hinten");
    }
    if (action) {
      pros.push(
        "du hast einen konkreten Hebel, den du täglich bewegen kannst"
      );
    }
    if (riskHedging) {
      pros.push("einfache Regeln können das Risiko begrenzen");
      cons.push(
        "wenn du null Risiko willst, kommst du vielleicht nie in Gang"
      );
    }

    if (!pros.length) {
      pros.push(
        "der wahre Hebel ist Routine: kleine, konstante Schritte schlagen große Vorsätze"
      );
    }
    if (!cons.length) {
      cons.push(
        "der Engpass ist deine Energie und Fokussierung, nicht das Schicksal"
      );
    }

    const pSentence = `Geschätzte Wahrscheinlichkeit etwa ${pct}%.`;
    const proSentence = `Dafür: ${pros.slice(0, 2).join(", ")}.`;
    const conSentence = `Dagegen: ${cons.slice(0, 2).join(", ")}.`;

    return `${pSentence} ${proSentence} ${conSentence}`.trim();
  }

  // fallback IT
  return buildWhatIfMotivation(domanda, "it", pct);
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

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    const ipHeader = req.headers["x-forwarded-for"];
    const ip = Array.isArray(ipHeader)
      ? ipHeader[0]
      : (ipHeader || "unknown").toString().split(",")[0].trim();

    const ok = await rateOk(`ask:${ip}`);
    if (!ok)
      return res.status(429).json({ error: "rate_limited_minute" });

    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        return res
          .status(400)
          .json({ error: "bad_request", detail: "invalid_json" });
      }
    }

    const {
      domanda = "",
      stile = "whatif", // "whatif" | "wtf"
      lang = "it",
      periodo = "future", // "future" | "past"
      micro = {},
    } = body || {};

    if (!domanda || typeof domanda !== "string") {
      return res
        .status(400)
        .json({ error: "bad_request", detail: "domanda_required" });
    }

    const messages = buildMessages({ domanda, lang, periodo, stile });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer =
      completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);

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
            ].includes(m)
          )
            return m;
          return inQuestion.has(m) ? m : m.toLowerCase();
        });
      })();
    }

    answer = sentenceCaseAll(answer);
    if (stile === "whatif") {
      answer = ensureZingaraEnding({ text: answer, lang, periodo, domanda });
    }
    answer = finalPunct(answer);

    const L = normLang(lang);
    const pct = computePct(domanda, stile);
    const motivation =
      stile === "whatif"
        ? buildWhatIfMotivation(domanda, L, pct)
        : undefined;

    const isSurprise =
      !!(micro && (micro.surprise === true || micro.src === "surprise"));
    const scientific =
      stile === "wtf" && !isSurprise
        ? scientificReportDemenziale(domanda, L)
        : undefined;

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
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({
      error: "server_error",
      detail: String(err?.message || err),
    });
  }
                              }
