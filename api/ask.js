// /api/ask.js — What?f Engine (Stable Hybrid WHATIF + Friendly-WTF Demenziale)
// - WHATIF: 60% analisi / 40% immagini sobrie. Incipit LIBERO (no “Bella …”) + tocco psicologo leggero.
// - WTF: 2–3 reazioni DEMENZIALI, UNA “imprecazione” teatrale, sorso alcolico, risposta vera, morale. (immutato)
// - Maiuscole post-process dopo . ? ! … : e con virgolette/parentesi. Un paragrafo, niente elenchi, niente eco della domanda.
// - Motivazione: brevissima, lasciata libera, ma coerente con domanda+risposta (20–45 → ora 18–32 parole). Output { motivation, probability }.
// - Limits: FREE 3/giorno — PRO 10/giorno (più piccolo burst/minuto).

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import crypto from "crypto";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
// Burst anti-abuso al minuto (soft)
const rlBurst = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

async function checkDailyLimit({ ip, isPro }) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `ask:daily:${isPro ? "pro" : "free"}:${ip}:${today}`;
  const max = isPro ? 10 : 3;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 86400);
  return { ok: count <= max, remaining: Math.max(0, max - count) };
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
// Maiuscole robuste inizio + dopo . ? ! … :
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

/* ========= WHAT IF — regole e incipit (liberi, solo suggeriti) ========= */
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
  en: `WHAT IF HYBRID (English): 60% concrete analysis, 40% sober imagery. FREE opener (never “Nice one”). 8–10 sentences, second person, one paragraph, no question restatement.`,
  es: `WHAT IF HYBRID (español): 60% análisis concreto, 40% imágenes sobrias. Inicio LIBRE. 8–10 frases, segunda persona, un solo párrafo.`,
  fr: `WHAT IF HYBRID (français): 60% analyse concrète, 40% images sobres. Ouverture LIBRE. 8–10 phrases, deuxième personne, un paragraphe.`,
  de: `WHAT IF HYBRID (Deutsch): 60% konkrete Analyse, 40% nüchterne Bilder. Freier Opener. 8–10 Sätze, zweite Person, ein Absatz.`
};

// Esempio IT (àncora di ritmo)
const WHATIF_HYBRID_EX_IT = `Sai, questa non è una domanda leggera. Guardi i numeri, poi guardi le abitudini: costi più bassi da una parte, occasioni più larghe dall’altra. La qualità della vita non è un grafico, è una routine: tempi di spostamento, servizi che funzionano, persone che senti vicine. Se stringi, il portafoglio respira un po’ di più; in cambio accetti un ritmo meno veloce e meno “vetrine” da inseguire. Le giornate si accorciano di frenesia e si allungano di fiato: un caffè fatto bene, una strada che conosci, un’aria che sa di casa. Non è una fuga né un eroismo: è ingegneria quotidiana, spostare pesi tra tempo, denaro e relazioni. A conti fatti, potresti guadagnare spazio mentale e perdere solo rumore. E quando la sera chiudi la porta, non senti il rimpianto bussare: senti il tuo passo tornare al suo passo.`;

