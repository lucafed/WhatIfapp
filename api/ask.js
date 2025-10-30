// /api/ask.js — What?f Engine (FINAL BALANCED EDITION • WTF EXACT STYLE)
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
function seededPick(seedStr, arr){
  if(!arr?.length) return "";
  const n = parseInt(tinyHash(String(seedStr||"")), 36);
  return arr[n % arr.length];
}

/* ========= WHAT IF — esempi e stile (INCIPIT GENERICI) ========= */
const EX_WHATIF_ANALITICO_IT =
`Questa domanda non spunta dal nulla: affiora dalle tue giornate quando rallenti. Guardi cosa tieni davvero in tasca — tempo, spese, facce, aria. Scopri che i conti non sono solo numeri: sono abitudini, chilometri, sonno. Qui potresti scambiare frenesia con spazio, stipendio con respiro, corsa con continuità. La rete che ti serve è corta ma affidabile, le scadenze esistono ma chiedono meno prove. La fatica cambia forma: meno traffico, più costanza. E mentre sistemi il ritmo, ti accorgi che non stai perdendo opportunità: stai mettendo a fuoco quelle che ti somigliano. Non è un passo indietro: è un passo che tiene.`;

const EX_WHATIF_REALE_IT =
`Apri la finestra e l’aria ti fa spazio come una sedia tirata al tavolo. Le strade si ricordano il tuo passo, i portoni ti riconoscono dal respiro. Al bar il cucchiaino batte due colpi e poi tace, come dire “sei a casa se vuoi”. La giornata non urla: chiede poco, restituisce piano. Cammini con le mani leggere nelle tasche e ogni insegna ti parla sottovoce. Le serate finiscono senza pretese, le mattine non chiedono scuse. Non torni indietro: rientri in te.`;

// Istruzioni WHAT IF
const WHATIF_ANALITICO_STYLE_IT = `WHAT IF Analitico:
- Incipit generico (niente frasi fisse note).
- Tono concreto: scambi reali, costi/benefici, routine, qualità della vita.
- Chiudi con una sintesi calma nello stile dell’esempio.
- 135–155 parole. Seconda persona soltanto.`;
const WHATIF_REALE_STYLE_IT = `WHAT IF Reale/Poetico:
- Incipit sensoriale asciutto (niente frasi fisse note).
- Immagini quotidiane, ritmo pulito.
- Chiudi riconciliando luogo e tempo.
- 135–155 parole. Seconda persona soltanto.`;

/* ========= WTF — banche & regole esatte ========= */
// Nomignoli (apertura secca, poi virgola)
const WTF_NICKS_IT = [
  "Campione","Cervello fino","Fenomeno","Oh stratega dell’ultima ora","Pilota automatico",
  "Capitano del caos","Artigiano del forse","Atleta del rinvio",
  "Funambolo del quasi","Direttore d’orchestra senza bacchetta",
  "Genio con i lacci slacciati","Samurai del boh","Condottiero delle liste incompiute",
  "Pellegrino del ritorno","Poeta del bar","Rockstar dei forse"
];
const WTF_NICKS_EN = [
  "Champ","Mastermind","Legend","Captain of chaos","Pilot on autopilot",
  "Wizard of ‘maybe’","Acrobat of almost","General of half-plans",
  "Street poet","Sneaker philosopher","Boss of detours","Chief of procrastination"
];

// Sfoghi iperbolici (senza riferimenti religiosi: usa la parola “bestemmia” come etichetta narrativa)
const WTF_SFOGHI_HYPER_IT = [
  "ti parte una bestemmia narrata che sembra sparata da un compressore emotivo impazzito",
  "ti scappa una bestemmia narrata che rotola come un barile giù per una scalinata di marmo",
  "ti esce una bestemmia narrata a pressione, che vibra nei molari e raddrizza i quadri storti",
  "ti scivola addosso una bestemmia narrata formato orchestrale, con ottoni e percussioni nei polmoni",
  "liberi una bestemmia narrata che fa corrente d’aria nei corridoi del cervello",
  "ti esplode una bestemmia narrata tipo airbag dell’anima, gonfia e salvifica",
  "ti sfugge una bestemmia narrata che accende tutte le spie del cruscotto interiore",
  "rilasci una bestemmia narrata a gamma larga, capace di muovere i magneti sul frigo"
];
const WTF_SFOGHI_HYPER_EN = [
  "you let out a narrated blasphemy that fires like a rogue air compressor of feelings",
  "a narrated blasphemy tumbles out like a barrel down marble steps",
  "a pressure-sealed narrated blasphemy rattles your molars and straightens crooked frames",
  "a full-orchestra narrated blasphemy swells with brass and drums in your lungs",
  "a narrated blasphemy gust sweeps the corridors of your brain",
  "an airbag-style narrated blasphemy pops, loud and oddly protective",
  "a wide-band narrated blasphemy lights every warning light on your inner dashboard",
  "a narrated blasphemy big enough to slide the magnets on the fridge"
];

