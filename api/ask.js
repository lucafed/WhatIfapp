// /api/ask.js — What?f Engine (Stable Hybrid WHATIF + Friendly-WTF Demenziale)
// - WHATIF: 60% analisi / 40% immagini sobrie. Incipit LIBERO (mai “Bella …”) + tocco psicologo leggero.
// - WTF: **INVARIATO** come tuoi esempi (presa in giro affettuosa → 2–3 micro-imprevisti → UNA imprecazione teatrale → reazioni oggetti → drink → risposta vera → morale).
// - Maiuscole post-process dopo . ? ! … : e con virgolette/parentesi. Paragrafo unico. Niente elenchi. Niente eco della domanda.
// - Motivazione: brevissima (18–32 parole), scritta dalla AI come micro-continuazione coerente (stesso tema). Vietati temi estranei (CV/portfolio/colloqui ecc.).
// - Limiti: FREE 3/giorno — PRO 10/giorno (stesso modello) + piccolo burst/minuto anti-abuso. Niente differenze di AI tra free/pro.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import crypto from "crypto";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
// burst/minuto morbido per evitare spam
const rlBurst = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

async function checkDailyLimit({ ip, isPro }) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `ask:daily:${isPro ? "pro" : "free"}:${ip}:${today}`;
  const max = isPro ? 10 : 3;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 86400);
  return { ok: count <= max, remaining: Math.max(0, max - count), max };
}

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
const VERCEL_PREVIEW_RX = /^https:\/\/[a-z0-9-]+-what-ifapp-[a-z0-9-]+-vercel\.app$/i;

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const ok = ALLOWED_ORIGINS.includes(origin) || VERCEL_PREVIEW_RX.test(origin);
  if (ok) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro, x-debug, x-seed"
  );
}

/* ========= Helpers: lingua, testo, casing ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
function normLang(l="it"){ const s=String(l||"it").toLowerCase().slice(0,2); return SUP_LANGS.includes(s)?s:"it"; }

function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?():\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\.\.\.+/g,"…").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,""); return t;
}
// Maiuscole robuste: inizio + dopo . ? ! … :
function sentenceCaseAll(s=""){
  if(!s) return s;
  s = s.replace(/^(\s*[«“"'\(\[]*)([a-zà-ÿ])/u, (m, pre, ch) => pre + ch.toUpperCase());
  s = s.replace(/([.!?…:]\s+)([«“"'\(\[]*)([a-zà-ÿ])/gu, (m, p, pre, ch) => p + pre + ch.toUpperCase());
  return s;
}
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

/* ========= RNG/Seeding ========= */
function hash32(str){ let x=2166136261; for(const c of String(str)) x=(x^c.charCodeAt(0))>>>0, x=(x*16777619)>>>0; return x>>>0; }
function u32fromCrypto(){ try{ return crypto.randomBytes(4).readUInt32BE(0); } catch{ return (Math.random()*2**32)>>>0; } }
function getRequestSeed(req, extra=""){
  const hdr = req?.headers?.["x-seed"];
  if (hdr) return Number(hdr)>>>0;
  const ip = ((req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || "0.0.0.0").toString().split(",")[0] || "").trim();
  const t = Date.now();
  const rnd = u32fromCrypto() ^ ((Math.random()*2**32)>>>0);
  return (hash32(ip + ":" + t + ":" + extra) ^ rnd) >>> 0;
}

