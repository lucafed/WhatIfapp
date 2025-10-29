// /api/ask.js — What?f Engine (FINAL EXPLOSIVE EDITION + MICRO-PROFILING)
// Stili: whatif (analitico | reale) · wtf
// Invarianti: un solo paragrafo, seconda persona, niente elenchi, niente nomi inventati
// Aggiunta: micro-profiler (usa le microdomande come contesto “tecnico”, senza cambiare i toni)

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
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
function normLine(s=""){return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();}
function tightenSentences(text,maxSentences){const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);const out=[],seen=new Set();for(const p of parts){const n=normLine(p);if(!n||seen.has(n))continue;out.push(p);seen.add(n);if(out.length>=maxSentences)break;}let t=out.join(" ");if(!/[.!?…]$/.test(t))t+=".";return t;}
function clampWords(text,maxWords){const w=String(text||"").split(/\s+/);if(w.length<=maxWords)return text;const slice=w.slice(0,maxWords).join(" ");const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);return m?m[1]:slice+"…";}
function normalizeOneParagraph(s=""){return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim();}
function stripQuestionEcho(domanda,text){const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();let t=String(text||"");const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;t=t.replace(rx,"");return t;}

/* ========= Modalità temporale ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en = isEn(lang);
  if(periodo==="past")return en?"Write as if it already happened.":"Scrivi come se fosse già successo.";
  return en?"Write as a near-future unfolding.":"Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi ========= */
const EX_WHATIF_ANALITICO_IT = `Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_REALE_IT = `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — esempi ========= */
const EX_WTF_MOTO_IT = `Ah ma guarda te… ti convinci che la moto sia la cura definitiva contro la noia. I primi metri sembrano un film, poi il copione cambia: casco che appanna, giacca che s’incolla, GPS che ti manda in una rotonda infinita e un piccione che ti elegge pista d’atterraggio. Ti esplode un bestemmione corazzato che fa tremare le vetrine e interrompe la messa delle 18. Il semaforo passa al rosso per rispetto, i bicchieri applaudono sullo scaffale, e Alexa si mette in modalità penitenza. Ti fermi al bar per una sbronza elegante — doppio amaro e birra anti-trauma — e giuri che domani esci solo col sole. Poi guardi la moto: grondante come te, e pensi che la libertà, se non ti bagna, non vale niente.`;

const EX_WTF_PACE_IT = `Ti presenti elegante e il destino in ciabatte. Pensi che fare pace sia un tè con i biscotti e due scuse perfette. Poi il messaggio resta su “sta scrivendo…”, il telefono cade nella tazza, la foto del vostro peggior litigio spunta come notifica, e il cuore ti tamburella come una batteria in prova. Ti esplode un’imprecazionona a detonazione che fa tremare i portafoto; la lampada sfarfalla in Morse, il POS recita un rosario di errori, e il cane del vicino prende appunti. Ti versi un bicchiere di rosso “per lucidare la sincerità” e ti presenti con voce da sopravvissuto. L’abbraccio è goffo ma intero: le parole inciampano e si rialzano. Alla fine, il silenzio è un applauso lento. Pace fatta, pure il semaforo lampeggia in verde per solidarietà.`;

/* ========= Sinonimi esplosivi & Reazioni ========= */
const WTF_SFOGO_STRONG = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "para-bestemmia a raffica",
  "madonna della miseria urlata",
  "anatema a grandinata",
  "urlo liturgico strozzato",
  "embolata sacrilega"
];

