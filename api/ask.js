// /api/ask.js — What?f Engine (FINAL BALANCED • WTF = “bestemmia narrata” power-up)
// Stili: whatif (analitico | reale) · wtf
// Regole: 1 paragrafo, seconda persona, niente elenchi, niente emoji, no eco della domanda, nessun nome inventato.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL  = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res){
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
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
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,"");
  return t;
}
function tinyHash(s=""){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36); }

/* ========= Modalità temporale ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en=isEn(lang);
  if(String(periodo).toLowerCase()==="past"){
    return en
      ? "Write as if it already happened (past/conditional allowed)."
      : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en
    ? "Write as a near-future unfolding starting now."
    : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — stile generico (niente incipit fissi) ========= */
const WHATIF_ANALITICO_STYLE_IT = `WHAT IF Analitico:
- Apertura sobria e generica (nessuna frase fissa). 
- Tono concreto: scambi reali, costi/benefici, routine, qualità della vita.
- Micro-dettagli quotidiani, niente eroismi.
- Chiudi con una riga riflessiva breve e pacata.
- 135–155 parole. Solo seconda persona.`;

const WHATIF_REALE_STYLE_IT = `WHAT IF Reale/Poetico:
- Apertura sensoriale generica (nessuna frase fissa).
- Immagini quotidiane asciutte (chiavi, aria, passi, luce), ritmo calmo.
- Riconciliazione con luogo/tempo verso la chiusa.
- 135–155 parole. Solo seconda persona.`;

/* ========= WTF — “bestemmia narrata” + reazioni comiche ========= */
/* Sfoghi: nessun riferimento religioso; usa la parola “bestemmia” come etichetta narrativa, comica, iperbolica */
const SFOGO_RIDICOLO_BANK = [
  "una bestemmia narrata che sembra sparata da un compressore emozionale in fiamme",
  "una bestemmia narrata talmente pressurizzata che piega una cannuccia metallica al passaggio",
  "una bestemmia narrata formato jet che lascia scie luminose di frustrazione nell’aria",
  "una bestemmia narrata così potente da far rimbalzare una briciola di pane in slow-motion",
  "una bestemmia narrata a onde concentriche che riarreda i pensieri come un terremoto gentile",
  "una bestemmia narrata a grandinata fonetica che stira le rughe al silenzio",
  "una bestemmia narrata supersonica che fa cadere un magnete dal frigo per lo spavento",
  "una bestemmia narrata in Dolby Surround che convince il vento a girare al contrario",
  "una bestemmia narrata elastica che si allunga, schiocca e torna indietro più educata",
  "una bestemmia narrata pirotecnica, tutta scintille e consonanti esplose",
  "una bestemmia narrata a vapore che fischia come una moka in crisi identitaria",
  "una bestemmia narrata a rullo compressore che appiattisce un dubbio di tre dimensioni",
  "una bestemmia narrata centrifuga che fa il ciclo rapido all’ansia",
  "una bestemmia narrata a effetto domino che fa cadere due pensieri e alzare il terzo",
  "una bestemmia narrata che pare un drago allergico alla pazienza",
];

/* Reazioni comiche: oggetti che reagiscono, senza esagerare con la scena 'teatrino', ma visive e secche */
const REACTIONS_BANK = [
  "la moka applaude a vapore e poi finge di non essere stata lei",
  "il frigo fa luce una volta sola come per dire basta così",
  "il ventilatore gira due colpi al contrario e si arrende",
  "la sedia scricchiola in autodifesa e poi si quieta",
  "Alexa va in silenzioso per rispetto e poi sospira da umana",
  "la porta si apre da sola di un dito, poi ci ripensa",
  "il bicchiere suda condensa come dopo una corsa",
  "la pianta finta vibra come se avesse fatto troppo yoga",
  "il citofono fa un beep di solidarietà e si vergogna",
  "la ciabatta multipresa lampeggia come una seduta spiritica",
  "lo specchio restituisce un pollice-verso minimalista",
  "il POS tossisce una ricevuta bianca e chiede scusa",
  "la tapparella scatta un dente e torna al suo posto",
  "la lampada sfarfalla in Morse: «ok, ricevuto»",
  "la lavatrice aggiunge due giri brevi per scaramanzia",
];

