// /api/ask.js — What?f Engine (Multilang • Robust • Contextual-WTF • Poetic-hard-guard)

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
  if (ALLOWED_ORIGINS.includes(origin))
    res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro"
  );
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it", "en", "es", "fr", "de"];
const LS = (x) => String(x || "");
function normLang(l = "it") {
  const s = LS(l).toLowerCase().slice(0, 2);
  return SUP_LANGS.includes(s) ? s : "it";
}
const isEnLike = (lang) => ["en", "es", "fr", "de"].includes(normLang(lang));

function normLine(s = "") {
  return LS(s).toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "").trim();
}
function tightenSentences(text, maxSentences) {
  const parts = LS(text).replace(/\n+/g, " ").split(/(?<=[.!?])\s+/)
    .map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for (const p of parts){
    const n=normLine(p); if(!n||seen.has(n)) continue;
    if(p.split(/\s+/).length<=3 && !/[.!?]$/.test(p)) continue;
    out.push(p); seen.add(n); if(out.length>=maxSentences) break;
  }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords){
  const w=LS(text).split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" ");
  const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){
  return LS(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ")
    .replace(/\.\.\.+/g,"…").replace(/\s+([.,;:!?])/g,"$1").trim();
}
function ensureSentenceCase(s=""){ const t=s.trim(); return t? t[0].toUpperCase()+t.slice(1):s; }
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }
function stripQuestionEcho(domanda,text){
  const d=LS(domanda).replace(/[“”"']/g,"").trim().toLowerCase();
  let t=LS(text);
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  return t.replace(rx,"");
}

/* ========= Temporal ========= */
function temporalInstruction(periodo="future",lang="it"){
  const en=isEnLike(lang);
  if(LS(periodo).toLowerCase()==="past"){
    return en? "Write as if it already happened (past/conditional allowed)."
             : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en? "Write as a near-future unfolding starting now."
           : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi (IT) ========= */
const WHATIF_ANALITICO_RX=`Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const WHATIF_POETICO_RX=`Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — few-shots (IT) ========= */
const FEWSHOT_WTF_IT=[
 `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
 `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
 `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

/* ========= Reazioni contestuali ========= */
const REACT_IT={
  money:["il POS finge un aggiornamento e ti guarda storto","lo scontrino si arrotola per non vedere","l’app della banca tossisce e poi fa finta di niente","il salvadanaio vibra come un vecchio autoradio"],
  work:["Excel apre da solo una colonna “speranze”","la stampante starnutisce carta e ti dà del lei","il badge lampeggia come una lucciola giudicante","la macchinetta del caffè fa un applauso a vapore"],
  travel:["il trolley picchietta le ruote","il tabellone partenze cambia idea due volte","il navigatore fa finta di non conoscerti ma ricalcola la vita"],
  city:["il cartello del paese ti strizza l’occhio","le chiavi tintinnano come campanelli","la serranda sbadiglia e ti saluta"],
  love:["il telefono vibra come un cuore timido","la playlist mette apposta la canzone sbagliata","le notifiche fanno la ola e poi si vergognano"],
  study:["l’evidenziatore s’illumina da solo","la penna scatta per firmare il destino","il quaderno si mette in riga meglio di te"],
  home:["la sedia applaude piano","la tapparella si abbassa e poi sbircia","la moka ti fa l’applauso in dialetto"],
  motor:["il casco ti guarda come una zia preoccupata","il semaforo passa al rosso solo per darti la scena"],
  tech:["il router lampeggia da discoteca","lo schermo fa un refresh di incoraggiamento","il cloud si schiarisce la voce"],
  kitchen:["il frigo sospira e diventa minimalista","il timer del forno fa un inchino","il mestolo si mette sull’attenti"],
  nature:["le foglie fanno un applauso opaco","il vento stira la giacca come una nonna","il sentiero ti allunga la mano"],
  fitness:["le scarpe salutano coi lacci","il tappetino si srotola come un invito","la borraccia suona come un brindisi d’allenamento"],
};
const REACT_EN={
  money:["the card reader pretends to update and glares","the receipt curls up not to look","the banking app coughs and moves on","the piggy bank hums like an old radio"],
  work:["Excel opens a new column called “hopes”","the printer sneezes paper and calls you sir","the badge blinks like a judgmental firefly","the coffee machine gives a tiny ovation"],
  travel:["the trolley taps its wheels","the departures board changes twice in solidarity","the GPS acts coy and recalculates your life"],
  city:["the town sign winks","your keys jingle like tiny bells","the shutter yawns and welcomes you"],
  love:["the phone buzzes like a shy heart","the playlist picks the wrong song on purpose","notifications do a wave then blush"],
  study:["the highlighter glows on its own","the pen lunges to sign destiny","the notebook straightens up"],
  home:["the chair creaks a polite clap","the blind lowers then peeks","the moka pot whistles applause"],
  motor:["the helmet eyes you like a worried aunt","the light turns red just to give you the stage"],
  tech:["the router blinks like a nightclub","the screen refreshes with encouragement","the cloud clears its throat"],
  kitchen:["the fridge sighs and goes minimalist","the oven timer bows","the ladle stands at attention"],
  nature:["the leaves give a muffled applause","the wind irons your jacket like a grandma","the path seems to hold out a hand"],
  fitness:["the shoes wave with their laces","the mat unrolls like an invitation","the bottle pings like a workout toast"],
};
function classifyTopic(q){
  const s=LS(q).toLowerCase(); const has=(rx)=>rx.test(s);
  if(has(/affitto|bollett|soldi|budget|risparmi|mutuo|debito|conto|banca|prezzo/)) return "money";
  if(has(/lavor|ufficio|collega|azienda|cv|colloquio|aumento/)) return "work";
  if(has(/viagg|trasfer|partire|trasloco|cambiare citt/)) return "travel";
  if(has(/aquila|l'aquila|quartiere|paese|città|citta/)) return "city";
  if(has(/amore|relazione|partner|fidanz|cuore|appuntamento/)) return "love";
  if(has(/studio|esame|universit|laurea|scuola|corso/)) return "study";
  if(has(/casa|divano|letto|cucina|balcone|pulire/)) return "home";
  if(has(/moto|motore|casco|auto|macchina|scooter/)) return "motor";
  if(has(/app|telefono|smart|internet|pc|computer|router|cloud|software/)) return "tech";
  if(has(/forno|frigo|ricetta|cucin|mestolo|padella/)) return "kitchen";
  if(has(/montagna|bosco|mare|vento|sentiero|natura|parco/)) return "nature";
  if(has(/palestra|correre|allen|yoga|peso|fitness/)) return "fitness";
  return "home";
}
function pick2(arr){ const a=[...arr]; if(a.length<2) return a; const i=Math.floor(Math.random()*a.length); let j=Math.floor(Math.random()*a.length); if(j===i) j=(j+1)%a.length; return [a[i],a[j]]; }

/* ========= Lingua/stile ========= */
function baseRules(lang){
  const en=isEnLike(lang);
  return en
    ? `RULES: single paragraph, no bullets, no emojis, do NOT restate the question. Second person only. Keep user samples' tone exactly.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Solo seconda persona. Mantieni esattamente il tono degli esempi.`;
}
function whatIfAnaliticoRule(lang){
  const en=isEnLike(lang);
  return en
    ? `WHAT IF Analytic: concrete tradeoffs, routine, cost/benefit. Match cadence of the Italian sample. 8–10 sentences; calm closing.`
    : `WHAT IF Analitico: scambi concreti, routine, costi/benefici. Stessa cadenza dell’esempio. 8–10 frasi; chiusura calma.`;
}
function whatIfPoeticoRule(lang){
  const en=isEnLike(lang);
  return en
    ? `WHAT IF Real/Poetic: start with “Nice one, Luca.” Short sentences (6–12 words). Sensory images (light, air, streets, hands, coffee). BAN: numbers/prices/budget/economy/rents/salaries/KPI, and words like “context/initiatives/it would mean”. Present or near-future only. Reconciled closing.`
    : `WHAT IF Reale/Poetico: apri con “Bella questa, Luca.” Frasi brevi (6–12 parole). Immagini sensoriali (luce, aria, vicoli, mani, caffè). DIVIETO: numeri, prezzi, budget, economia, affitti, stipendi, KPI, e parole come “contesto/iniziative/significherebbe”. Solo presente o futuro vicino. Chiusura riconciliata.`;
}
function wtfRule(lang, domanda){
  const en=isEnLike(lang);
  const topic=classifyTopic(domanda);
  const bank=normLang(lang)==="it"?REACT_IT:REACT_EN;
  const reacts=pick2(bank[topic]||bank.home);
  const header=en? `WHAT THE F (friendly). Be funny, never aggressive. 6–8 sentences. Playful tease + one absurd simile; 2–3 tiny mishaps; exactly ONE theatrical “swear” (not at people); include BOTH of these object reactions mid-paragraph: "${reacts[0]}"; "${reacts[1]}". Add a small alcoholic sip. Give 1–2 helpful lines that answer the question. Warm ironic punchline.`
                   : `WHAT THE F (amichevole). Fai ridere, mai aggressivo. 6–8 frasi. Presa in giro + una similitudine assurda; 2–3 micro-imprevisti; ESATTAMENTE UNA imprecazione teatrale (non contro persone); inserisci ENTRAMBE queste reazioni di oggetti a metà: "${reacts[0]}"; "${reacts[1]}". Aggiungi un piccolo sorso alcolico. Dai 1–2 righe utili che rispondono davvero. Chiusa ironica e calda.`;
  return header;
}

/* ========= Prompt ========= */
function buildMessages({ domanda, lang, periodo, stile, mode, micro }){
  const msgs=[
    { role:"system", content: baseRules(lang) },
    { role:"system", content: temporalInstruction(periodo, lang) },
  ];
  if(stile==="wtf"){
    msgs.push(
      { role:"system", content: wtfRule(lang, domanda) },
      { role:"system", content: `ESEMPI VINCOLANTI (tono/ritmo IT):\n- ${FEWSHOT_WTF_IT[0]}\n- ${FEWSHOT_WTF_IT[1]}\n- ${FEWSHOT_WTF_IT[2]}` }
    );
  }else{
    if(mode==="analitico"){
      msgs.push(
        { role:"system", content: whatIfAnaliticoRule(lang) },
        { role:"system", content: `ESEMPIO (IT):\n${WHATIF_ANALITICO_RX}` },
      );
    }else{
      msgs.push(
        { role:"system", content: whatIfPoeticoRule(lang) },
        { role:"system", content: `ESEMPIO (IT):\n${WHATIF_POETICO_RX}` },
      );
    }
  }
  const L=normLang(lang);
  const ask = L==="it" ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO a paragrafo unico.`
            : L==="en" ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH as a single paragraph.`
            : L==="es" ? `Pregunta (no la repitas): "${domanda}". Produce UNA respuesta en ESPAÑOL en un solo párrafo.`
            : L==="fr" ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.`
            : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.`;
  msgs.push({ role:"user", content: ask });
  return msgs;
}

/* ========= Poetic safeguards ========= */
const ANALYTIC_WORDS_RX=/\b(costi|benefici|costo|beneficio|budget|kpi|percentuali?|margini?|economia|pil|inflazione|affitti?|stipendi?|benchmark|metriche|analisi|trade[- ]?off|significher(?:e|ebbe)|contesto|iniziative?)\b/gi;
function softenAnalyticLexicon(s){
  return s.replace(ANALYTIC_WORDS_RX, (m)=>({
    costi:"spigoli", benefici:"comodità", costo:"spigolo", beneficio:"comodità",
    budget:"misura", kpi:"misure", percentuale:"parte", percentuali:"parti",
    margini:"bordi", economia:"ritmo della città", pil:"ritmo del paese",
    inflazione:"fiato corto dei prezzi", affitti:"case", stipendi:"paghe",
    benchmark:"paragoni", metriche:"misure", analisi:"sguardo",
    "trade-off":"scambio", significhere:"vorrebbe dire", significherebbe:"vorrebbe dire",
    contesto:"intorno", iniziativa:"gesto", iniziative:"gesti"
  }[m.toLowerCase()]||"misura"));
}
function ensurePoeticIncipit(lang, text){
  const L=normLang(lang); const want=L==="it"?"Bella questa, Luca.":"Nice one, Luca.";
  return new RegExp(`^\\s*(${want.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,"i").test(text)?text:`${want} ${text}`;
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

    const body=typeof req.body==="string"? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", mode="analitico", lang="it", periodo="future" } = body;

    if(!domanda || typeof domanda!=="string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages=buildMessages({ domanda, lang, periodo, stile, mode });

    const completion=await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf"? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 520,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer=completion?.choices?.[0]?.message?.content?.trim()||"";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer=stripQuestionEcho(domanda, answer);
    answer=tightenSentences(answer, stile==="wtf"? 8 : 10);
    answer=clampWords(answer, stile==="wtf"? 170 : 165);
    answer=normalizeOneParagraph(answer);
    if(stile!=="wtf"){ // poetico/analitico
      if(mode!=="analitico"){ // poetico: incipit + pulizia
        answer=ensurePoeticIncipit(lang, answer);
        answer=softenAnalyticLexicon(answer);
        answer=answer.replace(/\b\d+([.,]\d+)?\b/g, "qualche");
      }
    } else {
      // WTF: niente insulti, max due "!"
      answer=answer.replace(/!{3,}/g,"!!")
                   .replace(/\b(cazzo|cazzata|stronzo|idiota|cretino|imbecille)\b/gi,"accidente");
      // drink alcolico garantito
      if(!/\b(grappa|amaro|rosso|vino|spritz|negroni|calice|goccio|dito|brindisi)\b/i.test(answer)){
        answer=finalPunct(answer)+" Ti versi un goccio di amaro e il mondo si rimette in riga.";
      }
    }
    answer=ensureSentenceCase(answer);
    answer=finalPunct(answer);

    // Evita nomi non in domanda (solo IT)
    if(normLang(lang)==="it"){
      (function(){
        const d=LS(domanda);
        const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQ=new Set(d.match(nameRx)||[]);
        answer=answer.replace(nameRx,(m)=> inQ.has(m)? m : (["Ah","Oh","Ehi","Bella","Sai","Nice"].includes(m)? m : m.toLowerCase()));
      })();
    }

    return res.status(200).json({ answer, style: stile, mode, lang: normLang(lang), periodo, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