/* ========= WHAT IF — regole e incipit (liberi) ========= */
const WHATIF_OPENERS = {
  it: [
    "Non è una domanda semplice e lo sai.","Se guardi bene, qui non c’è solo un sì o un no.","Prima di tutto: ha senso che tu sia diviso.",
    "Questa scelta tira da due lati e tu la senti.","Vale la pena trattarla come un esperimento, non un verdetto.",
    "Non stai scegliendo tra giusto e sbagliato, ma tra due forme di te.","È un bivio vero: curiosità da una parte, prudenza dall’altra.",
    "Qui non serve coraggio cieco: serve misura.","Quello che temi e quello che desideri stanno seduti allo stesso tavolo.",
    "La domanda è grande, ma la risposta abita nella routine."
  ],
  en: [
    "This isn’t a simple question and you know it.","Look closely: it’s not just a yes or a no.","First things first: it makes sense you’re torn.",
    "This choice pulls from two sides and you feel it.","Treat it like an experiment, not a verdict.",
    "You’re not choosing right vs wrong, but two versions of you.","It’s a real fork: curiosity on one side, caution on the other.",
    "You don’t need blind courage here—you need proportion.","What you fear and what you want share the same table.",
    "The question is big; the answer lives in your routine."
  ],
  es: ["No es una pregunta sencilla y lo sabes.","Si miras de cerca, no es solo un sí o un no.","Para empezar: es normal que estés dividido.","Esta elección tira de dos lados y lo notas.","Trátalo como un experimento, no como un veredicto.","No eliges bien o mal: eliges dos versiones de ti.","Bifurcación real: curiosidad a un lado, prudencia al otro.","No hace falta coraje ciego, hace falta medida.","Lo que temes y lo que deseas comparten mesa.","La respuesta vive en tu rutina."],
  fr: ["Ce n’est pas une question simple et tu le sais.","Si tu regardes bien, ce n’est ni un oui ni un non.","D’abord: c’est normal d’être partagé.","Ce choix tire dans deux sens et tu le sens.","Traite-la comme une expérience, pas comme un verdict.","Tu ne choisis pas le bien ou le mal, mais deux versions de toi.","Vrai carrefour: curiosité/prudence.","Pas de courage aveugle: de la mesure.","Craintes et désirs à la même table.","La réponse vit dans ta routine."],
  de: ["Das ist keine einfache Frage und das weißt du.","Genau hinsehen: nicht nur Ja oder Nein.","Es ist logisch, dass du hin- und hergerissen bist.","Zwei Seiten ziehen an dir, das spürst du.","Behandle es wie ein Experiment, kein Urteil.","Nicht richtig/falsch, sondern zwei Versionen.","Gabelung: Neugier links, Vorsicht rechts.","Kein blinder Mut – Maß.","Furcht und Wunsch am selben Tisch.","Antwort lebt im Alltag."]
};

const WHATIF_RULE = {
  it: `WHAT IF HYBRID (italiano): 60% analisi concreta (costi/benefici, routine, qualità di vita), 40% immagini sobrie. Incipit LIBERO (mai “Bella”). 8–10 frasi, seconda persona, un paragrafo, niente eco. Tocco psicologo leggero.`,
  en: `WHAT IF HYBRID (English): 60% concrete analysis, 40% sober imagery. FREE opener (never “Nice one”). 8–10 sentences, second person, one paragraph, no restating the question.`,
  es: `WHAT IF HYBRID (español): 60% análisis concreto, 40% imágenes sobrias. Inicio LIBRE. 8–10 frases, segunda persona, un párrafo.`,
  fr: `WHAT IF HYBRID (français): 60% analyse concrète, 40% images sobres. Ouverture LIBRE. 8–10 phrases, deuxième personne, un paragraphe.`,
  de: `WHAT IF HYBRID (Deutsch): 60% konkrete Analyse, 40% nüchterne Bilder. Freier Opener. 8–10 Sätze, zweite Person, ein Absatz.`
};

// Esempio IT (àncora di ritmo)
const WHATIF_HYBRID_EX_IT = `Sai, questa non è una domanda leggera. Guardi i numeri, poi guardi le abitudini: costi più bassi da una parte, occasioni più larghe dall’altra. La qualità della vita non è un grafico, è una routine: tempi di spostamento, servizi che funzionano, persone che senti vicine. Se stringi, il portafoglio respira un po’ di più; in cambio accetti un ritmo meno veloce e meno “vetrine” da inseguire. Le giornate si accorciano di frenesia e si allungano di fiato: un caffè fatto bene, una strada che conosci, un’aria che sa di casa. Non è una fuga né un eroismo: è ingegneria quotidiana, spostare pesi tra tempo, denaro e relazioni. A conti fatti, potresti guadagnare spazio mentale e perdere solo rumore. E quando la sera chiudi la porta, non senti il rimpianto bussare: senti il tuo passo tornare al suo passo.`;

