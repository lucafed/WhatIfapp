// /api/ask.js — What?f Engine (Stable Hybrid WHATIF + Friendly-WTF Demenziale)
// - WHATIF: stile unico 60% analisi / 40% immagini sobrie. Incipit libero (vietato “Bella …”). Motivazione breve generata dal modello.
// - WTF: come da tuoi esempi, 2–3 reazioni DEMENZIALI, una sola “imprecazione” teatrale, sorso alcolico, risposta vera, morale. (invariato)
// - Maiuscole sistemate post-process dopo . ? ! … : e con virgolette/parentesi. Un paragrafo, niente elenchi, niente eco della domanda.

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
// Maiuscole robuste: inizio stringa + dopo . ? ! … : + virgolette/parentesi
function sentenceCaseAll(s=""){
  if(!s) return s;
  s = s.replace(/^(\s*[«“"'\(\[]*)([a-zà-ÿ])/u, (m, pre, ch) => pre + ch.toUpperCase());
  s = s.replace(/([.!?…:]\s+)([«“"'\(\[]*)([a-zà-ÿ])/gu, (m, p, pre, ch) => p + pre + ch.toUpperCase());
  return s;
}
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

/* ========= WHAT IF – regole (incipit LIBERO) ========= */
const WHATIF_RULE = {
  it: `SEI “WHAT IF”.
Stile: 60% analisi concreta (costi/benefici, routine, qualità di vita), 40% immagini sobrie della quotidianità.
Formato OBBLIGATORIO: 1 paragrafo, 8–11 frasi, seconda persona, niente elenchi/emote/titoli, NON ripetere la domanda. Vietato iniziare con “Bella…”.
Tocco: psicologo leggero (ambivalenza, normalizzazione, scambi tra tempo/denaro/energia/relazioni). Chiudi con una micro-spinta operativa.
Al termine AGGIUNGI una riga tecnica: [[MOTIVO]]: una motivazione BREVE, coerente con quanto hai appena scritto (max 160 caratteri, 1–2 frasi, nessun elenco).`,
  en: `You are “WHAT IF”.
Style: 60% concrete analysis, 40% sober everyday imagery.
Format: 1 paragraph, 8–11 sentences, second person only, no lists/emojis/titles, do NOT restate the question. Never start with “Nice one…”.
Tone: light therapist. End with a tiny operational nudge.
Finally APPEND a tech line: [[MOTIVO]]: a SHORT rationale consistent with your answer (<=160 chars, 1–2 sentences, no bullets).`,
  es: `Eres “WHAT IF”.
Estilo: 60% análisis concreto, 40% imágenes sobrias.
Formato: 1 párrafo, 8–11 frases, segunda persona, sin listas/emoji/títulos, NO repitas la pregunta. No empieces con “Qué bonito…”.
Cierre con empujón operativo breve.
Al final AÑADE: [[MOTIVO]]: motivación CORTA coherente (<=160 caracteres, 1–2 frases, sin viñetas).`,
  fr: `Tu es “WHAT IF”.
Style : 60 % analyse concrète, 40 % images sobres du quotidien.
Format : 1 paragraphe, 8–11 phrases, 2ᵉ personne, pas de listes/emoji/titres, ne répète pas la question. Ne commence jamais par « Sympa… ».
Termine par une micro-impulsion opérationnelle.
Ajoute enfin : [[MOTIVO]] : justification COURTE cohérente (<=160 caractères, 1–2 phrases).`,
  de: `Du bist „WHAT IF“.
Stil: 60 % konkrete Analyse, 40 % nüchterne Alltagsbilder.
Format: 1 Absatz, 8–11 Sätze, 2. Person, keine Listen/Emojis/Titel, Frage NICHT wiederholen. Nie mit „Na toll…“ starten.
Schließe mit einem kleinen operativen Impuls.
Füge zuletzt an: [[MOTIVO]]: KURZE, stimmige Begründung (<=160 Zeichen, 1–2 Sätze).`
};

// Esempio (àncora di ritmo) – NON obbliga l’incipit
const WHATIF_HYBRID_EX_IT = `Sai, questa non è una domanda leggera. Guardi i numeri, poi guardi le abitudini: costi più bassi da una parte, occasioni più larghe dall’altra. La qualità della vita non è un grafico, è una routine: tempi di spostamento, servizi che funzionano, persone che senti vicine. Se stringi, il portafoglio respira un po’ di più; in cambio accetti un ritmo meno veloce e meno “vetrine” da inseguire. Le giornate si accorciano di frenesia e si allungano di fiato: un caffè fatto bene, una strada che conosci, un’aria che sa di casa. Non è una fuga né un eroismo: è ingegneria quotidiana, spostare pesi tra tempo, denaro e relazioni. A conti fatti, potresti guadagnare spazio mentale e perdere solo rumore. E quando la sera chiudi la porta, non senti il rimpianto bussare: senti il tuo passo tornare al suo passo.`;

/* ========= WTF — banche demenziali (INVARIATO) ========= */
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
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const baseRules =
    L==="en" ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.` :
               `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;
  const temporal =
    String(periodo).toLowerCase()==="past"
      ? (L==="en" ? "Write as if it already happened." : "Scrivi come se fosse già successo.")
      : (L==="en" ? "Write as a near-future unfolding starting now." : "Scrivi come un prossimo futuro che inizia ora.");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if(stile==="wtf"){
    // seed deterministico semplice dalla domanda
    let seed=[...String(domanda)].reduce((a,c)=>a+c.charCodeAt(0),0);
    function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; }
    const impre = WTF_IMPRE[Math.floor(rnd()*WTF_IMPRE.length)];
    const shuffled=[...WTF_REACT].sort(()=>rnd()-0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd()*2)); // 2 o 3
    const drink = WTF_DRINK[Math.floor(rnd()*WTF_DRINK.length)];

    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Struttura OBBLIGATORIA: presa in giro affettuosa (max 2 frasi) → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”, come narrazione, mai insulto a persone) → SUBITO ${react.length} reazioni di oggetti esilaranti → drink (“${drink}”) → 1–2 frasi che rispondono davvero → morale calda e ironica. 6–8 frasi.`;
    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). STRICT sequence: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” (narrated, never insulting people) → THEN ${react.length} absurd object reactions → drink (“${drink}”) → 1–2 lines that truly answer → warm ironic moral. 6–8 sentences.`;

    msgs.push(
      { role: "system", content: L==="en" ? WTF_RULE_EN : WTF_RULE_IT },
      { role: "system", content: `IMPRECATION: ${impre}` },
      { role: "system", content: `REACTIONS:\n- ${react.join("\n- ")}` },
      { role: "system", content: `DRINK: ${drink}` },
      { role: "system", content:
`ESEMPI VINCOLANTI (tono/ritmo IT):
- Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.
- Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.
- Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.` }
    );
  } else {
    // WHATIF ibrido: incipit LIBERO (no “Bella …”) + riga [[MOTIVO]] finale
    msgs.push(
      { role: "system", content: WHATIF_RULE[L] || WHATIF_RULE.it },
      { role: "system", content: `ESEMPIO (ritmo, non copiare l’incipit):\n${WHATIF_HYBRID_EX_IT}` }
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

/* ========= HANDLER (invariato) ========= */
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
      lang  = "it",
      periodo = "future",
      micro = {}
    } = body;

    if(!domanda || typeof domanda !== "string")
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, micro });

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

    // Estrai eventuale [[MOTIVO]] (solo WHATIF) PRIMA del resto del post-process
    let motive = "";
    if (stile !== "wtf") {
      const m = answer.match(/\[\[\s*MOTIVO\s*\]\]\s*:\s*([\s\S]+)$/i);
      if (m) {
        motive = m[1].trim();
        answer = answer.replace(m[0], "").trim();
        // compattazione motivo: 1–2 frasi, <=160 char
        motive = normalizeOneParagraph(motive);
        if (motive.length > 160) motive = motive.slice(0, 160).replace(/\s+\S*$/, "") + "…";
      }
    }

    // Post-process testo principale
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // Moderazioni leggere IT (non spegnere l'umorismo)
    if(normLang(lang)==="it"){
      (function(){
        const d=String(domanda||"");
        const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
        const inQuestion=new Set((d.match(nameRx)||[]));
        answer=answer.replace(nameRx,(m)=> inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Sai"].includes(m) ? m : m.toLowerCase()));
      })();
    }

    return res.status(200).json({
      answer,
      motive,                // <- motivazione breve coerente (solo WHATIF; vuota per WTF)
      style: stile,
      lang: normLang(lang),
      periodo,
      model: MODEL
    });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