const WTF_REACTIONS_BANK = [
  "la lampada fa facepalm e poi sfarfalla in Morse",
  "il campanile tossisce un amen stonato",
  "il POS recita un rosario di errori e si benedice da solo",
  "la tapparella si abbassa per imbarazzo e poi risale curiosa",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita",
  "Alexa finge un aggiornamento e scappa in modalità ‘non disturbare’",
  "il citofono fa uno squillo di solidarietà e poi si pente",
  "il semaforo passa al rosso per rispetto e resta così in silenzio",
  "i bicchieri applaudono in cristallo e chiedono il bis",
  "il ventilatore fa l’inchino e gira al contrario per reverenza",
  "la macchina del caffè sputa un getto a fontana come applauso",
  "il cane del vicino prende appunti e scuote la testa da giudice",
  "la porta automatica si apre da sola, poi si vergogna e si richiude",
  "il registratore di cassa batte uno scontrino con scritto ‘amen’",
  "la moka fischia standing ovation"
];

const WTF_OPENINGS = [
  "Ah ma guarda te, …",
  "Oh, eccoci, …",
  "Ti presenti elegante e il destino in ciabatte, …",
  "Giornata da manuale, capitolo imprevisti, …",
  "Hai studiato tutto, tranne il caos, …",
  "Sembra facile finché non tocca a te, …"
];

/* ========= REGOLE ========= */
const TECH_RULES_BASE = (lang)=>`REGOLE:
- Un solo paragrafo. Niente elenchi, niente emoji.
- Tempo: prossimo futuro. Solo seconda persona ("tu").
- Lunghezza: WHATIF ≈145 parole, WTF ≈165 parole.
- Non inventare nomi. Se la domanda non contiene nomi, evitali.`;

const WTF_STRICT_IT = (openingShape)=>`WTF:
1) Inizia esattamente con «${openingShape}».
2) 2–3 frasi di presa in giro (roasting).
3) 4 micro-imprevisti comici e realistici (pertinenti al contesto della domanda).
4) Esplosione viscerale (una sola): scegli da ${WTF_SFOGO_STRONG.join(", ")}.
5) Subito dopo 3–5 reazioni esilaranti tratte dal bank (pertinenti al contesto).
6) Alcol o sbronza visibile.
7) Rispondi davvero alla domanda con una previsione/controfattuale concreta.
8) Chiusa ironica o poetica che richiama l’inizio.
Solo seconda persona.`;

/* ========= Aperture variabili ========= */
async function pickRotating(list, key){
  try{ const n=await redis.incr(key); if(n===1) await redis.expire(key,86400); return list[(n-1)%list.length]; }
  catch{ return list[Math.floor(Math.random()*list.length)]; }
}

