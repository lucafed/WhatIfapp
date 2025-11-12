// /api/ask.js — What?f Engine (Zingara-Realista WHATIF + Friendly-WTF narrativo-vivo)
// - WHATIF: incipit "zingara realista" (sempre, variabile), 60% analisi / 40% immagini sobrie,
//   chiusura con sensazione + gancio. Passato → controfattuale. Futuro → ipotesi vicina.
// - WTF: vivo, caotico ma affettuoso, oggetti naturali (cucina/bar/casa), 1 sola imprecazione organica.
// - Un paragrafo, niente elenchi, niente eco della domanda. Maiuscole ripristinate post-process.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

// Wrapper tollerante: se Upstash non è configurato/non risponde, non bloccare
let rateOk = async () => true;
try {
  rateOk = async (key) => {
    try { const { success } = await rl.limit(key); return !!success; }
    catch { return true; }
  };
} catch { /* noop */ }

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const allow = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : (process.env.NODE_ENV !== "production" ? origin : "");
  if (allow) res.setHeader("Access-Control-Allow-Origin", allow);
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
function hashStr(str=""){ let h=2166136261>>>0; for(const ch of String(str)){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619)>>>0; } return h>>>0; }
function pickDet(arr, seed){ return arr[ arr.length ? (seed % arr.length) : 0 ] || ""; }

/* ========= WHAT IF – esempio di respiro (tono “mio”) ========= */
const WHATIF_HYBRID_EX_IT =
  `Piccolo avviso del cuore, poi il resto: conti alla mano e abitudini in chiaro. ` +
  `Riduci rumore, allunghi fiato: meno frenesia, più spazio mentale. ` +
  `Le giornate diventano più tue — strade note, tempi umani, persone che ti tengono. ` +
  `Non è fuga né eroismo, è manutenzione di vita: sposti peso tra tempo, denaro e relazioni. ` +
  `In cambio della vetrina ottieni consistenza. ` +
  `A fine giornata non senti rimpianto bussare: senti il passo rientrare nel suo passo.`;

/* ======= WHAT IF RULES (tono “mio”) ======= */
const WHATIF_RULE_FUT_IT =
  `WHAT IF (italiano, FUTURO): apri SEMPRE con una riga breve da “zingara realista” (intuitiva, amichevole, 6–14 parole), ` +
  `poi 60% analisi concreta (routine, tempo, costi/benefici, energia, relazioni) + 40% immagini sobrie della quotidianità. ` +
  `Scrivi un futuro vicino che inizia ora: usa futuro/condizionale semplice (“potresti”, “inizierai”, “probabilmente”). ` +
  `Niente certezze assolute, niente dati reali o nomi non forniti. ` +
  `Chiudi con una frase che lasci una sensazione chiara e un piccolo gancio di curiosità. ` +
  `8–10 frasi, seconda persona, un paragrafo, NON ripetere la domanda. ` +
  `Linguaggio semplice, concreto, coinvolgente.`;

const WHATIF_RULE_PAST_IT =
  `WHAT IF (italiano, PASSATO CONTROFATTUALE): apri SEMPRE con una riga breve da “zingara realista”, ` +
  `poi 60% analisi concreta + 40% immagini sobrie. ` +
  `Chiave controfattuale: “se avessi…, avresti…”, “ti saresti trovato…”. ` +
  `Usa condizionale composto, niente date/fatti non forniti. ` +
  `Chiudi con sensazione + micro-gancio. ` +
  `8–10 frasi, seconda persona, un paragrafo, NON ripetere la domanda. ` +
  `Linguaggio semplice, concreto, coinvolgente.`;

