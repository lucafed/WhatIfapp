// /api/ask.js — What?f Engine (Stable Hybrid WHATIF + Friendly-WTF Demenziale)
// - WHATIF: 60% analisi / 40% immagini sobrie. Incipit LIBERO (no “Bella …”) + tocco psicologo leggero.
// - WTF: 2–3 reazioni DEMENZIALI, UNA “imprecazione” teatrale, sorso alcolico, risposta vera, morale. (Lasciato intatto.)
// - Maiuscole post-process dopo . ? ! … : e con virgolette/parentesi. Un paragrafo, niente elenchi, niente eco della domanda.
// - Motivazioni: box coerente + percentuale; massima libertà alla AI sul testo e sulla %.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import crypto from "crypto";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
// FREE: 3/min — PRO: 10/min (stesso modello)
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rlFree = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "1 m") });
const rlPro  = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ========= CORS ========= */
// Whitelist fissa + preview Vercel (branch builds)
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
const VERCEL_PREVIEW_RX = /^https:\/\/[a-z0-9-]+-what-ifapp-[a-z0-9-]+-vercel\.app$/i;

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const ok = ALLOWED_ORIGINS.includes(origin) || VERCEL_PREVIEW_RX.test(origin);
  if (ok) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro, x-debug, x-seed"
  );
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
function normLang(l="it"){ const s=String(l||"it").toLowerCase().slice(0,2); return SUP_LANGS.includes(s)?s:"it"; }

