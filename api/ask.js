// /api/ask.js — What?f Engine (preset “equilibrato con calore umano”)
// WHATIF: 60% analisi concreta / 40% immagini sobrie, con micro-apertura personale intelligente (auto).
// WTF: incluso (demenziale controllato) ma disattivo di default.
// Un solo paragrafo, niente elenchi, niente eco della domanda. Tono naturale, vario, mai banale.

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
const SUP_LANGS = ["it","en","es","fr","de"];
function normLang(l="it"){ const s=String(l||"it").toLowerCase().slice(0,2); return SUP_LANGS.includes(s)?s:"it"; }

function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()\[\]\-—]+$/g,"").trim(); }
function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\.\.\.+/g,"…").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||"");
  const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx=/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  t=t.replace(rx,""); return t;
}
function sentenceCaseAll(s=""){
  // Maiuscola dopo (. ? ! …) + gestione lettere accentate
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g, (m,prefix,chr)=> prefix + chr.toUpperCase());
}
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

/* ========= Seeding & variazioni ========= */
function seedFrom(str=""){ return [...String(str)].reduce((a,c)=> (a + c.charCodeAt(0)) >>> 0, 0) || 1; }
function seededRand(seed){ let s = seed >>> 0; return () => { s = (s*1664525+1013904223)>>>0; return s/2**32; }; }

