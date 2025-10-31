// /api/ask.js — Luca FINAL++
// What if Analitico ≠ Poetico (incipit obbligati) • WTF con maiuscole dopo i punti
// Reazioni demenziali cinematografiche (2–3, pertinenti), alcol obbligatorio (no acqua)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL  = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500"
];
function cors(req,res){
  const o=String(req.headers.origin||"");
  if(ALLOWED_ORIGINS.includes(o)) res.setHeader("Access-Control-Allow-Origin",o);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Text utils ========= */
const normLine = s=>String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ")
  .replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();

function tightenSentences(text,max){
  const parts=String(text||"").replace(/\n+/g," ")
    .split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){
    const n=normLine(p); if(!n||seen.has(n)) continue;
    if(p.split(/\s+/).length<=3 && !/[.!?…]$/.test(p)) continue;
    out.push(p); seen.add(n); if(out.length>=max) break;
  }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}

function clampWords(s,n){
  const w=String(s||"").split(/\s+/); if(w.length<=n) return s;
  const slice=w.slice(0,n).join(" ");
  const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}

function normalizeOneParagraph(s=""){
  return String(s).replace(/\s*\n+\s*/g," ")
    .replace(/\s{2,}/g," ").replace(/\.\.\.+/g,"…")
    .replace(/\s+([.,;:!?])/g,"$1").trim();
}

