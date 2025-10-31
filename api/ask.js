// /api/ask.js — What?f Engine (RESET • COPY-EXAMPLES-EXACT • Clean Grammar)
// Stili: whatif(analitico|reale) + wtf
// Paragrafo unico, seconda persona, niente elenco, niente eco della domanda, niente nomi inventati.

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
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
function normLine(s=""){ return String(s).toLowerCase()
  .replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }

function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ")
    .split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){
    const n=normLine(p); if(!n||seen.has(n)) continue;
    if(p.split(/\s+/).length<=3 && !/[.!?…]$/.test(p)) continue;
    out.push(p); seen.add(n); if(out.length>=maxSentences) break;
  }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" ");
  const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){
  return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ")
    .replace(/\.\.\.+/g,"…").replace(/\s+([.,;:!?…])/g,"$1").trim();
}
function capitalizeAfterPunctuation(s=""){
  // Maiuscola dopo inizio/frase/ellipsis
  return s.replace(/(^|[.!?…]\s+)([a-zà-öø-ÿ])/g, (m,p,c)=> p + c.toUpperCase());
}
function finalPunct(s=""){ return /[.!?…]$/.test(s) ? s : s + "."; }
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  return t.replace(rx,"");
}

/* ========= Modalità temporale ========= */
function temporalInstruction(periodo="future"){
  if(String(periodo).toLowerCase()==="past"){
    return "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= ESEMPI VINCOLANTI (COPIA TONO & CADENZA) ========= */
const WHATIF_ANALITICO_RX = `Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const WHATIF_POETICO_RX = `Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

const FEWSHOT_WTF = [
  `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
  `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
  `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

/* ========= Banche per WTF (reazioni demenziali, max 3) ========= */
const WTF_REACTIONS = [
  "la lampada fa il codice Morse e scrive “STAI CALMO”",
  "la moka mette il turbo e fa una coreografia da stadio",
  "il POS si mette in modalità “timido” e balbetta errori",
  "la tapparella scende per imbarazzo e poi sbircia",
  "il ventilatore gira al contrario per rispetto",
  "il citofono suona da solo e poi chiede scusa",
  "il frigorifero sospira e decide di diventare minimal",
  "la statua all’angolo si copre gli occhi e ride tra le dita",
  "i bicchieri applaudono in cristallo e chiedono il bis",
  "Alexa finge un aggiornamento e scappa in ‘non disturbare’",
];

/* ========= Regole di stile severe ========= */
const RULES_BASE = `REGOLE GLOBALI:
- Un solo paragrafo. Niente elenchi. Niente emoji. Non ripetere la domanda. Seconda persona soltanto.
- COPIA ESATTAMENTE tono e cadenza degli ESEMPI: stesso respiro, stesse scelte ritmiche.
- Mai “io/noi/me/mi/ho/abbiamo”. Niente nomi nuovi non presenti nella domanda.`;

const RULES_WHATIF_ANALITICO = `WHAT IF · Analitico (copiatura d’esempio):
- Incipit in stile “Sai,” (variante lecita: “Sai, questa domanda…”).
- Tono concreto: scambi reali, costi/benefici, routine, qualità della vita.
- 8–10 frasi, 135–155 parole. Chiusura calma come nell’esempio.`;

const RULES_WHATIF_POETICO = `WHAT IF · Reale/Poetico (copiatura d’esempio):
- Incipit in stile “Bella questa,” (variante lecita: “Bella questa — …”).
- Immagini sobrie e sensoriali; niente elenco di pro/contro.
- 8–10 frasi, 135–155 parole. Chiusura riconciliata come nell’esempio.`;

const RULES_WTF = `WHAT THE F (demenziale ma affettuoso):
- Struttura OBBLIGATORIA, 6–8 frasi, 145–165 parole:
  1) Presa in giro affettuosa (max 2 frasi).
  2) 2–3 micro-imprevisti legati al contesto della domanda.
  3) Esattamente UNO sfogo teatrale (bestemmia narrata, non insulto a persone).
  4) Subito DOPO 2–3 reazioni di OGGETTI **coerenti** e demenziali.
  5) Accenno di alcol (amaro, rosso, goccio onesto), mai acqua.
  6) Una risposta vera alla domanda (1–2 frasi).
  7) Morale calda e ironica.