/* ========= Incipit dinamici — “ZINGARA REALISTA” ========= */
const ZINGARA_INTROS = {
  it: [
    "Aspetta, che qui il cuore parla chiaro.",
    "Fermati un attimo: lo sento nelle dita.",
    "Oh, questa la vedo nitida.",
    "Piano, che qui c’è un segnale pulito.",
    "Zitto un secondo: l’aria dice già tanto.",
    "Non serve rumore: la risposta bussa piano.",
    "Shh, questa scena arriva dritta.",
    "Occhio: la strada si disegna da sola.",
    "Senti? C’è un passo che torna al suo ritmo.",
    "Eccola: la versione onesta di te."
  ],
  en: ["Hold on — your gut is loud here.","Wait: this comes in clear.","Hush, the picture is sharp."],
  es: ["Espera: esto se ve claro.","Silencio un segundo: ya se siente."],
  fr: ["Attends: ça arrive net.","Chut, ça parle tout seul."],
  de: ["Warte kurz: das wird klar.","Leise, das Bild ist deutlich."],
};

/* ========= Finali “gancio” ========= */
const ZINGARA_ENDINGS = {
  it: {
    future: [
      "E lì ti accorgerai che non serve correre: basta scegliere bene.",
      "E proprio lì capirai che la calma non è rinuncia, è margine.",
      "Da quel punto sentirai la vita rispondere semplice: poco, ma tuo.",
      "E quando ti volterai, vedrai che la fatica stava solo aprendo spazio."
    ],
    past: [
      "Forse oggi lo sentiresti nelle ossa: non era destino, era ritmo.",
      "E ti verrebbe voglia di chiederti un’altra volta: e se lo facessi adesso?",
      "Ti ritroveresti a pensare che alcune strade restano aperte, anche tardi.",
      "E capirai che quel rimpianto non morde: invita a provare meglio, adesso."
    ]
  }
};

function ensureZingaraEnding({ text, lang, periodo, domanda }){
  let s = String(text||"").trim();
  const last = (s.match(/([^.!?…]+[.!?…])\s*$/)||[])[1] || s;
  const alreadyHasHook = /(ti accorgerai|capirai|ti verrà voglia|ti ritroverai|e lì|e proprio lì|da quel punto|forse oggi)/i.test(last);
  if(alreadyHasHook) return s;
  const L = normLang(lang);
  const pool = (ZINGARA_ENDINGS[L] || ZINGARA_ENDINGS.it) || {};
  const bag = String(periodo).toLowerCase() === "past" ? (pool.past || ZINGARA_ENDINGS.it.past) : (pool.future || ZINGARA_ENDINGS.it.future);
  const addon = pickDet(bag, hashStr((domanda||"")+s));
  if(!addon) return s;
  s = s.replace(/[.!?…]+$/,'');
  return `${s}. ${addon}`;
}