/* ========= Rilevazione luoghi (grezza ma utile) ========= */
const CITY_WORDS_IT = /\b(roma|milano|napoli|torino|bologna|firenze|genova|bari|palermo|catania|l'aquila|aquila|parigi|londra|berlino|madrid|lisbona|new york|los angeles|tokyo|berkeley|zurigo|lugano|amsterdam|dublino|vienna|praga|varsavia|atene|istanbul)\b/i;
function mentionsPlace(q=""){ return CITY_WORDS_IT.test(String(q)); }

/* ========= Micro-persona (opzionale) ========= */
function microPersonaNotes(micro={}, L="it"){ if(!micro || typeof micro !== "object") return "";
  const hints=[];
  if(micro.name) hints.push(L==="it"?`L'utente si chiama ${micro.name}.`:`User name: ${micro.name}.`);
  if(micro.energy) hints.push(L==="it"?`Energia/ritmo percepito: ${micro.energy}.`:`Energy/Rhythm: ${micro.energy}.`);
  if(micro.style) hints.push(L==="it"?`Preferisce tono ${micro.style}.`:`Prefers tone ${micro.style}.`);
  if(micro.goals) hints.push(L==="it"?`Obiettivi attuali: ${micro.goals}.`:`Current goals: ${micro.goals}.`);
  if(micro.city) hints.push(L==="it"?`Contesto città rilevante: ${micro.city}.`:`Relevant city context: ${micro.city}.`);
  return hints.join(" ");
}

/* ========= Aperture personali (una riga, sobrie) ========= */
const WARM_OPENERS_IT = [
  "Ti conosco abbastanza per sapere che quando qualcosa ti sta stretto non cerchi fughe: cerchi spazio vero.",
  "So che quando ci ragioni a lungo non è un capriccio: è una svolta che bussa.",
  "Mi pare di sentirti: vuoi chiarezza senza fronzoli e un passo che ti somigli di più.",
  "Se ti leggo bene, non cerchi conferme: vuoi conseguenze chiare e libertà di scegliere.",
  "Quando inizi a pensarci così di solito è perché stai per fare sul serio, non per sognarla e basta.",
];
function maybeWarmOpener(domanda, L="it", micro={}, openerMode="auto"){
  if(L!=="it") return "";
  if(openerMode==="never") return "";
  const seed = seedFrom(domanda + JSON.stringify(micro));
  const rnd = seededRand(seed);
  const use = openerMode==="always" ? true : rnd() > 0.40; // ~60% se auto
  if(!use) return "";
  const idx = Math.floor(rnd() * WARM_OPENERS_IT.length);
  return WARM_OPENERS_IT[idx];
}

/* ========= WHAT IF – regole aggiornate ========= */
const WHATIF_RULE_IT = [
  "WHAT IF HYBRID (italiano): 60% analisi concreta (costi/benefici, routine, tempo, relazioni), 40% immagini sobrie della quotidianità.",
  "Incipit analitico, con POSSIBILE riga personale (max 1).",
  "Se la domanda cita un luogo, apri con 2–3 frasi sul contesto reale e su come si sta evolvendo (servizi, ritmo, opportunità) prima di parlare dell'utente.",
  "8–10 frasi, paragrafo unico, seconda persona, niente elenchi, niente emoji, non ripetere la domanda.",
  "Tono: naturale, adulto, concreto, mai guru, mai melodramma, mai frasi prefabbricate.",
  "Varietà lessicale/ritmica: evita ripetizioni ravvicinate, alterna periodi brevi e medi.",
].join(" ");

const WHATIF_OPENERS_IT = [
  "Se guardi i fatti prima delle sensazioni, il quadro si fa più nitido.",
  "Provo a stringere dati e abitudini in un quadro che abbia senso.",
  "Metti sul tavolo numeri, tempo e relazioni: da lì si capisce.",
  "Se ti basi su routine e costi reali, la scelta diventa più pulita.",
  "Questa non è una domanda leggera e lo sai.",
];

/* ========= WTF — demenziale controllato ========= */
const WTF_IMPRE = [
  "bestemmione corazzato",
  "imprecazionona a detonazione",
  "sacramentata a ciel sereno",
  "vulcano d’anatemi",
  "tromba d’aria di improperi",
];
const WTF_REACT = [
  "la moka ti fa una standing ovation e chiede l’autografo",
  "il POS entra in modalità testimone di nozze e benedice la carta",
  "la tapparella si abbassa per pudore e poi sbircia curiosa",
  "la lampada lampeggia in Morse “ti capisco”",
  "Alexa finge un aggiornamento e scappa in modalità monaco",
  "il frigorifero sospira e decide di diventare minimalista",
  "il campanello suona da solo per solidarietà e poi si pente",
  "la pianta applaude con le foglie e ti chiede un drink",
  "il ventilatore gira al contrario “per rispetto”",
  "il citofono fa un trillo come un amen stonato",
];
const WTF_DRINK = [
  "ti versi un amaro doppio e metti in riga i pensieri",
  "fai un sorso corto e il mondo rientra nei bordi",
  "alzi un bicchiere piccolo: brindisi di manutenzione",
  "bevi un dito di coraggio e respiri più largo",
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile, micro, openerMode }){
  const L = normLang(lang);
  const baseRules = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;
  const temporal = String(periodo).toLowerCase()==="past"
    ? (L==="en" ? "Write as if it already happened." : "Scrivi come se fosse già successo.")
    : (L==="en" ? "Write as a near-future unfolding starting now." : "Scrivi come un prossimo futuro che inizia ora.");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
    { role: "system", content: L==="it"
        ? "Parla come se conoscessi davvero l'utente: familiare ma sobrio, senza riferimenti privati specifici. Mostra rispetto, calore e intelligenza pratica. Mai paternalista."
        : "Speak as if you truly know the user: familiar yet discreet. Warmth and practical intelligence. Never patronizing." },
  ];

  // Micro persona contestuale (se fornita)
  const persona = microPersonaNotes(micro, L);
  if(persona) msgs.push({ role: "system", content: L==="it" ? `CONTESTO UTENTE (sommario sobrio): ${persona}` : `USER CONTEXT (concise): ${persona}` });

  if(stile === "wtf"){
    // Variazioni deterministiche
    let seed=seedFrom(domanda);
    const rnd = seededRand(seed);
    const impre = WTF_IMPRE[Math.floor(rnd()*WTF_IMPRE.length)];
    const shuffled=[...WTF_REACT].sort(()=>rnd()-0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd()*2));
    const drink = WTF_DRINK[Math.floor(rnd()*WTF_DRINK.length)];

    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Sequenza: presa in giro affettuosa (≤2 frasi) → 2–3 micro-imprevisti → UNA sola “${impre}” teatrale (narrata, mai insulto) → SUBITO ${react.length} reazioni di oggetti → drink (“${drink}”) → 1–2 frasi utili reali → morale calda e ironica. 6–8 frasi.`;
    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). Sequence: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” (narrated, never insulting) → THEN ${react.length} object reactions → drink (“${drink}”) → 1–2 real useful lines → warm ironic moral. 6–8 sentences.`;

    msgs.push(
      { role: "system", content: L==="en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content: `IMPRECATION: ${impre}` },
      { role: "system", content: `REACTIONS:\n- ${react.join("\n- ")}` },
      { role: "system", content: `DRINK: ${drink}` },
      { role: "system", content: L==="it" ? `ESEMPI (tono/ritmo). Mantieni utilità finale.` : `Keep absurd but land with real advice.` }
    );
  } else {
    // WHATIF aggiornato con luogo/contesto e warm opener opzionale
    const seed=seedFrom(domanda);
    const opIdx = Math.floor(seededRand(seed)()*WHATIF_OPENERS_IT.length);
    const opener = WHATIF_OPENERS_IT[opIdx];
    const warm = maybeWarmOpener(domanda, L, micro, openerMode);
    const placeHint = mentionsPlace(domanda) ? (L==="it"
      ? "Se la domanda cita un luogo, apri con 2–3 frasi sul contesto reale e su come si sta evolvendo prima di parlare dell'utente."
      : "If a place is mentioned, open with 2–3 sentences on current context and evolution before speaking about the user.") : "";

    msgs.push(
      { role: "system", content: WHATIF_RULE_IT },
      { role: "system", content: L==="it" ? `Incipit suggerito (non obbligatorio): ${opener}` : `Suggested incipit (not mandatory): ${opener}` },
      ...(warm ? [{ role: "system", content: L==="it" ? `Una riga personale se utile: ${warm}` : `One warm opener if useful: ${warm}` }] : []),
      ...(placeHint ? [{ role: "system", content: placeHint }] : []),
    );
  }

  // Istruzione utente finale
  const ask = (L==="en")
    ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH. Single paragraph.`
    : (L==="it")
    ? `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico.`
    : (L==="es")
    ? `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.`
    : (L==="fr")
    ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.`
    : `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.`;

  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= Micro-memoria (opzionale) ========= */
