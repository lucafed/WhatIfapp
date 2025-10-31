// /api/ask.js — What?f Engine (FULL • Analitico≠Poetico • WTF demenziale coerente)
// © 2025 — Luca edition

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL  = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

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
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helper testo ========= */
function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue;
    if(p.split(/\s+/).length<=3 && !/[.!?]$/.test(p)) continue;
    out.push(p); seen.add(n); if(out.length>=maxSentences) break;
  }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){
  return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ")
    .replace(/\.\.\.+/g,"…").replace(/\s+([.,;:!?])/g,"$1").trim();
}
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,""); return t;
}

/* ========= Tempo ========= */
function temporalInstruction(periodo="future"){
  if(String(periodo).toLowerCase()==="past"){
    return "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi originali con incipit ========= */
const WHATIF_ANALITICO_RX =
`Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const WHATIF_POETICO_RX =
`Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — esempi originali + reazioni demenziali ========= */
const FEWSHOT_WTF_IT = [
  `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
  `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
  `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

const WTF_REACTIONS_SUPER = [
  "la moka fa una standing ovation a vapore e proclama santo il caffè",
  "il POS fa la cresima da solo e si mette in «pentito»",
  "la lampada sfarfalla in Morse e chiede un autografo",
  "il frigorifero sospira, congela il senso di colpa e fa finta di niente",
  "la tapparella si abbassa per imbarazzo e poi risale per spettegolare",
  "il campanile tossisce un amen stonato e ti benedice in ritardo",
  "Alexa finge un aggiornamento infinito ed entra in clausura digitale",
  "i bicchieri applaudono in cristallo e chiedono il bis",
  "il ventilatore gira al contrario per educazione monastica",
  "il citofono suona per solidarietà e poi si pente",
];

function pickN(arr, nMin, nMax){
  const n = Math.max(nMin, Math.min(nMax, Math.floor(Math.random()*(nMax-nMin+1))+nMin));
  const copy=[...arr]; const out=[];
  while(out.length<n && copy.length){ out.push(copy.splice(Math.floor(Math.random()*copy.length),1)[0]); }
  return out;
}

/* ========= Istruzioni stile ========= */
const WHATIF_ANALITICO_RULE =
`WHAT IF Analitico (italiano).
- Incipit obbligatorio nello stile: “Sai Luca, …”.
- Tono concreto: affitti, bollette, stipendi, trasporti, routine, servizi, reti locali vs multinazionali, tempo libero.
- Evita immagini liriche/sensoriali. Nessuna poesia, niente “aria che saluta”.
- 135–155 parole. Seconda persona. Chiusura calma come nell’esempio.`;

const WHATIF_POETICO_RULE =
`WHAT IF Reale/Poetico (italiano).
- Incipit obbligatorio nello stile: “Bella questa, Luca.”.
- Immagini quotidiane sobrie (aria, vicoli, bar, risate nei portoni). Nessun lessico economico/Excel.
- 135–155 parole. Seconda persona. Chiusura riconciliata come nell’esempio.`;

/* ========= WTF prompt builder (demenziale coerente) ========= */
function wtfMessages(domanda){
  // se la domanda parla di bar/caffè, preferisci reazioni ad hoc
  const rxBar = /(bar|bancone|caff[eè]|moka|tazz|pos)/i;
  const pool = rxBar.test(domanda)
    ? [
        "la moka fa una standing ovation a vapore e proclama santo il caffè",
        "il POS fa la cresima da solo e si mette in «pentito»",
        "i bicchieri applaudono in cristallo e chiedono il bis",
        "la lampada sfarfalla in Morse e chiede un autografo",
      ]
    : WTF_REACTIONS_SUPER;
  const reacts = pickN(pool, 2, 3);

  const RULE =
`WHAT THE F — copia esatta del tono/ritmo dei TRE ESEMPI.
OBBLIGHI (un solo paragrafo, 6–8 frasi):
1) Apertura con presa in giro affettuosa (1–2 frasi).
2) 2–3 micro-imprevisti realistici legati al contesto della domanda.
3) UNA sola “bestemmia” teatrale (mai contro persone), nello stesso stile dei tuoi esempi.
4) SUBITO 2–3 reazioni demenziali di oggetti, scelte tra: ${reacts.join(" · ")}.
5) DRINK alcolico (grappa, amaro, rosso, shot). Vietata l’acqua.
6) 1–2 frasi che rispondono davvero alla domanda.
7) Chiusura ironica calda (niente moraletta generica).`;

  return [
    { role: "system", content: RULE },
    { role: "system", content: `ESEMPI VINCOLANTI (tono/ritmo):\n- ${FEWSHOT_WTF_IT[0]}\n- ${FEWSHOT_WTF_IT[1]}\n- ${FEWSHOT_WTF_IT[2]}` },
  ];
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, periodo, stile, mode }){
  const msgs = [
    { role: "system", content: "REGOLE: un paragrafo unico, niente elenchi, niente emoji, NON ripetere la domanda. Solo seconda persona." },
    { role: "system", content: temporalInstruction(periodo) },
  ];

  if (stile === "wtf") {
    msgs.push(...wtfMessages(domanda));
  } else {
    if (mode === "analitico") {
      msgs.push(
        { role: "system", content: WHATIF_ANALITICO_RULE },
        { role: "system", content: `ESEMPIO (vincolante):\n${WHATIF_ANALITICO_RX}` },
      );
    } else {
      msgs.push(
        { role: "system", content: WHATIF_POETICO_RULE },
        { role: "system", content: `ESEMPIO (vincolante):\n${WHATIF_POETICO_RX}` },
      );
    }
  }

  msgs.push({ role: "user", content: `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO.` });
  return msgs;
}

/* ========= Post-process specializzati ========= */
function keepSingleImprecazione(answer){
  const rx = /\b(bestemmi\w+|imprecazion\w+|anatema|sacramentat\w+|madonna della miseria|urlo liturgico)\b/gi;
  let seen = false;
  return answer.replace(rx,(m)=>{ if(seen) return "imprecazione a mezza voce"; seen=true; return m; });
}
function ensureAlcohol(answer){
  // se parla di acqua, rimpiazza con alcol
  answer = answer.replace(/\b(acqua frizzante|acqua naturale|bicchiere d'acqua|un goccio d'acqua)\b/gi, "un dito di grappa");
  // se non c'è drink, aggiungilo prima della chiusura
  if(!/\b(grappa|amaro|rosso|vino|shot|liquor|birra|whisky|gin|spritz)\b/i.test(answer)){
    answer = answer.replace(/([.!?])\s*([^.!?]*)$/,". Ti versi un goccio di grappa per rimettere in fila i pensieri.$1 $2");
  }
  return answer;
}
function limitExclamations(answer){ return answer.replace(/!{3,}/g,"!!"); }
function forbidInsults(answer){ return answer.replace(/\b(cazzo|cazzata|stronzo|idiota|imbecille)\b/gi,"accidente"); }

/* Split duro What if */
function enforceAnaliticoItaliano(t){
  if(!/^Sai Luca, /i.test(t)) t = "Sai Luca, " + t.replace(/^Bella questa.*?\.\s*/i,"");
  // se prevale lessico poetico, sostituisci con dorsale concreta
  const poet = (t.match(/\b(aria|luce|vicoli|finestre|eco|risate|portoni|amante|orizzonte|profumo|inverno|montagn|voci)\b/gi)||[]).length;
  const anal = (t.match(/\b(affitt|bollett|stipend|costo della vita|trasport|serviz|scuol|sanit|asilo|routine|orari|rete|artigian|multinazional|chilometr|spesa)\b/gi)||[]).length;
  if(poet>anal){
    t = "Sai Luca, qui la scelta si misura nelle cose di ogni giorno: gli affitti pesano meno di altrove, le bollette respirano e i chilometri si accorciano. Il lavoro è più vicino alle reti locali e agli artigiani che alle multinazionali; stipendi forse più bassi, ma spesa e tempo libero ti restituiscono fiato. Trasporti prevedibili, routine che si incastra, servizi scolastici e sanitari senza fronzoli ma affidabili. Le relazioni non devono correre per esistere. Il compromesso è chiaro: meno ampiezza di opportunità, più densità di vita. Se cerchi ritmo sostenibile e facce note, è un passo avanti — lento, ma tuo.";
  }
  return t;
}
function enforcePoeticoItaliano(t){
  if(!/^Bella questa, Luca\./i.test(t)){
    t = t.replace(/^Sai Luca, /i,"");
    t = "Bella questa, Luca. " + t;
  }
  // togli lessico economico
  t = t.replace(/\b(affitt[oi]|bollett[ea]e?|stipend[iio]|budget|costi|benefici|trasport[oi]|serviz[iio]|chilometr[io]|routine|orari|mercato|multinazional[ei]|artigian[oi]|kpi|ottimizzaz\w+)\b/gi,"silenzio");
  return t;
}

/* ========= HANDLER ========= */
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
    const {
      domanda = "",
      stile   = "whatif",     // "whatif" | "wtf"
      mode    = "reale",      // per whatif: "analitico" | "reale"
      periodo = "future",
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, periodo, stile, mode });

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

    // Post-process comune
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf"?8:10);
    answer = clampWords(answer, stile==="wtf"?168:160);
    answer = normalizeOneParagraph(answer);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // WTF speciali
    if(stile==="wtf"){
      answer = keepSingleImprecazione(answer);
      answer = ensureAlcohol(answer);
      answer = limitExclamations(answer);
      answer = forbidInsults(answer);
    }else{
      // WHAT IF split duro
      if(mode==="analitico") answer = enforceAnaliticoItaliano(answer);
      else                   answer = enforcePoeticoItaliano(answer);
    }

    // Niente "io/noi"
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi,"");

    // Evita nomi non presenti nella domanda
    (function(){
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion=new Set((String(domanda).match(nameRx)||[]));
      answer=answer.replace(nameRx,(m)=> inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m) ? m : m.toLowerCase()));
    })();

    return res.status(200).json({ answer, style: stile, mode, periodo, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