/* Istruzione WTF: sequenza snella con “bestemmia narrata” */
const WTF_STRICT_IT = `WHAT THE F (sarcastico, demenziale, affettuoso):
Struttura OBBLIGATORIA in un paragrafo (145–165 parole):
1) Apertura con UN nomignolo secco (nessun verbo attaccato), poi due prese in giro affettuose.
2) Tensione che sale (2–3 micro inciampi realistici, secchi).
3) Esplode UNA “bestemmia narrata” (usa proprio la parola “bestemmia”) scegliendo uno stile iperbolico dal pool fornito. Niente riferimenti religiosi.
4) SUBITO DOPO inserisci 2–3 reazioni comiche di oggetti (dal pool fornito).
5) Accenno d’alcol (sorso, amaro, gin microscopico).
6) Rispondi davvero alla domanda con una previsione/controfattuale concreta (1–2 frasi).
7) Chiudi con una riga ironica che richiama l’apertura.
Vincoli: solo seconda persona; niente elenchi; niente emoji; non ripetere la domanda; nessun nome inventato.
Banche disponibili (varia liberamente senza citarle esplicitamente nel testo):
- Bestemmia narrata: ${SFOGO_RIDICOLO_BANK.join(" · ")}.
- Reazioni: ${REACTIONS_BANK.join(" · ")}.`;

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
      { role: "system", content: WTF_STRICT_IT },
      { role: "system", content:
`ESEMPIO WTF (forma & tono, IT):
Campione, ti presenti come se avessi un tutorial in tasca e invece hai il Wi-Fi dell’autostima a una tacca; fai il serio, ma i passi inciampano sul primo pensiero storto e la tasca decide che oggi le chiavi suoneranno jazz. Resisti, conti fino a cinque, ci provi a passare elegante… poi ti parte **una bestemmia narrata che sembra sparata da un compressore emozionale in fiamme**, rimbalza sui muri, piega una cannuccia metallica e rimette in riga l’aria. La moka applaude a vapore, il frigo fa una sola luce come a dire basta così, il ventilatore gira due colpi al contrario e molla. Butti giù un dito d’amaro da manutenzione e, nel silenzio appena lucido, ammetti che sì: se lo fai davvero, domani scricchiola uguale ma con più mestiere. Morale: sei un casino adorabile, però funzionante.` }
    );
  } else {
    if (mode === "analitico") {
      msgs.push(
        { role: "system", content: WHATIF_ANALITICO_STYLE_IT },
        { role: "system", content:
`ESEMPIO WHAT IF (Analitico, IT):
La questione è concreta e non chiede eroi: chiede passi corti. Ti accorgi che il ritmo cambia il rumore nella testa: spese, tempi, persone; il bilancio non è solo soldi ma aria e sonno. Scambi veri, margini stretti, ma routine che torna mansueta quando smetti di inseguirla. Ti muovi tra alternative che non brillano, però reggono: meno vetrina, più sostanza. A fine giornata la somma non fa spettacolo, fa solidità. E ti somiglia.` }
      );
    } else {
      msgs.push(
        { role: "system", content: WHATIF_REALE_STYLE_IT },
        { role: "system", content:
`ESEMPIO WHAT IF (Reale/Poetico, IT):
Apri la finestra e l’aria ti mette in ordine i bordi. Cammini finché i passi imparano il marciapiede. Le mani ritrovano le chiavi senza cercarle e la luce di un lampione ti tiene il posto. Le cose non diventano facili: diventano tue, lentamente. E quel poco che basta, basta.` }
      );
    }
  }

  msgs.push({
    role: "user",
    content: `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ${String(lang||"it").toUpperCase()} a paragrafo unico.`
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
      temperature: stile === "wtf" ? 0.98 : 0.82,
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
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 168 : 160);
    answer = normalizeOneParagraph(answer);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // Guard-rail lingua: rimuovi prima persona esplicita
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, "");

    // Guard-rail nomi: non introdurre nomi assenti nella domanda
    (function(){
      const d = String(domanda||"");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion = new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m)=>{
        return inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai","Campione","Campionessa","Leggenda"].includes(m) ? m : m.toLowerCase());
      });
    })();

    return res.status(200).json({ answer, style: stile, mode, lang, periodo, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
