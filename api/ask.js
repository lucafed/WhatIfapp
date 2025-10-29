// /api/ask.js — What?f Engine (STABILE • BASE BUONA + FIX SEQUENZA)
// Stili: whatif (mode: analitico | reale) · wtf
// Paragrafo unico · Seconda persona · No emoji · No nomi inventati
// Lunghezze: WHATIF ~135–155 parole · WTF ~150–170 parole

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
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
function tinyHash(s=""){ let h = 2166136261>>>0; for (let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36); }
function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t=String(text||"");
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (t.toLowerCase().startsWith(d)) {
    const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim();
  }
  t=t.replace(rx,"");
  return t;
}

/* ========= Admin ========= */
async function isAdmin(req, requesterIp){
  const token = String(req.headers["x-admin-token"] || "").trim();
  if(!token) return false;
  try{
    const data = await redis.hgetall(`admin:token:${token}`); // { ip, ua }
    if(!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase()==="true";
    if(LOCK_IP) return data.ip && data.ip===requesterIp;
    return true;
  }catch{ return false; }
}

/* ========= Tempo ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en=isEn(lang);
  if(String(periodo).toLowerCase()==="past"){
    return en ? "Write as if it already happened (past/conditional allowed)."
              : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en ? "Write as a near-future unfolding starting now."
            : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= ESEMPI — WHAT IF ========= */
const EX_WHATIF_ANALITICO_IT = `Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_REALE_IT = `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= ESEMPI — WTF (forma corretta) ========= */
const EX_WTF_MOTO_IT = `Ti convinci che la moto sia la cura definitiva contro la noia: libertà, vento, romanticismo a due ruote. I primi metri sembrano un film, poi il copione cambia: casco che appanna, giacca che s’incolla, GPS che ti manda dentro una rotonda infinita e un piccione che ti elegge pista d’atterraggio. A quel punto ti esplode un bestemmione corazzato, un suono primordiale che fa tremare le vetrine e interrompe la messa delle 18. Il semaforo lampeggia per rispetto, un cane smette di abbaiare e un tizio in bici applaude in silenzio. Ti fermi al bar più vicino per una sbronza elegante — doppio amaro e birra anti-trauma — e giuri che domani ci riprovi solo col sole. Poi guardi la moto da fuori, grondante come te, e pensi: sì, va bene così — tanto la libertà, se non ti bagna, non vale niente.`;
const EX_WTF_BAR_IT  = `Ti convinci che sarà un rifugio zen: caffè perfetti, clienti sorridenti e musica jazz di fondo. Poi apri, e la realtà entra in coda. Il macinino tossisce, la macchina sputa vapore come un drago astmatico, un cliente chiede latte d’avena d’alce e il POS decide di aggiornarsi per l’eternità. È lì che sganci una imprecazionona a scoppio ritardato, una scarica di pura disperazione baristica che fa tremare i cucchiaini; il frigorifero si spegne per solidarietà, una signora fa il segno della croce col cappuccino e Alexa ti cancella dalle playlist. Ti versi un bicchierino di emergenza professionale, poi un altro per precauzione. Alla fine sorridi, guardi il bancone e pensi: forse non hai aperto un bar… hai fondato un centro di riabilitazione per nervi tesi.`;
const EX_WTF_STUDIO_IT = `Ti dici che è ora di rimetterti in gioco, che lo studio è rinascita, che il cervello va tenuto in allenamento. Primo giorno: la sedia cigola come un giudizio divino, il Wi-Fi si arrende, il prof inizia dal capitolo otto e il compagno accanto mastica penne con fervore religioso. A quel punto detoni una para-bestemmia baritonale, un rombo mistico che fa tremare i vetri; il proiettore lampeggia amen, le fotocopie cadono in processione e la macchinetta del caffè eroga solo acqua santa. Ti rifugi al bar universitario, chiedi un caffè corretto all’autostima e lo bevi come fosse penitenza. Torni sui libri, un po’ storto ma testardo, e capisci che studiare è come bestemmiar bene: serve ritmo, pazienza e la giusta quantità di fede.`;

/* ========= Pool incipit/reattivi (WTF) ========= */
const WTF_OPENINGS = [
  "Ah ma guarda te,",
  "Oh, eccoci,",
  "Ti presenti elegante e il destino in ciabatte,",
  "Giornata da manuale, capitolo imprevisti,",
  "Hai studiato tutto, tranne il caos,",
  "Sembra facile finché non tocca a te,"
];

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
  "la lampada fa facepalm e sfarfalla in Morse",
  "il campanile tossisce un amen stonato",
  "il POS recita un rosario di errori e si benedice da solo",
  "la tapparella si abbassa per imbarazzo e poi risale curiosa",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita",
  "Alexa finge un aggiornamento e scappa in ‘non disturbare’",
  "il citofono fa uno squillo di solidarietà e poi si pente",
  "i bicchieri applaudono in cristallo e chiedono il bis",
  "il ventilatore fa l’inchino e gira al contrario per reverenza",
  "la macchina del caffè spara una fontana in standing ovation",
  "il cane del vicino prende appunti con aria da giudice",
  "la porta automatica si apre da sola, poi si vergogna e si richiude",
  "il registratore di cassa batte uno scontrino con scritto ‘amen’",
  "la moka fischia applausi a scena aperta"
];

/* ========= REGOLE BASE ========= */
const TECH_RULES_BASE = (lang)=> isEn(lang)
? `RULES:
- One paragraph. No bullets, no emojis. Do NOT restate the question.
- Near-future. Second person only. Never use first person.
- Do not invent names (only use names found in the question, otherwise avoid).
- LENGTH: WHATIF 135–155 words; WTF 150–170 words.`
: `REGOLE:
- Un solo paragrafo. Niente elenchi, niente emoji. NON ripetere la domanda.
- Prossimo futuro. Solo seconda persona. Mai la prima persona narrante.
- Non inventare nomi (usa solo quelli presenti nella domanda, altrimenti evita).
- LUNGHEZZA: WHATIF 135–155 parole; WTF 150–170 parole.`;