/* ========= WTF — banca demenziale (INVARIATA, coi tuoi esempi) ========= */
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

// **ESEMPI VINCOLANTI (tono/ritmo IT) — NON MODIFICATI**
const WTF_EXAMPLES_IT =
`- Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.
- Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.
- Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`;

/* ========= OpenAI retry helper ========= */
async function askOpenAI(payload) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try { return await client.chat.completions.create(payload); }
    catch (e) { lastErr = e; await new Promise(r=>setTimeout(r, 350*(i+1))); }
  }
  throw lastErr;
}

/* ========= Prompt: RISPOSTA ========= */
function buildMessages({ domanda, lang, periodo, stile, seedU32 }){
  const L = normLang(lang);

  const baseRules =
    L === "en" ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.` :
    L === "es" ? `REGLAS: un solo párrafo, sin listas ni emojis. NO repitas la pregunta. Segunda persona.` :
    L === "fr" ? `RÈGLES : un seul paragraphe, pas de listes ni d’emojis. NE répète pas la question. Deuxième personne.` :
    L === "de" ? `REGELN: ein einziger Absatz, keine Listen oder Emojis. Frage NICHT wiederholen. Zweite Person.` :
                 `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;

  const temporal =
    String(periodo).toLowerCase()==="past"
      ? (L==="en" ? "Write as if it already happened." :
         L==="es" ? "Escribe como si ya hubiera ocurrido." :
         L==="fr" ? "Écris comme si c’était déjà arrivé." :
         L==="de" ? "Schreibe, als wäre es bereits passiert." :
                    "Scrivi come se fosse già successo.")
      : (L==="en" ? "Write as a near-future unfolding starting now." :
         L==="es" ? "Escribe como un futuro cercano que empieza ahora." :
         L==="fr" ? "Écris comme un futur proche qui commence maintenant." :
         L==="de" ? "Schreibe wie eine nahe Zukunft, die jetzt beginnt." :
                    "Scrivi come un prossimo futuro che inizia ora.");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if(stile==="wtf"){
    // **WTF INVARIATO**: regole identiche ai tuoi esempi
    let seed = (seedU32 ?? 0) ^ hash32(String(domanda));
    function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; }
    const impre = WTF_IMPRE[Math.floor(rnd()*WTF_IMPRE.length)];
    const shuffled=[...WTF_REACT].sort(()=>rnd()-0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd()*2)); // 2 o 3
    const drink = WTF_DRINK[Math.floor(rnd()*WTF_DRINK.length)];

    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). STRICT sequence: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” (narrated, never insulting people) → THEN ${react.length} absurd object reactions → drink (“${drink}”) → 1–2 lines that truly answer → warm ironic moral. 6–8 sentences.`;
    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Struttura OBBLIGATORIA: presa in giro affettuosa (max 2 frasi) → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”, come narrazione, mai insulto a persone) → SUBITO ${react.length} reazioni di oggetti esilaranti → drink (“${drink}”) → 1–2 frasi che rispondono davvero → morale calda e ironica. 6–8 frasi.`;
    const WTF_RULE_ES = `WHAT THE F (amable, absurdo pero útil). Secuencia ESTRICTA: broma cariñosa (≤2) → 2–3 microcontratiempos → UNA “${impre}” teatral → LUEGO ${react.length} reacciones absurdas de objetos → trago (“${drink}”) → 1–2 líneas reales → moraleja cálida.`;
    const WTF_RULE_FR = `WHAT THE F (amical, absurde mais utile). Séquence STRICTE : taquinerie (≤2) → 2–3 couacs → UNE “${impre}” théâtrale → PUIS ${react.length} réactions absurdes → boisson (“${drink}”) → 1–2 vraies phrases → morale chaleureuse.`;
    const WTF_RULE_DE = `WHAT THE F (freundlich, absurd, hilfreich). STRIKT: Neckerei (≤2) → 2–3 Mini-Pannen → EINE „${impre}“ → DANN ${react.length} absurde Reaktionen → Drink („${drink}“) → 1–2 echte Sätze → warme Moral.`;

    const Lrule = L==="en" ? WTF_RULE_EN : L==="es" ? WTF_RULE_ES : L==="fr" ? WTF_RULE_FR : L==="de" ? WTF_RULE_DE : WTF_RULE_IT;

    msgs.push(
      { role: "system", content: Lrule },
      { role: "system", content: `IMPRECATION: ${impre}` },
      { role: "system", content: `REACTIONS:\n- ${react.join("\n- ")}` },
      { role: "system", content: `DRINK: ${drink}` },
      { role: "system", content: `ESEMPI VINCOLANTI (tono/ritmo IT):\n${WTF_EXAMPLES_IT}` }
    );
  } else {
    // WHATIF: incipit LIBERO (non forzato), regole e àncora di respiro
    const opens = WHATIF_OPENERS[L] || WHATIF_OPENERS.it;
    const opener = opens[(hash32(String(domanda)) % opens.length)];
    msgs.push(
      { role: "system", content: WHATIF_RULE[L] || WHATIF_RULE.it },
      { role: "system", content: `Puoi APRIRE liberamente; se vuoi, usa uno di questi: ${opens.join(" | ")}. Preferisci: ${opener}. Mai “Bella…”.` },
      { role: "system", content: `ESEMPIO (respiro e tono IT):\n${WHATIF_HYBRID_EX_IT}` }
    );
  }

  const ask =
    (L==="en") ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH. Single paragraph.` :
    (L==="es") ? `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.` :
    (L==="fr") ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.` :
    (L==="de") ? `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.` :
                 `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico.`;
  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= Motivazione: estrazione tema + vincoli forti di coerenza ========= */