/* ========= WTF — NATURALE, OGGETTI VIVI ========= */
const WTF_OBJECTS = [
  "neon del bar che sfrigola",
  "frigorifero che borbotta",
  "moka che sbuffa",
  "bicchiere che suda",
  "sedia che scricchiola",
  "telefono che vibra a vuoto",
  "specchio che ti guarda di traverso",
  "pioggia che picchietta sul vetro",
];
const WTF_DRINK_LINES = [
  "ti versi un dito e rientri nei bordi",
  "fai un sorso corto e respiri meglio",
  "brindi a bassa voce e rimetti in fila i pensieri",
  "tieni il bicchiere fermo e lasci passare l’onda",
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const baseRules = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;

  const msgs = [ { role: "system", content: baseRules } ];

  if(stile === "wtf"){
    // seed deterministico (varia senza oscillare troppo)
    let seed=[...String(domanda)].reduce((a,c)=>a+c.charCodeAt(0),0);
    function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; }
    const objCount = 2 + Math.floor(rnd()*2); // 2–3 oggetti
    const objs = [...WTF_OBJECTS].sort(()=>rnd()-0.5).slice(0,objCount);
    const drink = WTF_DRINK_LINES[Math.floor(rnd()*WTF_DRINK_LINES.length)];

    const WTF_RULE_IT =
      `WHAT THE F (italiano): tono vivo, ironico, affettuoso. ` +
      `Niente surrealismi gratuiti: oggetti quotidiani (cucina/bar/casa) che reagiscono in modo naturale e breve. ` +
      `Una SOLA imprecazione breve e organica (interiezione, non offesa a persone; suona vera, quasi sussurrata). ` +
      `Struttura libera ma ritmata: presa in giro affettuosa → piccoli imprevisti concreti → imprecazione naturale mentre due cose vanno storte ` +
      `→ reazioni degli oggetti (${objs.join(", ")}) a ruota bassa → ${drink} → 1–2 frasi che rispondono davvero → chiusa calda e ironica. ` +
      `6–8 frasi, registro parlato, niente epica.`;

    const WTF_RULE_EN =
      `WHAT THE F (English): lively, ironic, caring. No absurdist gadgets; use everyday objects reacting naturally. ` +
      `ONE brief, organic expletive (interjection; never aimed at people). Free but tight rhythm: gentle tease → small concrete mishaps ` +
      `→ natural expletive as two things clash → objects react (${objs.join(", ")}) → ${drink} → 1–2 lines that truly answer → warm, ironic close. 6–8 sentences.`;

    msgs.push(
      { role: "system", content: L==="en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content:
        `ESEMPI VINCOLANTI (tono/ritmo IT):\n` +
        `- Oh santo cielo… di nuovo quella storia. Metti il telefono giù, provi a fare il duro, poi il neon sfrigola e il frigorifero borbotta: ` +
        `ti parte un’imprecazione bassa, quasi per stanchezza. La moka sbuffa, il bicchiere suda, la sedia protesta. ` +
        `Fai un sorso, rimetti in fila i pensieri: se ci torni, che sia per scrivere nuovo — non per riascoltare un disco graffiato.` },
      { role: "system", content: `PALETTE OGGETTI: ${WTF_OBJECTS.join("; ")}` },
      { role: "system", content: `DRINK LINE: ${drink}` }
    );
  } else {
    // WHAT IF (tono “mio”)
    const ruleIT = String(periodo).toLowerCase() === "past" ? WHATIF_RULE_PAST_IT : WHATIF_RULE_FUT_IT;
    msgs.push(
      { role: "system", content: ruleIT },
      { role: "system", content: `ESEMPIO (respiro/tono):\n${WHATIF_HYBRID_EX_IT}` }
    );
  }

  // Utente finale
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

/* ========= Server-side PCT ========= */
function computePct(domanda, stile){
  const t=String(domanda||"").toLowerCase();
  let s=50;
  if(/\b(7|14|21|30|60|90)\b/.test(t)) s+=12;
  if(/\b\d+([.,]\d+)?\b/.test(t)) s+=8;
  if(/budget|€|euro|spesa|max|under|sotto/.test(t)) s+=6;
  if(/senza|solo|al massimo|minimo|entro|prima delle|ogni|per/.test(t)) s+=8;
  if(/lancia|apri|impara|scrivi|chiedi|corri|studia|automatizza|testa/.test(t)) s+=6;
  if(/forse|magari|maybe|quizás/.test(t)) s-=8;
  if(!/\b\d/.test(t)) s-=6;
  s += (stile==='wtf' ? -4 : +2);
  const pct = Math.max(25, Math.min(92, Math.round(s)));
  return pct;
}

