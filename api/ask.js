// /api/ask.js — What?f Engine (WhatIf naturale + WTF demenziale — MULTILINGUA)
// WHATIF: voce calma, empatica, concreta. 8–11 frasi, prime settimane + outlook 3–6 mesi,
//         micro-azione di test + criterio interno. Linguaggio naturale e adulto.
// WTF: 2–3 reazioni demenziali, UNA “imprecazione” teatrale (mai verso persone), drink,
//      1–2 frasi utili, morale calda. 6–8 frasi.
// Post-process: un paragrafo, no eco della domanda, maiuscole dopo .?!… , clamp frasi/parole.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

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
function normLang(l="it"){ const s=String(l||"it").toLowerCase().slice(0,2); return SUP_LANGS.includes(s)?s:"it"; }

function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()[\]\-—]+$/g,"").trim(); }
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
  return t.replace(rx,"");
}
function sentenceCaseAll(s=""){ return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g,(m,p,c)=>p+c.toUpperCase()); }
function finalPunct(s=""){ return /[.!?…]$/.test(s)?s:s+"."; }

/* ========= WHAT IF rules by language ========= */
const WHATIF_RULES = {
  it: `
Sei "What If": voce calma, empatica, concreta. Scrivi in ITALIANO.
Paragrafo unico, 8–11 frasi, no elenchi né emoji, NON ripetere la domanda.
Sequenza: (1) radice emotiva; (2) perché conta ora; (3) prime settimane;
(4) outlook 3–6 mesi (pro + sfida); (5) realtà pratica (costi/tempo/energia/contesto);
(6) da dove nasce il desiderio; (7) micro-test; (8) criterio interno per decidere.
Stile naturale, immagini quotidiane brevi (non poetiche). Adatta il taglio al tema (città/lavoro/relazioni/soldi/crescita).
`.trim(),
  en: `
You are "What If": calm, empathetic, practical. Write in ENGLISH.
Single paragraph, 8–11 sentences, no bullets or emojis, do NOT restate the question.
Sequence: (1) emotional root; (2) why now; (3) first weeks; (4) 3–6 month outlook (upsides + challenge);
(5) practical reality (cost/time/energy/context); (6) origin of desire; (7) micro-test; (8) inner criterion.
Keep language natural; short everyday imagery. Adapt to topic (city/work/relationships/money/growth).
`.trim(),
  es: `
Eres "What If": voz calmada, empática y práctica. Escribe en ESPAÑOL.
Un solo párrafo, 8–11 frases, sin listas ni emojis, NO repitas la pregunta.
Secuencia: (1) raíz emocional; (2) por qué importa ahora; (3) primeras semanas;
(4) horizonte 3–6 meses (a favor + desafío); (5) realidad práctica (coste/tiempo/energía/contexto);
(6) origen del deseo; (7) micro-prueba; (8) criterio interno para decidir.
Lenguaje natural e imágenes cotidianas breves. Adapta al tema (ciudad/trabajo/relaciones/dinero/crecimiento).
`.trim(),
  fr: `
Tu es "What If" : voix calme, empathique et concrète. Écris en FRANÇAIS.
Un seul paragraphe, 8–11 phrases, pas de listes ni d’emojis, ne répète pas la question.
Séquence : (1) racine émotionnelle ; (2) pourquoi maintenant ; (3) premières semaines ;
(4) perspective à 3–6 mois (atouts + défi) ; (5) réalité pratique (coût/temps/énergie/contexte) ;
(6) origine du désir ; (7) micro-test ; (8) critère intérieur pour décider.
Langage naturel, images du quotidien brèves. Adapte au thème (ville/travail/relations/argent/croissance).
`.trim(),
  de: `
Du bist "What If": ruhig, empathisch, pragmatisch. Schreibe auf DEUTSCH.
Ein einziger Absatz, 8–11 Sätze, keine Listen, keine Emojis, wiederhole die Frage NICHT.
Reihenfolge: (1) emotionale Wurzel; (2) warum jetzt; (3) erste Wochen;
(4) Ausblick 3–6 Monate (Vorteile + Herausforderung); (5) praktische Realität (Kosten/Zeit/Energie/Kontext);
(6) Ursprung des Wunsches; (7) Mikro-Test; (8) inneres Entscheidungskriterium.
Natürlich, alltagsnah; an Thema anpassen (Stadt/Job/Beziehungen/Geld/Wachstum).
`.trim()
};