function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?():\[\]\-—]+$/g,"").trim(); }
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
// Maiuscole robuste: inizio stringa + dopo . ? ! … : e gestione virgolette/parentesi
function sentenceCaseAll(s=""){
  if(!s) return s;
  s = s.replace(/^(\s*[«“"'\(\[]*)([a-zà-ÿ])/u, (m, pre, ch) => pre + ch.toUpperCase());
  s = s.replace(/([.!?…:]\s+)([«“"'\(\[]*)([a-zà-ÿ])/gu, (m, p, pre, ch) => p + pre + ch.toUpperCase());
  return s;
}
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

// Hash/RNG utili (seed opzionale)
function hash32(str){ let x=2166136261; for(const c of String(str)) x=(x^c.charCodeAt(0))>>>0, x=(x*16777619)>>>0; return x>>>0; }
function u32fromCrypto(){ try{ return crypto.randomBytes(4).readUInt32BE(0); } catch{ return (Math.random()*2**32)>>>0; } }
function getRequestSeed(req, extra=""){
  const hdr = req?.headers?.["x-seed"];
  if (hdr) return Number(hdr)>>>0;
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "0.0.0.0").toString().split(",")[0].trim();
  const t = Date.now();
  const rnd = u32fromCrypto() ^ ((Math.random()*2**32)>>>0);
  return (hash32(ip + ":" + t + ":" + extra) ^ rnd) >>> 0;
}

/* ========= WHAT IF — regole (incipit LIBERO) ========= */
const WHATIF_RULE = {
  it: `WHAT IF HYBRID (italiano): 60% analisi concreta (costi/benefici, routine, qualità di vita), 40% immagini sobrie della quotidianità. Incipit libero e naturale (evita “Bella …”). 8–10 frasi, seconda persona, un paragrafo, non ripetere la domanda. Tocco psicologo leggero (ambivalenza, normalizzazione, scambi tra tempo/denaro/energia/relazioni).`,
  en: `WHAT IF HYBRID (English): 60% concrete analysis, 40% sober everyday imagery. Free, natural opener (avoid “Nice one”). 8–10 sentences, second person, single paragraph, do not restate the question. Light therapist touch.`,
  es: `WHAT IF HYBRID (español): 60% análisis concreto, 40% imágenes sobrias. Inicio libre y natural (evita “Qué bonito”). 8–10 frases, segunda persona, un párrafo, sin repetir la pregunta.`,
  fr: `WHAT IF HYBRID (français): 60% analyse concrète, 40% images sobres. Ouverture libre et naturelle (éviter « Sympa »). 8–10 phrases, deuxième personne, un paragraphe, sans répéter la question.`,
  de: `WHAT IF HYBRID (Deutsch): 60% konkrete Analyse, 40% nüchterne Alltagsbilder. Freier, natürlicher Einstieg (ohne „Na toll“). 8–10 Sätze, zweite Person, ein Absatz, Frage nicht wiederholen.`
};

// Esempio IT (àncora di ritmo, non vincolante sull’incipit)
const WHATIF_HYBRID_EX_IT = `Sai, questa non è una domanda leggera. Guardi i numeri, poi guardi le abitudini: costi più bassi da una parte, occasioni più larghe dall’altra. La qualità della vita non è un grafico, è una routine: tempi di spostamento, servizi che funzionano, persone che senti vicine. Se stringi, il portafoglio respira un po’ di più; in cambio accetti un ritmo meno veloce e meno “vetrine” da inseguire. Le giornate si accorciano di frenesia e si allungano di fiato: un caffè fatto bene, una strada che conosci, un’aria che sa di casa. Non è una fuga né un eroismo: è ingegneria quotidiana, spostare pesi tra tempo, denaro e relazioni. A conti fatti, potresti guadagnare spazio mentale e perdere solo rumore. E quando la sera chiudi la porta, non senti il rimpianto bussare: senti il tuo passo tornare al suo passo.`;

/* ========= WTF — banca demenziale (INTATTO) ========= */
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

/* ========= OpenAI retry helper (soft) ========= */
async function askOpenAI(payload) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try { return await client.chat.completions.create(payload); }
    catch (e) { lastErr = e; await new Promise(r=>setTimeout(r, 350*(i+1))); }
  }
  throw lastErr;
}

/* ========= Prompt builder (RISPOSTA) ========= */
function buildMessages({ domanda, lang, periodo, stile, seedU32 }){
  const L = normLang(lang);

  const baseRules =
    L === "en" ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.` :
    L === "es" ? `REGLAS: un solo párrafo, sin listas ni emojis. NO repitas la pregunta. Segunda persona.` :
    L === "fr" ? `RÈGLES : un seul paragraphe, pas de listes ni d’emojis. NE répète pas la question. Deuxième personne.` :
    L === "de" ? `REGELN: ein einziger Absatz, keine Listen oder Emojis. Frage NICHT wiederholen. Zweite Person.` :
                 `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;

  const temporal =
    String(periodo).toLowerCase()==="past" ?
      (L==="en" ? "Write as if it already happened." :
       L==="es" ? "Escribe como si ya hubiera ocurrido." :
       L==="fr" ? "Écris comme si c’était déjà arrivé." :
       L==="de" ? "Schreibe, als wäre es bereits passiert." :
                  "Scrivi come se fosse già successo.") :
      (L==="en" ? "Write as a near-future unfolding starting now." :
       L==="es" ? "Escribe como un futuro cercano que empieza ahora." :
       L==="fr" ? "Écris comme un futur proche qui commence maintenant." :
       L==="de" ? "Schreibe wie eine nahe Zukunft, die jetzt beginnt." :
                  "Scrivi come un prossimo futuro che inizia ora.");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if(stile==="wtf"){
    // Lasciato invariato
    let seed = (seedU32 ?? 0) ^ hash32(String(domanda));
    function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; }
    const impre = WTF_IMPRE[Math.floor(rnd()*WTF_IMPRE.length)];
    const shuffled=[...WTF_REACT].sort(()=>rnd()-0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd()*2)); // 2 o 3
    const drink = WTF_DRINK[Math.floor(rnd()*WTF_DRINK.length)];

    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). STRICT sequence: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” (narrated, never insulting people) → THEN ${react.length} absurd object reactions → drink (“${drink}”) → 1–2 lines that truly answer → warm ironic moral. 6–8 sentences.`;
    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Struttura OBBLIGATORIA: presa in giro affettuosa (max 2 frasi) → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”, come narrazione, mai insulto a persone) → SUBITO ${react.length} reazioni di oggetti esilaranti → drink (“${drink}”) → 1–2 frasi che rispondono davvero → morale calda e ironica. 6–8 frasi.`;
    const WTF_RULE_ES = `WHAT THE F (amable, absurdo pero útil). Secuencia ESTRICTA: broma cariñosa (≤2) → 2–3 microcontratiempos → UNA “${impre}” teatral → LUEGO ${react.length} reacciones absurdas de objetos → trago (“${drink}”) → 1–2 líneas que sí responden → moraleja cálida e irónica. 6–8 frases.`;
    const WTF_RULE_FR = `WHAT THE F (amical, absurde mais utile). Séquence STRICTE : taquinerie affectueuse (≤2) → 2–3 micro-couacs → UNE “${impre}” théâtrale → PUIS ${react.length} réactions absurdes d’objets → boisson (“${drink}”) → 1–2 phrases qui répondent vraiment → morale chaleureuse et ironique. 6–8 phrases.`;
    const WTF_RULE_DE = `WHAT THE F (freundlich, absurd aber hilfreich). STRIKTE Reihenfolge: liebevolles Necken (≤2) → 2–3 Mini-Pannen → EINE theatralische „${impre}“ → DANN ${react.length} absurde Objektreaktionen → Drink („${drink}“) → 1–2 Sätze echte Antwort → warme, ironische Moral. 6–8 Sätze.`;

    msgs.push(
      { role: "system", content:
        L==="en" ? WTF_RULE_EN : L==="es" ? WTF_RULE_ES : L==="fr" ? WTF_RULE_FR : L==="de" ? WTF_RULE_DE : WTF_RULE_IT
      },
      { role: "system", content: `IMPRECATION: ${impre}` },
      { role: "system", content: `REACTIONS:\n- ${react.join("\n- ")}` },
      { role: "system", content: `DRINK: ${drink}` },
      // Manteniamo un esempio di ritmo (non influisce sul contenuto WTF)
      { role: "system", content: `ESEMPIO (respiro e tono IT):\n${WHATIF_HYBRID_EX_IT}` }
    );
  } else {
    // WHATIF ibrido: regola + esempio, incipit lasciato libero
    msgs.push(
      { role: "system", content: WHATIF_RULE[L] || WHATIF_RULE.it },
      { role: "system", content: `ESEMPIO (solo ritmo, incipit a scelta):\n${WHATIF_HYBRID_EX_IT}` }
    );
  }

  // Istruzione finale nella lingua corretta
  const ask =
    (L==="en") ? `Question (do not repeat it): "${domanda}". Produce ONE answer in ENGLISH. Single paragraph.` :
    (L==="es") ? `Pregunta (no la repitas): "${domanda}". Escribe UNA respuesta en ESPAÑOL, un solo párrafo.` :
    (L==="fr") ? `Question (ne la répète pas) : « ${domanda} ». Donne UNE réponse en FRANÇAIS, un seul paragraphe.` :
    (L==="de") ? `Frage (nicht wiederholen): „${domanda}“. Gib EINE Antwort auf DEUTSCH, ein einziger Absatz.` :
                 `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO. Paragrafo unico.`;
  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= Prompt builder (MOTIVAZIONI: libertà su testo e %) ========= */
function buildMotivationPrompt({ domanda, answer, lang }){
  const L = normLang(lang);
  const sys =
    L==="en" ? `Create a motivation box consistent with the question and prior answer. Be concise, one paragraph. Choose any reasonable probability (0–100). Output JSON only: {"probability": <int>, "motivation": "<text>"}.` :
    L==="es" ? `Crea un cuadro de motivación coherente con la pregunta y la respuesta. Sé conciso, un párrafo. Elige cualquier probabilidad (0–100). Devuelve solo JSON: {"probability": <int>, "motivation": "<texto>"}.` :
    L==="fr" ? `Crée un encadré de motivation cohérent avec la question et la réponse. Concis, un paragraphe. Choisis une probabilité (0–100). Rends uniquement du JSON : {"probability": <int>, "motivation": "<texte>"}.` :
    L==="de" ? `Erstelle eine stimmige Begründung zur Frage und Antwort. Prägnant, ein Absatz. Wähle eine Wahrscheinlichkeit (0–100). Gib nur JSON zurück: {"probability": <int>, "motivation": "<text>"}.` :
              `Crea un riquadro “Motivazione” coerente con domanda e risposta. Sii conciso, un paragrafo. Scegli liberamente una probabilità (0–100). Restituisci SOLO JSON: {"probability": <int>, "motivation": "<testo>"}.`;

  return [
    { role: "system", content: sys },
    { role: "user", content: (L==="en" ? `Question: ${domanda}` :
                               L==="es" ? `Pregunta: ${domanda}` :
                               L==="fr" ? `Question : ${domanda}` :
                               L==="de" ? `Frage: ${domanda}` :
                                         `Domanda: ${domanda}`) },
    { role: "user", content: (L==="en" ? `Prior answer:\n${answer}` :
                               L==="es" ? `Respuesta previa:\n${answer}` :
                               L==="fr" ? `Réponse précédente :\n${answer}` :
                               L==="de" ? `Vorherige Antwort:\n${answer}` :
                                         `Risposta precedente:\n${answer}`) },
  ];
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const isPro =
      String(req.headers["x-pro"] || "").toLowerCase() === "true" ||
      String(req.headers["x-pro"] || "") === "1";

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await (isPro ? rlPro : rlFree).limit(`ask:${ip}:${isPro?"pro":"free"}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      lang  = "it",
      periodo = "future",
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    // Seed opzionale per varietà (non impone opener)
    const seedU32 = getRequestSeed(req, stile + ":" + lang);

    // ===== 1) Risposta =====
    const messages = buildMessages({ domanda, lang, periodo, stile, seedU32 });
    const completion = await askOpenAI({
      model: MODEL, // stesso modello per free e pro
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-process risposta
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Moderazione leggera (IT): non abbassare incipit naturali; evita nomi propri non presenti nella domanda
    if(normLang(lang)==="it"){
      (function(){
        const d=String(domanda||"");
        const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ’']{2,})\b/gu;
        const inQuestion=new Set((d.match(nameRx)||[]));
        answer=answer.replace(nameRx,(m)=> inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Sai","Se","Non","È","La","Il","Un","Una"].includes(m) ? m : m.toLowerCase()));
      })();
    }

    // ===== 2) Motivazioni (libere su testo e %) =====
    let probability = 50;
    let motivation = "";
    try{
      const motMsgs = buildMotivationPrompt({ domanda, answer, lang });
      const mot = await client.chat.completions.create({
        model: MODEL,
        response_format: { type: "json_object" },
        temperature: 0.6,
        max_tokens: 220,
        messages: motMsgs
      });
      const parsed = JSON.parse(mot?.choices?.[0]?.message?.content || "{}");
      probability = Math.max(0, Math.min(100, parseInt(parsed?.probability ?? 50, 10)));
      motivation = String(parsed?.motivation || "").trim();
      motivation = normalizeOneParagraph(sentenceCaseAll(finalPunct(motivation)));
    }catch{
      // Fallback minimal
      motivation = normLang(lang)==="it"
        ? "Può funzionare: riduci attrito, proteggi tempo/energia e i piccoli risultati alimentano la costanza."
        : "It can work: you reduce friction, protect time/energy, and small wins feed consistency.";
      probability = 50;
      motivation = finalPunct(sentenceCaseAll(motivation));
    }

    const debug = String(req.headers["x-debug"] || "").toLowerCase() === "true";
    return res.status(200).json({
      answer,
      motivation,
      probability,
      style: stile,
      lang: normLang(lang),
      periodo,
      model: MODEL,
      pro: isPro,
      ...(debug ? { debug: { seedU32 } } : {})
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
