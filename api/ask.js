// /api/ask.js — What?f Engine (FINAL MULTI-LANG · EXAMPLES-LOCKED · WTF-B STYLE)
// Stili: whatif (analitico | poetico) · wtf (B-style: roast affettuoso + imprecazione fisica + reazioni + drink + risposta + chiusa)
// Un paragrafo, seconda persona, niente elenchi, niente emoji, niente eco della domanda.

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
const isLang = (lang, code) => String(lang||"it").toLowerCase().startsWith(code);
const isEN = (l)=>isLang(l,"en");
const isES = (l)=>isLang(l,"es");
const isFR = (l)=>isLang(l,"fr");
const isDE = (l)=>isLang(l,"de");

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
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:|pregunta:|frage:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,""); return t;
}

/* ========= Modalità temporale ========= */
function temporalInstruction(periodo="future", lang="it"){
  if(String(periodo).toLowerCase()==="past"){
    if(isEN(lang)) return "Write as if it already happened (past/conditional allowed).";
    if(isES(lang)) return "Escribe como si ya hubiera pasado (pasado/condicional).";
    if(isFR(lang)) return "Écris comme si c'était déjà arrivé (passé/conditionnel).";
    if(isDE(lang)) return "Schreibe, als wäre es bereits passiert (Vergangenheit/Konditional).";
    return "Scrivi come se fosse già successo (passato/condizionale).";
  }
  if(isEN(lang)) return "Write as a near-future unfolding starting now.";
  if(isES(lang)) return "Escribe como un futuro cercano que empieza ahora.";
  if(isFR(lang)) return "Écris comme un futur proche qui commence maintenant.";
  if(isDE(lang)) return "Schreibe wie eine nahe Zukunft, die jetzt beginnt.";
  return "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi e stile ========= */
/* Incipit come i tuoi esempi, bloccati in few-shot per guidare il tono. */
const EX_WHATIF_ANALITICO_IT =
`Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const EX_WHATIF_POETICO_IT =
`Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* Istruzioni sintetiche per ogni lingua */
function whatifAnaliticoStyle(lang){
  if(isEN(lang)) return `WHAT IF Analytic: grounded, everyday tradeoffs, calm ending. 135–155 words. Second person only.`;
  if(isES(lang)) return `WHAT IF Analítico: concreto, intercambios cotidianos, cierre sereno. 135–155 palabras. Segunda persona.`;
  if(isFR(lang)) return `WHAT IF Analytique : concret, quotidien, conclusion posée. 135–155 mots. 2e personne.`;
  if(isDE(lang)) return `WHAT IF Analytisch: konkret, alltagstauglich, ruhiger Schluss. 135–155 Wörter. 2. Person.`;
  return `WHAT IF Analitico: concreto, scambi reali, chiusa calma. 135–155 parole. Seconda persona.`;
}
function whatifPoeticoStyle(lang){
  if(isEN(lang)) return `WHAT IF Poetic: lean sensory images, reconciled close. 135–155 words. Second person only.`;
  if(isES(lang)) return `WHAT IF Poético: imágenes sobrias, cierre reconciliado. 135–155 palabras. Segunda persona.`;
  if(isFR(lang)) return `WHAT IF Poétique : images sobres, fin réconciliée. 135–155 mots. 2e personne.`;
  if(isDE(lang)) return `WHAT IF Poetisch: nüchterne Bilder, versöhnlicher Schluss. 135–155 Wörter. 2. Person.`;
  return `WHAT IF Reale/Poetico: immagini quotidiane sobrie, chiusa riconciliata. 135–155 parole. Seconda persona.`;
}

/* ========= WTF — BANCA SFOGHI & REAZIONI (esagerate ma senza slur) ========= */
const WTF_SFOGO_BANK_IT = [
  "ti esplode una bestemmia-tornado che rimette in riga le sedie",
  "ti parte un bestemmione corazzato che lucida i cucchiaini da solo",
  "ti scappa una bestemmia-sisma che sposta di mezzo centimetro il bancone",
  "ti sale una bestemmia a turbina che asciuga il pavimento bagnato",
  "ti esce una bestemmia a martello pneumatico che convince il citofono a scusarsi",
  "ti vibra una bestemmia a sirena del porto che ferma i pensieri in doppia fila",
  "ti lanci in una bestemmia orchestrale che accorda i rumori di casa",
  "ti scivola una bestemmia a idrante che spegne un incendio che esisteva solo nella testa",
  "ti scappa una bestemmia a neon intermittente che fa finta di essere filosofia",
  "ti parte una bestemmia a compressore che appiana la giornata storta"
];

const WTF_REACTIONS_BANK_IT = [
  "la lampada sfarfalla in Morse come se capisse",
  "il campanile tossisce un amen stonato (solo rumoristico, niente slur)",
  "i bicchieri applaudono in cristallo e chiedono il bis",
  "la tapparella si abbassa per pudore e poi risale curiosa",
  "Alexa finge un aggiornamento e sparisce in non disturbare",
  "il POS si benedice da solo con un errore 08 e poi ci ripensa",
  "la moka fischia una standing ovation fuori orario",
  "il ventilatore gira al contrario per un secondo, per rispetto",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita",
  "il citofono fa uno squillo di solidarietà e poi si pente",
  "il frigorifero sospira e sceglie la vita minimalista",
  "la porta automatica si apre da sola e subito si vergogna"
];

/* ========= WHAT THE F — ISTRUZIONI (B-STYLE COME I TUOI ESEMPI) ========= */
function wtfStrict(lang){
  if(isEN(lang)) return `WHAT THE F (roasty but loving): One paragraph (145–165 words). Open with a brief affectionate roast (1–2 sentences). Then a single, huge, funny “imprecation” moment (use the word “imprecation/curse” explicitly, no slurs), immediately followed by 2–3 reacting-objects gags (only if relevant), a small alcohol beat, a real concrete answer (1–2 sentences), and a witty warm close. Second person only. No lists, no emojis, do NOT restate the question.`;
  if(isES(lang)) return `WHAT THE F (roast cariñoso): Un párrafo (145–165 palabras). Abre con una burla afectuosa (1–2 frases). Luego un único momento de “imprecación” grande y cómica (usa la palabra “imprecación/bestemmia” sin insultos), seguido de 2–3 objetos que reaccionan (si tiene sentido), un pequeño trago, una respuesta concreta (1–2 frases) y cierre irónico y cálido. Segunda persona. Sin listas ni emojis ni eco de la pregunta.`;
  if(isFR(lang)) return `WHAT THE F (roast affectueux): Un paragraphe (145–165 mots). Ouvre avec une taquinerie chaleureuse (1–2 phrases). Puis un seul moment d’“imprécation” énorme et drôle (utilise le mot, sans injures), enchaîne 2–3 objets qui réagissent (si pertinent), un petit moment alcool, une réponse concrète (1–2 phrases) et une chute ironique et tendre. 2e personne. Pas de listes, pas d’emojis, ne répète pas la question.`;
  if(isDE(lang)) return `WHAT THE F (liebevolles Roast): Ein Absatz (145–165 Wörter). Starte mit einem warmen Sticheln (1–2 Sätze). Dann ein einziger, großer, lustiger “Fluch/Bestemmia”-Moment (das Wort verwenden, keine Beleidigungen), direkt 2–3 reagierende-Objekt Gags (falls passend), ein kleiner Drink, eine konkrete Antwort (1–2 Sätze) und ein warm-witziger Schluss. Zweite Person. Keine Listen, keine Emojis, Frage nicht wiederholen.`;
  return `WHAT THE F (roast affettuoso): Un paragrafo (145–165 parole). Apri con una presa in giro affettuosa (1–2 frasi). Poi un unico momento di “bestemmia/imprecazione” enorme e comica (usa la parola), subito 2–3 reazioni di oggetti (solo se ha senso), un accenno di alcol, una risposta concreta (1–2 frasi) e chiusura ironica e calda. Solo seconda persona. Niente elenchi, niente emoji, NON ripetere la domanda.`;
}

/* ========= Few-shot ESATTI dai tuoi esempi (IT) ========= */
const WTF_FEWSHOTS_IT = [
  // BAR
  `ESEMPIO • WTF • Bar
Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte una bestemmia santa del vapore infame, così grossa che tremano i bicchieri. La macchina del caffè sputa vendetta e il frigorifero tossisce; in fondo una signora sussurra che al confessionale la tengono di scorta. Ti versi un goccio di liquore per calmare i santi e giuri che domani apri un bar solo per matti. In realtà ce la farai: ordini più sensati, mani più sicure, errori che insegnano. Morale: il caos non si educa — gli offri da bere e si comporta meglio.`,
  // MOTO
  `ESEMPIO • WTF • Moto
Oh, eccoci, centauro dell’inferno: casco lucido, cuore impavido e orgoglio pronto a fare danni. Parti e la libertà ti accarezza, poi un’ape decide che il tuo collo è il suo destino. Ti scappa un bestemmione che spacca l’aria e il semaforo passa al rosso per rispetto, mentre un cane cambia marciapiede da solo. Ti fermi, respiri, bevi un sorso corto “per lavare via la bestemmia” e riparti più sciolto. La verità? La moto ti apre la testa: più disciplina, più strada buona, più attenzione viva. Tornando, motore e voce si fondono: libertà e imprecazioni ben calibrate fanno ritmo.`,
  // INNAMORARSI
  `ESEMPIO • WTF • Innamorarsi
Ah, Luisa… ci risiamo: ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza e sparisce e senti salire la pressione come se stessi caricando una colpa. Ti parte una madonna della miseria — detta a voce bassa e senza offendere nessuno — così sincera che la lampada sfarfalla e il bicchiere applaude da solo. Alexa finge un aggiornamento, tu prendi un sorso di rosso e capisci che l’unica prova è restare. Finirà che ami meglio, con meno teatro e più schiena dritta. E se va male: brindisi, bestemmia piccola e giorni che ritrovano posto.`
];

/* ========= WHAT IF few-shots (IT) ========= */
const WHATIF_FEWSHOTS_IT = [
  `ESEMPIO • WHAT IF • Analitico\n${EX_WHATIF_ANALITICO_IT}`,
  `ESEMPIO • WHAT IF • Poetico\n${EX_WHATIF_POETICO_IT}`,
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode }){
  const sysRules = isEN(lang)
    ? `RULES: One paragraph, no bullets, no emojis, do NOT restate the question. Second person only. Length: WHAT IF 135–155, WTF 145–165.`
    : isES(lang)
    ? `REGLAS: Un párrafo, sin listas, sin emojis, no repitas la pregunta. Segunda persona. Longitud: WHAT IF 135–155, WTF 145–165.`
    : isFR(lang)
    ? `RÈGLES : Un seul paragraphe, pas de listes, pas d’emojis, ne répète pas la question. 2e personne. Longueur : WHAT IF 135–155, WTF 145–165.`
    : isDE(lang)
    ? `REGELN: Ein Absatz, keine Listen, keine Emojis, Frage nicht wiederholen. 2. Person. Länge: WHAT IF 135–155, WTF 145–165.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Solo seconda persona. Lunghezze: WHAT IF 135–155, WTF 145–165.`;

  const msgs = [
    { role: "system", content: sysRules },
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  if (stile === "wtf") {
    msgs.push({ role: "system", content: wtfStrict(lang) });

    // Banche (IT usate come “sapore”, non devono comparire letterali obbligatoriamente)
    msgs.push({ role: "system", content:
      `ISPIRAZIONI SFOGO (IT): ${WTF_SFOGO_BANK_IT.join(" · ")}\n` +
      `REAZIONI (IT): ${WTF_REACTIONS_BANK_IT.join(" · ")}`
    });

    // Few-shots IT esatti per bloccare tono (funziona anche multi-lingua: il modello impara il registro)
    WTF_FEWSHOTS_IT.forEach(s => msgs.push({ role: "system", content: s }));

  } else {
    // WHAT IF
    const styleLine = (mode === "analitico") ? whatifAnaliticoStyle(lang) : whatifPoeticoStyle(lang);
    msgs.push({ role: "system", content: styleLine });
    WHATIF_FEWSHOTS_IT.forEach(s => msgs.push({ role: "system", content: s }));
  }

  msgs.push({
    role: "user",
    content:
      (isEN(lang) ? `User question (do NOT restate it): "${domanda}". Generate ONE answer in ${String(lang).toUpperCase()} as a single paragraph, obeying the style.` :
       isES(lang) ? `Pregunta del usuario (NO la repitas): "${domanda}". Genera UNA respuesta en ${String(lang).toUpperCase()} en un solo párrafo, siguiendo el estilo.` :
       isFR(lang) ? `Question (NE LA répète pas) : « ${domanda} ». Génère UNE réponse en ${String(lang).toUpperCase()} en un seul paragraphe, en respectant le style.` :
       isDE(lang) ? `Frage (NICHT wiederholen): „${domanda}“. Erzeuge EINE Antwort auf ${String(lang).toUpperCase()} in einem Absatz, im passenden Stil.` :
       `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ${String(lang).toUpperCase()} a paragrafo unico, rispettando lo stile.`)
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
      mode  = "analitico",// per whatif: "analitico" | "reale" (poetico)
      lang  = "it",
      periodo = "future"
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, mode });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      frequency_penalty: (stile === "wtf") ? 0.35 : 0.1,
      presence_penalty: (stile === "wtf") ? 0.2 : 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // Guardrail: togli prima persona esplicita (per coerenza col “tu”)
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, "");

    // Guardrail nomi: non introdurre nomi non presenti nella domanda (eccetto incipit classici tipo "Ah"/"Oh")
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
