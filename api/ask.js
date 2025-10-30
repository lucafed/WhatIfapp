// /api/ask.js — What?f Engine (HARD-LOCKED WTF • GENERIC WHATIF OPENING)
// Stili: whatif (analitico | reale) · wtf
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
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
function randPick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; if(p.split(/\s+/).length<=3 && !/[.!?]$/.test(p)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,""); return t;
}

/* ========= Modalità temporale ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en = isEn(lang);
  if(String(periodo).toLowerCase()==="past"){
    return en
      ? "Write as if it already happened (past/conditional allowed)."
      : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en
    ? "Write as a near-future unfolding starting now."
    : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — generico (niente incipit fisso vecchio) ========= */
const WHATIF_ANALITICO_STYLE_IT = `WHAT IF Analitico:
- Incipit generico, sobrio (niente nomi propri gratuiti).
- Tono concreto: routine, costi/benefici, qualità della vita.
- Chiudi con una sintesi calma.
- 135–155 parole. Seconda persona.`;
const WHATIF_REALE_STYLE_IT = `WHAT IF Reale/Poetico:
- Incipit generico, immagini quotidiane asciutte.
- Respiro narrativo breve; niente eroismi.
- Chiudi riconciliando luogo e tempo.
- 135–155 parole. Seconda persona.`;

/* ========= WTF — HARD LOCK (banca sfoghi & reazioni) ========= */
const WTF_OPENINGS = [
  "Ah ma guarda te,",
  "Oh, eccoci,",
  "Eccoti qui,",
  "Ah, sì, certo,",
  "Ma figurati,",
];

const WTF_SFOGHI = [
  "ti parte una bestemmia a sirena che lucida i bicchieri e piega l’aria in diagonale",
  "sganci una bestemmia compressa che rimbalza sulle piastrelle come una biglia impazzita",
  "spingi fuori una bestemmia a turbina che fa ondeggiare i tovaglioli come bandiere bianche",
  "lasci andare una bestemmia corazzata che sfiora i muri e rimette in riga le sedie",
  "ti scappa una bestemmia elastica che si allunga sul bancone e torna indietro come uno yo-yo stanco",
  "spari una bestemmia a molla che fa saltare un paio di cucchiaini in perfetta coreografia",
  "tiri fuori una bestemmia a pressione che stappa il silenzio come una bottiglia testarda",
  "liberi una bestemmia a grandinata che picchietta sul metallo e convince il ghiaccio a comportarsi bene",
  "sguscia una bestemmia a frusta che sgrana l’aria e mette in fila i pensieri come soldatini",
  "ti esce una bestemmia a rullo che stende la scena e poi la spiana con garbo criminale"
];

const WTF_REAZIONI = [
  "la lampada sfarfalla in Morse come se volesse offrirti un tutorial",
  "il frigorifero sospira e decide di diventare minimalista",
  "la tapparella si abbassa per imbarazzo e poi risale con curiosità",
  "il POS fa finta di aggiornarsi e si mette in modalità timido",
  "la moka ti applaude con un fischio da capocomico",
  "il ventilatore gira al contrario solo per rispetto",
  "il citofono lascia un beep di solidarietà e poi arrossisce",
  "i bicchieri fanno tintinnìo di approvazione da orchestra da camera",
  "la porta automatica si apre da sola e poi si vergogna",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita",
  "Alexa prende nota e archivia sotto ‘momenti educativi’",
  "il semaforo lì fuori pensa al rosso e cambia idea per educazione"
];

function forceWtfParagraph(core) {
  // 1) Apertura
  let out = `${randPick(WTF_OPENINGS)} `;
  // 2) Roast: prendo 1–2 frasi dal core come “presa in giro”
  const parts = String(core||"").split(/(?<=[.!?])\s+/).filter(Boolean);
  const roast = parts.slice(0,2).join(" ");
  out += roast ? roast.replace(/^[A-Z]/, (m)=>m.toLowerCase()) + " " : "sempre convinto che oggi ti basti l’entusiasmo e due graffette. ";

  // 3) Sfogo (contiene SEMPRE la parola “bestemmia”)
  const sfogo = randPick(WTF_SFOGHI);
  out += sfogo.endsWith(".") ? sfogo+" " : sfogo+". ";

  // 4) Reazioni (2)
  const r1 = randPick(WTF_REAZIONI);
  let r2 = randPick(WTF_REAZIONI);
  let guard = 0;
  while(r2===r1 && guard++<5) r2 = randPick(WTF_REAZIONI);
  out += `${r1}, ${r2}. `;

  // 5) Alcol beat
  out += "bevi un sorso corto e onesto, che riposiziona i pensieri senza chiedere permesso. ";

  // 6) Risposta concreta (prendo l’ultima 1–2 frasi del core)
  const tail = parts.slice(-2).join(" ");
  if (tail) out += tail.endsWith(".") ? tail+" " : tail+". ";

  // 7) Chiusura ironica
  out += "morale: se il caos non si educa, gli offri da bere e si comporta meglio.";

  // Single paragraph + limiti
  out = normalizeOneParagraph(out);
  out = tightenSentences(out, 9);
  out = clampWords(out, 165);
  if(!/[.!?…]$/.test(out)) out+=".";
  // parola “bestemmia” garantita
  if(!/bestemmi\w*/i.test(out)){
    out = out.replace(/\s+morale:/i, " ti scappa pure un’ultima bestemmia sottovoce e nessuno fa finta di niente. Morale:");
  }
  return out;
}