// Reazioni oggetti (coerenti, 2–3 subito dopo lo sfogo)
const WTF_REACTIONS_IT = [
  "la lampada sfarfalla in Morse come se prendesse appunti",
  "il ventilatore fa mezzo giro al contrario e si arrende",
  "la moka fischia una standing ovation e poi fa finta di niente",
  "Alexa entra in ‘non disturbare’ senza preavviso",
  "il POS si benedice da solo con uno scontrino bianco",
  "la tapparella scende per l’imbarazzo e poi risale curiosa",
  "il citofono fa un colpo di tosse e nega tutto",
  "il frigorifero sospira e decide di essere frigo migliore",
  "la porta automatica si apre da sola e poi ci ripensa",
  "la sedia scricchiola come applauso educato",
  "il campanello vibra un sì breve e innocente",
  "il telecomando cambia canale da solo per discolparsi"
];
const WTF_REACTIONS_EN = [
  "the lamp flickers in Morse like it’s taking notes",
  "the fan spins half a turn backward and gives up",
  "the moka pot whistles a standing ovation, then plays dumb",
  "Alexa slides into Do Not Disturb without warning",
  "the card reader self-blesses with a blank receipt",
  "the shutter drops in embarrassment, then peeks back up",
  "the buzzer clears its throat and denies everything",
  "the fridge sighs and vows to be a better fridge",
  "the automatic door opens by itself and then regrets it",
  "the chair creaks like a polite applause",
  "the doorbell vibrates a tiny innocent yes",
  "the remote flips channels on its own to look busy"
];

// Regola di forma per WTF (come gli esempi tuo stile)
const WTF_RULES_IT = `
WHAT THE F (sarcasmo demenziale affettuoso):
- Apertura OBBLIGATORIA: SOLO un nomignolo (tra quelli forniti), seguito da virgola. Nessun verbo prima.
- Subito dopo: presa in giro affettuosa (1–2 frasi).
- Poi 2–3 micro-imprevisti realistici, descritti in corsa (niente elenco).
- Poi esplode UNO sfogo: usa una delle “bestemmie narrate” iperboliche (senza riferimenti religiosi, è un’etichetta narrativa).
- SUBITO DOPO inserisci 2–3 reazioni di oggetti coerenti, secche.
- Accenno d’alcol (sorso, doppio amaro, sbronza elegante).
- Rispondi davvero alla domanda (1–2 frasi concrete).
- Chiudi con riga ironica che richiama l’apertura.
- Vincoli: un solo paragrafo; seconda persona; 145–165 parole; niente emoji, niente domande, niente nomi inventati.
`;

const WTF_RULES_EN = `
WHAT THE F (goofy, loving roast):
- MANDATORY opening: ONLY a nickname (from the list), then a comma. No verb before.
- Then a warm roast (1–2 sentences).
- Then 2–3 tiny mishaps described inline (not a list).
- Then ONE outburst: use a “narrated blasphemy” hyperbole (no religious references; it’s just a narrative label).
- RIGHT AFTER add 2–3 object reactions, short and relevant.
- Tiny alcohol beat (sip, double amaro, elegant buzz).
- Actually answer the question (1–2 concrete sentences).
- Close with an ironic line that mirrors the opening.
- Constraints: one paragraph; second person; 145–165 words; no emojis, no questions, no invented names.
`;

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
  const en = isEn(lang);
  const msgs = [
    { role: "system", content: en
        ? `RULES: one paragraph, no bullets, no emojis, do NOT restate the question. Near-future. Second person only. No invented names. Length: WHATIF 135–155, WTF 145–165.`
        : `REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Prossimo futuro. Solo seconda persona. Niente nomi inventati. Lunghezza: WHATIF 135–155, WTF 145–165.` },
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  if (stile === "wtf") {
    const nickPool = en ? WTF_NICKS_EN : WTF_NICKS_IT;
    const sfoghi = en ? WTF_SFOGHI_HYPER_EN : WTF_SFOGHI_HYPER_IT;
    const reacts = en ? WTF_REACTIONS_EN : WTF_REACTIONS_IT;

    msgs.push(
      { role: "system", content: en ? WTF_RULES_EN : WTF_RULES_IT },
      { role: "system", content: (en
        ? `OPENING NICKNAMES (pick exactly one, then comma): ${nickPool.join(", ")}.`
        : `NOMIGNOLI DI APERTURA (scegline uno, poi virgola): ${nickPool.join(", ")}.`) },
      { role: "system", content: (en
        ? `HYPERBOLE BANK (use exactly one): ${sfoghi.join(" · ")}.`
        : `BANCA SFOGHI IPERBOLICI (usane esattamente uno): ${sfoghi.join(" · ")}.`) },
      { role: "system", content: (en
        ? `OBJECT REACTIONS (use 2–3 right after outburst): ${reacts.join(" · ")}.`
        : `REAZIONI OGGETTI (usane 2–3 subito dopo lo sfogo): ${reacts.join(" · ")}.`) },
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
    content: (isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Generate ONE answer in ${lang.toUpperCase()} as a single paragraph.`
      : `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ${lang.toUpperCase()} a paragrafo unico.`)
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

    // Guard-rail lingua: niente prima persona
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, "");

    // Guard-rail nomi: non introdurre nomi non presenti nella domanda
    (function(){
      const d = String(domanda||"");
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion = new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m)=>{
        return inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai","Champ"].includes(m) ? m : m.toLowerCase());
      });
    })();

    // Fallback: se WTF non parte con un nomignolo + virgola, prepend deterministico
    if(stile === "wtf"){
      const nick = isEn(lang) ? WTF_NICKS_EN : WTF_NICKS_IT;
      const want = seededPick(domanda, nick);
      const startsWithNick = new RegExp(`^(${nick.map(n=>n.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')).join("|")}),\\s`).test(answer);
      if(!startsWithNick){
        answer = `${want}, ${answer.charAt(0).toLowerCase()}${answer.slice(1)}`;
      }
    }

    return res.status(200).json({ answer, style: stile, mode, lang, periodo, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
