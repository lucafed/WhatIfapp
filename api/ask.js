// /api/ask.js — What?f Engine (60/40 + Demenz-WTF • IT/EN/ES/FR/DE)
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ===== CORS ===== */
const ALLOWED_ORIGINS = ["https://what-ifapp.vercel.app","http://localhost:3000","http://127.0.0.1:5500"];
function cors(req,res){
  const origin=String(req.headers.origin||"");
  if(ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin",origin);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro");
}

/* ===== Helpers ===== */
const SUP_LANGS=["it","en","es","fr","de"];
const normLang=(l="it")=>{const s=String(l||"it").toLowerCase().slice(0,2); return SUP_LANGS.includes(s)?s:"it";};
function normLine(s=""){return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();}
function tightenSentences(text,maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set(); for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim();}
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,""); return t;
}
// Maiuscole dopo . ! ? …
function sentenceCaseAll(s=""){
  const rx=/([.!?…])\s+([a-zà-ÿ])/g; // seconda lettera minuscola
  let t = s.trim(); t = t.replace(rx, (_,p,chr)=> `${p} ${chr.toUpperCase()}`);
  if(t && /[a-zà-ÿ]/.test(t[0])) t = t[0].toUpperCase()+t.slice(1);
  return t;
}

/* ===== Temporal ===== */
function temporalInstruction(periodo="future", lang="it"){
  const en = ["en","es","fr","de"].includes(normLang(lang));
  if(String(periodo).toLowerCase()==="past"){
    return en ? "Write as if it already happened (past/conditional allowed)."
              : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en ? "Write as a near-future unfolding starting now."
            : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ===== Style rules ===== */
// WHAT IF 60/40 (unico)
const WHATIF_RULES = {
  it: `WHAT IF 60/40 — Stile unico:
- 60% analisi economico-sociale concreta (costi/benefici, routine, reti, rischi/mitigazioni).
- 40% respiro narrativo asciutto (immagini quotidiane reali, senza poesia barocca).
- Incipit NON poetico (niente “Bella questa, Luca”): inizia con una constatazione sobria del contesto.
- 8–11 frasi, paragrafo unico, niente elenchi/emoji/domande retoriche. Chiusura pratica e pacata.`,
  en: `WHAT IF 60/40 — Single style:
- 60% concrete economic/social analysis (cost/benefit, routine, networks, risks/mitigation).
- 40% grounded sensory detail (no flowery poetry).
- Opening must be sober (no “Beautiful one” trope): start with a plain situational statement.
- 8–11 sentences, single paragraph, no lists/emojis. Calm, practical closing.`
};

// WTF regole + banche
const WTF_IMPRE = [
  "bestemmione corazzato", "imprecazionona a detonazione", "sacramentata a ciel sereno",
  "urlo liturgico strozzato", "para-bestemmia esplosiva", "anatema a grandinata"
];
const WTF_REACT = [
  "il tostapane lancia fette come coriandoli e poi si scusa",
  "la stampante sputa una pagina con scritto «OK BRO»",
  "la pianta grassa ti fa pollice in su con una foglia",
  "la moka fischia l’inno nazionale e poi si inchina",
  "il POS fa finta di aggiornarsi e mette modalità timido",
  "la sedia rotola via da sola come se avesse un turno di notte",
  "il frigorifero sospira e decide di diventare minimalista",
  "la tapparella si abbassa per imbarazzo e poi sbircia"
];
const WTF_RULES = {
  it: `WHAT THE F (amichevole, demenziale ma utile).
Sequenza RIGIDA, 6–9 frasi, paragrafo unico:
1) Apertura con presa in giro affettuosa (max 2 frasi).
2) 2–3 micro-imprevisti coerenti con la domanda.
3) ESATTAMENTE UNA imprecazione teatrale (mai contro persone) — scegli tra: ${WTF_IMPRE.join(", ")}.
4) Subito DOPO 2–3 reazioni di OGGETTI surreali ma in tema (coerenti con la scena).
5) Un sorso alcolico (grappa, amaro, vino o birra).
6) 1–2 frasi che rispondono DAVVERO alla domanda con un consiglio pratico.
7) Chiusura ironica calda (morale).`,
  en: `WHAT THE F (friendly, absurd but helpful).
STRICT sequence, 6–9 sentences, single paragraph:
1) Playful tease opening (≤2 sentences).
2) 2–3 tiny mishaps tied to the question.
3) EXACTLY ONE theatrical ‘swear’ (never at people) — pick one of: ${WTF_IMPRE.join(", ")}.
4) THEN 2–3 OBJECT reactions, surreal yet on-topic.
5) A small alcoholic sip (amaro, grappa, wine, beer).
6) 1–2 lines that truly answer with a practical pointer.
7) Warm ironic moral.`
};

/* ===== Prompt builder ===== */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const msgs = [
    { role:"system", content: ["en","es","fr","de"].includes(L)
        ? `RULES: one paragraph, no lists, no emojis, do NOT restate the question. Second person only.`
        : `REGOLE: paragrafo unico, niente elenchi, niente emoji, NON ripetere la domanda. Solo seconda persona.` },
    { role:"system", content: temporalInstruction(periodo, L) }
  ];
  if(stile==="wtf"){
    msgs.push({ role:"system", content: WTF_RULES[L] || WTF_RULES.it });
  } else {
    msgs.push({ role:"system", content: WHATIF_RULES[L] || WHATIF_RULES.it });
  }
  const ask =
    L==="it" ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO.` :
    L==="en" ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH.` :
    L==="es" ? `Pregunta (no la repitas): "${domanda}". Genera UNA respuesta en ESPAÑOL.` :
    L==="fr" ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS.` :
              `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH.`;
  msgs.push({ role:"user", content: ask });
  return msgs;
}

/* ===== Post-process specifico WTF ===== */
function keepSingleImprecazione(answer){
  let count=0;
  return answer.replace(/\b(bestemmi\w+|imprecazion\w+|anatema|urlo|sacramentata)\b/gi,(m)=>{count++; return (count===1)?m:"imprecazione a mezza voce";});
}
function ensureDrink(answer){
  if(/\b(sorso|calice|goccio|dito|amaro|grappa|birra|vino)\b/i.test(answer)) return answer;
  return answer.replace(/(Morale:|Moral:)/i, "Ti versi un dito di amaro e rimetti a posto i pensieri. $1");
}

/* ===== Handler ===== */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});
  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});
    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", lang="it", periodo="future" } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({error:"bad_request",detail:"domanda_required"});

    const messages = buildMessages({ domanda, lang, periodo, stile });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 520,
      frequency_penalty: 0.05,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // comune
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf"?9:11);
    answer = clampWords(answer, stile==="wtf"?175:170);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    if(stile==="wtf"){
      answer = keepSingleImprecazione(answer);
      answer = ensureDrink(answer);
      answer = answer.replace(/!{3,}/g,"!!");
    }

    // niente nomi inventati (IT/ES/FR/DE)
    (function(){
      const d=String(domanda||"");
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQ=new Set(d.match(nameRx)||[]);
      answer=answer.replace(nameRx,(m)=> inQ.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m)?m:m.toLowerCase()));
    })();

    return res.status(200).json({ answer, style:stile, lang:normLang(lang), periodo, model:MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