// stopwords e termini off-topic da bloccare se non presenti nella domanda/risposta
const STOPWORDS = new Set([
  "the","and","for","with","that","this","you","your","but","not","non","che","con","per","una","un","lo","la","le","il",
  "y","que","con","por","de","en","les","des","die","und","der","den","ein","eine","del","della","delle","dei","negli","nelle"
]);
const OFFTOPIC = [
  "cv","curriculum","portfolio","colloquio","colloqui","intervista","interviste","network","networking","outreach",
  "cliente","clienti","vendite","fatturato","recruiter","assunzione","hr","stage","marketing","fatturare","commerciale"
];

function tokens(s){
  return String(s||"").toLowerCase()
    .replace(/[“”"'.,;:!?()\[\]{}\-—/\\%]/g," ")
    .split(/\s+/).filter(Boolean);
}
function keywords(s){
  const arr = tokens(s).filter(w=>w.length>=4 && !STOPWORDS.has(w));
  // frequenze
  const freq = new Map();
  for (const w of arr) freq.set(w, (freq.get(w)||0)+1);
  return [...freq.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
}
function pickSalient(domanda, answer, limit=12){
  const list = [];
  const qk = keywords(domanda);
  const ak = keywords(answer);
  for (const w of qk) if (!list.includes(w)) list.push(w);
  for (const w of ak) if (!list.includes(w)) list.push(w);
  return list.slice(0, limit);
}

function validateMotivation(domanda, answer, motivation){
  const kQ = new Set(keywords(domanda));
  const kA = new Set(keywords(answer));
  const km = new Set(keywords(motivation));
  const baseTokens = new Set(tokens(domanda).concat(tokens(answer)));

  // almeno 2 parole salienti in comune
  let overlap = 0;
  for (const w of km) if (kQ.has(w) || kA.has(w)) { overlap++; if (overlap>=2) break; }
  if (overlap < 2) return { ok:false, reason:"overlap<2" };

  // niente domini off-topic se non già presenti
  for (const bad of OFFTOPIC) {
    if (tokens(motivation).includes(bad) && !baseTokens.has(bad)) {
      return { ok:false, reason:"offtopic" };
    }
  }

  // lunghezza 18–32 parole
  const wc = tokens(motivation).length;
  if (wc < 18 || wc > 32) return { ok:false, reason:"length" };

  return { ok:true };
}

function buildMotivationPrompt({ domanda, answer, lang }){
  const L = normLang(lang);
  const salient = pickSalient(domanda, answer, 12);
  const mustList = salient.length ? salient.join(", ") : "";
  const sys =
    L==="en" ? `Write a VERY SHORT continuation (18–32 words), same voice and topic as QUESTION+ANSWER. Use at least TWO tokens verbatim from: [${mustList}]. No bullets, no commands, no percent signs. Stay strictly on topic. Return ONLY JSON: {"probability":<0-100>,"motivation":"<string>"}.`
  : L==="es" ? `Escribe una continuación MUY CORTA (18–32 palabras), misma voz y tema que PREGUNTA+RESPUESTA. Usa al menos DOS términos literales de: [${mustList}]. Sin listas, mandatos ni %. SOLO JSON: {"probability":<0-100>,"motivation":"<string>"}.`
  : L==="fr" ? `Écris une suite TRÈS COURTE (18–32 mots), même voix et sujet que QUESTION+RÉPONSE. Utilise au moins DEUX mots littéraux parmi: [${mustList}]. Pas de listes/%, JSON UNIQUEMENT: {"probability":<0-100>,"motivation":"<string>"}.`
  : L==="de" ? `Schreibe eine SEHR KURZE Fortsetzung (18–32 Wörter), gleiche Stimme und THEMA wie FRAGE+ANTWORT. Nutze mindestens ZWEI Begriffe wörtlich aus: [${mustList}]. Keine Listen/%, NUR JSON: {"probability":<0-100>,"motivation":"<string>"}.`
  : `Scrivi una CONTINUAZIONE MOLTO BREVE (18–32 parole), stessa voce e STESSO TEMA di DOMANDA+RISPOSTA. Usa almeno DUE parole *letterali* tra: [${mustList}]. Niente elenchi/comandi/% . SOLO JSON: {"probability":<0-100>,"motivation":"<string>"}.`;

  return [
    { role: "system", content: sys },
    { role: "user", content: (L==="en" ? `Question: ${domanda}` :
                               L==="es" ? `Pregunta: ${domanda}` :
                               L==="fr" ? `Question : ${domanda}` :
                               L==="de" ? `Frage: ${domanda}` :
                                         `Domanda: ${domanda}`) },
    { role: "user", content: (L==="en" ? `Prior answer:\n${answer}` :
                               L==="es" ? `Respuesta previa:\n${answer}` :
                               L==="fr" ? `Réponse précédente :\n${answer}` :
                               L==="de" ? `Vorherige Antwort:\n${answer}` :
                                         `Risposta precedente:\n${answer}`) },
  ];
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const isPro =
      String(req.headers["x-pro"] || "").toLowerCase() === "true" ||
      String(req.headers["x-pro"] || "") === "1";

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();

    // burst/min
    const burst = await rlBurst.limit(`ask:burst:${ip}`);
    if(!burst.success) return res.status(429).json({ error:"rate_limited_minute" });

    // limite giornaliero
    const daily = await checkDailyLimit({ ip, isPro });
    if(!daily.ok) {
      return res.status(429).json({
        error:"rate_limited_daily",
        detail:"limite giornaliero raggiunto",
        remaining: 0,
        max: daily.max
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      lang  = "it",
      periodo = "future",
      micro = {}
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const seedU32 = getRequestSeed(req, stile + ":" + lang);

    /* ===== 1) RISPOSTA ===== */
    const messages = buildMessages({ domanda, lang, periodo, stile, seedU32 });
    const completion = await askOpenAI({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // post-process
    answer = stripQuestionEcho(domanda, answer);
    // NON forziamo l'incipit (libertà all'AI)
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    /* ===== 2) MOTIVAZIONE (breve, coerente) ===== */
    async function genMotivation(promptMsgs, temp=0.55){
      const mot = await client.chat.completions.create({
        model: MODEL, temperature: temp, max_tokens: 140, messages: promptMsgs
      });
      let raw = String(mot?.choices?.[0]?.message?.content || "").trim();
      let json = null;
      try { json = JSON.parse(raw); }
      catch { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { json = JSON.parse(m[0]); } catch {} } }
      let probability = Math.max(0, Math.min(100, parseInt(json?.probability ?? 50, 10)));
      let motivation = String(json?.motivation || "").trim();
      motivation = normalizeOneParagraph(sentenceCaseAll(finalPunct(motivation)));
      return { probability, motivation };
    }

    // primo tentativo con lista di parole salienti
    let { probability, motivation } = await genMotivation(buildMotivationPrompt({ domanda, answer, lang }), 0.5);

    // validazione e retry con vincoli più duri se necessario
    let valid = validateMotivation(domanda, answer, motivation);
    if (!valid.ok) {
      const salient = pickSalient(domanda, answer, 12).join(", ");
      const L = normLang(lang);
      const strictSys =
        L==="en" ? `ONLY JSON. 18–32 words. Must include AT LEAST TWO of: [${salient}]. Block unrelated domains (resumes, interviews, networking, clients, sales). {"probability":<0-100>,"motivation":"..."}` :
        L==="es" ? `SOLO JSON. 18–32 palabras. Debe incluir AL MENOS DOS de: [${salient}]. Bloquea dominios ajenos (CV, entrevistas, networking, clientes, ventas). {"probability":<0-100>,"motivation":"..."}` :
        L==="fr" ? `JSON SEULEMENT. 18–32 mots. Inclure AU MOINS DEUX parmi : [${salient}]. Bloque domaines hors sujet (CV, entretiens, réseau, clients, ventes). {"probability":<0-100>,"motivation":"..."}` :
        L==="de" ? `NUR JSON. 18–32 Wörter. Mindestens ZWEI aus: [${salient}]. Fremde Domänen blockieren (Lebenslauf, Vorstellung, Netzwerk, Kunden, Vertrieb). {"probability":<0-100>,"motivation":"..."}` :
                  `SOLO JSON. 18–32 parole. Includi ALMENO DUE tra: [${salient}]. Blocca domini estranei (CV, colloqui, networking, clienti, vendite). {"probability":<0-100>,"motivation":"..."}`;
      const strictPrompt = [
        { role: "system", content: strictSys },
        { role: "user", content: (L==="en" ? `Question: ${domanda}` : L==="es" ? `Pregunta: ${domanda}` : L==="fr" ? `Question : ${domanda}` : L==="de" ? `Frage: ${domanda}` : `Domanda: ${domanda}`) },
        { role: "user", content: (L==="en" ? `Prior answer:\n${answer}` : L==="es" ? `Respuesta previa:\n${answer}` : L==="fr" ? `Réponse précédente :\n${answer}` : L==="de" ? `Vorherige Antwort:\n${answer}` : `Risposta precedente:\n${answer}`) },
      ];
      ({ probability, motivation } = await genMotivation(strictPrompt, 0.4));
      valid = validateMotivation(domanda, answer, motivation);

      if (!valid.ok) {
        // ultimo tentativo ultra-conservativo
        const hardPrompt = [
          { role: "system", content: strictSys },
          { role: "user", content: (L==="en" ? `Question: ${domanda}` : L==="es" ? `Pregunta: ${domanda}` : L==="fr" ? `Question : ${domanda}` : L==="de" ? `Frage: ${domanda}` : `Domanda: ${domanda}`) },
          { role: "user", content: (L==="en" ? `Keep it strictly about the same topic.` : L==="es" ? `Manténlo estrictamente en el mismo tema.` : L==="fr" ? `Reste strictement sur le même sujet.` : L==="de" ? `Bleib strikt beim selben Thema.` : `Resta strettamente sullo stesso tema.`) },
          { role: "user", content: (L==="en" ? `Prior answer:\n${answer}` : L==="es" ? `Respuesta previa:\n${answer}` : L==="fr" ? `Réponse précédente :\n${answer}` : L==="de" ? `Vorherige Antwort:\n${answer}` : `Risposta precedente:\n${answer}`) },
        ];
        ({ probability, motivation } = await genMotivation(hardPrompt, 0.3));
        // se ancora non perfetta, restituiamo comunque il best-effort più coerente ottenuto
      }
    }

    const debug = String(req.headers["x-debug"] || "").toLowerCase() === "true";
    return res.status(200).json({
      answer,
      motivation,
      probability,
      style: stile,
      lang: normLang(lang),
      periodo,
      model: MODEL,
      pro: isPro,
      ...(debug ? { debug: { validMotivation: validateMotivation(domanda, answer, motivation) } } : {})
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
