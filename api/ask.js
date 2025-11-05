// /api/ask.js — What?f Engine (WhatIf naturale + WTF demenziale — MULTILINGUA)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Rate limit ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

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
const normLang = (l="it") =>
  SUP_LANGS.includes(String(l||"it").toLowerCase().slice(0,2))
    ? String(l).toLowerCase().slice(0,2)
    : "it";

const normLine = (s="") => String(s).toLowerCase()
  .replace(/[“”"']/g,"").replace(/\s+/g," ")
  .replace(/[.,;:!?()[\]\-—]+$/g,"").trim();

function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" ");
  const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){
  return String(s)
    .replace(/\s*\n+\s*/g," ")
    .replace(/\s{2,}/g," ")
    .replace(/\.\.\.+/g,"…")
    .replace(/\s+([.,;:!?])/g,"$1")
    .trim();
}
function stripQuestionEcho(domanda,text){
  let t=String(text||"");
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  if(d.length>=8){
    const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
    if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  }
  const rx=/^(?:\s*(?:e\s*se|what\s*if|domanda:|q:)\s*[^.!?…]*[.!?…]\s+)/i;
  return t.replace(rx,"").trim();
}
const sentenceCaseAll = (s="") => s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/gu,(m,p,c)=>p+c.toUpperCase());
const finalPunct = (s="") => /[.!?…]$/.test(s)?s:s+".";

/* ========= WHAT IF ========= */
const WHATIF_RULES = {
  it: `Sei "What If": voce calma, empatica, concreta. Scrivi in ITALIANO.
Paragrafo unico, 8–11 frasi, no elenchi né emoji, NON ripetere la domanda.
Sequenza: (1) radice emotiva; (2) perché conta ora; (3) prime settimane;
(4) outlook 3–6 mesi (pro + sfida); (5) realtà pratica (costi/tempo/energia/contesto);
(6) da dove nasce il desiderio; (7) micro-test; (8) criterio interno per decidere.
Stile naturale, immagini quotidiane brevi. Adatta al tema (città/lavoro/relazioni/soldi/crescita).`.trim(),
  en: `You are "What If": calm, empathetic, practical. Write in ENGLISH.
Single paragraph, 8–11 sentences, no bullets or emojis, do NOT restate the question.
Sequence: (1) emotional root; (2) why now; (3) first weeks; (4) 3–6 month outlook (upsides + challenge);
(5) practical reality (cost/time/energy/context); (6) origin of desire; (7) micro-test; (8) inner criterion. Keep it natural.`.trim(),
  es: `Eres "What If": voz calmada, empática y práctica. Escribe en ESPAÑOL.
Un solo párrafo, 8–11 frases, sin listas ni emojis, NO repitas la pregunta.
Secuencia: raíz emocional → por qué ahora → primeras semanas → 3–6 meses (pro + desafío) → realidad práctica → origen del deseo → micro-prueba → criterio interno.`.trim(),
  fr: `Tu es "What If" : voix calme, empathique et concrète. Écris en FRANÇAIS.
Un seul paragraphe, 8–11 phrases, pas de listes ni d’emojis, ne répète pas la question. Suis la séquence et reste naturel.`.trim(),
  de: `Du bist "What If": ruhig, empathisch, pragmatisch. Schreibe auf DEUTSCH.
Ein Absatz, 8–11 Sätze, keine Listen/Emojis, Frage NICHT wiederholen. Folge der Sequenz, alltagsnah.`.trim()
};
const WHATIF_EXAMPLES = {
  it:`Questa domanda nasce quando una parte di te chiede un ritmo più tuo. Le prime settimane avrebbero un sapore familiare e strano insieme: luoghi che riconosci e la testa che corre meno. Dopo un mese arriva la prova vera: confrontarti con chi eri e chi sei adesso, capire se quella differenza ti allarga o ti stringe. Nel concreto guadagni spazio mentale e routine più sane, ma perdi un po’ di vibrazione quotidiana. Se lo vivi come passo in avanti e non ritorno al passato, in sei mesi puoi sentirti più stabile e presente; se ti sembra di rientrare in una versione più piccola di te, tornerà presto voglia di ripartire. Fai un test di due settimane “come se fosse già così”: orari, luoghi, lavoro. Se ti svegli più leggero e non senti di mettere la vita in pausa, non stai tornando: stai iniziando da lì.`,
  en:`This question appears when part of you asks for a rhythm that feels more like you. The first weeks feel familiar and odd at once; a month in, the real test is who you were vs who you are now. You gain mental space and steadier routines, but lose some everyday buzz. If it’s a step forward (not a return), in six months you feel more stable and present; if it shrinks you, the urge to move on returns. Run a two-week “as if already true” test: hours, places, work. If you wake up lighter and don’t feel on pause, you’re not going back — you’re starting from there.`,
  es:`Esta pregunta aparece cuando una parte de ti pide un ritmo más tuyo…`,
  fr:`Cette question arrive quand une part de toi demande un rythme plus à toi…`,
  de:`Diese Frage taucht auf, wenn ein Teil von dir nach einem eigenen Rhythmus ruft…`
};

