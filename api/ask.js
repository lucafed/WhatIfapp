// /api/ask.js — What?f Engine (FINAL BALANCED EDITION • YOUR WTF FEWSHOTS)
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

/* Aperture tipiche WTF da usare se manca l’incipit “alla tua” */
const WTF_OPENINGS = [
  "Ah ma guarda te,",
  "Oh, eccoci,",
  "Eccoti qui,",
  "Ah, sì, certo,",
  "Ma figurati,",
];

/* Forza apertura se non c’è, e garantisce la parola “bestemmia” in uscita */
function ensureWtfOpeningAndBestemmia(answer){
  let a = String(answer||"").trim();
  // Apertura
  if(!/^(ah|oh|eccoti|ma figurati)/i.test(a)){
    a = `${WTF_OPENINGS[Math.floor(Math.random()*WTF_OPENINGS.length)]} ${a.charAt(0).toLowerCase()+a.slice(1)}`;
  }
  // Parola “bestemmia” presente? se no, inietto una riga breve a metà
  if(!/bestemmi\w*/i.test(a)){
    const parts = a.split(/(?<=[.!?])\s+/);
    const mid = Math.max(1, Math.floor(parts.length/2));
    parts.splice(mid, 0, "ti scappa una bestemmia che piega l’aria e fa vibrare i bicchieri");
    a = parts.join(" ");
  }
  return a;
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
/* (Se vuoi, cambiamo questi incipit in futuro con uno più generico) */
const EX_WHATIF_ANALITICO_IT = `Sai, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_REALE_IT = `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

const WHATIF_ANALITICO_STYLE_IT = `WHAT IF Analitico:
- Incipit sobrio, tono concreto (routine, costi/benefici).
- Chiusa calma e sintetica.
- 135–155 parole. Seconda persona.`;
const WHATIF_REALE_STYLE_IT = `WHAT IF Reale/Poetico:
- Incipit sobrio, immagini quotidiane.
- Chiudi riconciliando luogo e tempo.
- 135–155 parole. Seconda persona.`;

/* ========= WTF — REGOLE + I TUOI ESEMPI (FEW-SHOT) ========= */
const WTF_STRICT_IT = `WHAT THE F (demenziale affettuoso, ma rispondi davvero):
- Apertura ironica che prende in giro (1–2 frasi).
- 1–2 micro-imprevisti realistici.
- Esplosione di “bestemmia” (parola presente), descritta in modo fisico/assurdo (nessun riferimento religioso reale).
- 2 reazioni di oggetti/ambiente.
- Accenno d’alcol.
- Risposta concreta alla domanda (1–2 frasi).
- Chiusura ironica che richiama l’apertura.
- Seconda persona, un paragrafo, 145–165 parole. Niente elenchi, niente emoji, non ripetere la domanda.`;

/* === I TUOI TRE ESEMPI, PARI PARI, COME FEW-SHOT === */
const WTF_FEWSHOTS_IT = [
  {
    role: "system",
    content:
`ESEMPIO WTF • Bar (usa lo stile)
Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora: “questo al confessionale lo tengono in riserva”. Ti versi un goccio di liquore per calmare i santi e giuri che domani apri un bar solo per matti. Alla chiusura, il bancone ti guarda e tu, esausto, sussurri: “oggi ho bestemmiato più del prete quando finisce il vino — ma almeno ho servito verità calde”.`
  },
  {
    role: "system",
    content:
`ESEMPIO WTF • Moto (usa lo stile)
Oh, eccoci, centauro dell’inferno! Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” talmente sonoro che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo, ma stavolta con affetto, tipo rito purificatore. Un vecchio ti dice “bella linea” e tu pensi che parlasse del nervo saltato. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio, con un sorrisetto da complice. Quando torni a casa senti ancora l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie bene calibrate.`
  },
  {
    role: "system",
    content:
`ESEMPIO WTF • Innamorarsi (usa lo stile)
Ah, Luisa… ci risiamo, eh? Ti butti nel cuore come in un pozzo vuoto, e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e tu senti salire la pressione sanguigna come se ti stesse caricando un peccato. Ti parte un “bestemmia della miseria impestata!” così sincero che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento di sistema, e tu bestemmi a mezza voce come se fosse una preghiera sbagliata. Poi sorridi, bevi un sorso di rosso e dici: “ogni mia storia finisce con una bestemmia e un brindisi — ma almeno bevo meglio di come amo.” La luna fuori ti guarda e, giuro, sembra che annuisca pure lei.`
  }
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
    msgs.push({ role: "system", content: WTF_STRICT_IT }, ...WTF_FEWSHOTS_IT);
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
      frequency_penalty: 0.15,
      presence_penalty: 0.1,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 168 : 160);
    answer = normalizeOneParagraph(answer);
    if(stile === "wtf"){
      answer = ensureWtfOpeningAndBestemmia(answer);
    }
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // Guard-rail lingua: niente prima persona
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, "");

    // Guard-rail nomi: non introdurre nomi non presenti nella domanda
    (function(){
      const d = String(domanda||"");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion = new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m)=>{
        return inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai","Ma"].includes(m) ? m : m.toLowerCase());
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
