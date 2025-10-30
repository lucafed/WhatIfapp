// /api/ask.js — What?f Engine (FINAL BALANCED EDITION • WTF INCIPIT & IMPRECATION ENFORCED)
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
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function seededPick(arr, seedStr){
  if(!arr?.length) return "";
  let h=0; for(const c of String(seedStr||"")) h=(h*31 + c.charCodeAt(0))>>>0;
  return arr[h % arr.length];
}

/* ========= WHAT IF — esempi e stile (INCIPIT GENERICI) ========= */
const EX_WHATIF_ANALITICO_IT = `Guardando bene la mappa della tua vita, tornare a L’Aquila oggi significherebbe rimettere ordine nelle priorità: tempo, relazioni, qualità dell’aria quotidiana. L’economia si muove piano ma tiene; più reti locali che multinazionali, più artigiani che capannoni. Gli stipendi sono più bassi, ma la spesa e gli affitti pesano meno e il margine di respiro aumenta. Le scuole lavorano in maniera solida, la montagna restituisce tregua alle domeniche e i bambini crescono con un orizzonte vero oltre lo schermo. Il Veneto resterebbe forte per ritmo e occasioni, ma qui troveresti spazio, fiato e uno scambio più umano. Non sarebbe un passo indietro: sarebbe un passo fatto meglio, alla tua velocità.`;
const EX_WHATIF_REALE_IT = `Apri le finestre e l’aria fredda entra come una parola imparata bene. I vicoli riprendono il tuo passo, le montagne ti fanno da schiena. Al bar il caffè è corto e ruvido, e le voci di strada sanno di pane e d’inverno. I bambini giocano con l’eco invece che col rumore, e la sera si chiude con una risata che rimbalza nei portoni. Ogni giorno chiede meno prove, ogni sera più tua. Non torni indietro: torni dove il tempo ti riconosce per nome.`;

// Istruzioni WHAT IF (generiche, senza incipit fissi “Sai…”/“Bella questa…”)
const WHATIF_ANALITICO_STYLE_IT = `WHAT IF Analitico:
- Apertura sobria e neutra (no “Sai…”, no “Bella questa…”).
- Tono concreto: scambi reali, costi/benefici, routine, qualità della vita.
- Chiudi con una sintesi calma nello stile dell’esempio.
- 135–155 parole. Seconda persona soltanto.`;
const WHATIF_REALE_STYLE_IT = `WHAT IF Reale/Poetico:
- Apertura sensoriale sobria (niente formule ricorrenti).
- Immagini quotidiane, linguaggio asciutto.
- Chiudi riconoscendo luogo e tempo come alleati.
- 135–155 parole. Seconda persona soltanto.`;

/* ========= WTF — banche incipit + imprecazioni iperboliche + reazioni ========= */
const WTF_INCIPIT_BANK_IT = [
  "Ah ma guarda te, esploratore della domenica,",
  "Oh stratega improvvisato col cuore in tasca,",
  "Eccoti di nuovo, funambolo del forse,",
  "Ma guarda chi rientra in scena con la sicurezza di un piccione in stazione,",
  "Ah sì, gladiatore del dubbio col mantello sbrodolato,",
  "Campione del “domani vediamo”,",
  "Filosofo da marciapiede con ambizioni da terrazza panoramica,",
  "Ti presenti come un eroe di ritorno e inciampi nella tua stessa epica,",
  "Rientri come se la città avesse steso il tappeto rosso,",
  "Cuore grande, mappa confusa e passo teatrale,"
];

const WTF_IMPRECATION_BANK_IT = [
  "ti parte una bestemmia gonfia come un pallone da basket in fiamme nel corridoio del cervello",
  "esplode un bestemmione elastico che rimbalza tra le pareti come uno yoyo impazzito",
  "ti scappa una bestemmiata vaporosa che appanna i vetri e sgrana i magneti del frigo",
  "ti sale una bestemmia a fisarmonica che si apre e si richiude finché i cucchiaini non si arrendono",
  "ti scivola via un bestemmione con il turbo che fa tremare le mensole come in prova sismica",
  "sbocci una bestemmia coreografica che fa ondeggiare l’aria come una tendina in discoteca",
  "tiri fuori una bestemmiata con i pattini che slitta lungo la cucina lasciando strisce di sarcasmo",
  "accendi una bestemmia da fuochi d’artificio interiori che disegna cerchi sopra i pensieri",
  "liberi un bestemmione idraulico che apre tutte le valvole e scarica i nervi a cascata",
  "lanci una bestemmiata a molla che scatta tre volte e poi si sdraia sul tappeto a ridere"
];

const WTF_REACTIONS_BANK_IT = [
  "la lampada sfarfalla in Morse come se capisse tutto",
  "i bicchieri applaudono in cristallo e chiedono il bis",
  "la tapparella si abbassa per imbarazzo e poi risale curiosa",
  "Alexa finge un aggiornamento e scappa in ‘non disturbare’",
  "il POS recita un rosario di errori e poi si benedice da solo",
  "la moka fischia una standing ovation",
  "il ventilatore gira al contrario per reverenza",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita",
  "il citofono fa uno squillo di solidarietà e poi si pente",
  "il frigorifero si spegne per compassione",
  "la porta automatica si apre da sola e poi si vergogna",
  "il divano scricchiola come se ti stesse giudicando",
  "la sedia emette un sospiro sindacale",
  "il telecomando cambia canale da solo per non sentirti",
  "il cappotto appeso scuote le spalle come a dire “figurati”"
];