/* ========= MICRO PROFILER ========= */
/* Trasforma il micro profilo in istruzioni TECNICHE (non “toni”), limitate a 1–2 dettagli per risposta. */
function microGuideFrom(micro={}, lang="it", stile="whatif", mode="reale"){
  const m = micro || {};
  const L = (it,en)=> isEn(lang)?en:it;

  // mapper sintetici (solo suggerimenti di scena)
  const mood = String(m.mood||"").toLowerCase();
  const anchor = String(m.anchor||"").toLowerCase();
  const decide = String(m.decide||"").toLowerCase();
  const jungA = String(m.jung_attitude||"").toLowerCase();     // estroversione/introversione
  const jungR = String(m.jung_rational||"").toLowerCase();     // pensiero/sentimento
  const jungP = String(m.jung_perception||"").toLowerCase();   // sensazione/intuizione
  const zodiac = String(m.zodiac||"").toLowerCase();

  const hints = [];

  // MOOD
  if (mood.includes("ansios") || mood.includes("restless"))
    hints.push(L("inserisci sensazioni di tensione fisiologica gestita (respiro, spalle, dita) senza dirlo esplicitamente",
                 "blend subtle physiological tension (breath, shoulders, fingers) without stating it"));
  if (mood.includes("calm") || mood.includes("calmo"))
    hints.push(L("introduci micro-pause e ritmo disteso",
                 "use micro-pauses and relaxed pacing"));
  if (mood.includes("carico") || mood.includes("charged"))
    hints.push(L("aggiungi slancio operativo e piccoli scatti di iniziativa",
                 "add bursts of initiative and kinetic cues"));

  // ANCHOR
  if (anchor.includes("persone") || anchor.includes("people"))
    hints.push(L("fai comparire legami/relazioni come vincolo reale",
                 "surface ties/relationships as real constraints"));
  if (anchor.includes("soldi") || anchor.includes("money") || anchor.includes("bollette") )
    hints.push(L("cita vincoli economici (spesa, affitto, bollette) come scambio concreto",
                 "cite budget/bills as a concrete trade-off"));
  if (anchor.includes("routine"))
    hints.push(L("metti la routine come appiglio che rassicura/irrita",
                 "use routine as a reassuring/irritating anchor"));

  // DECIDE
  if (decide.includes("pancia") || decide.includes("gut"))
    hints.push(L("decisioni rapide a sensazione con piccoli aggiustamenti",
                 "snap decisions by feel with small corrections"));
  if (decide.includes("liste") || decide.includes("lists"))
    hints.push(L("accenna a check mentale pro/contro",
                 "hint at a quick mental pros/cons check"));
  if (decide.includes("amico") || decide.includes("friend"))
    hints.push(L("micro-riferimento a un parere esterno",
                 "tiny reference to an outside opinion"));
  if (decide.includes("scadenza") || decide.includes("deadline"))
    hints.push(L("usa il tempo come interruttore decisionale",
                 "use a deadline as the trigger"));
  if (decide.includes("moneta") || decide.includes("coin"))
    hints.push(L("metafora/accenno al lancio della moneta",
                 "coin-toss metaphor/cue"));
  if (decide.includes("caffè") || decide.includes("coffee"))
    hints.push(L("micro scena “caffè + passeggiata” come reset mentale",
                 "insert a tiny “coffee + walk” mental reset"));

  // JUNG (accenni figurativi, mai etichette)
  if (jungA.includes("intro"))
    hints.push(L("usa un interno/angolo calmo come base di scena",
                 "anchor the scene from a quiet interior vantage"));
  if (jungA.includes("estro"))
    hints.push(L("usa uno spazio sociale come base di scena",
                 "anchor the scene in a social/outer space"));
  if (jungR.includes("pensiero") || jungR.includes("thinking"))
    hints.push(L("inserisci 1 micro-dato pratico a supporto",
                 "insert 1 micro pragmatic fact"));
  if (jungR.includes("sentiment") || jungR.includes("feeling"))
    hints.push(L("inserisci 1 micro-risonanza emotiva (una percezione, non spiegazioni)",
                 "use 1 sensory/emotional resonance"));
  if (jungP.includes("sensazione") || jungP.includes("sensing"))
    hints.push(L("usa dettagli tattili/uditivi/visivi concreti",
                 "use tactile/auditory/visual concretes"));
  if (jungP.includes("intuizione") || jungP.includes("intuition"))
    hints.push(L("chiudi con una piccola inferenza/immagine che “apre”",
                 "end with a small opening inference/image"));

  // ZODIAC (solo easter egg leggerissimo)
  if (zodiac && zodiac !== "no sign, just vibes")
    hints.push(L("se serve, un micro-cenno ironico al portafortuna",
                 "optionally a tiny ironic nod to lucky habit/sign"));

  // Se non c’è nulla, non aggiungiamo rumore
  if (!hints.length) return "";

  // Limitiamo a 2 micro-suggerimenti per risposta
  const picked = hints.slice(0, 2);

  // Formuliamo come REGOLA TECNICA, non tono.
  return L(
    `MICRO-PROFILO (regole tecniche, integra solo se naturale; max 2 indizi): ${picked.map(x=>`• ${x}`).join(" ")}`,
    `MICRO-PROFILE (technical hints, use only if natural; max 2 cues): ${picked.map(x=>`• ${x}`).join(" ")}`
  );
}

