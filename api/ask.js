// /api/ask.js — What?f Engine (Stable Hybrid WHATIF + Friendly-WTF Demenziale)
// - WHATIF: stile unico 60% analisi / 40% immagini sobrie. Incipit analitico (no “Bella Luca”).
//   MOD: aggiunto INCIPIT DINAMICO post-process (no cambio prompt).
// - WTF: come da tuoi esempi, 2–3 reazioni DEMENZIALI, una sola “imprecazione” teatrale, sorso alcolico, risposta vera, morale. (INVARIATO)
// - MOD: seconda chiamata leggera per meta: WHAT IF -> {pct, motivation} ; WTF -> {pct, scientific_report}.
// - Maiuscole sistemate post-process dopo punto / “…”.
// - Un paragrafo, niente elenchi, niente eco della domanda.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MODEL_EXTRACT = process.env.OPENAI_MODEL_EXTRACT || MODEL; // per estrazione meta

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
  // Metti maiuscola dopo (. ? ! …) + gestione virgolette semplici
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g, (m,prefix,chr)=> prefix + chr.toUpperCase());
}
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

/* ========= WHAT IF – stile 60/40 (analitico + immagini sobrie) ========= */
const WHATIF_HYBRID_EX_IT = `Sai, questa non è una domanda leggera. Guardi i numeri, poi guardi le abitudini: costi più bassi da una parte, occasioni più larghe dall’altra. La qualità della vita non è un grafico, è una routine: tempi di spostamento, servizi che funzionano, persone che senti vicine. Se stringi, il portafoglio respira un po’ di più; in cambio accetti un ritmo meno veloce e meno “vetrine” da inseguire. Le giornate si accorciano di frenesia e si allungano di fiato: un caffè fatto bene, una strada che conosci, un’aria che sa di casa. Non è una fuga né un eroismo: è ingegneria quotidiana, spostare pesi tra tempo, denaro e relazioni. A conti fatti, potresti guadagnare spazio mentale e perdere solo rumore. E quando la sera chiudi la porta, non senti il rimpianto bussare: senti il tuo passo tornare al suo passo.`;

const WHATIF_RULE_IT = `WHAT IF HYBRID (italiano): 60% analisi concreta (costi/benefici, routine, qualità di vita), 40% immagini sobrie della quotidianità. Incipit analitico nello stile: “Sai, questa non è una domanda leggera.” Vietato iniziare con “Bella questa”. 8–10 frasi. Seconda persona. Una sola risposta a paragrafo unico. Niente eco della domanda.`;

/* ========= WTF — banche demenziali ========= */
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

/* ========= WHAT IF — INCIPIT DINAMICI (post-process) ========= */
const INTRO_BANK = {
  it: [
    "La stanza è uguale, ma lo sguardo no.",
    "Prima respiri, poi scegli il passo.",
    "Dove guardi cambia ciò che vedi.",
    "Non serve rumore per muovere l’ago.",
    "È già un inizio.",
    "La traiettoria si sposta di un grado.",
    "Piccolo movimento, grande differenza.",
    "La calma apre una porta laterale.",
    "Comincia dove i dubbi fanno spazio.",
    "Ogni decisione è un prototipo."
  ],
  en: [
    "Same room, different gaze.",
    "Breathe first, then step.",
    "Where you look changes what you see.",
    "No noise needed to move the needle.",
    "It's already a beginning.",
    "A one-degree shift changes the route.",
    "Small move, big difference.",
    "Calm opens a side door.",
    "Start where doubt makes space.",
    "Every decision is a prototype."
  ],
  es: [
    "La habitación es la misma, tu mirada no.",
    "Respira primero, luego avanza.",
    "Donde miras cambia lo que ves.",
    "Ya es un comienzo.",
    "Un grado cambia el rumbo."
  ],
  fr: [
    "Même pièce, autre regard.",
    "Respire d’abord, puis avance.",
    "Là où tu regardes change ce que tu vois.",
    "C’est déjà un début."
  ],
  de: [
    "Gleicher Raum, anderer Blick.",
    "Erst atmen, dann Schritt.",
    "Wohin du siehst, ändert, was du siehst.",
    "Es ist bereits ein Anfang."
  ],
};
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function addDynamicIntroIfWhatIf({ answer, stile, lang }){
  if(stile !== "whatif") return answer;
  const L = normLang(lang);
  const bank = INTRO_BANK[L] || INTRO_BANK.it || [];
  if(!bank.length) return answer;
  const intro = pick(bank);
  const first8 = String(answer||"").split(/\s+/).slice(0,8).join(" ").toLowerCase();
  const introLow = intro.toLowerCase();
  const looksDuplicated = first8.includes(introLow.slice(0, Math.min(10, introLow.length)));
  if(looksDuplicated) return answer;
  let out = `${intro} ${answer}`.trim();
  if(out.length > 1200) out = clampWords(out, 165);
  return out;
}

