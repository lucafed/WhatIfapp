// /api/ask.js — What?f Engine (WHATIF realistico + WTF naturale variabile)
// - WHATIF: 70% analisi concreta / 30% immagini minime, tono adulto e asciutto.
// - WTF: ironico/sarcastico, 3–4 micro-gag variabili, UNA imprecazione teatrale descritta,
//        un sorso alcolico, risposta vera, morale calda. Ordine dei blocchi leggermente mescolato.
// - Un paragrafo, niente elenchi, niente eco della domanda. Maiuscole sistemate post-process.

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

function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
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
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g, (m,prefix,chr)=> prefix + chr.toUpperCase());
}
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

/* ========= Style Profiles ========= */
const STYLE = {
  whatif: {
    rules_it: `WHATIF REALISTICO: tono analitico, adulto, concreto. 70% ragionamento (costi/benefici, tempo, routine, relazioni), 30% immagini minime e reali (mai poetiche). Vietato motivazionale e vago. Nessuna eco della domanda. Seconda persona. 7–10 frasi, un unico paragrafo. Chiusura asciutta.`,
    example_it: `Sai, questa non è una decisione leggera. Metti in fila costi abitativi, tempi di spostamento e qualità dei servizi; poi guardi chi puoi vedere senza organizzare un trasloco ogni weekend. Il portafoglio respira se tagli gli extra fissi, ma il ritmo diventa meno brillante e più regolare. La routine guadagna stabilità: minuti che smetti di bruciare in traffico, margini per allenarti o seguire una pratica senza rincorrere l’orologio. In cambio rinunci a qualche opportunità “di vetrina” e metti più valore nella continuità. Se lo scambio ti dà più testa libera che FOMO, è un affare. È ingegneria quotidiana: spostare peso da stress e spesa a tempo utile. A fine giornata la domanda è una: ti senti più te stesso dove chiudi la porta?`,
    seedTemp: 0.78,
    maxSentences: 10,
    maxWords: 180,
    freqPenalty: 0.15
  },
  wtf: {
    rules_it: `WHAT THE F NATURALE: ironico/sarcastico ma affettuoso. Usa 3–4 micro-gag a rotazione (oggetti che reagiscono, mini-imprevisti), UNA “imprecazione teatrale” descritta (mai insulto a persone), un sorso alcolico, poi 1–2 frasi davvero utili e una morale calda e pungente. Non seguire sempre la stessa sequenza: mescola leggermente l’ordine. 6–8 frasi, un paragrafo, niente emoji, niente eco della domanda.`,
    impre: [
      "bestemmione in surround",
      "imprecazione barocca",
      "sacramentata che fa vibrare i bicchieri",
      "anatema da sagra di paese"
    ],
    react: [
      "la moka fischia come se avessi vinto il Giro",
      "la tapparella si cala per vergogna e poi spià",
      "Alexa finge un aggiornamento e sparisce",
      "il frigorifero sospira e decide il minimalismo",
      "il campanello suona da solo e si scusa",
      "la pianta applaude con le foglie e chiede un drink"
    ],
    drink: [
      "un amaro secco che raddrizza la giornata",
      "un dito di rosso di manutenzione",
      "un sorso corto che rimette i bordi",
      "un cicchetto educato ma risolutivo"
    ],
    seedTemp: 0.95,
    maxSentences: 8,
    maxWords: 170,
    freqPenalty: 0.0
  }
};

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const S = STYLE[stile === "wtf" ? "wtf" : "whatif"];

  const baseRules = (L==="en")
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;

  const temporal = String(periodo).toLowerCase()==="past"
    ? (L==="en" ? "Write as if it already happened." : "Scrivi come se fosse già successo.")
    : (L==="en" ? "Write as a near-future unfolding starting now." : "Scrivi come un prossimo futuro che inizia ora.");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if(stile==="wtf"){
    // Variazione naturale deterministica sulla domanda
    let seed=[...String(domanda)].reduce((a,c)=>a+c.charCodeAt(0),0);
    function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; }

    const impre = S.impre[Math.floor(rnd()*S.impre.length)];
    const reactPool = [...S.react].sort(()=>rnd()-0.5).slice(0, 3 - (rnd()>0.6?1:0)); // 2–3 reazioni
    const drink = S.drink[Math.floor(rnd()*S.drink.length)];

    // Ordine flessibile dei blocchi (mescolato ma coerente)
    const blocks = ["tease","mishaps","imprecation","reactions","drink","answer","moral"];
    const softShuffle = [...blocks].sort(()=>rnd()-0.5);

    const flexRule = `VARIAZIONE: segui quest’ordine morbido (ma naturale, senza forzature): ${softShuffle.join(" → ")}. Inserisci UNA imprecazione teatrale (“${impre}”), reazioni oggetti (${reactPool.join("; ")}), e un drink (“${drink}”). Tieni 6–8 frasi e chiudi con una morale pungente ma calda.`;

    msgs.push(
      { role: "system", content: S.rules_it },
      { role: "system", content: flexRule }
    );
  } else {
    msgs.push({ role: "system", content: S.rules_it });
    if (S.example_it) msgs.push({ role: "system", content: `ESEMPIO (tono/respiro): ${S.example_it}` });
  }

  // Istruzione finale all'assistente (no eco)
  const ask = (L==="it")
    ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico.`
    : (L==="en")
    ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH. Single paragraph.`
    : (L==="es")
    ? `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.`
    : (L==="fr")
    ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.`
    : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.`;

  msgs.push({ role: "user", content: ask });
  return msgs;
}

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
      stile = "whatif",   // "whatif" | "wtf"
      lang  = "it",
      periodo = "future",
      micro = {}
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, micro });

    const S = STYLE[stile === "wtf" ? "wtf" : "whatif"];
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: S.seedTemp,
      top_p: 0.92,
      max_tokens: 520,
      frequency_penalty: S.freqPenalty,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, S.maxSentences);
    answer = clampWords(answer, S.maxWords);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Moderazioni leggere IT: evita nomi propri non presenti nella domanda
    if(normLang(lang)==="it"){
      (function(){
        const d=String(domanda||"");
        const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQuestion=new Set((d.match(nameRx)||[]));
        answer=answer.replace(nameRx,(m)=> inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Sai"].includes(m) ? m : m.toLowerCase()));
      })();
    }

    return res.status(200).json({ answer, style: stile, lang: normLang(lang), periodo, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