/* ========= Prompt builder ========= */
async function buildMessages({ domanda, lang, periodo, stile, mode, ip, micro }){
  const msgs=[{role:"system",content:TECH_RULES_BASE(lang)},{role:"system",content:temporalInstruction(periodo,lang)}];

  // Inietta micro-profiler PRIMA degli esempi (non cambia tono, solo dettagli)
  const microGuide = microGuideFrom(micro, lang, stile, mode);
  if (microGuide) msgs.push({ role: "system", content: microGuide });

  if(stile==="wtf"){
    const opening=await pickRotating(WTF_OPENINGS,`rot:wtf:${ip}`);
    msgs.push(
      {role:"system",content:WTF_STRICT_IT(opening)},
      {role:"system",content:`ESEMPIO · WTF (IT) · Moto\n${EX_WTF_MOTO_IT}`},
      {role:"system",content:`ESEMPIO · WTF (IT) · Pace\n${EX_WTF_PACE_IT}`}
    );
  }else{
    if(mode==="analitico"){
      msgs.push(
        {role:"system",content:`ESEMPIO · WHAT IF · Analitico\n${EX_WHATIF_ANALITICO_IT}`}
      );
    }else{
      msgs.push(
        {role:"system",content:`ESEMPIO · WHAT IF · Reale\n${EX_WHATIF_REALE_IT}`}
      );
    }
  }

  msgs.push({role:"user",content:`Domanda: "${domanda}". Rispondi in ${lang.toUpperCase()} con un solo paragrafo.`});
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS")return res.status(200).end();
  if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
  try{
    if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"missing_api_key"});
    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unk").split(",")[0].trim();

    // Rate limit base
    const adminToken = String(req.headers["x-admin-token"]||"").trim();
    const isPro = String(req.headers["x-pro"]||"").trim() === "1";
    let bypass=false;
    try{
      if(adminToken){
        const data=await redis.hgetall(`admin:token:${adminToken}`);
        if(data) bypass=true;
      }
    }catch{}

    if(!bypass){
      const { success } = await rl.limit(`ask:${ip}`);
      if(!success) return res.status(429).json({ error:"rate_limited_minute" });
    }

    let used=0, dailyCap=isPro?10:3;
    if(!bypass){
      const today=new Date().toISOString().slice(0,10);
      const key=`credits:${ip}:${today}`;
      used=(await redis.incr(key))??1;
      if(used===1) await redis.expire(key,60*60*24);
      if(used>dailyCap) return res.status(402).json({error:"daily_credits_exhausted",used,dailyCap});
    }

    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const { domanda="", stile="whatif", mode="reale", lang="it", periodo="future", micro={} }=body;
    if(!domanda)return res.status(400).json({error:"bad_request",detail:"domanda_required"});

    const messages=await buildMessages({domanda, lang, periodo, stile, mode, ip, micro});
    const completion=await client.chat.completions.create({
      model:MODEL,
      temperature:stile==="wtf"?0.98:0.82,
      top_p:0.92,
      max_tokens:480,
      frequency_penalty:0.1,
      presence_penalty:0.0,
      messages,
    });

    let answer=completion?.choices?.[0]?.message?.content?.trim()||"";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer=stripQuestionEcho(domanda,answer);
    answer=tightenSentences(answer, stile==="wtf"?9:11);
    answer=clampWords(answer, stile==="wtf"?170:160);
    answer=normalizeOneParagraph(answer);
    if(!/[.!?…]$/.test(answer)) answer+=".";

    // Niente prima persona
    answer=answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi,"");

    // Guardia nomi non presenti in domanda
    (function(){
      const d = String(domanda||"");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQ = new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m)=>{
        return inQ.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m) ? m : m.toLowerCase());
      });
    })();

    return res.status(200).json({answer,style:stile,mode,lang,periodo,model:MODEL});
  }catch(e){
    console.error("❌ [/api/ask] error:",e);
    return res.status(500).json({error:"server_error",detail:String(e.message||e)});
  }
}