function stripQuestionEcho(q,t){
  const d=String(q||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let s=String(t||"");
  const lead=s.slice(0,Math.min(s.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=s.indexOf("."); if(cut>-1) s=s.slice(cut+1).trim(); }
  return s.replace(rx,"");
}

/* Maiuscola dopo . ! ? …  + inizio riga */
function capAfterStopsIt(s=""){
  return s
    .replace(/(^\s*[a-zà-ÿ])|([.!?…]\s+[a-zà-ÿ])/g, m => m.toUpperCase())
    .replace(/\b(luca)\b/gi,"Luca");
}

/* ========= Tempo ========= */
function temporalInstruction(periodo="future"){
  return String(periodo).toLowerCase()==="past"
    ? "Scrivi come se fosse già successo (passato/condizionale consentiti)."
    : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= Esempi vincolanti ========= */
const WHATIF_ANALITICO_RX =
`Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const WHATIF_POETICO_RX =
`Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — few-shots (vincolo di tono) ========= */
const FEWSHOT_WTF_IT = [
  `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
  `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
  `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

/* ========= Reazioni demenziali “ingigantite” ========= */
const REACT_BASE = [
  "la moka esplode in una standing ovation a vapore e ti fa una ola di schiuma",
  "il POS si fa la cresima da solo, emette ricevute benedette e va in modalità «pentito»",
  "la lampada sfarfalla in Morse, scrive «BRAVO» e poi pretende la mancia",
  "la tapparella cala per la vergogna, risale per spettegolare e scatta un selfie al destino",
  "il frigorifero sospira teatrale, congela il senso di colpa e finge un blackout artistico",
  "il campanile tossisce un amen stonato, sbaglia nota e ti assolve con ritardo",
  "Alexa finge un aggiornamento infinito, entra in clausura digitale e mette silenzio perpetuo",
  "i bicchieri applaudono in cristallo, chiedono il bis e fanno tintinnio da stadio",
  "il ventilatore gira al contrario per cavalleria e ti fa onde da concerto",
  "il citofono suona per solidarietà, poi ci ripensa e manda un vocale di scuse",
  "il casco si allaccia da solo, fa un inchino e ti nomina cavaliere della rotonda",
  "lo scooter tossisce «bravo» dalla marmitta e firma l’aria con due colpi",
  "il mouse fa doppio click sul karma, va in crash e riavvia la tua dignità",
  "il divano notifica «aggiornamento fallito: alzati» e ti scorre via da sotto"
];

function pick(arr,n){ const a=[...arr], out=[]; while(out.length<n && a.length){ out.push(a.splice(Math.floor(Math.random()*a.length),1)[0]); } return out; }

function contextReactions(domanda){
  const d=String(domanda||"");
  if(/bar|caff[eè]|moka|bancone|tazza|pos/i.test(d)) return pick(REACT_BASE.filter(x=>/(moka|POS|bicchieri|lampada|tapparella|frigorifero)/i.test(x)),3);
  if(/moto|scooter|casco|strada|semaforo/i.test(d))  return pick(REACT_BASE.filter(x=>/(casco|scooter|campanile|ventilatore|citofono)/i.test(x)),3);
  if(/ufficio|pc|laptop|riunion/i.test(d))           return pick(REACT_BASE.filter(x=>/(mouse|lampada|tapparella|frigorifero|divano)/i.test(x)),3);
  return pick(REACT_BASE,3);
}

/* ========= Regole stile ========= */
const WHATIF_ANALITICO_RULE =
`WHAT IF Analitico (OBBLIGATORIO):
• Inizia ESATTAMENTE con: "Sai Luca,"
• Linguaggio concreto: affitti, bollette, stipendi, trasporti, servizi, routine, orari, artigiani/multinazionali.
• Vietate immagini liriche (aria, vicoli, montagna, profumi, risate, portoni…).
• 8–10 frasi, chiusura calma come nell’esempio.`;

const WHATIF_POETICO_RULE =
`WHAT IF Reale/Poetico (OBBLIGATORIO):
• Inizia ESATTAMENTE con: "Bella questa, Luca."
• Immagini sensoriali quotidiane (aria, vicoli, bar, risate, portoni, montagna, luce).
• Vietate parole da “Excel” (affitti, bollette, budget, costi/benefici, trasporti).
• 8–10 frasi, chiusura riconciliata come nell’esempio.`;

/* ========= WTF Rules ========= */
function wtfPrompt(domanda){
  const reacts = contextReactions(domanda);
  const RULE =
`WHAT THE F — COPIA il tono dei TRE ESEMPI (ironico, adulto, mai cattivo).
Struttura (un paragrafo, 6–8 frasi):
1) Presa in giro affettuosa (1–2 frasi).
2) 2–3 micro-imprevisti del contesto.
3) Esplode UNA sola bestemmia teatrale (mai contro persone).
4) SUBITO 2–3 reazioni demenziali, ipercinetiche e cinematografiche: ${reacts.join(" · ")}.
5) Drink ALCOLICO obbligatorio (grappa/amaro/rosso/shot). Vietata l’acqua.
6) 1–2 frasi che rispondono davvero alla domanda.
7) Chiusura ironica calda (no moraline).`;
  return [
    { role:"system", content:RULE },
    { role:"system", content:`ESEMPI VINCOLANTI:\n- ${FEWSHOT_WTF_IT[0]}\n- ${FEWSHOT_WTF_IT[1]}\n- ${FEWSHOT_WTF_IT[2]}` },
    { role:"system", content:`REACTIONS_SEED: ${reacts.join(" | ")}` }
  ];
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, periodo, stile, mode }){
  const msgs=[
    { role:"system", content:"REGOLE: paragrafo unico; niente elenchi/emoji; non ripetere la domanda; seconda persona." },
    { role:"system", content: temporalInstruction(periodo) },
  ];
  if(stile==="wtf"){
    msgs.push(...wtfPrompt(domanda));
  }else if(mode==="analitico"){
    msgs.push(
      { role:"system", content: WHATIF_ANALITICO_RULE },
      { role:"system", content: `ESEMPIO VINCOLANTE:\n${WHATIF_ANALITICO_RX}` }
    );
  }else{
    msgs.push(
      { role:"system", content: WHATIF_POETICO_RULE },
      { role:"system", content: `ESEMPIO VINCOLANTE:\n${WHATIF_POETICO_RX}` }
    );
  }
  msgs.push({ role:"user", content:`Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO.` });
  return msgs;
}

/* ========= Enforcers ========= */
function enforceAnalitico(t){
  // Incipit fisso
  t = t.replace(/^Bella questa, Luca\.\s*/i,"");
  if(!/^Sai Luca,/.test(t)) t = "Sai Luca, " + t.replace(/^Sai Luca,\s*/,"");
  // Se troppo poetico, sostituisci con blocco concreto
  const poet=(t.match(/\b(aria|luce|vicoli|profumo|risate|portoni|montagn|eco|amante|orizzonte|inverno)\b/gi)||[]).length;
  const conc=(t.match(/\b(affitt|bollett|stipend|trasport|serviz|routine|orari|spesa|artigian|multinazional)\b/gi)||[]).length;
  if(poet>conc){
    t = "Sai Luca, qui le scelte si misurano in cose semplici: affitti ancora umani, bollette che respirano, spesa che non divora lo stipendio. I trasporti sono prevedibili e gli orari si incastrano con la vita. Il lavoro appoggia più alle reti locali e agli artigiani che alle multinazionali: meno scala, più relazione. Guadagni forse più bassi, ma guadagni tempo e continuità. Non devi correre per esistere: la routine si assesta, i fine settimana hanno un bordo pulito e non vivi a rincorsa. Il compromesso è chiaro: meno occasioni grandi, più stabilità piccola. Se cerchi ritmo sostenibile e facce note, è un avanzare lento ma tuo.";
  }
  return t;
}
function enforcePoetico(t){
  // Incipit fisso
  t = t.replace(/^Sai Luca,\s*/i,"");
  if(!/^Bella questa, Luca\./.test(t)) t = "Bella questa, Luca. " + t;
  // rimuovi parole “Excel”
  return t.replace(/\b(affitt[oi]|bollett[ea]e?|stipend[iio]|budget|costi|benefici|trasport[oi]|serviz[iio]|routine|orari|multinazional[ei]|artigian[oi]|spesa)\b/gi,"silenzio");
}

/* ========= WTF guards ========= */
function keepSingleImprecazione(answer){
  const rx=/\b(bestemmi\w+|maledett[ao]|\bporca\b.*?\bmisera\b|anatema|sacramentat\w+|urlo liturgico|imprecazion\w+)\b/gi;
  let seen=false; return answer.replace(rx,m=>{ if(seen) return "imprecazione a mezza voce"; seen=true; return m; });
}
function ensureAlcohol(answer){
  answer=answer.replace(/\b(acqua (frizzante|naturale)|bicchiere d'acqua)\b/gi,"un dito di grappa");
  if(!/\b(grappa|amaro|rosso|vino|whisky|gin|birra|spritz|shot)\b/i.test(answer)){
    answer = answer.replace(/([.!?…])\s*$/,". Ti versi uno shot onesto e rimetti in fila i pensieri$1");
  }
  return answer;
}
function ensureReactions(answer, seed){
  const arr=(seed||"").split(/\s*\|\s*/).filter(Boolean);
  const used=arr.filter(k=>answer.toLowerCase().includes(k.split(" ")[1]?.toLowerCase()||""));
  if(used.length>=2) return answer;
  const add = pick(arr, Math.max(0,2-used.length)).join(" e ");
  return add ? answer.replace(/([.!?…])\s*$/i, `. Intorno succede l’impossibile: ${add}$1`) : answer;
}
const limitExcl = s=>s.replace(/!{3,}/g,"!!");
const forbidInsults = s=>s.replace(/\b(cazzo|cazzata|stronzo|idiota|imbecille)\b/gi,"accidente");

/* ========= HANDLER ========= */
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });
  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });
    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`); if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", mode="reale", periodo="future" } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, periodo, stile, mode });
    const completion = await client.chat.completions.create({
      model: MODEL, temperature: stile==="wtf"?0.98:0.82, top_p:0.92,
      max_tokens: 520, frequency_penalty:0.1, presence_penalty:0.0, messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Common post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf"?8:10);
    answer = clampWords(answer, stile==="wtf"?180:165);
    answer = normalizeOneParagraph(answer);

    if(stile==="wtf"){
      const seed = (messages.find(m=>m.role==="system" && String(m.content).startsWith("REACTIONS_SEED"))?.content||"").replace("REACTIONS_SEED: ","");
      answer = keepSingleImprecazione(answer);
      answer = ensureAlcohol(answer);
      answer = ensureReactions(answer, seed);
      answer = limitExcl(answer);
      answer = forbidInsults(answer);
    }else{
      answer = (mode==="analitico") ? enforceAnalitico(answer) : enforcePoetico(answer);
    }

    // Maiuscole dopo ogni punto/… (vale anche per WTF)
    answer = capAfterStopsIt(answer);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // Evita prima persona forte
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi,"");

    // Evita nomi non presenti nella domanda
    (function(){
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g; const inQ=new Set((String(domanda).match(nameRx)||[]));
      answer = answer.replace(nameRx,(m)=> inQ.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m) ? m : m.toLowerCase()));
    })();

    return res.status(200).json({ answer, style:stile, mode, periodo, model:MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
        }