- Non più di “!!”. Niente aggressività contro persone.
- COPIA tono/ritmo dei 3 esempi vincolanti.`;

function buildMessages({ domanda, stile, mode, periodo }){
  const msgs = [
    { role: "system", content: RULES_BASE },
    { role: "system", content: temporalInstruction(periodo) },
  ];

  if (stile === "wtf"){
    msgs.push(
      { role: "system", content: RULES_WTF },
      { role: "system", content: `ESEMPI VINCOLANTI (tono/ritmo):\n- ${FEWSHOT_WTF[0]}\n- ${FEWSHOT_WTF[1]}\n- ${FEWSHOT_WTF[2]}` },
      { role: "system", content: `USA 2–3 REAZIONI COERENTI scelte tra:\n${WTF_REACTIONS.join(" · ")}` }
    );
  } else if (mode === "analitico"){
    msgs.push(
      { role: "system", content: RULES_WHATIF_ANALITICO },
      { role: "system", content: `ESEMPIO VINCOLANTE (Analitico):\n${WHATIF_ANALITICO_RX}` }
    );
  } else { // reale/poetico
    msgs.push(
      { role: "system", content: RULES_WHATIF_POETICO },
      { role: "system", content: `ESEMPIO VINCOLANTE (Reale/Poetico):\n${WHATIF_POETICO_RX}` }
    );
  }

  msgs.push({
    role:"user",
    content:`Domanda (NON ripeterla): "${domanda}". Genera UNA risposta in ITALIANO, paragrafo unico, rispettando lo stile selezionato.`
  });
  return msgs;
}

/* ========= Handler ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const {
      domanda = "",
      stile = "whatif",      // "whatif" | "wtf"
      mode  = "reale",       // for whatif: "analitico" | "reale"
      periodo = "future",
    } = body;

    if(!domanda || typeof domanda!=="string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, stile, mode, periodo });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 500,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process robusto
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf" ? 8 : 10);
    answer = clampWords(answer, stile==="wtf" ? 165 : 155);
    answer = normalizeOneParagraph(answer);

    // Maiuscole dopo punto/… e punteggiatura
    answer = capitalizeAfterPunctuation(answer);
    answer = finalPunct(answer);

    // Una sola “bestemmia” narrata (no insulti a persone) + niente volgarità dirette
    answer = answer.replace(/\b(cazzo|stronzo|idiota|cretino|imbecille)\b/gi, "accidente");
    const bestRx = /\bbestemmi\w+|anatema|sacramentat\w+|imprecazion\w+/gi;
    let count=0; answer = answer.replace(bestRx, (m)=> (++count===1)? m : "imprecazione a mezza voce");

    // Evita nomi propri non presenti nella domanda
    (function(){
      const d = String(domanda||"");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const allowed = new Set(d.match(nameRx)||[]);
      answer = answer.replace(nameRx, (m)=> allowed.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m)?m:m.toLowerCase()));
    })();

    // Niente acqua in WTF (assicura alcol)
    if(stile==="wtf" && !/\b(amaro|rosso|vino|liquore|grappa|spritz|birra|whisky|rum|gin|negroni|brindisi|goccio|sorso)\b/i.test(answer)){
      answer = answer.replace(/(Morale:)/i, "Ti versi un goccio onesto e ti si allineano i pensieri. $1");
    }

    // Limita !!! a !!
    answer = answer.replace(/!{3,}/g,"!!");

    return res.status(200).json({ answer, style: stile, mode, periodo, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