/* ========= Example (usato solo come ancoraggio di ritmo) ========= */
const WHATIF_EXAMPLES = {
  it: `Questa domanda nasce quando una parte di te chiede un ritmo più tuo. Le prime settimane avrebbero un sapore familiare e strano insieme: luoghi che riconosci e la testa che corre meno. Dopo un mese arriva la prova vera: confrontarti con chi eri e chi sei adesso, capire se quella differenza ti allarga o ti stringe. Nel concreto guadagni spazio mentale e routine più sane, ma perdi un po’ di vibrazione quotidiana. Se lo vivi come passo in avanti e non ritorno al passato, in sei mesi puoi sentirti più stabile e presente; se ti sembra di rientrare in una versione più piccola di te, tornerà presto voglia di ripartire. Fai un test di due settimane “come se fosse già così”: orari, luoghi, lavoro. Se ti svegli più leggero e non senti di mettere la vita in pausa, non stai tornando: stai iniziando da lì.`,
  en: `This question appears when part of you asks for a rhythm that feels more like you. The first weeks feel familiar and odd at once; a month in, the real test is who you were vs who you are now. You gain mental space and steadier routines but lose some everyday buzz. If it’s a step forward (not a return), in six months you feel more stable and present; if it shrinks you, the urge to move on returns. Run a two-week “as if already true” test: hours, places, work. If you wake up lighter and don’t feel on pause, you’re not going back — you’re starting from there.`,
  es: `Esta pregunta aparece cuando una parte de ti pide un ritmo más tuyo. Las primeras semanas se sienten familiares y raras a la vez; al mes llega la prueba real: quién eras y quién eres ahora. Ganas espacio mental y rutinas más estables, pierdes algo de zumbido diario. Si es un paso adelante, en seis meses te sientes más presente; si te encoge, volverán las ganas de moverte. Haz una prueba de dos semanas “como si ya fuera así”. Si te despiertas más ligero y sin sensación de pausa, no es un regreso: es un comienzo.`,
  fr: `Cette question arrive quand une part de toi demande un rythme plus à toi. Les premières semaines sont familières et étranges à la fois ; au bout d’un mois, l’épreuve réelle est qui tu étais vs qui tu es. Tu gagnes de l’espace mental et des routines plus stables, tu perds un peu d’effervescence. Si c’est un pas en avant, dans six mois tu te sens plus présent ; si ça te rétrécit, l’envie de repartir reviendra. Fais un test de deux semaines “comme si c’était déjà vrai”. Si tu te réveilles plus léger sans te sentir en pause, tu ne reviens pas en arrière, tu démarres de là.`,
  de: `Diese Frage taucht auf, wenn ein Teil von dir nach einem eigenen Rhythmus ruft. Die ersten Wochen wirken vertraut und ungewohnt zugleich; nach einem Monat kommt die echte Probe: wer du warst vs. wer du bist. Du gewinnst mentalen Raum und stabilere Routinen, verlierst etwas Alltagskitzel. Wenn es ein Schritt nach vorn ist, fühlst du dich in sechs Monaten präsenter; wenn es dich schrumpft, willst du wieder weiterziehen. Mach einen Zwei-Wochen-Test „als wäre es schon wahr“. Wachst du leichter auf und fühlst dich nicht auf Pause, gehst du nicht zurück — du startest von dort.`
};