/* ========= WTF ========= */
const WTF_IMPRE = ["bestemmione corazzato","imprecazionona a detonazione","sacramentata a ciel sereno","vulcano d’anatemi","tromba d’aria di improperi"];
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
// Sbronza “galattica” (più forte e breve)
const WTF_DRINK = [
  "tequila orbitale a secchiate, brindisi alle costellazioni",
  "negroni da cataclisma, triplo giro senza mani",
  "rum fino a vedere i giorni della settimana in 3D",
  "grappa che parla lingue antiche e ti dà del tu",
  "spritz formato catino con salvataggio del barman",
  "birra a pluviometro: allerta meteo in salotto",
  "vino a cascata: applausi dei vetri, ovazione del parquet",
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const baseRules = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;
  const temporal = String(periodo).toLowerCase()==="past"
    ? (L==="en" ? "Write as if it already happened." : L==="es" ? "Escribe como si ya hubiera pasado." : L==="fr" ? "Écris comme si c’était déjà arrivé." : L==="de" ? "Schreibe, als wäre es bereits geschehen." : "Scrivi come se fosse già successo.")
    : (L==="en" ? "Write as a near-future unfolding starting now." : L==="es" ? "Escribe como un futuro cercano que empieza ahora." : L==="fr" ? "Écris comme un futur proche qui commence maintenant." : L==="de" ? "Schreibe als nahe Zukunft, die jetzt beginnt." : "Scrivi come un prossimo futuro che inizia ora.");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if(stile==="wtf"){
    let seed=[...String(domanda)].reduce((a,c)=>a+c.charCodeAt(0),0);
    const rnd=()=>{ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; };
    const impre = WTF_IMPRE[Math.floor(rnd()*WTF_IMPRE.length)];
    const react = [...WTF_REACT].sort(()=>rnd()-0.5).slice(0, 2 + Math.floor(rnd()*2));
    // 2–3 giri di sbronza galattica
    const drinks = [...WTF_DRINK].sort(()=>rnd()-0.5).slice(0, 2 + (rnd()<0.5?1:0));

    // Tono “What the F” ripristinato, più corto e più risposta
    const wtfRules = (()=>{
      const drinksList = drinks.map(d=>`“${d}”`).join(" + ");
      const reactN = react.length;
      const IT = `WHAT THE F (irriverente, assurdo ma utile). Pattern libero e BREVE: presa in giro affettuosa (≤2) → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”, narrato, mai verso persone) → SUBITO ${reactN} oggetti parlanti → ${drinks.length} giri di sbronza galattica (${drinksList}) → **2–3 frasi che rispondono davvero alla domanda** → **CHIUSURA LAMPO**: morale ironica + consiglio scemo attinente. Totale 4–6 frasi, paragrafo unico.`;
      const EN = `WHAT THE F (irreverent, absurd yet helpful). Free, SHORT pattern: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical burst (“${impre}”) → THEN ${reactN} talking objects → ${drinks.length} rounds of galactic booze (${drinksList}) → **2–3 sentences that truly answer** → **FLASH END**: ironic moral + silly on-topic tip. Total 4–6 sentences, single paragraph.`;
      const ES = `WHAT THE F (irreverente, absurdo pero útil). Libre y CORTO: broma cariñosa (≤2) → 2–3 micro-contratiempos → UN estallido (“${impre}”) → ${reactN} objetos parlantes → ${drinks.length} rondas de borrachera galáctica (${drinksList}) → **2–3 frases que sí responden** → **CIERRE FLASH**: moraleja irónica + consejo tonto. Total 4–6 frases.`;
      const FR = `WHAT THE F (irrévérencieux, absurde mais utile). Libre et COURT : taquinerie (≤2) → 2–3 couacs → UNE explosion (« ${impre} ») → ${reactN} objets parlants → ${drinks.length} tournées d’ivresse galactique (${drinksList}) → **2–3 phrases qui répondent** → **FIN ÉCLAIR** : morale ironique + conseil idiot. Total 4–6 phrases.`;
      const DE = `WHAT THE F (frech, absurd und hilfreich). Locker und KURZ: necken (≤2) → 2–3 Pannen → EINE theatralische Entladung („${impre}“) → ${reactN} sprechende Objekte → ${drinks.length} Runden galaktischer Rausch (${drinksList}) → **2–3 Antwortsätze** → **KURZES ENDE**: ironische Moral + dummer Tipp. Insgesamt 4–6 Sätze.`;
      return { it:IT, en:EN, es:ES, fr:FR, de:DE }[L] || IT;
    })();

    msgs.push(
      { role:"system", content: wtfRules },
      { role:"system", content:`IMPRECATION: ${impre}` },
      { role:"system", content:`REACTIONS:\n- ${react.join("\n- ")}` },
      { role:"system", content:`DRINKS:\n- ${drinks.join("\n- ")}` },
    );
  } else {
    msgs.push(
      { role:"system", content: WHATIF_RULES[L] || WHATIF_RULES.it },
      { role:"system", content: `Esempio/Example:\n${WHATIF_EXAMPLES[L] || WHATIF_EXAMPLES.it}` },
      { role:"system", content: `ADATTAMENTO PER TEMA: città/lavoro/relazioni/soldi/crescita.` }
    );
  }

  const ask =
    L==="en" ? `Question (do NOT repeat it). ONE SINGLE PARAGRAPH (8–11 sentences). Keep it natural and concise. "${domanda}"`
  : L==="es" ? `No repitas la pregunta. Un solo párrafo (8–11 frases), natural y conciso. "${domanda}"`
  : L==="fr" ? `Ne répète pas la question. Un seul paragraphe (8–11 phrases), naturel et concis. « ${domanda} »`
  : L==="de" ? `Wiederhole die Frage nicht. Ein einziger Absatz (8–11 Sätze), natürlich und knapp. „${domanda}“`
  :           `Non ripetere la domanda. Scrivi UN SOLO PARAGRAFO (8–11 frasi), naturale e conciso. "${domanda}"`;
  msgs.push({ role: "user", content: ask });

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
    const { domanda = "", stile = "whatif", lang = "it", periodo = "future", micro = {} } = body;
    if(!domanda || typeof domanda !== "string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

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

    // ===== Post-process =====
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 6 : 11); // ancora più corto per WTF
    answer = clampWords(answer, stile === "wtf" ? 120 : 165);    // cap parole più stretto per WTF
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // ===== IT normalizzazioni sicure (NON toccare prima parola / post-punteggiatura) =====
    if(normLang(lang)==="it"){
      const d=String(domanda||"");
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion=new Set((d.match(nameRx)||[]));

      answer = answer.replace(nameRx, (m, _g1, offset, str)=>{
        if(offset===0) return m; // inizio stringa
        const before = str.slice(0, offset);
        if(/[.!?…]["'”)\]]?\s*$/.test(before)) return m; // subito dopo fine frase
        return inQuestion.has(m) || ["Ah","Oh","Ehi","Sai"].includes(m) ? m : m.toLowerCase();
      });

      // L'Aquila
      answer = answer.replace(/\ball’aquila\b/g, "all’Aquila");
    }

    // ===== Forza MAIUSCOLA iniziale come ultimo step assoluto =====
    answer = answer.replace(/^\s*([a-zà-ÿ])/u, (m,c)=>c.toUpperCase());

    return res.status(200).json({ answer, style: stile, lang: normLang(lang), periodo, model: MODEL });

  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
