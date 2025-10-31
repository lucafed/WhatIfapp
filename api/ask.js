// /api/ask.js — Luca FINAL • Analitico≠Poetico • WTF demenziale • Grammar Fix
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL  = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Rate ========= */
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ========= CORS ========= */
const ALLOWED_ORIGINS = ["https://what-ifapp.vercel.app","http://localhost:3000","http://127.0.0.1:5500"];
function cors(req,res){ const o=String(req.headers.origin||""); if(ALLOWED_ORIGINS.includes(o)) res.setHeader("Access-Control-Allow-Origin",o);
  res.setHeader("Vary","Origin"); res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro"); }

/* ========= Text utils ========= */
const normLine = s=>String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();
function tightenSentences(text,max){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[],seen=new Set(); for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue;
    if(p.split(/\s+/).length<=3 && !/[.!?…]$/.test(p)) continue; out.push(p); seen.add(n); if(out.length>=max) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(s,n){ const w=String(s||"").split(/\s+/); if(w.length<=n) return s;
  const slice=w.slice(0,n).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/); return m?m[1]:slice+"…"; }
const normalizeOneParagraph = s=>String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\.\.\.+/g,"…").replace(/\s+([.,;:!?])/g,"$1").trim();
function stripQuestionEcho(q,t){
  const d=String(q||"").replace(/[“”"']/g,"").trim().toLowerCase(); let s=String(t||"");
  const lead=s.slice(0,Math.min(s.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=s.indexOf("."); if(cut>-1) s=s.slice(cut+1).trim(); }
  return s.replace(rx,"");
}
/* Maiuscola dopo . ! ? … e dopo « » */
function capSentencesIt(s=""){
  const fixed = s.replace(/(^\s*[a-zà-ÿ])|([.!?…]\s+[a-zà-ÿ])/g, m => m.toUpperCase());
  // “luca” -> “Luca” in avvio
  return fixed.replace(/\b(luca)\b/gi,"Luca");
}

/* ========= Tempo ========= */
function temporalInstruction(periodo="future"){
  return String(periodo).toLowerCase()==="past"
    ? "Scrivi come se fosse già successo (passato/condizionale consentiti)."
    : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= Esempi vincolanti ========= */
const WHATIF_ANALITICO_RX = `Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const WHATIF_POETICO_RX   = `Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

const FEWSHOT_WTF_IT = [
  `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
  `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
  `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

/* ========= Reazioni demenziali (coerenti col contesto) ========= */
const REACT_BASE = [
  "la moka fa una standing ovation a vapore e proclama santo il caffè",
  "il POS fa la cresima da solo e si mette in «pentito»",
  "la lampada sfarfalla in Morse e chiede un autografo",
  "il frigorifero sospira, congela il senso di colpa e finge di non aver visto",
  "la tapparella si abbassa per imbarazzo e risale per spettegolare",
  "il campanile tossisce un amen stonato e ti benedice in ritardo",
  "Alexa finge un aggiornamento infinito ed entra in clausura digitale",
  "i bicchieri applaudono in cristallo e chiedono il bis",
  "il ventilatore gira al contrario per educazione monastica",
  "il citofono suona per solidarietà e poi si pente",
  "il casco si allaccia da solo e ti dà del tu",
  "lo scooter tossisce un ‘bravo’ dallo scarico",
  "il divano ti notifica «aggiornamento fallito: alzati»",
  "il mouse fa doppio click sul karma e crasha"
];
function pick(arr,n){ const a=[...arr], out=[]; while(out.length<n && a.length){ out.push(a.splice(Math.floor(Math.random()*a.length),1)[0]); } return out; }
function contextReactions(domanda){
  const d=String(domanda||"");
  if(/bar|caff[eè]|moka|bancone|tazza|pos/i.test(d)) return pick(REACT_BASE.filter(x=>/(moka|POS|bicchieri|lampada|tapparella|frigorifero)/i.test(x)),3);
  if(/moto|scooter|casco|strada|semaforo/i.test(d))  return pick(REACT_BASE.filter(x=>/(casco|scooter|campanile|ventilatore|citofono)/i.test(x)),3);
  if(/ufficio|pc|laptop|riunion/i.test(d))           return pick(REACT_BASE.filter(x=>/(mouse|lampada|tapparella|frigorifero|citofono)/i.test(x)),3);
  return pick(REACT_BASE,3);
}

/* ========= Regole stile ========= */
const WHATIF_ANALITICO_RULE =
`WHAT IF Analitico — COPIA la cadenza dell’esempio.
OBBLIGHI: incipit esatto “Sai Luca,”; linguaggio concreto (affitti, bollette, stipendi, trasporti, routine, servizi); nessuna immagine lirica.
8–10 frasi, chiusura calma come nell’esempio.`;

const WHATIF_POETICO_RULE =
`WHAT IF Reale/Poetico — COPIA il respiro dell’esempio.
OBBLIGHI: incipit esatto “Bella questa, Luca.”; immagini sensoriali sobrie (aria, vicoli, bar, risate, portoni); nessuna parola da ‘Excel’.
8–10 frasi, chiusura riconciliata come nell’esempio.`;

/* ========= WTF prompt ========= */
function wtfPrompt(domanda){
  const reacts = contextReactions(domanda);
  const RULE = `WHAT THE F — tono identico ai TRE ESEMPI.
STRUTTURA (un paragrafo, 6–8 frasi):
1) Presa in giro affettuosa (1–2 frasi).
2) 2–3 micro-imprevisti del contesto.
3) UNA sola bestemmia teatrale (mai contro persone), come nei tuoi esempi.
4) SUBITO queste reazioni demenziali (scegline 2–3): ${reacts.join(" · ")}.
5) DRINK ALCOLICO obbligatorio (grappa/amaro/rosso/shot). Vietata l’acqua.
6) 1–2 frasi che rispondono davvero alla domanda.
7) Chiusura ironica calda (niente moraline).`;
  return [
    { role:"system", content: RULE },
    { role:"system", content: `ESEMPI VINCOLANTI:\n- ${FEWSHOT_WTF_IT[0]}\n- ${FEWSHOT_WTF_IT[1]}\n- ${FEWSHOT_WTF_IT[2]}` },
    { role:"system", content: `REACTIONS_SEED: ${reacts.join(" | ")}` },
  ];
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, periodo, stile, mode }){
  const msgs = [
    { role:"system", content:"REGOLE GENERALI: un paragrafo unico; niente elenchi; niente emoji; non ripetere la domanda; seconda persona." },
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
  if(!/^Sai Luca,/i.test(t)) t="Sai Luca, "+t.replace(/^Bella questa, Luca\.\s*/i,"");
  const poet=(t.match(/\b(aria|luce|vicoli|profumo|risate|portoni|montagn|eco|amante|orizzonte|inverno)\b/gi)||[]).length;
  const conc=(t.match(/\b(affitt|bollett|stipend|trasport|serviz|scuol|sanit|asilo|routine|orari|spesa|multinazional|artigian)\b/gi)||[]).length;
  if(poet>conc){
    t = "Sai Luca, qui le scelte si misurano in cose semplici: affitti ancora umani, bollette che respirano, spesa che non mangia lo stipendio. I trasporti sono prevedibili, gli orari si incastrano con la vita e i servizi — scuola e sanità — funzionano senza teatro. Il lavoro si appoggia più alle reti locali e agli artigiani che alle multinazionali: meno scala, più relazione. Guadagni forse più bassi, ma tempo libero e relazione ripagano in fiato. Qui non devi correre per esistere: la routine si assesta, il fine settimana ha un bordo pulito, e puoi permetterti lentezze che altrove costano. Il compromesso è chiaro: meno occasioni grandi, più continuità piccola. Se cerchi ritmo sostenibile e facce note, è un avanzare lento ma tuo.";
  }
  return t;
}
function enforcePoetico(t){
  if(!/^Bella questa, Luca\./i.test(t)){
    t=t.replace(/^Sai Luca,\s*/i,""); t="Bella questa, Luca. "+t;
  }
  // togli parole "Excel"
  return t.replace(/\b(affitt[oi]|bollett[ea]e?|stipend[iio]|budget|costi|benefici|trasport[oi]|serviz[iio]|routine|orari|multinazional[ei]|artigian[oi])\b/gi,"silenzio");
}

/* ========= WTF guards ========= */
function keepSingleImprecazione(answer){
  const rx=/\b(bestemmi\w+|miseria|anatema|sacramentat\w+|urlo liturgico|imprecazion\w+)\b/gi;
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
  const keys=(seed||"").split(/\s*\|\s*/); const hit=keys.some(k=>k && answer.toLowerCase().includes(k.split(" ")[1]?.toLowerCase()||""));
  if(hit) return answer;
  const two = pick(keys.filter(Boolean),2).join(" e ");
  return answer.replace(/([.!?…])\s*$/i, `. Intorno succede l’impossibile: ${two}${RegExp.$1}`);
}
const limitExcl = s=>s.replace(/!{3,}/g,"!!");
const forbidInsults = s=>s.replace(/\b(cazzo|cazzata|stronzo|idiota|imbecille)\b/gi,"accidente");

/* ========= HANDLER ========= */
export default async function handler(req,res){
  cors(req,res); if(req.method==="OPTIONS") return res.status(200).end();
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
      model: MODEL, temperature: stile==="wtf"?0.98:0.82, top_p:0.92, max_tokens:480, frequency_penalty:0.1, presence_penalty:0.0, messages,
    });
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Common post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf"?8:10);
    answer = clampWords(answer, stile==="wtf"?168:160);
    answer = normalizeOneParagraph(answer);

    // Split & guards
    if(stile==="wtf"){
      const seed = (messages.find(m=>m.role==="system" && String(m.content).startsWith("REACTIONS_SEED"))?.content||"").replace("REACTIONS_SEED: ","");
      answer = keepSingleImprecazione(answer);
      answer = ensureAlcohol(answer);
      answer = ensureReactions(answer, seed);
      answer = limitExcl(answer);
      answer = forbidInsults(answer);
    }else{
      if(mode==="analitico") answer = enforceAnalitico(answer);
      else                   answer = enforcePoetico(answer);
    }

    // Maiuscole & fine
    answer = capSentencesIt(answer);
    if(!/[.!?…]$/.test(answer)) answer+=".";

    // No prima persona forte
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi,"");

    // Evita nomi non in domanda
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
