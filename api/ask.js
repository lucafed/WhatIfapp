// /api/ask.js — What?f Engine (Unico WHATIF 60/40 • WTF Demenza+) — completo
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

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

/* ===== Helpers ===== */
const SUP = ["it","en","es","fr","de"];
const normLang = (l="it") => { const s=String(l||"it").slice(0,2).toLowerCase(); return SUP.includes(s)?s:"en"; };

const normLine = (s="") => String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();

function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
const normalizeOneParagraph = (s="") => String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?…])/g,"$1").trim();
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  return t.replace(rx,"");
}
function capitalizeAfterPunct(s=""){
  return String(s).replace(/(^\s*[a-zà-ÿ])|([.!?…]\s+)([a-zà-ÿ])/g,(m,a,sep,c)=>a? a.toUpperCase(): sep + c.toUpperCase());
}

/* ===== Temporal ===== */
function temporalInstruction(periodo="future", lang="it"){
  const en = normLang(lang) !== "it";
  if(String(periodo).toLowerCase()==="past"){
    return en ? "Write as if it already happened (past/conditional allowed)."
              : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en ? "Write as a near-future unfolding starting now."
            : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ===== WHATIF 60/40 (sample guida IT) ===== */
const WHATIF_6040_SAMPLE_IT =
`Guardi il quadro generale prima di muovere un passo. Tornare o cambiare rotta significa pesare costi, tempo e qualità della vita: stipendi e opportunità da una parte, affitti, spostamenti e routine dall’altra. Valuti reti sociali, servizi, scuole e margini di crescita senza bruciarti. Nel concreto, la giornata si fa gestibile: tragitti più corti, spese sotto controllo, meno rumore di fondo. Ti immagini al lavoro con un ritmo che non ti divora e nel tempo libero con luoghi che fanno respirare. Le immagini sono semplici: una tazza che si scalda, un portone che riconosci, una strada che non ti chiede fretta. Alla fine capisci che la scelta non è tra vincere o perdere, ma tra vivere tirato o vivere nitido: se la somma torna, ti sposti; se non torna, rimetti a fuoco quello che hai e togli il superfluo.`;

/* ===== WTF — demenziale ===== */
const WTF_IMPRE = [
  "bestemmione corazzato","imprecazione a trombone sinfonico","sacramentata a ciel sereno formato stadio",
  "urlo liturgico con riverbero","para-bestemmia a grandinata","vulcano d’anatemi con coriandoli"
];
const WTF_REACT = [
  "il mouse fa moonwalk e cade dal tappetino",
  "la stampante sputa carta bianca come un lama offeso",
  "la sedia girevole fa tre piroette e ti promuove a direttore del vuoto",
  "la lampada manda un SOS in Morse e poi si spegne per imbarazzo",
  "il frigorifero emette un DO minore e ti giudica in bemolle",
  "Alexa finge di non conoscerti e cambia nome in Alessio",
  "il POS recita un rosario di errori e si benedice da solo",
  "il tostapane applaude a tempo e chiede il bis",
  "la tapparella scende da sola e poi risale per curiosare"
];
const pick = (arr,n=1)=>{ const out=[]; const used=new Set(); while(out.length<n&&used.size<arr.length){const i=Math.floor(Math.random()*arr.length); if(used.has(i))continue; used.add(i); out.push(arr[i]);} return out; };

/* ===== Rules ===== */
function baseRules(lang){
  const en = normLang(lang) !== "it";
  return en
    ? "RULES: single paragraph, no lists or emojis, second person only, do NOT restate the question."
    : "REGOLE: paragrafo unico, niente elenchi o emoji, solo seconda persona, NON ripetere la domanda.";
}
function whatif6040Rule(lang){
  const en = normLang(lang) !== "it";
  return en
  ? "WHAT IF 60/40: 60% concrete analysis (cost/benefit, routine, services, networks), 40% sober everyday imagery. Practical opening (not lyrical). 8–11 sentences; calm closing."
  : "WHAT IF 60/40: 60% analisi concreta (costi/benefici, routine, servizi, reti), 40% immagini sobrie quotidiane. Incipit pratico (non lirico). 8–11 frasi; chiusura calma.";
}
function wtfRule(lang){
  const en = normLang(lang) !== "it";
  return en
    ? "WHAT THE F (friendly absurd). STRUCTURE: teasing opening (≤2 sentences) → 2–3 tiny mishaps → EXACTLY ONE theatrical ‘swear’ (never at people) → THEN 2–3 absurd OBJECT reactions → quick alcohol sip → 1–2 lines that truly answer → warm ironic moral. 6–9 sentences."
    : "WHAT THE F (assurdo ma affettuoso). STRUTTURA: apertura pungente (≤2 frasi) → 2–3 micro-imprevisti → ESATTAMENTE UNA imprecazione teatrale (mai contro persone) → POI 2–3 reazioni ASSURDE di OGGETTI → accenno di alcol → 1–2 frasi che rispondono davvero → morale calda e ironica. 6–9 frasi.";
}

/* ===== Prompt builder ===== */
function buildMessages({ domanda, lang, stile, periodo }){
  const L = normLang(lang);
  const msgs = [
    { role:"system", content: baseRules(L) },
    { role:"system", content: temporalInstruction(periodo, L) },
  ];

  if(stile==="wtf"){
    const impre = pick(WTF_IMPRE,1)[0];
    const reacts = pick(WTF_REACT,3);
    msgs.push(
      { role:"system", content: wtfRule(L) },
      { role:"system", content: `IMPRECATION: ${impre}` },
      { role:"system", content: `REACTIONS:\n- ${reacts[0]}\n- ${reacts[1]}\n- ${reacts[2]}` },
      { role:"system", content: (L==="it" ? "DRINK: bevi un amaro doppio e il mondo rientra a fuoco." : "DRINK: take a double amaro; the world snaps into focus.") },
      { role:"system", content: (L==="it" ? "MORALE: al caos offri da bere e diventa educato." : "MORAL: buy chaos a drink and it behaves.") },
    );
  }else{
    msgs.push(
      { role:"system", content: whatif6040Rule(L) },
      { role:"system", content: (L==="it"
        ? `ESEMPIO GUIDA (IT):\n${WHATIF_6040_SAMPLE_IT}`
        : "GUIDE EXAMPLE: pragmatic opening; weigh costs/opportunities; add sparse sensory details; close with a calm synthesis."
      ) }
    );
  }

  const ask =
    L==="it" ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO.`
  : L==="es" ? `Pregunta (no la repitas): "${domanda}". Genera UNA respuesta en ESPAÑOL.`
  : L==="fr" ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS.`
  : L==="de" ? `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH.`
             : `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH.`;

  msgs.push({ role:"user", content: ask });
  return msgs;
}

/* ===== Handler ===== */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    let { domanda = "", stile = "whatif", lang = "it", periodo = "future" } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    lang = normLang(lang);
    const messages = buildMessages({ domanda, lang, stile, periodo });

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

    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 175 : 165);
    answer = normalizeOneParagraph(answer);

    if(stile === "wtf"){
      let count=0;
      answer = answer.replace(/\b(bestemmi\w*|imprecazion\w*|anatemi?\b|urlo|sacramentat\w*)\b/gi,
        (m)=> (++count===1 ? m : (lang==="it" ? "imprecazione a mezza voce" : "half-whispered swear")));
    }

    answer = capitalizeAfterPunct(answer);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    if(lang==="it"){
      (function(){
        const d = String(domanda||"");
        const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQuestion = new Set((d.match(nameRx)||[]));
        answer = answer.replace(nameRx, (m)=> inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m) ? m : m.toLowerCase()));
      })();
    }

    return res.status(200).json({ answer, style: stile, lang, periodo, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
