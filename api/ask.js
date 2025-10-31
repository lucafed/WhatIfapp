// /api/ask.js — What?f Engine (Ultra Fun WTF + 60/40 WhatIf + Grammar Fix)
// - WTF: demenziale, 2–3 reazioni di oggetti ASSURDE ma attinenti al contesto, UNA sola imprecazione teatrale, accenno alcolico (mai acqua)
// - WhatIf: stile unico 60% analisi socio-economica / 40% poetico-reale, con incipit variabili (no "Bella Luca" fisso)
// - Multilingua (IT/EN/ES/FR/DE) per le istruzioni
// - Post-process: maiuscole dopo . ! ? … ; normalizzazione spazi; limite !! ; niente nomi inventati

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro"
  );
}

/* ========= Lang utils ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
const normLang = (l="it") => {
  const s = String(l||"it").toLowerCase().slice(0,2);
  return SUP_LANGS.includes(s) ? s : "it";
};
const isEnLike = (l) => ["en","es","fr","de"].includes(normLang(l));

/* ========= Text utils ========= */
function normLine(s=""){
  return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();
}
function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){
    const n = normLine(p); if(!n || seen.has(n)) continue;
    if(p.split(/\s+/).length<=3 && !/[.!?…]$/.test(p)) continue;
    out.push(p); seen.add(n);
    if(out.length>=maxSentences) break;
  }
  let t = out.join(" ");
  if(!/[.!?…]$/.test(t)) t += ".";
  return t;
}
function clampWords(text, maxWords){
  const w = String(text||"").split(/\s+/);
  if(w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m ? m[1] : slice + "…";
}
function normalizeOneParagraph(s=""){
  return String(s)
    .replace(/\s*\n+\s*/g," ")
    .replace(/\s{2,}/g," ")
    .replace(/\.\.\.+/g,"…")
    .replace(/\s+([.,;:!?…])/g,"$1")
    .trim();
}
function capitalizeAfterStops(s=""){
  // Maiuscola dopo . ! ? … (anche con virgolette/spazi)
  return String(s).replace(/([.!?…])(\s+)([a-zà-ž])/g, (_,p,sp,ch)=> p + sp + ch.toUpperCase());
}
function finalPunct(s=""){ return /[.!?…]$/.test(s) ? s : s + "."; }
function limitExclamations(s=""){ return String(s).replace(/!{3,}/g,"!!"); }
function stripQuestionEcho(domanda, text){
  const d = String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t = String(text||"");
  const lead = t.slice(0, Math.min(t.length, d.length + 12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut = t.indexOf("."); if(cut > -1) t = t.slice(cut+1).trim(); }
  t = t.replace(rx,"");
  return t;
}

/* ========= Temporal ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en = isEnLike(lang);
  if(String(periodo).toLowerCase()==="past"){
    return en ? "Write as if it already happened (past/conditional allowed)."
              : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en ? "Write as a near-future unfolding starting now."
            : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHATIF — stile unico 60/40 con incipit variabili ========= */
const WHATIF_60_40_RULE = (lang) => isEnLike(lang)
? `WHAT IF (Single style 60/40):
- Start with a short, varied incipit (not always the same), intimate but grounded.
- 60% analytic (trade-offs, cost of living, routines, options, risks).
- 40% real/poetic (sober, sensory, concrete images).
- Second person only. 8–11 sentences. One paragraph. No lists, no emojis, do NOT restate the question.
- End with a calm, reconciled line.`
: `WHAT IF (Stile unico 60/40):
- Inizia con un incipit breve e variato (non sempre uguale), intimo ma concreto.
- 60% analitico (scambi, costo della vita, routine, alternative, rischi).
- 40% reale/poetico (immagini sobrie, sensoriali, quotidiane).
- Solo seconda persona. 8–11 frasi. Un paragrafo. Niente elenchi, niente emoji, NON ripetere la domanda.
- Chiudi con una riga calma e riconciliata.`;

const WHATIF_INCIPETS_IT = [
  "Sai, questa domanda non ti molla: torna quando fai silenzio.",
  "Metti il telefono a faccia in giù e la risposta comincia a farsi vedere.",
  "Ti siedi un attimo e scopri che l’aria ha memoria più di te.",
  "Lasci parlare la stanza: quello che senti è già un indizio.",
  "Respiri come chi ha tempo: da lì comincia tutto."
];
const WHATIF_INCIPETS_EN = [
  "You set the phone face down and the answer starts to show.",
  "You sit for a moment and the air remembers more than you do.",
  "You let the room speak; what you hear is already a clue.",
  "You breathe like someone with time; that’s where it begins.",
  "You stop rushing and the future stops hiding."
];

/* ========= WTF — super demenziale ma coerente col contesto ========= */
// UNA sola imprecazione teatrale (narrazione, non insulto diretto)
const WTF_IMPRECATIONS_IT = [
  "un bestemmione corazzato",
  "una sacramentata a grandinata",
  "un anatema pirotecnico con riverbero",
  "una para-bestemmia a fisarmonica",
  "un ruggito liturgico in stereofonia",
  "una detonazione teologica con coriandoli",
];
const WTF_IMPRECATIONS_EN = [
  "a cathedral-grade swear detonation",
  "a liturgical roar in stereo",
  "a cartoonish holy outburst with reverb",
  "a squeezebox-style swear-in, swear-out",
  "a theological boom with confetti",
];

// Reazioni ASSURDE ma agganciabili al contesto (bar, cucina, strada, ufficio, casa, moto…)
const WTF_REACTIONS_IT = [
  "il frigorifero fa partire l’inno nazionale in do minore",
  "la moka ti batte il cinque e sputa cuori di vapore",
  "il semaforo passa al verde per rispetto e poi ti manda un bacio",
  "la sedia applaude piano e poi chiede l’autografo",
  "il citofono fa un fischio da stadio e poi finge di non essere stato lui",
  "la stampante sputa un contratto di pace con graffette a forma di colomba",
  "il casco fa cenno di sì da solo e ti promuove cavaliere del traffico",
  "la tapparella si abbassa per la vergogna e risale curiosa",
  "Alexa finge un aggiornamento di 7 ore e scappa via in modalità turista",
  "il POS recita un rosario di errori e poi stampa «Amen» sullo scontrino",
  "il ventilatore gira al contrario per riverenza e si inchina a 1200 giri",
  "il barile del retro stappa da solo e brinda alla tua salute",
];
const WTF_REACTIONS_EN = [
  "the fridge plays the national anthem in minor key",
  "the moka high-fives you and puffs heart-shaped steam",
  "the traffic light turns green out of respect then blows a kiss",
  "the chair claps softly and asks for an autograph",
  "the door buzzer whistles like a stadium then denies everything",
  "the printer spits out a peace treaty with dove-shaped staples",
  "the helmet nods on its own and knights you road champion",
  "the shutter drops in shame then peeks back up",
  "the card reader chants a litany of errors then prints ‘Amen’",
  "the fan spins backward in reverence and bows at 1200 RPM",
  "the keg in the back pops itself and toasts to your health",
];

// Accenni alcolici (mai acqua!)
const DRINKS_IT = [
  "ti versi un amaro doppio e raddrizzi l’orizzonte",
  "prendi un sorso di whiskey come firma in calce",
  "alzi un calice corto: manutenzione dell’anima",
  "bevi un dito di rum e rimetti in colonna i pensieri",
];
const DRINKS_EN = [
  "you take a double amaro and straighten the horizon",
  "you sip a short whiskey as a signature at the bottom",
  "you raise a tiny glass: soul maintenance",
  "you drink a finger of rum and stack your thoughts",
];

// Regola forma e sequenza WTF (in IT o EN-like)
function WTF_RULE(lang){
  const en = isEnLike(lang);
  const IMP = (en? WTF_IMPRECATIONS_EN : WTF_IMPRECATIONS_IT).join(", ");
  const RCT = (en? WTF_REACTIONS_EN : WTF_REACTIONS_IT).join(" · ");
  return en
    ? `WHAT THE F (funny, absurd, but kind). ONE paragraph, 6–9 sentences. Structure:
1) Playful jab opening (≤2 sentences).
2) 2–3 tiny mishaps tied to the context of the question (bar/kitchen/street/office/home/bike... infer from the question).
3) EXACTLY ONE theatrical swear (choose ONE from: ${IMP}). It must be narrative, never against people.
4) Immediately 2–3 OBJECT REACTIONS, absurd but coherent with the inferred context (choose from: ${RCT}).
5) Strong drink mention (no water).
6) 1–2 lines that actually answer the question with a concrete tip/forecast.
7) Warm ironic moral (one sentence).
Bans: anger, insults to people, more than two “!!”.`
    : `WHAT THE F (demenziale ma gentile). UN paragrafo, 6–9 frasi. Sequenza:
1) Apertura con stoccata affettuosa (≤2 frasi).
2) 2–3 micro-imprevisti legati al contesto della domanda (bar/cucina/strada/ufficio/casa/moto… inferisci dalla domanda).
3) ESATTAMENTE UNA imprecazione teatrale (scegline UNA: ${IMP}). Deve essere narrata, mai contro persone.
4) Subito 2–3 REAZIONI DI OGGETTI, assurde ma coerenti col contesto (scegli da: ${RCT}).
5) Accenno alcolico deciso (no acqua).
6) 1–2 frasi che rispondono davvero alla domanda con consiglio/previsione concreta.
7) Morale finale, calda e ironica (una frase).
Divieti: rabbia, insulti a persone, più di due “!!”.`;
}

/* ========= Base rules ========= */
function baseRules(lang){
  const en = isEnLike(lang);
  return en
  ? `RULES: Single paragraph. Second person only. No lists/emojis. Do NOT repeat the question.`
  : `REGOLE: Un solo paragrafo. Solo seconda persona. Niente elenchi/emoji. NON ripetere la domanda.`;
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const msgs = [
    { role: "system", content: baseRules(L) },
    { role: "system", content: temporalInstruction(periodo, L) },
  ];

  if (stile === "wtf") {
    msgs.push({ role: "system", content: WTF_RULE(L) });
  } else {
    msgs.push({ role: "system", content: WHATIF_60_40_RULE(L) });
    // Incipits suggeriti come "seme" per evitare ripetizioni
    const bank = (L==="it") ? WHATIF_INCIPETS_IT : WHATIF_INCIPETS_EN;
    msgs.push({ role: "system", content: `Incipit examples (vary, don't always reuse): ${bank.join(" | ")}` });
  }

  // Istruzione finale utente nella lingua richiesta
  const ask =
    L === "it"
      ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO.`
      : L === "en"
      ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH.`
      : L === "es"
      ? `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL.`
      : L === "fr"
      ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS.`
      : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH.`;

  msgs.push({ role: "user", content: ask });
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",     // "whatif" | "wtf"
      lang = "it",
      periodo = "future",
      // campi extra pass-through
      micro = {},
      sex = ""
    } = body;

    if(!domanda || typeof domanda!=="string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 520,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // ===== Post-process comune =====
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 180 : 170);
    answer = normalizeOneParagraph(answer);
    answer = limitExclamations(answer);
    answer = capitalizeAfterStops(answer);
    answer = finalPunct(answer);

    // Guard-rail: niente nomi propri non presenti nella domanda (solo IT/EN-like)
    (function(){
      const d = String(domanda||"");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ'’]{2,})\b/g;
      const inQ = new Set(d.match(nameRx) || []);
      answer = answer.replace(nameRx, (m)=>{
        return inQ.has(m) ? m : (["Ah","Oh","Ehi","Hey","Bella","Sai","Well"].includes(m) ? m : m.toLowerCase());
      });
    })();

    // Soft-filter insulti diretti (lascia umorismo)
    const L = normLang(lang);
    answer = answer.replace(/\b(cazzo|cazzata|stronzo|idiota|imbecille|moron|idiot)\b/gi, L==="it" ? "accidente" : "heck");

    return res.status(200).json({
      answer,
      style: stile,
      lang: L,
      periodo,
      model: MODEL
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