/* ========= Prompt builder (TUO, invariato su WTF) ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const baseRules = L==="en"
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
    // Costruisci semi casuali deterministicamente sulla domanda (per varietà)
    let seed=[...String(domanda)].reduce((a,c)=>a+c.charCodeAt(0),0);
    function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; }
    const impre = WTF_IMPRE[Math.floor(rnd()*WTF_IMPRE.length)];
    const shuffled=[...WTF_REACT].sort(()=>rnd()-0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd()*2)); // 2 o 3
    const drink = WTF_DRINK[Math.floor(rnd()*WTF_DRINK.length)];

    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Struttura OBBLIGATORIA: presa in giro affettuosa (max 2 frasi) → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”, come narrazione, mai insulto a persone) → SUBITO ${react.length} reazioni di oggetti esilaranti → drink (“${drink}”) → 1–2 frasi che rispondono davvero → morale calda e ironica. Tono da barista affettuoso sbronzo-elegante, mai aggressivo. 6–8 frasi.`;
    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). STRICT sequence: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” (narrated, never insulting people) → THEN ${react.length} absurd object reactions → drink (“${drink}”) → 1–2 lines that truly answer → warm ironic moral. 6–8 sentences.`;

    msgs.push(
      { role: "system", content: L==="en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content: `IMPRECATION: ${impre}` },
      { role: "system", content: `REACTIONS:\n- ${react.join("\n- ")}` },
      { role: "system", content: `DRINK: ${drink}` },
      { role: "system", content:
`ESEMPI VINCOLANTI (tono/ritmo IT):
- Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.
- Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.
- Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.` }
    );
  } else {
    msgs.push(
      { role: "system", content: WHATIF_RULE_IT },
      { role: "system", content: `ESEMPIO (respiro e tono):\n${WHATIF_HYBRID_EX_IT}` }
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

/* ========= Estrattore meta (seconda chiamata, robusta) ========= */
async function extractMeta({ domanda, answer, stile, lang }) {
  const L = normLang(lang);
  const sys = (L==="en")
    ? `You extract concise metadata. Output strictly JSON.`
    : `Estrai metadati concisi. Produci strettamente JSON.`;

  const base =
    (L==="en")
      ? `From the question and the answer, compute a realistic probability 0..100 and provide a compact rationale paragraph.`
      : `Dalla domanda e dalla risposta, calcola una percentuale realistica 0..100 e fornisci un paragrafo conciso di motivazione.`;

  const taskIF =
    (L==="en")
      ? `Return JSON: {"pct": <integer>, "motivation": "<one compact paragraph in ${L}>"}`
      : `Restituisci JSON: {"pct": <integer>, "motivation": "<paragrafo conciso in ${L}>"}`;

  const taskWTF =
    (L==="en")
      ? `Return JSON: {"pct": <integer>, "scientific_report": "<one compact scientific-style paragraph in ${L}>"}`
      : `Restituisci JSON: {"pct": <integer>, "scientific_report": "<paragrafo conciso in stile scientifico in ${L}>"}`;

  const userMsg =
    (L==="en")
      ? `QUESTION: ${domanda}\nANSWER: ${answer}\n${base}\n${stile==="whatif" ? taskIF : taskWTF}\nNo markdown. No commentary.`
      : `DOMANDA: ${domanda}\nRISPOSTA: ${answer}\n${base}\n${stile==="whatif" ? taskIF : taskWTF}\nSenza markdown. Senza commenti.`;

  const comp = await client.chat.completions.create({
    model: MODEL_EXTRACT,
    temperature: 0.2,
    max_tokens: 220,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userMsg }
    ],
  });

  const raw = comp?.choices?.[0]?.message?.content || "";
  try{
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if(start>=0 && end>=start){
      const data = JSON.parse(raw.slice(start, end+1));
      let pct = Number.isFinite(+data.pct) ? Math.max(0, Math.min(100, Math.round(+data.pct))) : undefined;
      let motivation = data.motivation ? String(data.motivation).trim() : undefined;
      let scientific_report = data.scientific_report ? String(data.scientific_report).trim() : undefined;
      return { pct, motivation, scientific_report };
    }
  }catch{}
  return { pct: undefined, motivation: undefined, scientific_report: undefined };
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

    // 1) Genera risposta (comportamento originale)
    const messages = buildMessages({ domanda, lang, periodo, stile, micro });

    const completion = await client.chat.completions.create({
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
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Incipit dinamico SOLO per WHAT IF (post-process, non tocco il prompt)
    answer = addDynamicIntroIfWhatIf({ answer, stile, lang });

    // Moderazioni leggere IT
    if(normLang(lang)==="it"){
      (function(){
        const d=String(domanda||"");
        const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQuestion=new Set((d.match(nameRx)||[]));
        answer=answer.replace(nameRx,(m)=> inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Sai"].includes(m) ? m : m.toLowerCase()));
      })();
    }

    // 2) Estrazione meta per riquadro motivazioni
    let pct, motivation, scientific_report;
    try{
      const meta = await extractMeta({ domanda, answer, stile, lang });
      pct = meta.pct;
      motivation = meta.motivation;
      scientific_report = meta.scientific_report;
    }catch{
      pct = undefined; motivation = undefined; scientific_report = undefined;
    }

    return res.status(200).json({
      answer,
      style: stile,
      lang: normLang(lang),
      periodo,
      model: MODEL,
      pct,
      motivation,
      scientific_report
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
