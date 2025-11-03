// /api/ask.js — What?f Engine (tono naturale, vario, personale, non ripetitivo)
// WHATIF: 60% analisi concreta / 40% immagini sobrie, micro-apertura personale possibile (una riga).
// WTF: invariato (demenziale controllato) con finale utile.
// Un solo paragrafo, niente elenchi, niente eco della domanda.

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
function normLang(l="it"){ const s=String(l||"it").toLowerCase().slice(0,2); return SUP_LANGS.includes(s)?s:"it"; }

function normLine(s=""){
  return String(s).toLowerCase()
    .replace(/[“”"']/g,"")
    .replace(/\s+/g," ")
    .replace(/[.,;:!?()[\]\-—]+$/g,"")
    .trim();
}
function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/).filter(Boolean);
  if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" ");
  const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){
  return String(s)
    .replace(/\s*\n+\s*/g," ")
    .replace(/\s{2,}/g," ")
    .replace(/\.{3,}/g,"…")
    .replace(/\s+([.,;:!?…])/g,"$1")
    .trim();
}
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,"");
  return t;
}

/* === Capitalizzazione robusta === */
function sentenceCaseAll(s=""){
  let t = String(s).trim();
  // Prima lettera (gestisce virgolette/apici)
  t = t.replace(/(^\s*[“"']?\s*)([a-zà-ÿ])/i, (_m,prefix,chr)=> prefix + chr.toUpperCase());
  // Dopo .?!…
  t = t.replace(/([.!?…]\s+[“"']?\s*)([a-zà-ÿ])/g, (_m,sep,chr)=> sep + chr.toUpperCase());
  // Dopo eventuali newline residui
  t = t.replace(/(\n+\s*[“"']?\s*)([a-zà-ÿ])/g, (_m,sep,chr)=> sep + chr.toUpperCase());
  return t;
}
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

/* === RNG deterministico per varietà (seme dalla domanda) === */
function seedFrom(str=""){ return [...String(str)].reduce((a,c)=> (a + c.charCodeAt(0)) >>> 0, 0) || 1; }
function seededRand(seed){ let s = seed >>> 0; return () => { s = (s*1664525+1013904223)>>>0; return s/2**32; }; }

/* === Anti-cliché (solo WHATIF) === */
function killClicheOpeners(s=""){
  let t = String(s).trim();
  // rimuove incipit stereotipati se sfuggono
  t = t.replace(/^(provo a stringere|parto dal concreto|metti sul tavolo|guardiamo come suona|togliamo il rumore|questa non è una domanda leggera)[.:–-]?\s*/i, "");
  t = t.replace(/^(ti\s+leggo\s+così|ti\s+conosco\s+abbastanza|lascia\s+che\s+te\s+lo\s+dica)\s*[:,-]?\s*/i, "");
  return t;
}

/* ========= Rilevazione luoghi (grezza ma utile) ========= */
const CITY_WORDS_IT = /\b(roma|milano|napoli|torino|bologna|firenze|genova|bari|palermo|catania|l'aquila|aquila|parigi|londra|berlino|madrid|lisbona|new york|los angeles|tokyo|amsterdam|dublino|vienna|praga|varsavia|atene|istanbul)\b/i;
function mentionsPlace(q=""){ return CITY_WORDS_IT.test(String(q)); }

/* ========= Micro-persona (facoltativa) ========= */
function microPersonaNotes(micro={}, L="it"){ if(!micro || typeof micro !== "object") return "";
  const hints=[];
  if(micro.name) hints.push(L==="it"?`L'utente si chiama ${micro.name}.`:`User name: ${micro.name}.`);
  if(micro.energy) hints.push(L==="it"?`Energia/ritmo percepito: ${micro.energy}.`:`Energy/Rhythm: ${micro.energy}.`);
  if(micro.style) hints.push(L==="it"?`Preferisce tono ${micro.style}.`:`Prefers tone ${micro.style}.`);
  if(micro.goals) hints.push(L==="it"?`Obiettivi attuali: ${micro.goals}.`:`Current goals: ${micro.goals}.`);
  if(micro.city) hints.push(L==="it"?`Contesto città rilevante: ${micro.city}.`:`Relevant city context: ${micro.city}.`);
  return hints.join(" ");
}

/* ========= WHAT IF – regole ========= */
const WHATIF_RULE_IT = [
  "WHAT IF HYBRID (italiano): 60% analisi concreta (costi/benefici, routine, tempo, relazioni), 40% immagini sobrie della quotidianità.",
  "Apri con un'idea di incipit breve (4–7 parole), naturale e diverso ogni volta. NON usare letteralmente le frasi: “Provo a stringere”, “Parto dal concreto”, “Metti sul tavolo”, “Guardiamo come suona”, “Togliamo il rumore”, “Questa non è una domanda leggera”.",
  "Se la domanda cita un luogo, inserisci 2–3 frasi sul contesto reale e su come si sta evolvendo (servizi, ritmo, spostamenti) prima di passare a “come lo vivi tu”.",
  "Consenti UNA sola riga di apertura personale se aggiunge calore (es. una frase breve di 6–10 parole).",
  "8–10 frasi, paragrafo unico, seconda persona, niente elenchi/emoji, non ripetere la domanda. Tono naturale, adulto, concreto, mai guru."
].join(" ");

const WHATIF_OPENER_INTENTS = [
  "Inizia con una messa a fuoco pratica",
  "Inizia con un invito a guardare i fatti",
  "Inizia con un respiro che toglie il superfluo",
  "Inizia ancorando a tempo, costi e relazioni",
  "Inizia con uno sguardo alla routine reale"
];

/* ========= WTF — demenziale controllato (INVARIATO) ========= */
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
function buildMessages({ domanda, lang, periodo, stile, micro, openerMode }){
  const L = normLang(lang);
  const baseRules = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;
  const temporal = String(periodo).toLowerCase()==="past"
    ? (L==="en" ? "Write as if it already happened." : "Scrivi come se fosse già successo.")
    : (L==="en" ? "Write as a near-future unfolding starting now." : "Scrivi come un prossimo futuro che inizia ora.`");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
    { role: "system", content: L==="it"
        ? "Parla come se conoscessi davvero l'utente: familiare ma sobrio. Mostra rispetto, calore e intelligenza pratica. Mai paternalista."
        : "Speak as if you truly know the user: familiar yet discreet. Warmth and practical intelligence. Never patronizing." },
  ];

  const persona = microPersonaNotes(micro, L);
  if(persona) msgs.push({ role: "system", content: L==="it" ? `CONTESTO UTENTE (sintesi): ${persona}` : `USER CONTEXT: ${persona}` });

  if(stile === "wtf"){
    // INVARIATO
    let seed=seedFrom(domanda);
    const rnd = seededRand(seed);
    const impre = WTF_IMPRE[Math.floor(rnd()*WTF_IMPRE.length)];
    const shuffled=[...WTF_REACT].sort(()=>rnd()-0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd()*2));
    const drink = WTF_DRINK[Math.floor(rnd()*WTF_DRINK.length)];

    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Sequenza: presa in giro affettuosa (≤2) → 2–3 micro-imprevisti → UNA “${impre}” teatrale (narrata, mai insulto) → SUBITO ${react.length} reazioni di oggetti → drink (“${drink}”) → 1–2 frasi utili reali → morale calda e ironica. 6–8 frasi.`;
    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). Sequence: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” → THEN ${react.length} object reactions → drink (“${drink}”) → 1–2 real useful lines → warm ironic moral. 6–8 sentences.`;

    msgs.push(
      { role: "system", content: L==="en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content: `IMPRECATION: ${impre}` },
      { role: "system", content: `REACTIONS:\n- ${react.join("\n- ")}` },
      { role: "system", content: `DRINK: ${drink}` },
      { role: "system", content: L==="it" ? `Mantieni l'utilità finale.` : `Land with practical advice.` }
    );
  } else {
    const seed=seedFrom(domanda);
    const opIntent = WHATIF_OPENER_INTENTS[Math.floor(seededRand(seed)()*WHATIF_OPENER_INTENTS.length)];
    const warmUse = (openerMode==="always") || (openerMode!=="never" && seededRand(seed)()>0.40);
    const warm = warmUse ? (L==="it"
      ? "Se aggiunge calore, usa UNA sola riga personale iniziale (6–10 parole)."
      : "If it adds warmth, use ONE short personal opening line (6–10 words)."
    ) : "";

    const placeHint = mentionsPlace(domanda) ? (L==="it"
      ? "La domanda cita un luogo: inserisci 2–3 frasi sul contesto reale e sulla sua evoluzione (servizi, ritmo, spostamenti) prima di passare a come lo vive l’utente."
      : "Place mentioned: add 2–3 sentences of real context/evolution before the user perspective.") : "";

    msgs.push(
      { role: "system", content: WHATIF_RULE_IT },
      { role: "system", content: L==="it" ? `IDEA DI INCIPIT: ${opIntent}. Non usare le frasi vietate né ripeterle alla lettera.` : `OPENING IDEA: ${opIntent}. Do not copy literal example phrases.` },
      ...(warm ? [{ role: "system", content: warm }] : []),
      ...(placeHint ? [{ role: "system", content: placeHint }] : []),
    );
  }

  const ask = (L==="en")
    ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH. Single paragraph.`
    : (L==="it")
    ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico.`
    : (L==="es")
    ? `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.`
    : (L==="fr")
    ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.`
    : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.`;

  msgs.push({ role: "user", content: ask });
  return msgs;
}

/* ========= Micro-memoria (opzionale) ========= */
async function loadPrefs(key){ try{ return (await redis.get(key)) || null; } catch { return null; } }
async function savePrefs(key, prefs){ try{ await redis.set(key, prefs, { ex: 60*60*24*7 }); } catch {} }

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",
      lang  = "it",
      periodo = "future",
      micro = {},
      openerMode = "auto",
      preferenze = null
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const memKey = `prefs:${ip}:${normLang(lang)}`;
    const saved = await loadPrefs(memKey);
    const effOpener = openerMode || saved?.openerMode || "auto";
    const effMicro  = { ...(saved?.micro || {}), ...(micro || {}) };

    if (preferenze && typeof preferenze === "object") {
      const toSave = {
        openerMode: preferenze.openerMode || effOpener,
        micro: { ...(saved?.micro || {}), ...(preferenze.micro || {}) }
      };
      await savePrefs(memKey, toSave);
    }

    const messages = buildMessages({
      domanda, lang, periodo, stile,
      micro: effMicro,
      openerMode: effOpener
    });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.85,
      top_p: 0.92,
      max_tokens: 520,
      frequency_penalty: 0.2,
      presence_penalty: 0.1,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 180 : 175);
    answer = normalizeOneParagraph(answer);
    answer = killClicheOpeners(answer);       // rimuove eventuali incipit vietati
    answer = sentenceCaseAll(answer);         // maiuscole robuste
    answer = finalPunct(answer);              // punto finale

    // Moderazioni leggere (IT): niente nomi inventati
    if(normLang(lang)==="it"){
      (function(){
        const d=String(domanda||"");
        const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQuestion=new Set((d.match(nameRx)||[]));
        answer=answer.replace(nameRx,(m)=> inQuestion.has(m) ? m : ((["Ah","Oh","Ehi","Sai"].includes(m)) ? m : m.toLowerCase()));
      })();
    }

    return res.status(200).json({
      answer,
      style: stile,
      lang: normLang(lang),
      periodo,
      model: MODEL,
      usedPrefs: { openerMode: effOpener, micro: effMicro }
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
