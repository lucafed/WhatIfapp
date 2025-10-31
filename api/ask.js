// /api/ask.js — What?f Engine (RESTORE WHATIF + FUNNIER WTF REACTIONS)
// IT focus. Stili: whatif("analitico" | "reale") · wtf
// Un paragrafo, seconda persona, niente elenchi, niente nomi inventati.

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
const S = (x) => String(x || "");
function normLine(s=""){ return S(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts = S(text).replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; if(p.split(/\s+/).length<=3 && !/[.!?]$/.test(p)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=S(text).split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){ return S(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){
  const d=S(domanda).replace(/[“”"']/g,"").trim().toLowerCase(); let t=S(text);
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  return t.replace(rx,"");
}
function ensureSentenceCase(s=""){ const t=s.trim(); return t? t[0].toUpperCase()+t.slice(1):s; }
function finalPunct(s=""){ return /[.!?…]$/.test(s)? s : s+"."; }

/* ========= Temporal ========= */
function temporalInstruction(periodo="future"){
  if(String(periodo).toLowerCase()==="past"){
    return "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi fissi (TUOI) ========= */
const WHATIF_ANALITICO_RX = `Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const WHATIF_POETICO_RX = `Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — few-shots “buoni” ========= */
const FEWSHOT_WTF = [
  `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
  `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
  `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

/* ========= Regole di stile ========= */
function baseRules(){
  return `REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Solo seconda persona. Mantieni ESATTAMENTE lo stile degli esempi utente.`;
}
function whatIfAnaliticoRule(){
  return `WHAT IF Analitico (italiano). Incipit come nell’esempio (“Sai Luca…” o variante breve). Tono concreto (routine, scambi, costi/benefici, qualità della vita). 8–10 frasi, chiusura calma. Evita immagini liriche non necessarie.`;
}
function whatIfPoeticoRule(){
  return `WHAT IF Reale/Poetico (italiano). DEVI iniziare con “Bella questa, Luca.” (o “Bella questa — me l’aspettavo da te.”). Frasi brevi (6–14 parole). Immagini quotidiane sensoriali (aria, luce, vicoli, mani, caffè). Vietati termini analitici: costi, stipendi, budget, percentuali, economia, trade-off, KPI, ROI, affitti, margini, prezzi. Presente o futuro vicino. Chiusura riconciliata come nell’esempio.`;
}
function wtfFriendlyRule(){
  return `WHAT THE F (amichevole e demenziale). 6–8 frasi. Sequenza RIGOROSA: presa in giro affettuosa (1–2 frasi) → 2–3 micro-imprevisti pertinenti → UNA sola “bestemmia” teatrale (mai contro persone) → SUBITO 2–3 reazioni di oggetti demenziali ma attinenti → sorso alcolico → 1–2 frasi che rispondono davvero → morale ironica variabile.`;
}

/* ========= WTF — reazioni demenziali contestuali ========= */
const REACT_DEMENZ = {
  bar: [
    "la moka fa una standing ovation a vapore",
    "il POS recita un rosario di errori e poi si benedice",
    "il macinino tossisce in quattro quarti come un jazzista asmatico",
    "la tazzina applaude in porcellana e chiede il bis",
  ],
  strada: [
    "il semaforo passa al rosso per rispetto",
    "il monopattino inchina il manubrio come fosse a teatro",
    "il cartello di stop fa l’occhiolino e poi arrossisce",
  ],
  casa: [
    "la lampada sfarfalla in Morse e pare dirti «ricevuto»",
    "il frigorifero sospira e diventa minimalista",
    "la tapparella si abbassa per imbarazzo e poi sbircia",
  ],
  amore: [
    "Alexa finge un aggiornamento e scappa in ‘non disturbare’",
    "il divano ti offre l’angolo VIP e poi ti giudica",
    "la pianta applaude con due foglie e si sente utile",
  ],
  default: [
    "il ventilatore gira al contrario per educazione",
    "la statua si copre gli occhi e sbircia tra le dita",
    "il citofono squilla in solidarietà e poi si pente",
  ],
};
function tagsFromQuestion(q){
  const s = S(q).toLowerCase();
  return {
    bar: /bar|caff[eè]|moka|bancone|cappuccino|espresso/.test(s),
    strada: /moto|strada|semaforo|traffico|auto|motorino|monopattino/.test(s),
    casa: /casa|cucina|frigor|lampada|tapparella|salotto|stanza/.test(s),
    amore: /amore|ragazzo|ragazza|relazione|ex|cuore|messagg/.test(s),
  };
}
function pick(arr, n=1){
  const out=[], used=new Set();
  while(out.length<n && used.size < arr.length){
    const i = Math.floor(Math.random()*arr.length);
    if(used.has(i)) continue;
    used.add(i); out.push(arr[i]);
  }
  return out;
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, periodo, stile, mode }){
  const msgs = [
    { role: "system", content: baseRules() },
    { role: "system", content: temporalInstruction(periodo) },
  ];

  if (stile === "wtf") {
    msgs.push(
      { role: "system", content: wtfFriendlyRule() },
      { role: "system", content: `ESEMPI VINCOLANTI (tono/ritmo):\n- ${FEWSHOT_WTF[0]}\n- ${FEWSHOT_WTF[1]}\n- ${FEWSHOT_WTF[2]}` }
    );
  } else {
    if (mode === "analitico") {
      msgs.push(
        { role: "system", content: whatIfAnaliticoRule() },
        { role: "system", content: `ESEMPIO (Analitico)\n${WHATIF_ANALITICO_RX}` },
      );
    } else {
      msgs.push(
        { role: "system", content: whatIfPoeticoRule() },
        { role: "system", content: `ESEMPIO (Reale/Poetico)\n${WHATIF_POETICO_RX}` },
      );
    }
  }

  msgs.push({
    role: "user",
    content: `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO a paragrafo unico.`
  });
  return msgs;
}

/* ========= Guardie POETICO (anti-analitico + incipit + ritmo) ========= */
const ANALYTIC_RX = /\b(costi|benefici|costo|beneficio|budget|percentuali?|margini?|economia|pil|inflazione|affitt[i|o]|stipend[i|o]|benchmark|metriche|analisi|trade[- ]?off|contesto|iniziativ[ae]|prezz[oi]|spes[ae]|risparmi|kpi|roi)\b/gi;
function softenAnalyticLexicon(s){
  return s.replace(ANALYTIC_RX, (m)=>({
    costi:"spigoli", benefici:"comodità", costo:"spigolo", beneficio:"comodità",
    budget:"misura", percentuale:"parte", percentuali:"parti", margini:"bordi",
    economia:"ritmo", pil:"fiato", inflazione:"fiato corto", affitto:"casa", affitti:"case",
    stipendi:"paghe", stipendio:"paga", benchmark:"paragoni", metriche:"misure",
    analisi:"sguardo", "trade off":"scambio", "trade-off":"scambio", contesto:"intorno",
    iniziativa:"gesto", iniziative:"gesti", prezzo:"prezzo", prezzi:"prezzi",
    spesa:"spesa", spese:"spese", risparmi:"metti da parte", kpi:"misure", roi:"ritorno"
  }[m.toLowerCase()]||"respiro"));
}
function poeticRythm(s){
  let t = s.replace(/,\s+/g,". ").replace(/\s{2,}/g," ");
  t = t.split(/(?<=[.!?])\s+/).map(line=>{
    const words=line.trim().split(/\s+/);
    if(words.length>16){
      const cut = 10 + Math.floor(Math.random()*3);
      line = words.slice(0,cut).join(" ") + ". " + words.slice(cut).join(" ");
    }
    return line.trim();
  }).join(" ");
  return t;
}
function enforcePoetic(text){
  let t = text.trim();
  if (!/^Bella questa[,— ]+Luca/i.test(t)) t = "Bella questa, Luca. " + t;
  t = softenAnalyticLexicon(t);
  t = poeticRythm(t);
  return t;
}

/* ========= Post-process WTF ========= */
const IMPREC_RX=/\bbestemmi\w*|imprecazion\w*|sacrament\w*|anatema\w*|urlo liturgico|madonna della miseria/gi;
function keepSingleImprecazione(answer){
  let c=0;
  return answer.replace(IMPREC_RX,(m)=> (++c===1? m : "imprecazione a mezza voce"));
}
function ensureAlcohol(answer){
  if(/\b(grappa|amaro|rosso|vino|spritz|negroni|whisky|rum|birra|calice|goccio|dito|brindisi)\b/i.test(answer)) return answer;
  return finalPunct(answer)+" Ti versi un goccio di rosso e il mondo si rimette in riga.";
}
function limitExclamations(s){ return s.replace(/!{3,}/g,"!!"); }
function forbidInsults(s){ return s.replace(/\b(cazzo|cazzata|stronzo|idiota|cretino|imbecille)\b/gi,"accidente"); }

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
    const { domanda = "", stile = "whatif", mode = "analitico", periodo = "future" } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    // Reazioni demenziali coerenti con la domanda (per WTF)
    const tags = tagsFromQuestion(domanda);
    const pools = [];
    if (tags.bar) pools.push(...REACT_DEMENZ.bar);
    if (tags.strada) pools.push(...REACT_DEMENZ.strada);
    if (tags.casa) pools.push(...REACT_DEMENZ.casa);
    if (tags.amore) pools.push(...REACT_DEMENZ.amore);
    if (pools.length===0) pools.push(...REACT_DEMENZ.default);
    const chosenReacts = pick(pools, 2 + Math.floor(Math.random()*2)); // 2 o 3

    const messages = buildMessages({ domanda, periodo, stile, mode });

    // Inserisco un “seed” invisibile per spingere quelle reazioni specifiche
    if (stile === "wtf") {
      messages.push({ role:"system", content:`REACTIONS TO USE (choose ${chosenReacts.length}):\n- ${chosenReacts.join("\n- ")}` });
      messages.push({ role:"system", content:`RICORDA SEQUENZA: imprevisti → IMPRECAZIONE (una) → REAZIONI (queste) → drink → risposta → morale.` });
    }

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (mode === "analitico" ? 0.82 : 0.86),
      top_p: 0.92,
      max_tokens: 520,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process comune
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);

    if (stile === "wtf") {
      answer = keepSingleImprecazione(answer);
      answer = forbidInsults(answer);
      answer = limitExclamations(answer);
      answer = ensureAlcohol(answer);
    } else if (mode !== "analitico") {
      // Poetico/Reale — differenziato dall’analitico
      answer = enforcePoetic(answer);
    }

    // No 1a persona forte
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, "");

    // Evita nomi non presenti nella domanda (lascia interiezioni tipo “Ah, Oh, Bella, Sai”)
    (function(){
      const d=S(domanda); const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion=new Set(d.match(nameRx)||[]);
      answer = answer.replace(nameRx, (m)=> inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m)? m : m.toLowerCase()));
    })();

    answer = ensureSentenceCase(answer);
    answer = finalPunct(answer);

    return res.status(200).json({ answer, style: stile, mode, periodo, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
