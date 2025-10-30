// /api/ask.js — What?f Engine (FINAL BALANCED EDITION • WTF “COSÌ” con variante A/B)
// Basato sul tuo script funzionante; sostituito SOLO il blocco WTF con lo stile degli esempi.
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
// seed minimo per variazioni stabili
function tinyHash(s=""){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36); }

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

/* ========= WHAT IF — esempi e stile (INCIPIT FISSI) ========= */
const EX_WHATIF_ANALITICO_IT = `Sai, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;
const EX_WHATIF_REALE_IT = `Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

// Istruzioni WHAT IF (niente personalità, solo forma + incipit)
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

/* ========= WTF — NUOVO STILE “COSÌ” con variante A/B ========= */
// Base comune (IT/EN)
const WTF_BASE_IT = `
Sei “What the F”: roast affettuoso in SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole).
Apertura SOLO con un nomignolo (senza verbi). Inserisci UNA sola bestemmia narrata (“ti esce una bestemmia che fa tremare i bicchieri”) — mai letterale.
Oggetti che reagiscono solo se servono alla scena. Accenno d’alcol consentito. Niente elenchi, niente domande, niente emoji, niente prediche.
Chiudi caldo e divertente, come una risata sulla spalla. Rispetta la modalità temporale.`;
const WTF_BASE_EN = `
You are “What the F”: affectionate roast in SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words).
OPEN with ONLY a nickname (no verbs). Include exactly ONE narrated blasphemy (“you let out a blasphemy that rattles the glasses”) — never literal.
Use “reacting objects” only when relevant. A small alcohol beat is fine. No lists, no questions, no emojis, no moralizing.
Close warm and funny; respect temporal mode.`;

// Variante A: roast + oggetti coerenti (2–3 max)
const WTF_VAR_A_IT = `VARIANTE A — Spingi sul roast affettuoso, usa 2–3 oggetti che reagiscono coerenti al luogo (bar → moka/POS, strada → lampione/portone, casa → tapparella/lampada). Mantieni ritmo secco e umano.`;
const WTF_VAR_A_EN = `VARIANT A — Lean into affectionate roast, use 2–3 place-coherent reacting objects (bar → moka/POS, street → streetlight/door, home → blinds/lamp). Keep it punchy and human.`;

// Variante B: eventi a scorrere (3–4 micro-imprevisti distribuiti)
const WTF_VAR_B_IT = `VARIANTE B — Scena a scorrere: distribuisci 3–4 micro-imprevisti lungo il paragrafo (“intanto”, “poi”, “mentre provi…”), poi una bestemmia narrata; un accenno d’alcol; chiusura calda e ironica.`;
const WTF_VAR_B_EN = `VARIANT B — Flowing scene: spread 3–4 tiny mishaps through the paragraph (“meanwhile”, “then”, “as you try…”), then one narrated blasphemy; one alcohol beat; warm, funny close.`;

// Esempio aggiornato (mostrato solo come few-shot guida)
const WTF_EX_IT = `ESEMPIO · WTF (guida tono/forma)
Pellegrino del ritorno, scendi con la valigia che scricchiola dignità; il marciapiede riconosce il tuo passo e al bancone la tazzina fa “di nuovo?”, addolcisci l’orgoglio con un grappino da undici e ti esce una bestemmia che fa tremare i bicchieri mentre il lampione finge di non sentire; due facce ti chiamano per nome e capisci che non stai tornando indietro ma tornando intero, con le crepe lucidate a festa.`;
const WTF_EX_EN = `EXAMPLE · WTF (tone/shape)
Champ, suitcase squeaking dignity; the sidewalk recognizes your step and the cup goes “again?”, a tiny beer forgives your pride and you let out a blasphemy that rattles the glasses while the streetlight pretends it didn’t hear; two faces say your name and you realize you’re not going back but landing whole, cracks polished for the party.`;

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, mode }){
  const msgs = [
    { role: "system", content: isEn(lang)
        ? `RULES: one paragraph, no bullets, no emojis, do NOT restate the question. Near-future. Second person only. No invented names. Length: WHATIF 135–155, WTF 145–165.`
        : `REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Prossimo futuro. Solo seconda persona. Niente nomi inventati. Lunghezza: WHATIF 135–155, WTF 145–165.` },
    { role: "system", content: temporalInstruction(periodo, lang) },
  ];

  // pick variante A/B in modo stabile per domanda
  const seed = tinyHash(domanda);
  const variantAB = parseInt(seed,36) % 2 === 0 ? "A" : "B";

  if (stile === "wtf") {
    const base = isEn(lang) ? WTF_BASE_EN : WTF_BASE_IT;
    const varA  = isEn(lang) ? WTF_VAR_A_EN : WTF_VAR_A_IT;
    const varB  = isEn(lang) ? WTF_VAR_B_EN : WTF_VAR_B_IT;
    const example = isEn(lang) ? WTF_EX_EN : WTF_EX_IT;

    msgs.push(
      { role: "system", content: base.trim() },
      { role: "system", content: (variantAB === "A" ? varA : varB).trim() },
      { role: "system", content: example }
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
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,   // un filo più “croccante” sul WTF
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);     // 6–8 frasi target
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);        // ~125–165 parole WTF
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