/* ========= WHAT IF: motivazioni (solo quick/manual, MAI surprise) ========= */
function buildWhatIfMotivation(domanda, lang="it", pct=60){
  const L = (lang||"it").slice(0,2);
  const t = String(domanda||"").toLowerCase();

  const hasTime = /\b(7|14|21|30|60|90|giorn|settiman|mes|mesi|anni)\b/.test(t);
  const hasBudget = /(budget|€|euro|spesa|costo|max|under|sotto|caparra)/.test(t);
  const hasDeadline = /(entro|prima|scadenza|deadline)/.test(t);
  const action = /(apri|lancia|impara|studia|scrivi|automatizza|testa|cambia|trova|assumi|costruisci|crea)/.test(t);
  const riskHedging = /(senza|solo|al massimo|minimo|rischio)/.test(t);

  const PFX = (L==="en") ? "Probability" : (L==="es") ? "Probabilidad" : (L==="fr") ? "Probabilité" : (L==="de") ? "Wahrscheinlichkeit" : "Probabilità";
  const MAIN = (L==="en") ? "Main lever" : (L==="es") ? "Palanca principal" : (L==="fr") ? "Levier principal" : (L==="de") ? "Haupthebel" : "La leva principale";
  const BOTTL = (L==="en") ? "Bottleneck" : (L==="es") ? "Cuello de botella" : (L==="fr") ? "Goulet d’étranglement" : (L==="de") ? "Engpass" : "Il collo di bottiglia";

  const parts = [];
  parts.push(`${PFX} ${pct}%:${L==="en"?"":" "}`);

  if(hasTime) parts.push(L==="en" ? "timeline manageable if you distribute effort weekly" : "la timeline è gestibile se distribuisci lo sforzo su base settimanale");
  else parts.push(L==="en" ? "feasible with steady daily cadence" : "fattibile con cadenza giornaliera costante");

  if(hasBudget) parts.push(L==="en" ? "(costs controlled via deposits/small tools)" : "(costi sotto controllo con caparra/strumenti leggeri)");
  if(hasDeadline) parts.push(L==="en" ? "locking the key decision early reduces friction" : "bloccare la decisione chiave in anticipo riduce l’attrito");
  if(action) parts.push(L==="en" ? "focus on one concrete step per day" : "punta a un passo concreto al giorno");
  if(riskHedging) parts.push(L==="en" ? "and cap risk with simple constraints" : "e metti un tetto al rischio con vincoli semplici");

  const s1 = parts.join(" ").replace(/\s{2,}/g," ").trim();

  let s2 = "";
  if(hasBudget){
    s2 = (L==="en")
      ? `${MAIN}: upfront deposit & recurring small costs. ${BOTTL}: traffic/lead flow.`
      : `${MAIN}: anticipo e micro-costi ricorrenti. ${BOTTL}: flusso di traffico/lead.`;
  }else if(hasTime){
    s2 = (L==="en")
      ? `${MAIN}: weekly rhythm. ${BOTTL}: context switching.`
      : `${MAIN}: ritmo settimanale. ${BOTTL}: cambi di contesto.`;
  }else{
    s2 = (L==="en")
      ? `${MAIN}: consistent routine. ${BOTTL}: scope creep.`
      : `${MAIN}: routine consistente. ${BOTTL}: allargamento dello scope.`;
  }

  return `${s1} ${s2}`.trim().replace(/\s{2,}/g," ");
}