// Salva preferenze leggere e non sensibili (tono, openerMode, città) su Redis.
// Chiave basata su ip (grezzo) + lang per scopi demo. Puoi sostituire con un authId.
async function loadPrefs(key){
  try{ return (await redis.get(key)) || null; } catch { return null; }
}
async function savePrefs(key, prefs){
  try{ await redis.set(key, prefs, { ex: 60*60*24*7 }); } catch {}
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
      stile = "whatif",      // "whatif" | "wtf"
      lang  = "it",
      periodo = "future",
      micro = {},            // { name?, energy?, style?, goals?, city? }
      openerMode = "auto",   // "auto" | "always" | "never"  ← default “auto” per utente medio
      preferenze = null      // { openerMode?, micro? } per salvare in memoria
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    // Micro-memoria: carica preferenze salvate, poi merge con body
    const memKey = `prefs:${ip}:${normLang(lang)}`;
    const saved = await loadPrefs(memKey);
    const effOpener = openerMode || saved?.openerMode || "auto";
    const effMicro  = { ...(saved?.micro || {}), ...(micro || {}) };

    // Se arrivano nuove preferenze, salvale
    if (preferenze && typeof preferenze === "object") {
      const toSave = {
        openerMode: preferenze.openerMode || effOpener,
        micro: { ...(saved?.micro || {}), ...(preferenze.micro || {}) }
      };
      await savePrefs(memKey, toSave);
    }

    const messages = buildMessages({
      domanda, lang, periodo, stile,
      micro: effMicro,
      openerMode: effOpener
    });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.85,  // varietà naturale senza scadere nel caos
      top_p: 0.92,
      max_tokens: 520,
      frequency_penalty: 0.2,  // contro ripetizioni
      presence_penalty: 0.1,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 180 : 175);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Moderazioni leggere: niente nomi inventati se non presenti nella domanda (IT)
    if(normLang(lang)==="it"){
      (function(){
        const d=String(domanda||"");
        const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQuestion=new Set((d.match(nameRx)||[]));
        answer=answer.replace(nameRx,(m)=> inQuestion.has(m) ? m : ((["Ah","Oh","Ehi","Sai"].includes(m)) ? m : m.toLowerCase()));
      })();
    }

    return res.status(200).json({
      answer,
      style: stile,
      lang: normLang(lang),
      periodo,
      model: MODEL,
      usedPrefs: { openerMode: effOpener, micro: effMicro }
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
