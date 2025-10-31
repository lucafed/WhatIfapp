// /api/ask.js — What?f Engine (ULTRA SPLIT WHATIF • HYSTERICAL WTF REACTIONS • NO WATER)
// Stili: whatif (analitico | reale) · wtf
// Un paragrafo, seconda persona, niente elenchi/emoji, no eco domanda, no nomi inventati.

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
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\.\.\.+/g,"…").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,""); return t;
}
function ensureSentenceCase(s=""){ const t=s.trim(); if(!t) return s; return t[0].toUpperCase()+t.slice(1); }
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

/* ========= Temporal ========= */
function temporalInstruction(periodo="future"){
  if(String(periodo).toLowerCase()==="past"){
    return "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= ESEMPI VINCOLANTI — tuoi ========= */
const WHATIF_ANALITICO_RX = `Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const WHATIF_POETICO_RX = `Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF few-shots (tono vincolante) ========= */
const FEWSHOT_WTF_IT = [
  `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
  `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
  `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

/* ========= WTF — reazioni DEMENZIALI contestuali (2–3 max) ========= */
const REACTIONS_BY_CONTEXT = {
  bar: [
    "la lampada del bancone sfarfalla in Morse e ordina un ristretto col tuo nome",
    "il POS finge la Cresima e si mette in ‘pentito’",
    "la moka fa una standing ovation a vapore e ti propone sindaco del caffè",
    "i bicchieri applaudono in cristallo e si mettono in fila per un autografo",
    "il frigo sospira e congela il senso di colpa"
  ],
  moto: [
    "il semaforo passa al rosso per rispetto e ti fa l’inchino",
    "il casco annuisce da solo come un maestro zen in policarbonato",
    "il cane all’angolo cambia marciapiede e ti augura buona strada",
    "lo specchietto si gira dall’altra parte per non vedere il peccato veniale"
  ],
  amore: [
    "la lampada fa luce dramatica e chiede i diritti d’autore sulla scena",
    "il bicchiere applaude da solo e si rimpinza per compagnia",
    "Alexa finge un aggiornamento a vita e si mette in clausura digitale",
    "la tenda si chiude da sola e lascia un buco per spiare"
  ],
  ufficio: [
    "la stampante sputa un fax del ’98 con scritto «coraggio»",
    "il badge fa tre bip in latino e ti assolve",
    "l’ascensore apre le porte, ti giudica e richiude con tatto",
    "la macchinetta del caffè batte uno scontrino di consolazione"
  ],
  casa: [
    "la tapparella si abbassa per imbarazzo e poi risale per spettegolare",
    "il citofono suona in do minore e poi ti chiede scusa",
    "la sedia scricchiola come applausi educati di teatro serale",
    "la pianta grassa annuisce e ti promuove a giardiniere onorario"
  ],
  cucina: [
    "il tostapane fa un inchino e spara coriandoli di pane",
    "la pentola fischia l’inno nazionale del sugo",
    "il frigorifero si spegne per empatia e poi si riaccende per fame"
  ],
  montagna: [
    "la seggiovia tossisce un amen stonato e ti benedice il ginocchio",
    "il rifugio lampeggia ‘occupato’ per darti importanza",
    "il campanile anticipa la mezz’ora e la dedica a te"
  ],
  mare: [
    "l’ombrellone si chiude da solo e riapre solo se prometti di stare calmo",
    "il bagnasciuga fa applausi a onde corte e poi firma il selfie",
    "il chiosco del lungomare stappa da sé e brinda al tuo destino"
  ],
  default: [
    "la lampada sfarfalla in Morse e pare dirti «ricevuto»",
    "il ventilatore gira al contrario solo per rispetto",
    "il campanello suona in fa diesis e poi arrossisce"
  ]
};
const WTF_IMPRECATIONS = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "vulcano d’anatemi con effetto eco",
  "tromba d’aria di improperi a norma CE"
];
const WTF_DRINKS = [
  "ti versi un goccio di liquore e rimetti a posto i pensieri",
  "prendi un sorso corto di amaro e il mondo si raddrizza",
  "alzi un calice minuscolo: brindisi di manutenzione",
  "bevi un dito di rosso e respiri più largo",
  "butti giù uno shot educato e torni in traiettoria"
];
const WTF_MORALES = [
  "Morale: ridi tu per primo e il resto si arrangia.",
  "Morale: il caos non si doma, gli dai del tu.",
  "Morale: se non si allinea, lo porti a bere e si convince.",
  "Morale: metà fortuna, metà mestiere, zero rancore."
];

/* ========= Regole dure WHAT IF ========= */
const BASE_RULES = `REGOLE GENERALI:
- Un solo paragrafo. Niente elenchi. Niente emoji. NON ripetere la domanda.
- Solo seconda persona. Nessun nome proprio non presente nella domanda.
- Copia esattamente tono, cadenza e respiro degli esempi.`;

const WHATIF_ANALITICO_RULE = `WHAT IF Analitico (vincolante):
- INCIPIT OBBLIGATORIO: “Sai Luca,” (o variante coerente: “Sai, questa domanda…”).
- Lessico SOLO concreto: routine, orari, affitti, bollette, stipendi, chilometri, servizi, reti locali, artigiani, scambi reali.
- VIETATO: immagini/figure poetiche (eco, vicoli che guardano, montagne-amanti, risate che rimbalzano, profumi/vento).
- Cadenza dell’esempio analitico. 135–155 parole. Chiusura calma.`;

const WHATIF_POETICO_RULE = `WHAT IF Reale/Poetico (vincolante):
- INCIPIT OBBLIGATORIO: “Bella questa, Luca.” (o variante strettissima).
- Lessico SOLO sensoriale sobrio: aria, luce, vicoli, finestre, passi, mani, caffè corto e ruvido, voci, risate, inverno/vento, orizzonte vero.
- VIETATO: gergo analitico (costi/benefici, budget, KPI, ottimizzazione, affitto/bollette/ stipendi).
- Cadenza dell’esempio poetico. 135–155 parole. Chiusura riconciliata.`;

/* ========= Costruzione WTF con reazioni contestuali ========= */
function pick(arr, n=1){
  const out=[], used=new Set();
  while(out.length<n && used.size<arr.length){
    const i=Math.floor(Math.random()*arr.length);
    if(used.has(i)) continue; used.add(i); out.push(arr[i]);
  }
  return out;
}
function detectContext(domanda=""){
  const d = domanda.toLowerCase();
  if(/bar|caff[eè]|bancone|moka|pos|latte/.test(d)) return "bar";
  if(/moto|casco|motore|strada|sem[af]oro/.test(d)) return "moto";
  if(/amore|relazione|cuore|lui|lei|partner|messaggi|ghost/.test(d)) return "amore";
  if(/ufficio|badge|stampante|riunione|colleghi|manager/.test(d)) return "ufficio";
  if(/casa|divano|citofono|tapparella|sedia|pianta/.test(d)) return "casa";
  if(/cucina|fornelli|tostapane|frigo|pentola/.test(d)) return "cucina";
  if(/montagna|rifugio|neve|seggiovia|sentiero/.test(d)) return "montagna";
  if(/mare|spiaggia|chiosco|ombrellone|bagnasciuga/.test(d)) return "mare";
  return "default";
}
function wtfSeeds(domanda){
  const ctx = detectContext(domanda);
  const pool = REACTIONS_BY_CONTEXT[ctx] || REACTIONS_BY_CONTEXT.default;
  const reacts = pick(pool, 2 + Math.floor(Math.random()*2)); // 2–3
  const opening = pick([
    "Ah ma guarda te… contrattando col destino a colpi di caffè",
    "Oh eccoti: campione mondiale di complicarti la vita con stile",
    "Bella mossa: vuoi vincere in salita con il sorriso",
    "Uè, specialista in problemi artigianali fatti a mano"
  ],1)[0] + (Math.random()<0.7? ": testa dura, cuore tenero, timing discutibile." : ".");
  const impre = pick(WTF_IMPRECATIONS,1)[0];
  const drink = pick(WTF_DRINKS,1)[0];
  const moral = pick(WTF_MORALES,1)[0];
  return [
    { role:"system", content:`WHAT THE F (amichevole, comico):
OBBLIGO forma (6–8 frasi, un paragrafo): apertura ≤2 frasi → 2–3 micro-imprevisti → UNA imprecazione teatrale (non contro persone) → SUBITO 2–3 reazioni di oggetti coerenti al contesto → accenno alcolico → 1–2 frasi che rispondono davvero → morale. Niente acqua. Max due “!”. Matcha gli esempi.` },
    { role:"system", content:`OPENING: ${opening}` },
    { role:"system", content:`IMPRECATION: ${impre}` },
    { role:"system", content:`REACTIONS:\n- ${reacts.join("\n- ")}` },
    { role:"system", content:`DRINK: ${drink}` },
    { role:"system", content:`MORAL: ${moral}` },
    { role:"system", content:`ESEMPI VINCOLANTI (tono/ritmo):\n- ${FEWSHOT_WTF_IT[0]}\n- ${FEWSHOT_WTF_IT[1]}\n- ${FEWSHOT_WTF_IT[2]}` },
  ];
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, periodo, stile, mode }){
  const msgs = [
    { role:"system", content: `REGOLE GENERALI: un solo paragrafo, senza elenchi/emoji, NON ripetere la domanda; seconda persona; no nomi inventati. Lunghezza: WHATIF 135–155, WTF 145–165.` },
    { role:"system", content: temporalInstruction(periodo) },
  ];
  if (stile === "wtf") {
    msgs.push(...wtfSeeds(domanda));
  } else if (mode === "analitico") {
    msgs.push(
      { role:"system", content: WHATIF_ANALITICO_RULE },
      { role:"system", content: `ESEMPIO ANALITICO (VINCOLANTE):\n${WHATIF_ANALITICO_RX}` },
    );
  } else {
    msgs.push(
      { role:"system", content: WHATIF_POETICO_RULE },
      { role:"system", content: `ESEMPIO POETICO (VINCOLANTE):\n${WHATIF_POETICO_RX}` },
    );
  }
  msgs.push({ role:"user", content:`Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO, un solo paragrafo.` });
  return msgs;
}

/* ========= Post-process ========= */
function keepSingleImprecazione(answer){
  const rx=/\bbestemmi\w*|imprecazion\w*|sacrament\w*|anatema\w*|improper/i;
  let seen=false;
  return answer.replace(new RegExp(rx,'gi'), m => seen ? "imprecazione a mezza voce" : (seen=true, m));
}
function ensureDrink(answer){
  if(/\b(grappa|amaro|rosso|vino|spritz|negroni|whisky|rum|birra|calice|goccio|dito|brindisi|liquore|shot)\b/i.test(answer)) return answer;
  return finalPunct(answer)+" Ti versi un goccio di liquore e il mondo si rimette in riga.";
}
function limitExclamations(s){ return s.replace(/!{3,}/g,"!!"); }
function forbidInsults(s){ return s.replace(/\b(cazzo|cazzata|stronzo|idiota|cretino|imbecille)\b/gi,"accidente"); }

/* ——— What if: anti-contaminazione dura ——— */
const LIRICO_BAN = /\b(eco|profumo|odore|vento|brezza|neve|montagn[ae]|amante che|risata che rimbalza|voci che sanno|orizzonte vero|vicoli che|finestre che|mani che|luce che)\b/gi;
const ANALISI_BAN = /\b(costi|benefici|budget|kpi|metriche|efficienza|performance|ottimizzazione|trade[- ]?off|affitto|bollett(e|a)|stipend[iio]|rete(?:\s+locale)?|artigiani|chilometr[io]|serviz[io]i?)\b/gi;

function forceAnalitico(answer){
  if(!/^Sai Luca, /i.test(answer)) answer = "Sai Luca, " + answer.replace(/^([A-ZÀ-Ýa-zà-ÿ]+,?\s*)/,"");
  // rimuovi lirismi
  answer = answer.replace(LIRICO_BAN, "routine");
  return answer;
}
function forcePoetico(answer){
  if(/^Bella questa, Luca\./i.test(answer)===false){
    if(/^Bella questa, /i.test(answer)) answer = answer.replace(/^Bella questa, /,"Bella questa, Luca. ");
    else answer = "Bella questa, Luca. " + answer;
  }
  // rimuovi gergo analitico
  answer = answer.replace(ANALISI_BAN, "respiro");
  return answer;
}

/* ========= HANDLER ========= */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", mode="reale", periodo="future" } = body;

    if(!domanda || typeof domanda!=="string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, periodo, stile, mode });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : 0.82,
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
    answer = tightenSentences(answer, stile==="wtf" ? 8 : 10);
    answer = clampWords(answer, stile==="wtf" ? 170 : 155);
    answer = normalizeOneParagraph(answer);
    answer = ensureSentenceCase(answer);
    answer = finalPunct(answer);

    if(stile==="wtf"){
      answer = keepSingleImprecazione(answer);
      answer = forbidInsults(answer);
      answer = limitExclamations(answer);
      answer = ensureDrink(answer);
    }else{
      if(mode==="analitico") answer = forceAnalitico(answer);
      else answer = forcePoetico(answer);
    }

    // No prima persona forte
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi,"");

    // Evita nomi non in domanda
    (function(){
      const d=String(domanda||""); const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g; const inQ=new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m)=> inQ.has(m)? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m)? m : m.toLowerCase()));
    })();

    return res.status(200).json({ answer, style:stile, mode, lang:"it", periodo, model:MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