/* ========= What If few rules to guide the core ========= */
const WHATIF_RULES_IT = `WHAT IF — un paragrafo, seconda persona, 135–155 parole.
- Apertura generica (es. “Oggi guardi la cosa da vicino.” / “Metti in fila i pezzi.” / “Ti avvicini senza fretta.”)
- Tono: calmo, concreto (Analitico) o sensoriale asciutto (Reale).
- Nessuna domanda, nessun elenco, nessun nome inventato.
- Chiudi con una riga breve, riflessiva, non un consiglio.`;

/* ========= WTF — i TUOI tre esempi, inclusi per tono ========= */
const WTF_FEWSHOTS_IT = [
  { role: "system", content:
`ESEMPIO WTF • Bar (stile)
Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte una bestemmia a sirena che lucida i bicchieri e piega l’aria in diagonale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in lista. Ti versi un goccio di liquore per abbassare il volume del cervello e giuri che domani apri solo per professionisti del caos. Alla chiusura, il bancone ti guarda e tu, esausto, sussurri che oggi hai bestemmiato più della pazienza — ma almeno hai servito verità calde.`},
  { role: "system", content:
`ESEMPIO WTF • Moto (stile)
Oh, eccoci, centauro con l’ansia lucidata. Casco nuovo, spalle larghe, ego al minimo sindacale. Parti e la libertà ti fischia nelle orecchie, poi un’ape decide che il tuo collo è mitologico. Esce un bestemmione che spacca l’aria, il semaforo cambia umore e un cane attraversa da solo per rispetto. Ti fermi, respiri, bestemmi di nuovo in formato carezza, come rito di taratura. Al bar ordini da bere per lavare la bestemmia e il barista ti serve doppio, complici senza verbale. Torni a casa con l’eco del motore e la tua voce, fuse in una sinfonia che, onestamente, ti sta proprio bene addosso.`},
  { role: "system", content:
`ESEMPIO WTF • Innamorarsi (stile)
Eccoti qui, specialista nel tuffo senza acqua. Lui ti visualizza e scappa, e il sangue ti sale come un ascensore arrabbiato. Parte una bestemmia della miseria che accende la lampada e fa applaudire il bicchiere, il gatto valuta il trasloco e Alexa si mette in aggiornamento spirituale. Bevi un sorso di rosso e ti rimetti a fuoco, che tanto l’amore lo impari sempre a colpi di scena. Alla fine ridi, bestemmi piano come fosse stretching, e la notte annuisce: hai fatto il tuo giro, domani ricominci meglio.`}
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode }){
  const msgs = [
    { role: "system", content: isEn(lang)
        ? `RULES: one paragraph, no bullets, no emojis, do NOT restate the question. Near-future. Second person only. No invented names. Length: WHATIF 135–155, WTF 145–165.`
        : `REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Prossimo futuro. Solo seconda persona. Niente nomi inventati. Lunghezza: WHATIF 135–155, WTF 145–165.` },
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  if (stile === "wtf") {
    msgs.push(
      { role: "system", content: `WHAT THE F — tono rude, ironico, adulto. Usa “bestemmia/bestemmione/bestemmie” come parola fisica e comica, senza riferimenti religiosi.` },
      ...WTF_FEWSHOTS_IT
    );
  } else {
    msgs.push({ role: "system", content: WHATIF_RULES_IT });
    if (mode === "analitico") {
      msgs.push({ role: "system", content: WHATIF_ANALITICO_STYLE_IT });
    } else {
      msgs.push({ role: "system", content: WHATIF_REALE_STYLE_IT });
    }
  }

  msgs.push({
    role: "user",
    content: `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ${lang.toUpperCase()} a paragrafo unico.`
  });
  return msgs;
}

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
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      mode  = "reale",    // per whatif: "analitico" | "reale"
      lang  = "it",
      periodo = "future"
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, mode });

    const completion = await client.chat.completions.create({
      model: MODEL,
      // Abbasso temp sul WTF per aderire al tono; WhatIf resta morbido
      temperature: stile === "wtf" ? 0.7 : 0.82,
      top_p: 0.9,
      max_tokens: 480,
      frequency_penalty: 0.15,
      presence_penalty: 0.05,
      messages,
    });

    let core = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!core) throw new Error("empty_model_response");

    // Post-process base
    core = stripQuestionEcho(domanda, core);
    core = normalizeOneParagraph(core);

    let answer = core;

    // Hard lock WTF: ricompongo forzatamente nello stile esempi
    if (stile === "wtf") {
      answer = forceWtfParagraph(core);
    } else {
      // WhatIf limiti e chiusura
      answer = tightenSentences(answer, 11);
      answer = clampWords(answer, 155);
      if(!/[.!?…]$/.test(answer)) answer += ".";
    }

    // Guard-rail lingua: togli prima persona
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, "");

    // Guard-rail nomi: non introdurre nomi non presenti nella domanda
    (function(){
      const d = String(domanda||"");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion = new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m)=>{
        return inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai","Ma","Eccoti"].includes(m) ? m : m.toLowerCase());
      });
    })();

    return res.status(200).json({
      answer,
      style: stile,
      mode,
      lang,
      periodo,
      model: MODEL
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
