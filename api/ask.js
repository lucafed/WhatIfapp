// /api/ask.js — What?f Engine (WHATIF + WTF) con rate giornaliero e opener anti-ripetizione
// - FREE: 3 richieste/giorno · PRO: 10 richieste/giorno (stesso modello)
// - WHATIF: 60% analisi / 40% immagini sobrie. Incipit VARIABILE e non ripetuto (cache Redis per IP+lingua).
// - WTF: flusso demenziale controllato ma utile.
// - Box motivazioni coerenti (probabilità + paragrafo) opzionale già integrato.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import crypto from "crypto";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate (giornaliero) ========= */
// FREE: 3/giorno — PRO: 10/giorno
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rlFreeDay = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "1 d") });
const rlProDay  = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 d") });

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
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro, x-debug, x-seed");
}

/* ========= Helpers ========= */
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
function sentenceCaseAll(s=""){
  if(!s) return s;
  s = s.replace(/^(\s*[«“"'\(\[]*)([a-zà-ÿ])/u, (m, pre, ch) => pre + ch.toUpperCase());
  s = s.replace(/([.!?…:]\s+)([«“"'\(\[]*)([a-zà-ÿ])/gu, (m, p, pre, ch) => p + pre + ch.toUpperCase());
  return s;
}
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

// Hash/RNG/Seed
function hash32(str){ let x=2166136261; for(const c of String(str)) x=(x^c.charCodeAt(0))>>>0, x=(x*16777619)>>>0; return x>>>0; }
function rndU32(){ try{ return crypto.randomBytes(4).readUInt32BE(0); } catch{ return (Math.random()*2**32)>>>0; } }
function getRequestSeed(req, extra=""){
  const hdr = req?.headers?.["x-seed"]; if (hdr) return Number(hdr)>>>0;
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "0.0.0.0").toString().split(",")[0].trim();
  const t = Date.now(); const r = rndU32();
  return (hash32(ip + ":" + t + ":" + extra) ^ r) >>> 0;
}
function seededPick(arr, seedU32){ const r = seedU32 / 2**32; return arr[Math.floor(r*arr.length)]; }

/* ========= WHATIF Openers ========= */
const WHATIF_OPENERS = {
  it: [
    "Non è una domanda semplice e lo sai.","Se guardi bene, qui non c’è solo un sì o un no.","Prima di tutto: ha senso che tu sia diviso.",
    "Questa scelta tira da due lati e tu la senti.","Vale la pena trattarla come un esperimento, non un verdetto.",
    "Non stai scegliendo tra giusto e sbagliato, ma tra due forme di te.","È un bivio vero: curiosità da una parte, prudenza dall’altra.",
    "Qui non serve coraggio cieco: serve misura.","Quello che temi e quello che desideri stanno seduti allo stesso tavolo.",
    "La domanda è grande, ma la risposta abita nella routine.","Quando smetti di fare rumore, senti la domanda intera.",
    "Se togli il freno dell’ansia, il quadro è più nitido.","Le alternative non litigano: ti chiedono di scegliere un ritmo.",
    "Conta cosa ti costa restare, non solo cosa rischi andando.","A volte serve spostare un peso, non cambiare il mondo."
  ],
  en: [
    "This isn’t a simple question and you know it.","Look closely: it’s not just a yes or a no.","First things first: it makes sense you’re torn.",
    "This choice pulls from two sides and you feel it.","Treat it like an experiment, not a verdict.",
    "You’re not choosing right vs wrong, but two versions of you.","It’s a real fork: curiosity on one side, caution on the other.",
    "You don’t need blind courage here—you need proportion.","What you fear and what you want share the same table.",
    "The question is big; the answer lives in your routine.","Quiet the noise and the outline sharpens.",
    "Count the cost of staying, not only the risk of moving.","Often you don’t need heroics—just a better trade."
  ],
  es: [
    "No es una pregunta sencilla y lo sabes.","Si miras de cerca, no es solo un sí o un no.","Para empezar: es normal que estés dividido.",
    "Esta elección tira de dos lados y lo notas.","Trátalo como un experimento, no como un veredicto.",
    "No eliges bien o mal: eliges dos versiones de ti.","Bifurcación real: curiosidad a un lado, prudencia al otro.",
    "No hace falta coraje ciego, hace falta medida.","Lo que temes y lo que deseas comparten mesa.",
    "La pregunta es grande; la respuesta vive en tu rutina.","Si bajas el ruido, aparece el contorno.",
    "Cuenta el coste de quedarte, no solo el riesgo de moverte."
  ],
  fr: [
    "Ce n’est pas une question simple et tu le sais.","Si tu regardes bien, ce n’est ni un oui ni un non.","D’abord: c’est normal d’être partagé.",
    "Ce choix tire dans deux sens et tu le sens.","Traite-la comme une expérience, pas comme un verdict.",
    "Tu ne choisis pas le bien ou le mal, mais deux versions de toi.","Vrai carrefour: curiosité d’un côté, prudence de l’autre.",
    "Pas de courage aveugle: de la mesure.","Ce que tu crains et ce que tu veux s’assoient à la même table.",
    "La question est grande; la réponse vit dans ta routine.","Quand le bruit baisse, le contour apparaît."
  ],
  de: [
    "Das ist keine einfache Frage und das weißt du.","Genau hinsehen: Es ist nicht nur Ja oder Nein.","Zuerst: Es ist logisch, dass du hin- und hergerissen bist.",
    "Diese Entscheidung zieht an zwei Seiten, und das spürst du.","Behandle es wie ein Experiment, nicht wie ein Urteil.",
    "Du wählst nicht richtig oder falsch, sondern zwei Versionen von dir.","Ein echter Scheideweg: Neugier links, Vorsicht rechts.",
    "Kein blinder Mut nötig – Maß genügt.","Was du fürchtest und willst, sitzt am selben Tisch.",
    "Die Frage ist groß; die Antwort lebt im Alltag.","Wenn der Lärm sinkt, wird die Kontur klar."
  ]
};

const WHATIF_RULE = {
  it: `WHAT IF HYBRID (italiano): 60% analisi concreta, 40% immagini sobrie. Incipit VARIABILE da lista; vietato “Bella”. 8–10 frasi, seconda persona, paragrafo unico.`,
  en: `WHAT IF HYBRID (English): 60% analysis, 40% sober imagery. Variable opener; never “Nice one”. 8–10 sentences, second person, one paragraph.`,
  es: `WHAT IF HYBRID (español): 60% análisis, 40% imágenes sobrias. Inicio variable. 8–10 frases, segunda persona, un párrafo.`,
  fr: `WHAT IF HYBRID (français): 60% analyse, 40% images sobres. Ouverture variable. 8–10 phrases, deuxième personne, un paragraphe.`,
  de: `WHAT IF HYBRID (Deutsch): 60% Analyse, 40% nüchterne Bilder. Variabler Opener. 8–10 Sätze, zweite Person, ein Absatz.`
};

/* ========= WTF lists ========= */
const WTF_IMPRE = ["bestemmione corazzato","imprecazionona a detonazione","sacramentata a ciel sereno","vulcano d’anatemi","tromba d’aria di improperi"];
const WTF_REACT = [
  "la moka ti fa una standing ovation e chiede l’autografo","il POS entra in modalità testimone di nozze e benedice la carta",
  "la tapparella si abbassa per pudore e poi sbircia curiosa","la lampada lampeggia in Morse “ti capisco”","Alexa finge un aggiornamento e scappa in modalità monaco",
  "il frigorifero sospira e decide di diventare minimalista","il campanello suona da solo per solidarietà e poi si pente","la pianta applaude con le foglie e ti chiede un drink",
  "il ventilatore gira al contrario “per rispetto”","il citofono fa un trillo come un amen stonato",
];
const WTF_DRINK = ["ti versi un amaro doppio e metti in riga i pensieri","fai un sorso corto e il mondo rientra nei bordi","alzi un bicchiere piccolo: brindisi di manutenzione","bevi un dito di coraggio e respiri più largo"];

/* ========= OpenAI retry ========= */
async function askOpenAI(payload) {
  let lastErr;
  for (let i=0;i<2;i++){
    try { return await client.chat.completions.create(payload); }
    catch (e){ lastErr=e; await new Promise(r=>setTimeout(r, 350*(i+1))); }
  }
  throw lastErr;
}

/* ========= Opener anti-ripetizione (Redis) ========= */
async function pickUniqueOpener(openers, cacheKey){
  try{
    const recent = JSON.parse((await redis.get(cacheKey)) || "[]");
    const pool = openers.filter(o => !recent.includes(o));
    const choice = pool.length ? openers[Math.floor(rndU32()%pool.length)] : openers[Math.floor(rndU32()%openers.length)];
    // aggiorna recente (max 5) con TTL 24h
    const next = [choice, ...recent.filter(o=>o!==choice)].slice(0,5);
    await redis.set(cacheKey, JSON.stringify(next), { ex: 60*60*24 });
    return choice;
  }catch{
    // fallback: random
    return openers[Math.floor(rndU32()%openers.length)];
  }
}

/* ========= Prompt builder (risposta principale) ========= */
function buildMessages({ domanda, lang, periodo, stile, opener }){
  const L = normLang(lang);

  const baseRules =
    L==="en" ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.` :
    L==="es" ? `REGLAS: un solo párrafo, sin listas ni emojis. NO repitas la pregunta. Segunda persona.` :
    L==="fr" ? `RÈGLES : un seul paragraphe, pas de listes ni d’emojis. NE répète pas la question. Deuxième personne.` :
    L==="de" ? `REGELN: ein einziger Absatz, keine Listen oder Emojis. Frage NICHT wiederholen. Zweite Person.` :
               `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;

  const temporal =
    String(periodo).toLowerCase()==="past" ?
      (L==="en" ? "Write as if it already happened." :
       L==="es" ? "Escribe como si ya hubiera ocurrido." :
       L==="fr" ? "Écris comme si c’était déjà arrivé." :
       L==="de" ? "Schreibe, als wäre es bereits passiert." :
                  "Scrivi come se fosse già successo.") :
      (L==="en" ? "Write as a near-future unfolding starting now." :
       L==="es" ? "Escribe como un futuro cercano que empieza ahora." :
       L==="fr" ? "Écris comme un futur proche qui commence maintenant." :
       L==="de" ? "Schreibe wie eine nahe Zukunft, die jetzt beginnt." :
                  "Scrivi come un prossimo futuro che inizia ora.");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if (stile==="wtf"){
    let seed = rndU32() ^ hash32(String(domanda));
    function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; }
    const impre = WTF_IMPRE[Math.floor(rnd()*WTF_IMPRE.length)];
    const shuffled=[...WTF_REACT].sort(()=>rnd()-0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd()*2));
    const drink = WTF_DRINK[Math.floor(rnd()*WTF_DRINK.length)];
    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). STRICT sequence: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” → THEN ${react.length} absurd object reactions → drink (“${drink}”) → 1–2 lines that truly answer → warm ironic moral. 6–8 sentences.`;
    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Sequenza OBBLIGATORIA: presa in giro (≤2) → 2–3 micro-imprevisti → UNA “${impre}” → ${react.length} reazioni di oggetti → drink (“${drink}”) → 1–2 frasi di risposta vera → morale calda e ironica. 6–8 frasi.`;
    const WTF_RULE_ES = `WHAT THE F… (en español).`;
    const WTF_RULE_FR = `WHAT THE F… (en français).`;
    const WTF_RULE_DE = `WHAT THE F… (auf Deutsch).`;
    msgs.push(
      { role:"system", content: (L==="en"?WTF_RULE_EN: L==="es"?WTF_RULE_ES: L==="fr"?WTF_RULE_FR: L==="de"?WTF_RULE_DE: WTF_RULE_IT) },
      { role:"system", content:`IMPRECATION: ${impre}` },
      { role:"system", content:`REACTIONS:\n- ${react.join("\n- ")}` },
      { role:"system", content:`DRINK: ${drink}` }
    );
  } else {
    const rule = WHATIF_RULE[L] || WHATIF_RULE.it;
    const list = WHATIF_OPENERS[L] || WHATIF_OPENERS.it;
    msgs.push(
      { role:"system", content: rule },
      { role:"system", content:`APRIRE OBBLIGATORIAMENTE con: ${opener}. (Scelto tra: ${list.join(" | ")})` }
    );
  }

  const ask =
    L==="en" ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH. Single paragraph.` :
    L==="es" ? `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.` :
    L==="fr" ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.` :
    L==="de" ? `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.` :
               `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico.`;
  msgs.push({ role:"user", content: ask });
  return msgs;
}

/* ========= Handler ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const isPro = String(req.headers["x-pro"] || "").toLowerCase() === "true" || String(req.headers["x-pro"] || "") === "1";
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();

    // Rate giornaliero
    const { success } = await (isPro ? rlProDay : rlFreeDay).limit(`askday:${ip}:${isPro?"pro":"free"}`);
    if(!success) return res.status(429).json({ error:"rate_limited_day" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", periodo = "future" } = body;
    if(!domanda || typeof domanda !== "string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const L = normLang(lang);
    const openers = WHATIF_OPENERS[L] || WHATIF_OPENERS.it;

    // Opener unico per IP + lingua (cache 24h, evita ripetizioni)
    const openerKey = `whatif:opener:${ip}:${L}`;
    const opener = (stile === "whatif") ? await pickUniqueOpener(openers, openerKey) : "";

    // Prompt
    const messages = buildMessages({ domanda, lang: L, periodo, stile, opener });

    // Call
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

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    if (stile === "whatif" && opener && !answer.toLowerCase().startsWith(opener.slice(0,12).toLowerCase())){
      answer = `${opener} ${answer}`;
    }
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 185);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Moderazione leggera IT (non tocca l’incipit)
    if(L==="it"){
      (function(){
        const d=String(domanda||"");
        const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ’']{2,})\b/gu;
        const inQuestion=new Set((d.match(nameRx)||[]));
        const STARTERS_IT = new Set(["Non","Se","Prima","Questa","Vale","È","E","Ma","Qui","Ora","Quando","Poi","Intanto","Perché","La","Il","Lo","Un","Una","Questo","Quello"]);
        function prevNonSpace(str, i){ let k=i-1; while(k>=0 && /\s/.test(str[k])) k--; return k>=0?str[k]:""; }
        answer = answer.replace(nameRx,(m,word,offset,str)=>{
          const prev = prevNonSpace(str, offset);
          const guard = offset===0 || /[.!?…:;(\[«“"']/.test(prev) || STARTERS_IT.has(word) || inQuestion.has(m);
          return guard ? m : m.toLowerCase();
        });
      })();
    }

    // (Motivazioni opzionali — se non ti serve, puoi ignorare questa parte di output)
    // Per semplicità, qui restituiamo solo la risposta. Puoi riattivare la sezione motivazioni
    // che avevamo in precedenza se vuoi anche il box “Esito & motivazioni”.

    return res.status(200).json({
      answer, style: stile, lang: L, periodo, model: MODEL, pro: isPro
    });

  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