/* ========= WTF — istruzione sequenza (senza “4 colpi bassi” fissi) ========= */
const WTF_STRICT_IT = `WHAT THE F (sarcasmo demenziale ma rispondi davvero):
Sequenza OBBLIGATORIA in un solo paragrafo (145–165 parole):
1) APRI con uno di questi incipit (esattamente uno, senza verbi prima o dopo): 
   ${WTF_INCIPIT_BANK_IT.join(" · ")}
2) Prendilo in giro con affetto (1–2 frasi), scena viva legata alla domanda.
3) Fai succedere un paio di micro-sfighe realistiche (variazione libera, niente elenco).
4) Poi esplode UNA imprecazione iperbolica usando la parola “bestemmia/bestemmione/bestemmiata” (senza mai nomi religiosi). Descrivila in modo fisico e assurdo.
5) SUBITO DOPO inserisci 2 reazioni di oggetti coerenti alla scena (scegli tra la banca reazioni).
6) Accenno di alcol (sorso, amaro, bicchiere) che cambia la temperatura emotiva.
7) Rispondi davvero alla domanda con una previsione/controfattuale concreta (1–2 frasi).
8) Chiudi con una riga ironica che richiama l’apertura.
Vincoli: solo seconda persona; niente elenchi; niente emoji; niente nomi inventati; non ripetere la domanda; lingua semplice.`;

/* ========= Prompt builder ========= */
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
`ESEMPIO WTF (forma, tono, incipit, imprecazione iperbolica):
Ah ma guarda te, esploratore della domenica, arrivi convinto che basti il passo giusto e invece la giornata ti mette lo sgambetto con un sorriso storto; fai quello zen coi pensieri in fila e la tasca decide sciopero, il telefono scivola con la grazia di un frigorifero dal terzo piano. Stringi i denti, ti dici che va tutto bene… poi ti parte una bestemmia gonfia come un pallone da basket in fiamme nel corridoio del cervello e si spostano i magneti sul frigo; la lampada sfarfalla in Morse e la moka applaude come fosse Sanremo. Un amaro ti rimette le spalle in bolla e, mentre sistemi l’aria, ammetti che sì: puoi farlo davvero, basta inciampare con stile. Morale: il mondo non si conquista, si prende a testate con gentilezza.` }
    );
  } else {
    if (mode === "analitico") {
      msgs.push(
        { role: "system", content: WHATIF_ANALITICO_STYLE_IT },
        { role: "system", content: `ESEMPIO · WHAT IF (Analitico)\n${EX_WHATIF_ANALITICO_IT}` },
      );
    } else {
      msgs.push(
        { role: "system", content: WHATIF_REALE_STYLE_IT },
        { role: "system", content: `ESEMPIO · WHAT IF (Reale/Poetico)\n${EX_WHATIF_REALE_IT}` },
      );
    }
  }

  msgs.push({
    role: "user",
    content: `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ${lang.toUpperCase()} a paragrafo unico.`
  });
  return msgs;
}

/* ========= Post-process ENFORCERS per WTF ========= */
function ensureWtfIncipit(domanda, answer, lang){
  const start = answer.trim().slice(0,120).toLowerCase();
  const hasAny = WTF_INCIPIT_BANK_IT.some(x => start.startsWith(x.toLowerCase()));
  if (hasAny) return answer;
  const pick = seededPick(WTF_INCIPIT_BANK_IT, domanda);
  // Se inizia già con parola forte, aggiungo incipit + spazio
  return `${pick} ${answer.replace(/^[—–-]\s*/,"")}`;
}
function ensureOneBestemmia(answer, domanda){
  const rx = /\bbestemmi\w*|imprecazion\w*|sacrament\w*/i; // cerca presenza “bestemmia/bestemmione/bestemmiata…”
  if (rx.test(answer)) return answer;
  const imp = seededPick(WTF_IMPRECATION_BANK_IT, domanda);
  // Inserisco dopo la prima frase
  const parts = answer.split(/(?<=[.!?])\s+/);
  if (parts.length>1){
    parts.splice(1,0, imp.charAt(0).toUpperCase()+imp.slice(1) + ".");
    return parts.join(" ");
  }
  return answer + " " + imp + ".";
}
function ensureTwoReactions(answer, domanda){
  const countReacts = (answer.match(/lampada|moka|tapparella|Alexa|POS|ventilatore|statua|citofono|frigorifero|porta automatica|divano|sedia|telecomando|cappotto/gi)||[]).length;
  if (countReacts>=2) return answer;
  const r1 = seededPick(WTF_REACTIONS_BANK_IT, domanda+"r1");
  const r2 = seededPick(WTF_REACTIONS_BANK_IT.filter(x=>x!==r1), domanda+"r2");
  return answer.replace(/([.!?])\s*$/, `. ${r1}, ${r2}.`);
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

    // Post-process comune
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 168 : 160);
    answer = normalizeOneParagraph(answer);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // Enforcers specifici WTF
    if (stile === "wtf"){
      answer = ensureWtfIncipit(domanda, answer, lang);
      answer = ensureOneBestemmia(answer, domanda);
      answer = ensureTwoReactions(answer, domanda);
    }

    // Guard-rail lingua: niente prima persona dichiarativa
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, "");

    // Guard-rail nomi: non introdurre nomi non presenti nella domanda
    (function(){
      const d = String(domanda||"");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion = new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m)=>{
        return inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m) ? m : m.toLowerCase());
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
