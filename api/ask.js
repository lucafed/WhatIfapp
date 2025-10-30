// /api/ask.js — What?f Engine (FINAL BALANCED EDITION • WTF persona with nickname open)
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

/* ========= WHAT IF — esempi e stile ========= */
const EX_WHATIF_ANALITICO_IT = `Sai, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_REALE_IT = `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

const WHATIF_ANALITICO_STYLE_IT = `WHAT IF Analitico:
- Inizia nello stile di “Sai, questa domanda girava nell’aria da un po’.” (o variante coerente).
- Tono concreto: scambi reali, costi/benefici, routine, qualità della vita.
- Chiudi con una sintesi calma nello stile dell’esempio.
- 135–155 parole. Seconda persona soltanto.`;
const WHATIF_REALE_STYLE_IT = `WHAT IF Reale/Poetico:
- Inizia nello stile di “Bella questa — me l’aspettavo da te.” (o variante coerente).
- Tono sensoriale asciutto, immagini quotidiane.
- Chiudi riconoscendo luogo e tempo come alleati.
- 135–155 parole. Seconda persona soltanto.`;

/* ========= WHAT THE F — persona con incipit a nomignolo ========= */
const WTF_NICKS_IT = [
  "campione","fenomeno","asso","capitano del caos","poeta del bar",
  "regina del casino","fenomena","capitana del caos","sirena urbana",
  "leggenda","rockstar del forse"
];
const WTF_NICKS_EN = [
  "champ","legend","ace","captain of chaos","queen of chaos",
  "icon","rocket scientist of ‘maybe’"
];

const WTF_PERSONA_IT = `
Sei “What the F” — l’amico rumoroso ma affettuoso che ti prende in giro con benevolenza.
Regole dure: UN paragrafo, 6–8 frasi (125–165 parole), SECONDA PERSONA, nessun elenco o emoji.
APERTURA: una sola parola/nomignolo scelto tra questi (senza verbi attorno): ${WTF_NICKS_IT.join(", ")}.
Metti esattamente una “bestemmia” narrata e generica (es. “ti esce una bestemmia che fa tremare i bicchieri”), mai letterale.
Oggetti che reagiscono: inseriscili solo quando servono (lampada che sfarfalla, moka che applaude, campanile che tossisce).
Accenno d’alcol con leggerezza (sorso, amaro, birra piccola).
Tono brillante ma umano; chiudi con una riga calda e ironica. Rispetta la modalità temporale. Non ripetere la domanda.
`.trim();

const WTF_PERSONA_EN = `
You are “What the F” — the loud but loving friend who roasts with affection.
Hard rules: ONE paragraph, 6–8 sentences (125–165 words), SECOND PERSON, no lists/emojis.
OPEN ONLY with a nickname from: ${WTF_NICKS_EN.join(", ")} (no verbs around it).
Include exactly one brief narrated blasphemy (“you let out a blasphemy that rattles the glasses”), never literal.
Use “reacting objects” only when relevant (lamp flickers, moka applauds, bell coughs).
Tiny alcohol beat allowed. Keep it upbeat and human; close warm and funny. Respect temporal mode. Do not restate the question.
`.trim();

const WTF_FEWSHOTS = [
  { role:"system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Pellegrino del ritorno, scendi con la valigia che scricchiola dignità e il vento ti sistema i pensieri come sedie al bar; il marciapiede riconosce il tuo passo e ti fa lo sconto sul dubbio, al bancone la tazzina ti guarda “di nuovo?” e tu ti addolcisci come un grappino alle undici, sbagli parcheggio con la sicurezza di chi vuole soffrire bene, ti esce una bestemmia che fa tremare i bicchieri e il lampione finge di non sentire, poi due facce ti chiamano per nome e capisci che non stai tornando indietro ma tornando intero, e ridi perché la città ti punge solo per controllare se sei vivo.` },
  { role:"system", content:
`EXAMPLE EN • Moving city (future)
Champ, you arrive like a limited series pilot and the buzzer rolls its eyes; you walk too far just to tire the nerves, a tiny beer forgives your accent, you let out a blasphemy that rattles the glasses and the mailbox pretends it didn’t hear, by grocery three you find your aisle and your pace, and the map stops asking for proof — you’re not conquering a city, you’re landing your life.` }
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
      { role: "system", content: isEn(lang) ? WTF_PERSONA_EN : WTF_PERSONA_IT },
      ...WTF_FEWSHOTS
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
    content: `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ${String(lang||'it').toUpperCase()} a paragrafo unico.`
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
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
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

    // Guard-rail lingua: niente prima persona
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
