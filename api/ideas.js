// /api/ideas.js — Generatore idee (personalized/generic/absurd) con dedup & diversità
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL  = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ===== util =====
const SUP = ["it","en","es","fr","de"];
const normLang = (l="it")=>{
  const s=String(l||"it").toLowerCase().slice(0,2);
  return SUP.includes(s)?s:"it";
};
const clean = s => String(s||"")
  .normalize("NFKC")
  .replace(/[“”„"']/g,"")
  .replace(/\s+/g," ")
  .trim();

// Jaccard su bigrammi per dedup “quasi-duplicati”
function sim(a,b){
  const A=new Set(bigrams(a)), B=new Set(bigrams(b));
  const inter=[...A].filter(x=>B.has(x)).length;
  const uni = new Set([...A,...B]).size;
  return uni? inter/uni : 0;
}
function bigrams(s){
  const t=clean(s).toLowerCase();
  const out=[];
  for(let i=0;i<t.length-1;i++) out.push(t.slice(i,i+2));
  return out;
}
function dedup(list, threshold=0.6){
  const out=[];
  for(const x of list){
    const ok = out.every(y => sim(x,y) < threshold);
    if(ok) out.push(x);
  }
  return out;
}
function sentenceCaseAll(s){
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g,(m,p,c)=>p+c.toUpperCase());
}
function finalQ(s, lang){
  let t = String(s||"").replace(/[?？]+$/,'').trim();
  if(!t) return "";
  if(lang==="es"){ if(!t.startsWith("¿")) t="¿"+t; return t.endsWith("?")?t:t+"?"; }
  if(lang==="fr"){ return t.endsWith("?")?t:t+" ?"; }
  return t.endsWith("?")?t:t+"?";
}

// ===== prompt =====
function buildPrompt({lang, periodo, style, boost, counts}){
  const L = normLang(lang);
  const nP = Math.max(8, Math.min(48, counts?.personalized ?? 24));
  const nG = Math.max(6, Math.min(48, counts?.generic ?? 16));
  const nA = Math.max(4, Math.min(32, counts?.absurd ?? 8));

  const base = (L==="en")
    ? `You are a sharp ideas engine. Output deep, varied, *question-form* prompts for a What-if app. 
Avoid trivial rephrasings. Include multiple domains (career, learning, relationships, creativity, money, habits, health, location, risk-taking).
No lists with numbers; return strict JSON.` 
    : `Sei un generatore di idee. Produci spunti in forma di *domande* profonde e varie per un’app “E se…”.
Evita parafrasi banali. Copri più domini (lavoro, studio, relazioni, creatività, soldi, abitudini, salute, luogo, rischio).
Niente elenchi numerati; restituisci JSON rigido.`;

  const tense = (periodo==="past")
    ? (L==="en" ? "Past hypothetical / counterfactual (as if it had already happened)."
                : "Ipotesi al passato / controfattuali (come se fosse già successo).")
    : (L==="en" ? "Near-future scenarios starting now."
                : "Scenari di prossimo futuro che iniziano ora.");

  const flavour = (style==="wtf")
    ? (L==="en" ? "Add a pinch of playful absurdity in 'absurd' list (wholesome, not offensive)."
                : "Aggiungi un pizzico di assurdo nella lista 'absurd' (giocoso, mai offensivo).")
    : (L==="en" ? "Keep absurd minimal but witty; focus on concrete, meaningful changes."
                : "Mantieni l'assurdo minimo ma arguto; focus su cambi concreti e significativi.");

  const persona = boost ? ((L==="en")
    ? `Personalization hints (free text): ${boost}`
    : `Spunti di personalizzazione (testo libero): ${boost}`) : "";

  const ask = (L==="en")
    ? `Return JSON:
{
  "personalized": ${nP} questions,
  "generic": ${nG} questions,
  "absurd": ${nA} questions
}
Rules: each item a single, well-formed question; 6–16 words; avoid near-duplicates; varied verbs; different domains; no quotes around punctuation.`
    : `Restituisci JSON:
{
  "personalized": ${nP} domande,
  "generic": ${nG} domande,
  "absurd": ${nA} domande
}
Regole: ogni elemento è una domanda unica ben formata; 6–16 parole; niente quasi-duplicati; verbi vari; domini diversi; niente virgolette inutili.`;

  return [base, tense, flavour, persona, ask].filter(Boolean).join("\n\n");
}

// ===== handler =====
export default async function handler(req,res){
  if(req.method==="OPTIONS"){ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS"); res.setHeader("Access-Control-Allow-Headers","Content-Type"); return res.status(200).end(); }
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const lang    = normLang(body.lang||"it");
    const periodo = (body.periodo==="past")?"past":"future";
    const style   = (body.style==="wtf")?"wtf":"whatif";
    const boost   = clean(body.boost||"");
    const counts  = body.counts || {};

    const prompt = buildPrompt({lang, periodo, style, boost, counts});

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.92,
      top_p: 0.95,
      max_tokens: 1200,
      messages: [
        { role:"system", content:"You output STRICT JSON only. No preface, no prose." },
        { role:"user", content: prompt }
      ]
    });

    let raw = completion?.choices?.[0]?.message?.content || "{}";
    // ripara JSON lasco
    try{
      raw = raw.trim().replace(/```(?:json)?/g,"").replace(/```/g,"");
    }catch{}
    let data = {};
    try{ data = JSON.parse(raw) }catch(e){ data = {} }

    const P = Array.isArray(data.personalized)?data.personalized:[];
    const G = Array.isArray(data.generic)?data.generic:[];
    const A = Array.isArray(data.absurd)?data.absurd:[];

    // Normalizza + dedup forte
    function normQ(s){ return finalQ(sentenceCaseAll(clean(s)), lang); }
    const personalized = dedup(P.map(normQ)).slice(0, counts.personalized || 24);
    const generic      = dedup(G.map(normQ)).slice(0, counts.generic || 16);
    const absurd       = dedup(A.map(normQ)).slice(0, counts.absurd || 8);

    return res.status(200).json({ personalized, generic, absurd, lang, periodo, style, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ideas] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
