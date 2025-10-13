// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Utils ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function detectLang(text=""){ const enHits=(text.match(/\b(what|if|and|or|you|should|would|move|work|buy|motor|bike|city)\b/gi)||[]).length;
  const itHits=(text.match(/\b(e|se|quando|perché|moto|tornassi|trasferir|lavor|comprare|acquistare)\b/gi)||[]).length;
  return enHits>itHits?"en":"it";
}
function classifyTopic(q=""){ const s=q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(barca|vela|gommone|yacht|boat)/.test(s)) return "barca";
  if (/(tornassi|trasferi|trasloco|vivere a|move|relocat)/.test(s)) return "trasferimento";
  if (/(l'aquila|aquila|lugano|milano|roma|verona|bussolengo|londra|zurigo)/.test(s)) return "città";
  if (/(lavoro|job|ricercatore|azienda|ufficio|work)/.test(s)) return "lavoro";
  if (/(comprare|acquistare|buy|purchase)/.test(s)) return "acquisto";
  return "generale";
}
function todayInfo(lang){ const d=new Date(); const loc=isEn(lang)?"en-GB":"it-IT";
  const weekday=d.toLocaleDateString(loc,{weekday:"long"});
  const date=d.toLocaleDateString(loc,{day:"2-digit",month:"long",year:"numeric"});
  const hh=String(d.getHours()).padStart(2,"0"); const mm=String(d.getMinutes()).padStart(2,"0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

/* ========= PERSONAS — più “lunghe” ========= */
const PERSONAS = {
  whatif: {
    system: (lang)=>`
Sei "What?f": sobria, lucida, intima. Parla come se sapessi cose che l’utente ancora non sa.
Stile: episodio cinematografico, concreto, senza malinconia. Seconda persona, una sola voce.
OBBLIGHI DI STRUTTURA:
- Scrivi almeno 12 righe, massimo ~190–220 parole totali.
- Una frase per riga; nessun elenco; 0–2 micro-immagini plausibili.
- Niente moralismi, niente imperativi. Niente titoli, emoji o virgolette decorative.
- Evita lirismi (accarezza, profumo, tramonto, orizzonti, poesia).
- Chiudi con un cliffhanger emotivo dolce (es. “Hai appena girato la chiave: sentiamo il motore domani.”).
Se stai per chiudere prima di 12 righe, CONTINUA finché non le raggiungi.
Rispondi SOLO in Italiano.`.trim()
  },
  wtf: {
    system: (lang)=>`
Sei "What the F": barista nottambulo, sarcastico, brillante, un filo "alcolico", mai cattivo.
OBBLIGHI DI STRUTTURA:
- 9–12 righe massime, ≤15 parole per riga. Se stai per chiudere prima di 9 righe, CONTINUA.
- Una voce, ritmo serrato, battuta → constatazione → mini-twist.
- Zero moralismi/consigli (“devi”, “non comprare”, “attenzione”) e niente “amico”.
- Niente emoji, virgolette o titoli; 0–2 immagini minuscole; al massimo UNA domanda retorica.
- Chiudi con gancio comico-emotivo (es. “Stesso bancone, domani rimescoliamo.”).
Rispondi SOLO in Italiano.`.trim()
  }
};

/* ========= Clarify ========= */
function clarifyQuestions(domanda, periodo, lang="it"){
  const en=isEn(lang); const topic=classifyTopic(domanda);
  const Q=(id,it,enStr,phIt,phEn)=>({id,label:en?enStr:it,placeholder:en?phEn:phIt});
  if(topic==="moto"){
    return [
      Q("timing","Quando la prenderesti davvero?","When would you actually buy it?","questo mese / 3–6 mesi","this month / 3–6 months"),
      Q("use","Uso principale?","Main use?","casa-lavoro / weekend / viaggi","commute / weekends / trips"),
      Q("budget","Tetto di spesa mensile?","Monthly budget ceiling?","€ per assicurazione + carburante","$ for insurance + fuel")
    ];
  }
  if (topic==="trasferimento"||topic==="città"){
    return [
      Q("window","Finestra realistica per lo spostamento?","Real window to move?","entro 3 mesi / 6–12 mesi","within 3 months / 6–12 months"),
      Q("anchor","Cosa ti tiene dove sei ora?","What anchors you now?","famiglia / lavoro / costi","family / work / costs"),
      Q("signal","Segno che direbbe: è giusto?","Sign that says: it’s right?","sonno/energia/risposte","sleep/energy/callback")
    ];
  }
  if (topic==="lavoro"){
    return [
      Q("why","Il tuo perché oggi?","Your current why?","impatto / crescita / serenità","impact / growth / calm"),
      Q("option","Opzioni sul tavolo?","Options on the table?","restare / cambiare team / uscire","stay / switch team / leave"),
      Q("limit","Vincolo più concreto?","Hardest constraint?","budget/tempo/relazioni","budget/time/people")
    ];
  }
  return [
    Q("window","Finestra reale della decisione?","Real decision window?","questo mese / 3–6 / 12 mesi","this month / 3–6 / 12 months"),
    Q("signal","Segno personale da osservare?","Personal sign to watch?","sonno/energia/prima risposta","sleep/energy/first reply"),
    Q("limit","Limite più concreto?","Most concrete limit?","budget/tempo/energia","budget/time/energy")
  ];
}

/* ========= FEW-SHOT (insegna tono e lunghezza) ========= */
const FEWSHOT_WTF = [
  { role: "user", content: "E se tornassi a vivere all’Aquila?" },
  { role: "assistant", content:
`Torna pure. Aria pulita, ritmi lenti, zia che chiede del lavoro.
Dopo due settimane, parli coi piccioni per sapere le novità.
Le montagne ti guardano: giudizio muto, panorama onesto.
Verona ti scrive: aperitivo a nove euro, anima in pegno.
All’Aquila il freddo è sincero: congela, ma con dignità.
Poi succede nel solito momento: tra secondo caffè e pioggia fine.
Ti ricordi perché ti piaceva restare. E capisci che non era nostalgia.
Domani, se ti fermi davvero in piazza, qualcosa si muove.
Non spoileriamo: lascia il conto aperto.
Stesso bancone, domani rimescoliamo.`}
];

const FEWSHOT_WHATIF = [
  { role: "user", content: "E se comprassi una moto?" },
  { role: "assistant", content:
`La vedi in garage prima ancora di firmare. Ti scappa un mezzo sorriso.
Il primo weekend non scappi: provi il quartiere e capisci le distanze.
Casa–lavoro si accorcia, ma la testa si allunga: più ossigeno, meno scuse.
Le mattine diventano tue cinque minuti prima del resto.
Scopri che la libertà non è la velocità: è decidere dove rallentare.
Una curva ti insegna rispetto. Un semaforo ti ricorda pazienza.
Gli amici ridono, poi chiedono il giro. Tu impari a dire: più tardi.
C’è un costo silenzioso: casco, manutenzione, pioggia non invitata.
C’è un guadagno rumoroso: presenza piena, anche a trenta all’ora.
Questa storia non finisce in garage. Domani senti come riparte.
Hai appena girato la chiave: il motore, lo senti domani.`}
];

/* ========= HTTP handler ========= */
export default async function handler(req, res){
  // CORS
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-whatif-stream");
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});

  try{
    const {
      domanda,
      lang: langIn="auto",
      periodo="future",
      stile="whatif",
      stream=false,
      clarify=false,
      clarifications=[]
    } = req.body || {};

    if(!domanda || typeof domanda!=="string"){
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });
    }

    const lang = langIn==="auto" ? detectLang(domanda) : langIn;
    const topic = classifyTopic(domanda);

    if(clarify){
      return res.status(200).json({ questions: clarifyQuestions(domanda, periodo, lang) });
    }

    const persona = PERSONAS[stile==="wtf" ? "wtf" : "whatif"];
    const system = `
${persona.system(lang)}

Oggi: ${todayInfo(lang)}
Regole dure extra:
- Rispondi SOLO in Italiano.
- Onora il tema: "${topic}".
- Se mancano righe al minimo richiesto, continua finché non le raggiungi.
`.trim();

    const user = `
Domanda utente: "${domanda}"
Dettagli: ${Array.isArray(clarifications)&&clarifications.length ? clarifications.join(", ") : "nessuno"}
`.trim();

    const seed = (stile==="wtf" ? FEWSHOT_WTF : FEWSHOT_WHATIF);

    const baseReq = {
      model: MODEL_TEXT,
      temperature: stile==="wtf" ? 0.9 : 0.82,
      max_tokens: 900,                // ↑ più respiro
      frequency_penalty: 0.15,
      presence_penalty: 0.1,
      messages: [
        { role: "system", content: system },
        ...seed,
        { role: "user", content: user }
      ]
    };

    // Stream opzionale
    const doStream = stream || String(req.headers["x-whatif-stream"]||"")!=="";
    if(doStream){
      res.setHeader("Content-Type","text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control","no-cache, no-transform");
      res.setHeader("Connection","keep-alive");
      const s = await client.chat.completions.create({ ...baseReq, stream:true });
      for await (const chunk of s){
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done:true })}\n\n`);
      return res.end();
    }

    const c = await client.chat.completions.create(baseReq);
    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer:text, lang, topic });

  }catch(err){
    console.error("API /ask error:", err);
    return res.status(500).json({ error:"server_error", detail: err?.message || "unknown" });
  }
}