/* ========= WTF banks ========= */
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
const WTF_DRINK = [
  "ti versi un amaro doppio e metti in riga i pensieri",
  "fai un sorso corto e il mondo rientra nei bordi",
  "alzi un bicchiere piccolo: brindisi di manutenzione",
  "bevi un dito di coraggio e respiri più largo",
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const baseRules = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;
  const temporal = String(periodo).toLowerCase()==="past"
    ? (L==="en" ? "Write as if it already happened." : (L==="es"?"Escribe como si ya hubiera pasado.":(L==="fr"?"Écris comme si c’était déjà arrivé.":(L==="de"?"Schreibe, als wäre es bereits geschehen.":"Scrivi come se fosse già successo."))))
    : (L==="en" ? "Write as a near-future unfolding starting now." : (L==="es"?"Escribe como un futuro cercano que empieza ahora.":(L==="fr"?"Écris comme un futur proche qui commence maintenant.":(L==="de"?"Schreibe als nahe Zukunft, die jetzt beginnt.":"Scrivi come un prossimo futuro che inizia ora."))));

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if(stile==="wtf"){
    let seed=[...String(domanda)].reduce((a,c)=>a+c.charCodeAt(0),0);
    function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; }
    const impre = WTF_IMPRE[Math.floor(rnd()*WTF_IMPRE.length)];
    const shuffled=[...WTF_REACT].sort(()=>rnd()-0.5);
    const react = shuffled.slice(0, 2 + Math.floor(rnd()*2));
    const drink = WTF_DRINK[Math.floor(rnd()*WTF_DRINK.length)];
    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Struttura OBBLIGATORIA: presa in giro affettuosa (≤2 frasi) → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”, narrato, mai verso persone) → SUBITO ${react.length} reazioni di oggetti esilaranti → drink (“${drink}”) → 1–2 frasi che rispondono davvero → morale calda. 6–8 frasi.`;
    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). STRICT: playful tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” (narrated, never at people) → THEN ${react.length} absurd object reactions → drink (“${drink}”) → 1–2 lines that truly answer → warm moral. 6–8 sentences.`;
    msgs.push(
      { role:"system", content: L==="en"?WTF_RULE_EN:WTF_RULE_IT },
      { role:"system", content:`IMPRECATION: ${impre}` },
      { role:"system", content:`REACTIONS:\n- ${react.join("\n- ")}` },
      { role:"system", content:`DRINK: ${drink}` }
    );
  } else {
    msgs.push(
      { role:"system", content: WHATIF_RULES[L] || WHATIF_RULES.it },
      { role:"system", content: `Esempio/Example:\n${WHATIF_EXAMPLES[L] || WHATIF_EXAMPLES.it}` },
      { role:"system", content: `
ADATTAMENTO PER TEMA:
- CITTÀ/RELOCATION: routine, rete, costi, identità; prime settimane + 3–6 mesi.
- LAVORO/CARRIERA: crescita vs fuga, struttura, pipeline contatti, micro-progetto, outlook 90 giorni.
- RELAZIONI: dinamiche nuove vs ruoli vecchi, confini, comunicazione, check 4–6 settimane.
- SOLDI/RISCHIO: tempo prima dei soldi, unità di prova, soglia di uscita, scenario 30–45 giorni.
- CRESCITA PERSONALE: abitudini minime, energia, criteri interni, feedback settimanale, 6–8 settimane.`}
    );
  }

  const ask =
    L==="en" ? `Question (do NOT repeat it). ONE SINGLE PARAGRAPH (8–11 sentences). Keep it natural and concise. "${domanda}"`
  : L==="es" ? `No repitas la pregunta. Un solo párrafo (8–11 frases), natural y conciso. "${domanda}"`
  : L==="fr" ? `Ne répète pas la question. Un seul paragraphe (8–11 phrases), naturel et concis. « ${domanda} »`
  : L==="de" ? `Wiederhole die Frage nicht. Ein einziger Absatz (8–11 Sätze), natürlich und knapp. „${domanda}“`
  :           `Non ripetere la domanda. Scrivi UN SOLO PARAGRAFO (8–11 frasi), naturale e conciso. "${domanda}"`;
  msgs.push({ role:"user", content: ask });
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

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // ITA: fix propri "Aquila", etc.
    if(normLang(lang)==="it"){
      const d=String(domanda||"");
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion=new Set((d.match(nameRx)||[]));
      answer=answer.replace(nameRx,(m)=> inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Sai"].includes(m) ? m : m.toLowerCase()));
      answer=answer.replace(/\ball’aquila\b/g,"all’Aquila");
    }

    return res.status(200).json({ answer, style: stile, lang: normLang(lang), periodo, model: MODEL });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
      }