/* ========= WTF: rapporto scientifico demenziale ========= */
function scientificReportDemenziale(domanda, lang="it"){
  function h(s=""){ let x=0; for(const c of s) x=(x*131 + c.charCodeAt(0))>>>0; return x>>>0; }
  const seed = h(domanda||"");
  const pick = (arr)=> arr[ seed % arr.length ];

  const UNI = [
    "Dipartimento di Metafisica Applicata – Università di Busto Arsizio Est",
    "Politecnico delle Scuse Creative",
    "Istituto Europeo di Scienze Baristiche",
    "Laboratorio di Statistiche Improbabili",
    "Centro Studi di Fisica dell’Umore",
    "Accademia Transalpina delle Decisioni Avventate",
  ];
  const JOUR = [
    "Rivista di Fisica dell’Umore",
    "Giornale Internazionale di Scuse Quantistiche",
    "Annali di Metodologie Poco Replicabili",
    "Quaderni di Ergonomia dell’Anima",
  ];
  const EFFECT = [
    "imprecazione calibrata",
    "brindisi di manutenzione",
    "tapparelle giudicanti",
    "ventilatore che gira al contrario “per rispetto”",
    "lampada che lampeggia “ti capisco” in Morse",
  ];
  const METRIC = ["r=0.82","p=0.047","η²=0.31","β=0.67","AUC=0.73","OR=2.1"];

  const u = pick(UNI);
  const j = pick(JOUR);
  const e = pick(EFFECT);
  const m = pick(METRIC);
  const n = 30 + (seed % 70);

  if((lang||"it").startsWith("en")){
    return `Scientific-ish report: ${u} (n=${n}) found that a ${e} improves decision clarity (${m}). Peer-reviewed by ${j}, probably.`;
  }
  return `Rapporto scientifico (più o meno): ${u} (n=${n}) rileva che “${e}” migliora la chiarezza decisionale (${m}). Revisione a cura di ${j}, forse.`;
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const ok = await rateOk(`ask:${ip}`);
    if(!ok) return res.status(429).json({ error:"rate_limited_minute" });

    const bodyRaw = typeof req.body === "string" ? req.body : JSON.stringify(req.body||{});
    const body = bodyRaw ? (typeof req.body === "string" ? JSON.parse(bodyRaw) : (req.body||{})) : {};
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      lang  = "it",
      periodo = "future", // "future" | "past"
      micro = {},
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

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

    // ===== Post-process (ordine CORRETTO) =====
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);

    // 1) Incipit ZINGARA sempre (solo WHAT IF)
    if (stile === "whatif") {
      answer = addDynamicIntroIfWhatIf({ answer, stile, lang, domanda });
    }

    // 2) Moderazioni leggere IT (prima del ripristino maiuscole)
    if(normLang(lang)==="it"){
      (function(){
        const d=String(domanda||"");
        const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQuestion=new Set((d.match(nameRx)||[]));
        answer=answer.replace(nameRx,(m)=>{
          if (["Ah","Oh","Ehi","Sai","Shh","Occhio","Piano","Fermati","Aspetta"].includes(m)) return m;
          return inQuestion.has(m) ? m : m.toLowerCase();
        });
      })();
    }

    // 3) Ripristina maiuscole
    answer = sentenceCaseAll(answer);

    // 4) Finale emozionale con gancio se manca (solo WHAT IF)
    if (stile === "whatif") {
      answer = ensureZingaraEnding({ text: answer, lang, periodo, domanda });
    }

    // 5) Punteggiatura finale
    answer = finalPunct(answer);

    // ===== Extra payload =====
    const L = normLang(lang);
    const pct = computePct(domanda, stile);

    // Sorgente richiesta (Spunti rapidi / Manuale / Sorprendimi)
    const src = String(micro?.src || "").toLowerCase();
    const isSurprise = (src === "surprise") || micro.surprise === true;
    const isQuick = (src === "quick" || src === "spunti" || src === "hints" || micro.quick === true);
    const isManual = (src === "manual") || (!src); // default manuale se non specificato

    // Motivazioni SOLO per WHAT IF e SOLO in Spunti Rapidi o Manuale; MAI in Sorprendimi
    const motivation = (stile === "whatif" && !isSurprise && (isQuick || isManual))
      ? buildWhatIfMotivation(domanda, L, pct)
      : undefined;

    // Scientific per WTF (lasciato), escluso se sorpresa
    const scientific = (stile === "wtf" && !isSurprise) ? scientificReportDemenziale(domanda, L) : undefined;

    return res.status(200).json({
      answer,
      style: stile,
      lang: L,
      periodo,
      model: MODEL,
      pct,
      motivation,   // presente solo se (whatif && !surprise && (quick||manual))
      scientific,   // per wtf, non in “sorprendimi”
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}

/* ========= Incipit Zingara (aggiunta) ========= */
function addDynamicIntroIfWhatIf({ answer, stile, lang, domanda }){
  if(stile !== "whatif") return answer;
  const L = normLang(lang);
  const bank = ZINGARA_INTROS[L] || ZINGARA_INTROS.it;
  const intro = pickDet(bank, hashStr(domanda || answer));
  const a = String(answer||"").trim();
  const first = (a.match(/^([\s\S]*?[.!?…])/)||[])[1] || a;
  const already = bank.some(s => normLine(first).startsWith(normLine(s)));
  if(already) return a;
  return `${intro} ${a}`.trim();
  }
