// /api/ask.js — What?f Engine (MODE-FIX + DEMENZIALE WTF + SentenceCase IT)
// Un paragrafo, seconda persona, no nomi inventati. Distinzione netta WHATIF analitico vs poetico.

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
const SUP_LANGS=["it","en","es","fr","de"];
const normLang = (l="it") => (SUP_LANGS.includes(String(l).toLowerCase().slice(0,2)) ? String(l).toLowerCase().slice(0,2) : "it");
const isEnLike  = (lang) => ["en","es","fr","de"].includes(normLang(lang));

function normLine(s=""){
  return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ")
               .replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();
}
function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ")
    .split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){
    const n=normLine(p); if(!n || seen.has(n)) continue;
    if(p.split(/\s+/).length<=3 && !/[.!?…]$/.test(p)) continue;
    out.push(p); seen.add(n); if(out.length>=maxSentences) break;
  }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+=".";
  return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m ? m[1] : slice + "…";
}
function normalizeOneParagraph(s=""){
  return String(s).replace(/\s*\n+\s*/g," ")
    .replace(/\s{2,}/g," ").replace(/\.\.\.+/g,"…")
    .replace(/\s+([.,;:!?…])/g,"$1").trim();
}
function stripQuestionEcho(domanda,text){
  const d = String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t = String(text||"");
  const lead=t.slice(0, Math.min(t.length, d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,"");
  return t;
}
/* Maiuscola dopo . ! ? … */
function capAfterStopsIt(s=""){
  return s.replace(/(^|[.!?…]\s+)([a-zà-öø-ÿ])/g, (_,p1,p2)=> p1 + p2.toUpperCase());
}

/* ========= Temporal ========= */
function temporalInstruction(periodo="future", lang="it"){
  const en = isEnLike(lang);
  if(String(periodo).toLowerCase()==="past"){
    return en ? "Write as if it already happened (past/conditional allowed)."
              : "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return en ? "Write as a near-future unfolding starting now."
            : "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi + stili (incipit diversi) ========= */
const EX_WHATIF_ANALITICO_IT =
`Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const EX_WHATIF_REALE_IT =
`Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* Stili-guida */
const WHATIF_ANALITICO_STYLE_IT =
`WHAT IF Analitico:
- Incipit nello spirito di “Sai Luca, …”.
- Linguaggio concreto: costi/benefici, routine, servizi, lavoro, tempo.
- 135–155 parole. Seconda persona. Chiusura calma e sintetica come nell’esempio.`;

const WHATIF_REALE_STYLE_IT =
`WHAT IF Reale/Poetico:
- Incipit nello spirito di “Bella questa, Luca.”.
- Immagini sensoriali asciutte e quotidiane (aria, vicoli, caffè, luce).
- 135–155 parole. Seconda persona. Chiusura riconciliata, non analitica.`;

/* ========= WTF — banca reazioni demenziali ========= */
const REACT_BASE = [
  "la lampada sfarfalla in Morse e sembra chiederti la mancia",
  "la moka improvvisa una standing ovation a vapore",
  "il POS fa una novena di errori e poi si benedice da solo",
  "la tapparella si abbassa per imbarazzo e risale con curiosità",
  "Alexa finge un aggiornamento e se la dà a gambe in ‘non disturbare’",
  "il frigorifero sospira e decide che oggi digiuna",
  "il ventilatore gira al contrario per rispetto",
  "la sedia scricchiola come se ti stesse applaudendo piano",
  "la statua all’angolo si copre gli occhi e sbircia tra le dita",
  "la stampante spara coriandoli di ‘errore 404’",
  "il campanile tossisce un amen stonato",
  "la porta automatica si apre da sola e poi si vergogna",
];
function pick(arr, n=1){
  const out=[], used=new Set();
  while(out.length<n && used.size<arr.length){
    const i=Math.floor(Math.random()*arr.length);
    if(used.has(i)) continue; used.add(i); out.push(arr[i]);
  }
  return out;
}

/* ========= Prompt builder ========= */
function baseRules(lang){
  return isEnLike(lang)
    ? `RULES: one paragraph, no bullets, no emojis, do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Solo seconda persona.`;
}
function buildMessages({ domanda, lang, periodo, stile, mode }){
  const msgs = [
    { role: "system", content: baseRules(lang) },
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  if(stile === "wtf"){
    const reacts = pick(REACT_BASE, 3).join(" · ");
    msgs.push(
      { role: "system", content:
        `WHAT THE F (amichevole, demenziale, ma utile). Sequenza OBBLIGATORIA (145–165 parole, un paragrafo):
1) Presa in giro affettuosa (max 2 frasi).
2) 3–4 micro-imprevisti concreti legati alla domanda.
3) Ti trattieni… provi… riprovi… poi esplode UNO sfogo teatrale (tipo “bestemmione corazzato”, “imprecazionona a detonazione”, “santa pazienza implosa”). Non contro persone.
4) SUBITO 2–3 reazioni demenziali coerenti al contesto, scegli tra: ${reacts}.
5) DRINK: deve essere alcolico (dito di grappa, amaro doppio, rosso onesto).
6) 1–2 frasi che rispondono davvero alla domanda (consiglio o previsione concreta).
7) Chiusura ironica breve (morale).
Bans: insulti a persone, rabbia vera, più di due “!!”.` }
    );
  } else {
    if(mode === "analitico"){
      msgs.push(
        { role: "system", content: WHATIF_ANALITICO_STYLE_IT },
        { role: "system", content: `ESEMPIO (vincolante tono/ritmo):\n${EX_WHATIF_ANALITICO_IT}` },
      );
    } else {
      msgs.push(
        { role: "system", content: WHATIF_REALE_STYLE_IT },
        { role: "system", content: `ESEMPIO (vincolante tono/ritmo):\n${EX_WHATIF_REALE_IT}` },
      );
    }
  }

  const L = normLang(lang);
  const ask =
    L==="it" ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO.` :
    L==="en" ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH.` :
    L==="es" ? `Pregunta (no la repitas): "${domanda}". Produce UNA respuesta en ESPAÑOL.` :
    L==="fr" ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS.` :
               `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH.`;
  msgs.push({ role:"user", content: ask });

  return msgs;
}

/* ========= Enforcers incipit ========= */
function enforceAnalitico(t){
  // togli eventuale poetico d’apertura
  t = t.replace(/^\s*bella\s+questa,\s*luca[.,]?\s*/i, "");
  // prefissa incipit concreto
  if(!/^Sai Luca,/.test(t)) t = "Sai Luca, " + t.replace(/^Sai Luca,\s*/,"");
  // riequilibrio lessico (tende al concreto)
  const poet = (t.match(/\b(aria|luce|vicoli|profumo|risate|portoni|montagn|eco|amante|orizzonte|inverno)\b/gi)||[]).length;
  const conc = (t.match(/\b(affitt|bollett|stipend|trasport|serviz|routine|orari|spesa|artigian|multinazional|tempo|costi|benefici)\b/gi)||[]).length;
  if (poet > conc){
    t = "Sai Luca, qui le scelte si misurano in cose semplici: affitti più umani, bollette che non strangolano e routine che torna a respirare. I trasporti sono prevedibili, il lavoro ruota più su reti locali e artigiani che su multinazionali. Guadagni forse più bassi, ma recuperi tempo e continuità; i weekend hanno un bordo pulito e non vivi a rincorsa. Il compromesso è chiaro: meno occasioni gigantesche, più stabilità piccola. Se cerchi ritmo sostenibile e facce note, è un avanzare lento ma tuo.";
  }
  return t;
}
function enforcePoetico(t){
  t = t.replace(/^\s*sai\s+luca,\s*/i, "");
  if(!/^Bella questa, Luca\./.test(t)) t = "Bella questa, Luca. " + t;
  // spunta termini troppo “excel”
  return t.replace(/\b(affitt[oi]|bollett[ea]e?|stipend[iio]|budget|costi|benefici|trasport[oi]|serviz[iio]|routine|orari|multinazional[ei]|artigian[oi]|spesa)\b/gi,"");
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req,res);
  if (req.method==="OPTIONS") return res.status(200).end();
  if (req.method!=="POST")  return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const domanda = String(body?.domanda || "");
    const stile   = String(body?.stile || "whatif");
    const rawMode = String(body?.mode || "").toLowerCase();
    const periodo = String(body?.periodo || "future");
    const lang    = normLang(body?.lang || "it");

    if(!domanda) return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    // NORMALIZZAZIONE MODE: solo se stile=whatif
    const MODE = (stile === "whatif" && rawMode === "analitico") ? "analitico" :
                 (stile === "whatif" ? "reale" : null);

    const messages = buildMessages({ domanda, lang, periodo, stile, mode: MODE });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile==="wtf") ? 0.98 : 0.82,
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
    answer = tightenSentences(answer, (stile==="wtf") ? 9 : 11);
    answer = clampWords(answer, (stile==="wtf") ? 168 : 160);
    answer = normalizeOneParagraph(answer);

    // WHAT IF: incipit enforce
    if(stile !== "wtf"){
      answer = (MODE === "analitico") ? enforceAnalitico(answer) : enforcePoetico(answer);
    } else {
      // WTF: limiti e drink alcolico presente
      answer = answer.replace(/!{3,}/g,"!!")
                     .replace(/\b(cazzo|stronzo|idiota|imbecille)\b/gi, "accidente");
      const hasDrink = /\b(grappa|amaro|vino|spritz|birra|whisky|rum|gin|rosso|spumante|prosecco|negroni|martini)\b/i.test(answer);
      if(!hasDrink){
        answer = answer.replace(/(Morale:)/i, "Ti butti un dito di grappa di servizio, rimetti in riga il mondo. $1");
        if(!/Morale:/i.test(answer)) answer += " Ti butti un amaro doppio e il mondo si rimette seduto.";
      }
    }

    // Maiuscole dopo punto
    answer = capAfterStopsIt(answer);
    // Punteggiatura finale
    if(!/[.!?…]$/.test(answer)) answer += ".";

    // No prima persona (leggero)
    if(lang==="it") answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi,"");

    // Evita nomi non nella domanda (solo IT)
    if(lang==="it"){
      (function(){
        const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQ = new Set((domanda.match(nameRx)||[]));
        answer = answer.replace(nameRx,(m)=> inQ.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai","Morale"].includes(m)?m:m.toLowerCase()));
      })();
    }

    return res.status(200).json({ answer, style:stile, mode:MODE, lang, periodo, model:MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