/* ========= REGOLE WTF (sequenza VINCOLATA) ========= */
const WTF_STRICT_IT = `WTF — segui questa SEQUENZA esatta con parole nuove:
1) PRESA IN GIRO iniziale (2–3 frasi) che prepara la scena.
2) 4 MICRO-IMPREVISTI realistici e comici legati al contesto della domanda.
3) SFOGO VISCERALE (UNO solo) usando un sinonimo: ${WTF_SFOGO_STRONG.join(", ")}.
4) REAZIONI ASSURDE (2–4) prese dal mondo attorno, coerenti con la scena.
5) ALCOL: sbronza/shot/amarissimo visibile.
6) RISPOSTA/FORECAST concreta alla domanda (controfattuale o prossimi passi).
7) CHIUSURA breve che richiama l’inizio (callback).`;

/* ========= STILE WHAT IF ========= */
const WHATIF_ANALITICO_STYLE_IT = `WHAT IF — Analitico: incipit nello stile “Sai, questa domanda girava nell’aria da un po’…”. Tono concreto (costi/benefici, reti locali, routine, compromessi), seconda persona, chiusura di sintesi pacata. 135–155 parole.`;
const WHATIF_REALE_STYLE_IT     = `WHAT IF — Reale/Poetico: incipit nello stile “Bella questa — me l’aspettavo da te.” Immagini sensoriali quotidiane, respiro narrativo asciutto, chiusura che riconosce tempo/luogo come alleati. 135–155 parole.`;

/* ========= Aperture a rotazione ========= */
async function pickRotating(list, key){
  try{
    const n = await redis.incr(key);
    if(n===1) await redis.expire(key, 24*60*60);
    return list[(n-1) % list.length];
  }catch{
    return list[Math.floor(Math.random()*list.length)];
  }
}

/* ========= Prompt builder ========= */
async function buildMessages({ domanda, lang, periodo, stile, mode, ip }){
  const msgs = [
    { role:"system", content: TECH_RULES_BASE(lang) },
    { role:"system", content: temporalInstruction(periodo, lang) },
  ];

  if (stile === "wtf"){
    // incipit ruotato
    const opening = await pickRotating(WTF_OPENINGS, `rot:wtf:open:${ip}`);
    msgs.push(
      { role:"system", content: WTF_STRICT_IT },
      { role:"system", content: `Usa come incipit una variante nello stile: «${opening} …». NON ripetere sempre lo stesso incipit nelle chiamate successive.` },
      { role:"system", content: `ESEMPIO · WTF · Moto\n${EX_WTF_MOTO_IT}` },
      { role:"system", content: `ESEMPIO · WTF · Bar\n${EX_WTF_BAR_IT}` },
      { role:"system", content: `ESEMPIO · WTF · Studio\n${EX_WTF_STUDIO_IT}` },
      { role:"system", content: `Banca reazioni (scegline 2–4 coerenti col contesto): ${WTF_REACTIONS_BANK.join(" · ")}` },
    );
  } else {
    if (mode === "analitico"){
      msgs.push(
        { role:"system", content: WHATIF_ANALITICO_STYLE_IT },
        { role:"system", content: `ESEMPIO · WHAT IF · Analitico\n${EX_WHATIF_ANALITICO_IT}` },
      );
    } else {
      msgs.push(
        { role:"system", content: WHATIF_REALE_STYLE_IT },
        { role:"system", content: `ESEMPIO · WHAT IF · Reale\n${EX_WHATIF_REALE_IT}` },
      );
    }
  }

  msgs.push({
    role:"user",
    content: `Domanda (NON ripeterla nel testo): "${domanda}". Genera UNA risposta in ${String(lang||"it").toUpperCase()} in un solo paragrafo, rispettando esattamente le regole sopra.`
  });

  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST")   return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip      = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const admin   = await isAdmin(req, ip);
    const bypass  = admin === true;
    const isPro   = String(req.headers["x-pro"] || "").trim() === "1";

    if(!bypass){
      const { success } = await rl.limit(`ask:${ip}`);
      if(!success) return res.status(429).json({ error:"rate_limited_minute" });
    }

    let used=0, dailyCap = isPro ? 10 : 3;
    if(!bypass){
      const today = new Date().toISOString().slice(0,10);
      const key   = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if(used===1) await redis.expire(key, 60*60*24);
      if(used>dailyCap){
        return res.status(402).json({ error:"daily_credits_exhausted", used, dailyCap });
      }
    }

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const {
      domanda = "",
      stile   = "whatif",           // "whatif" | "wtf"
      mode    = "reale",            // per whatif: "analitico" | "reale"
      lang    = "it",
      periodo = "future",
      // micro opzionale in futuro
    } = body;

    if(!domanda || typeof domanda!=="string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = await buildMessages({ domanda, lang, periodo, stile, mode, ip });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      frequency_penalty: 0.05,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile==="wtf" ? 9 : 11);
    answer = clampWords(answer, stile==="wtf" ? 170 : 158);
    answer = normalizeOneParagraph(answer);
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // Guard-rail: niente prima persona (solo enforcement via prompt; qui solo controllo soft)
    // Guard-rail nomi: non introdurre nomi non presenti nella domanda (solo regola a monte)

    return res.status(200).json({
      answer,
      style:   stile,
      mode,
      lang,
      periodo,
      model:   MODEL,
      admin,
      pro:     isPro,
      credits: bypass ? null : { used, dailyCap },
    });

  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
