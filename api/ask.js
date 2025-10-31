// /api/ask.js — What?f Engine (STRICT STYLES • CONTEXT REACTIONS • NO WATER)
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

/* ========= ESEMPI VINCOLANTI — TUOI ========= */
const WHATIF_ANALITICO_RX = `Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const WHATIF_POETICO_RX = `Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF few-shots (tono vincolante) ========= */
const FEWSHOT_WTF_IT = [
  `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
  `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
  `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

/* ========= WTF — banche per reazioni DEMENZIALI contestuali ========= */
const REACTIONS_BY_CONTEXT = {
  bar: [
    "la lampada del bancone sfarfalla in Morse e ordina un espresso",
    "la moka fa una standing ovation a vapore",
    "il POS finge un aggiornamento e passa a modalità timida",
    "i bicchieri applaudono in cristallo e chiedono il bis",
    "il frigo sospira e decide di diventare minimalista"
  ],
  moto: [
    "il semaforo passa al rosso per rispetto",
    "il casco ti annuisce da solo come un saggio di plastica",
    "il cane sull’angolo cambia marciapiede per prudenza",
    "lo specchietto si gira dall’altra parte per pudore"
  ],
  amore: [
    "la lampada sfarfalla come se capisse il dramma",
    "il bicchiere applaude da solo e poi si riempie",
    "Alexa finge un aggiornamento e scappa in ‘non disturbare’",
    "la tenda si chiude da sola per discrezione"
  ],
  ufficio: [
    "la stampante tossisce un fax del ’98",
    "l’ascensore apre le porte e poi ci ripensa",
    "il badge fa bip tre volte in segno di lutto",
    "la macchinetta del caffè batte scontrino di consolazione"
  ],
  casa: [
    "la tapparella si abbassa per imbarazzo e poi sbircia",
    "il citofono squilla in solidarietà e poi si pente",
    "la sedia scricchiola come se applaudisse piano",
    "la pianta grassa annuisce con foglie perplesse"
  ],
  cucina: [
    "il tostapane fa un inchino e sputa briciole a tempo",
    "la pentola fischia un’ovazione",
    "il frigorifero si spegne per compassione"
  ],
  montagna: [
    "la seggiovia tossisce un amen stonato",
    "il rifugio lampeggia ‘occupato’ per empatia",
    "il campanile del paese anticipa la mezz’ora per incoraggiarti"
  ],
  mare: [
    "l’ombrellone si chiude da solo e poi riapre curioso",
    "il bagnasciuga fa applausi a onde corte",
    "il chiosco del lungomare stappa da sé e brinda"
  ],
  default: [
    "la lampada sfarfalla in Morse e pare dirti «ricevuto»",
    "la tapparella si abbassa e poi sbircia",
    "il ventilatore gira al contrario per rispetto",
    "il campanello suona in do minore e si commuove"
  ]
};
const WTF_IMPRECATIONS = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "srotoli una bestemmia in slow-motion, tutta coreografia e zero veleno",
  "ti esce una bestemmia frizzante che fa le bollicine come l’acqua tonica"
];
const WTF_DRINKS = [
  "ti versi un goccio di liquore e rimetti a posto i pensieri",
  "prendi un sorso corto di amaro e il mondo si raddrizza",
  "alzi un calice minuscolo: brindisi di manutenzione",
  "bevi un dito di rosso e respiri più largo",
  "butti giù uno shot educato e torni in traiettoria"
];
const WTF_MORALES = [
  "Morale: il caos non si doma, gli dai del tu.",
  "Morale: ridi tu per primo e il resto si arrangia.",
  "Morale: se non si allinea, lo porti a bere e si convince.",
  "Morale: metà fortuna, metà mestiere, zero rancore."
];

/* ========= Regole dure WHAT IF ========= */
const BASE_RULES = `REGOLE GENERALI:
- Un solo paragrafo. Niente elenchi. Niente emoji. NON ripetere la domanda.
- Solo seconda persona. Nessun nome proprio non presente nella domanda.
- Matcha esattamente tono, cadenza e respiro degli esempi.`;

const WHATIF_ANALITICO_RULE = `WHAT IF Analitico (vincolante):
- INCIPIT OBBLIGATORIO: “Sai Luca,” (o variante coerente).
- Lessico concreto: routine, orari, bollette, affitto, stipendi, chilometri, servizi, reti locali, artigiani, scambi reali.
- VIETATO: immagini liriche/sensoriali; niente “eco”, “montagne che guardano”, “risate che rimbalzano”, ecc.
- Cadenza e lessico identici all’esempio analitico. 135–155 parole. Chiusura calma.`;

const WHATIF_POETICO_RULE = `WHAT IF Reale/Poetico (vincolante):
- INCIPIT OBBLIGATORIO: “Bella questa, Luca.” (o variante strettissima).
- Lessico sensoriale quotidiano: aria, luce, vicoli, finestre, passi, mani, caffè corto e ruvido, voci, risate, inverno/vento, orizzonte vero.
- VIETATO: gergo analitico (costi/benefici, budget, KPI, efficienza, trade-off).
- Cadenza e immagini identiche all’esempio poetico. 135–155 parole. Chiusura riconciliata.`;

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
  if(/amore|relazione|cuore|lui|lei|partner|messaggi/.test(d)) return "amore";
  if(/ufficio|badge|stampante|riunione|colleghi|manager/.test(d)) return "ufficio";
  if(/casa|divano|citofono|tapparella|sedia|pianta/.test(d)) return "casa";
  if(/cucina|fornelli|tostapane|frigo|pentola/.test(d)) return "cucina";
  if(/montagna|rifugio|neve|seggiovia|sentiero/.test(d)) return "montagna";
  if(/mare|spiaggia|chiosco|ombrellone|bagnasciuga/.test(d)) return "mare";
  return "default";
}
function wtfSeeds(domanda, micro={}){
  const ctx = detectContext(domanda);
  const reactionsPool = REACTIONS_BY_CONTEXT[ctx] || REACTIONS_BY_CONTEXT.default;
  const reactCount = 2 + Math.floor(Math.random()*2); // 2 o 3
  const reacts = pick(reactionsPool, reactCount);
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
    { role:"system", content: `WHAT THE F (amichevole, comico):
Struttura OBBLIGATORIA (6–8 frasi, un paragrafo).
Apertura (presa in giro ≤2 frasi) → 2–3 micro-imprevisti → ESATTAMENTE UNA imprecazione teatrale (non contro persone) → SUBITO 2–3 reazioni di oggetti coerenti al contesto → accenno alcolico → 1–2 frasi che rispondono davvero → morale calda.
Niente acqua. Max due “!”. Matcha gli esempi.` },
    { role:"system", content: `OPENING: ${opening}` },
    { role:"system", content: `IMPRECATION: ${impre}` },
    { role:"system", content: `REACTIONS:\n- ${reacts.join("\n- ")}` },
    { role:"system", content: `DRINK: ${drink}` },
    { role:"system", content: `MORAL: ${moral}` },
    { role:"system", content: `ESEMPI VINCOLANTI (tono/ritmo):\n- ${FEWSHOT_WTF_IT[0]}\n- ${FEWSHOT_WTF_IT[1]}\n- ${FEWSHOT_WTF_IT[2]}` },
  ];
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, periodo, stile, mode }){
  const msgs = [
    { role:"system", content: BASE_RULES },
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
  msgs.push({
    role:"user",
    content:`Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO, un solo paragrafo.`
  });
  return msgs;
}

/* ========= Post-process ========= */
function keepSingleImprecazione(answer){
  const rx=/\bbestemmi\w*|imprecazion\w*|sacrament\w*|anatema\w*/gi;
  let c=0; return answer.replace(rx, m => (++c===1? m : "imprecazione a mezza voce"));
}
function ensureDrink(answer){
  if(/\b(grappa|amaro|rosso|vino|spritz|negroni|whisky|rum|birra|calice|miniuscolo|goccio|dito|brindisi|liquore|shot)\b/i.test(answer)) return answer;
  return finalPunct(answer)+" Ti versi un goccio di liquore e il mondo si rimette in riga.";
}
function limitExclamations(s){ return s.replace(/!{3,}/g,"!!"); }
function forbidInsults(s){ return s.replace(/\b(cazzo|cazzata|stronzo|idiota|cretino|imbecille)\b/gi,"accidente"); }

function forceAnaliticoIncipt(answer){
  if(/^Sai Luca, /i.test(answer)) return answer;
  return "Sai Luca, " + answer.replace(/^([A-ZÀ-Ýa-zà-ÿ]+,?\s*)/,"");
}
function forcePoeticoIncipit(answer){
  if(/^Bella questa, Luca\./i.test(answer)) return answer;
  if(/^Bella questa, /i.test(answer)) return answer.replace(/^Bella questa, /,"Bella questa, Luca. ");
  return "Bella questa, Luca. " + answer;
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

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile   = "whatif",   // "whatif" | "wtf"
      mode    = "reale",    // "analitico" | "reale"
      periodo = "future"
    } = body;

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

    // Post-process comune
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
      if(mode==="analitico"){
        // forza incipit analitico e bandisce lirico
        answer = forceAnaliticoIncipt(answer);
        answer = answer
          .replace(/\b(eco|profumo|odore|vento|neve|montagn[ae]|risata che rimbalza|voci che sanno|amante che aspetta|orizzonte vero)\b/gi, "routine")
          .replace(/\b(incanto|magia|poesia|sospiri)\b/gi,"ritmo");
      }else{
        // forza incipit poetico e bandisce gergo analitico
        answer = forcePoeticoIncipit(answer);
        answer = answer
          .replace(/\b(costi|benefici|budget|kpi|metriche|efficienza|performance|trade[- ]?off|ottimizzazione|scambi concreti|stipend[iio]|affitto|bollette|rientrare nei conti)\b/gi, "respiro");
      }
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