/* ========= WTF — banca demenziale (immutato nel tono) ========= */
const WTF_IMPRE = [
  "bestemmione corazzato","imprecazionona a detonazione","sacramentata a ciel sereno","vulcano d’anatemi","tromba d’aria di improperi",
];
const WTF_REACT = [
  "la moka ti fa una standing ovation e chiede l’autografo","il POS entra in modalità testimone di nozze e benedice la carta",
  "la tapparella si abbassa per pudore e poi sbircia curiosa","la lampada lampeggia in Morse “ti capisco”","Alexa finge un aggiornamento e scappa in modalità monaco",
  "il frigorifero sospira e decide di diventare minimalista","il campanello suona da solo per solidarietà e poi si pente","la pianta applaude con le foglie e ti chiede un drink",
  "il ventilatore gira al contrario “per rispetto”","il citofono fa un trillo come un amen stonato",
];
const WTF_DRINK = [
  "ti versi un amaro doppio e metti in riga i pensieri","fai un sorso corto e il mondo rientra nei bordi","alzi un bicchiere piccolo: brindisi di manutenzione","bevi un dito di coraggio e respiri più largo",
];

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
    // Random con seedU32 (immutato)
    let seed = (seedU32 ?? 0) ^ hash32(String(domanda));
    function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; }
    const impre = WTF_IMPRE[Math.floor(rnd()*WTF_IMPRE.length)];
    const shuffled=[...WTF_REACT].sort(()=>rnd()-0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd()*2)); // 2 o 3
    const drink = WTF_DRINK[Math.floor(rnd()*WTF_DRINK.length)];

    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). STRICT sequence: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” → THEN ${react.length} absurd object reactions → drink (“${drink}”) → 1–2 lines that truly answer → warm ironic moral. 6–8 sentences.`;
    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Struttura OBBLIGATORIA: presa in giro affettuosa (max 2 frasi) → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”) → SUBITO ${react.length} reazioni di oggetti esilaranti → drink (“${drink}”) → 1–2 frasi che rispondono davvero → morale calda e ironica. 6–8 frasi.`;
    const WTF_RULE_ES = `WHAT THE F (amable, absurdo pero útil). Secuencia ESTRICTA: broma cariñosa (≤2) → 2–3 microcontratiempos → UNA “${impre}” → LUEGO ${react.length} reacciones absurdas → trago (“${drink}”) → 1–2 líneas reales → moraleja cálida.`;
    const WTF_RULE_FR = `WHAT THE F (amical, absurde mais utile). Séquence STRICTE : taquinerie (≤2) → 2–3 couacs → UNE “${impre}” → PUIS ${react.length} réactions absurdes → boisson (“${drink}”) → 1–2 vraies phrases → morale chaleureuse.`;
    const WTF_RULE_DE = `WHAT THE F (freundlich, absurd, hilfreich). STRIKT: Neckerei (≤2) → 2–3 Mini-Pannen → EINE „${impre}“ → DANN ${react.length} absurde Reaktionen → Drink („${drink}“) → 1–2 echte Sätze → warme Moral.`;

    const Lrule = L==="en" ? WTF_RULE_EN : L==="es" ? WTF_RULE_ES : L==="fr" ? WTF_RULE_FR : L==="de" ? WTF_RULE_DE : WTF_RULE_IT;

    msgs.push(
      { role: "system", content: Lrule },
      { role: "system", content: `IMPRECATION: ${impre}` },
      { role: "system", content: `REACTIONS:\n- ${react.join("\n- ")}` },
      { role: "system", content: `DRINK: ${drink}` },
      { role: "system", content: `ESEMPIO IT (respiro/tono):\n${WHATIF_HYBRID_EX_IT}` }
    );
  } else {
    // WHATIF ibrido: incipit LIBERO + psicologo leggero (solo suggerimento, nessuna forzatura)
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

/* ========= Prompt: MOTIVAZIONE (breve, coerente) ========= */
function buildMotivationPrompt({ domanda, answer, lang }){
  const L = normLang(lang);
  const sys =
    L==="en" ? `Write a VERY SHORT follow-up that continues the same voice, STRICTLY consistent with the QUESTION and the PRIOR ANSWER theme. 18–32 words, one tight paragraph. No bullets, no lists, no percentages, no commands. Do NOT introduce unrelated topics (e.g., resumes, CVs, portfolios, interviews, unless explicitly in QUESTION or ANSWER). Return ONLY pure JSON: {"probability":<0-100 integer>,"motivation":"<string>"}.`
  : L==="es" ? `Escribe una continuación MUY CORTA en la misma voz, ESTRICTAMENTE coherente con la PREGUNTA y la RESPUESTA. 18–32 palabras, un párrafo. Sin listas, porcentajes ni mandatos. No introduzcas temas ajenos (CV, entrevistas) salvo que estén en la PREGUNTA o RESPUESTA. Devuelve SOLO JSON puro: {"probability":<0-100>,"motivation":"..."}.`
  : L==="fr" ? `Écris une suite TRÈS COURTE dans la même voix, STRICTEMENT cohérente avec la QUESTION et la RÉPONSE. 18–32 mots, un paragraphe. Pas de listes, pourcentages ni injonctions. N’ajoute aucun sujet hors thème (CV, etc.) sauf s’ils figurent déjà. Rends UNIQUEMENT du JSON: {"probability":<0-100>,"motivation":"..."}.`
  : L==="de" ? `Schreibe eine SEHR KURZE Fortsetzung in derselben Stimme, STRIKT stimmig zu FRAGE und ANTWORT. 18–32 Wörter, ein Absatz. Keine Listen/Prozente/Befehle. Keine Fremdthemen (CV etc.), außer sie stehen schon drin. Gib NUR JSON: {"probability":<0-100>,"motivation":"..."}.`
  : `Scrivi una CONTINUAZIONE MOLTO BREVE, stessa voce, STRETTAMENTE coerente con DOMANDA e RISPOSTA. 18–32 parole, un paragrafo. Niente elenchi/percentuali/comandi. Non introdurre temi estranei (CV, portfolio, colloqui) salvo compaiano già. Restituisci SOLO JSON puro: {"probability":<0-100>,"motivation":"<string>"}.`;

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

/* ========= Coerenza motivazione: heuristics + 1 rigenerazione ========= */
const STOPWORDS = new Set([
  "the","and","for","with","that","this","you","your","but","not","non","che","con","per","una","un","lo","la","le","il",
  "y","que","con","por","de","en","les","des","die","und","der","den","ein","eine"
]);
function keywords(s){
  return new Set(String(s||"").toLowerCase()
    .replace(/[“”"'.,;:!?()\[\]{}\-—/\\%]/g," ")
    .split(/\s+/)
    .filter(w=>w.length>=4 && !STOPWORDS.has(w))
  );
}
function isMotivationCoherent(domanda, answer, motivation){
  const kQ = keywords(domanda);
  const kA = keywords(answer);
  const kM = keywords(motivation);
  // almeno 1 parola in comune con domanda o risposta
  const interQA = new Set([...kQ, ...kA]);
  let overlap = 0;
  for (const w of kM) if (interQA.has(w)) { overlap++; if (overlap>=1) break; }
  return overlap>=1;
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

    // Burst/min
    const burst = await rlBurst.limit(`ask:burst:${ip}`);
    if(!burst.success) return res.status(429).json({ error:"rate_limited_minute" });

    // Limite giornaliero
    const daily = await checkDailyLimit({ ip, isPro });
    if(!daily.ok) {
      return res.status(429).json({
        error:"rate_limited_daily",
        detail:"limite giornaliero raggiunto",
        remaining: 0,
        max: isPro ? 10 : 3
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

    // Post-process risposta
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    /* ===== 2) MOTIVAZIONE (breve, coerente) ===== */
    async function genMotivation() {
      const motMsgs = buildMotivationPrompt({ domanda, answer, lang });
      const mot = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.6,
        max_tokens: 140,
        messages: motMsgs
      });
      let raw = String(mot?.choices?.[0]?.message?.content || "").trim();
      let json = null;
      try { json = JSON.parse(raw); }
      catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) { try { json = JSON.parse(m[0]); } catch {} }
      }
      let probability = Math.max(0, Math.min(100, parseInt(json?.probability ?? 50, 10)));
      let motivation = String(json?.motivation || "").trim();
      motivation = normalizeOneParagraph(sentenceCaseAll(finalPunct(motivation)));
      return { probability, motivation };
    }

    let { probability, motivation } = await genMotivation();

    // Heuristic coherence check; if incoherent, regenerate once with stricter guardrails
    if (!isMotivationCoherent(domanda, answer, motivation)) {
      const L = normLang(lang);
      const stricter = [
        { role: "system", content:
          L==="en" ? `Return ONLY JSON. Write a 18–28 word motivation that reuses at least ONE salient noun from the QUESTION or the PRIOR ANSWER. No new domains. {"probability":<0-100>,"motivation":"..."}` :
          L==="es" ? `Devuelve SOLO JSON. Motivación de 18–28 palabras que reuse al menos UN sustantivo de la PREGUNTA o la RESPUESTA. Sin temas nuevos. {"probability":<0-100>,"motivation":"..."}` :
          L==="fr" ? `Rends UNIQUEMENT du JSON. Motivation de 18–28 mots réutilisant AU MOINS UN nom de la QUESTION ou de la RÉPONSE. Pas de nouveaux sujets. {"probability":<0-100>,"motivation":"..."}` :
          L==="de" ? `Gib NUR JSON zurück. 18–28 Wörter Motivation, mit MINDESTENS einem Substantiv aus FRAGE oder ANTWORT. Keine neuen Themen. {"probability":<0-100>,"motivation":"..."}` :
                    `Restituisci SOLO JSON. Motivazione 18–28 parole che riusa ALMENO un sostantivo della DOMANDA o della RISPOSTA. Nessun tema nuovo. {"probability":<0-100>,"motivation":"..."}` },
        { role: "user", content: (L==="en" ? `Question: ${domanda}` : L==="es" ? `Pregunta: ${domanda}` : L==="fr" ? `Question : ${domanda}` : L==="de" ? `Frage: ${domanda}` : `Domanda: ${domanda}`) },
        { role: "user", content: (L==="en" ? `Prior answer:\n${answer}` : L==="es" ? `Respuesta previa:\n${answer}` : L==="fr" ? `Réponse précédente :\n${answer}` : L==="de" ? `Vorherige Antwort:\n${answer}` : `Risposta precedente:\n${answer}`) },
      ];
      try{
        const mot2 = await client.chat.completions.create({
          model: MODEL, temperature: 0.5, max_tokens: 120, messages: stricter
        });
        let raw2 = String(mot2?.choices?.[0]?.message?.content || "").trim();
        let json2 = null;
        try { json2 = JSON.parse(raw2); }
        catch {
          const m2 = raw2.match(/\{[\s\S]*\}/);
          if (m2) { try { json2 = JSON.parse(m2[0]); } catch {} }
        }
        const p2 = Math.max(0, Math.min(100, parseInt(json2?.probability ?? probability, 10)));
        const m2txt = normalizeOneParagraph(sentenceCaseAll(finalPunct(String(json2?.motivation || motivation))));
        if (isMotivationCoherent(domanda, answer, m2txt)) {
          probability = p2;
          motivation = m2txt;
        }
      }catch{}
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
      ...(debug ? { debug: { seedU32 } } : {})
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
