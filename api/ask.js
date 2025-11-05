// /api/ask.js — What?f Engine (senza Upstash, con CORS robusto + health GET)
// WHATIF: voce calma, empatica, concreta. 8–11 frasi (paragrafo unico).
// WTF: 6–8 frasi, 2–3 gag, UNA “imprecazione” teatrale (non verso persone), drink, 1–2 frasi utili, morale.
// Post-process: no eco della domanda, maiuscole dopo .?!…, clamp frasi/parole.

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= CORS ========= */
const FALLBACK_ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "https://hat-ifapp.vercel.app",
  "https://your-custom-domain.example",  // <-- sostituisci col tuo dominio
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function parseEnvOrigins() {
  const env = (process.env.CORS_ORIGINS || "").trim();
  if (!env) return null;
  return env.split(",").map(s => s.trim()).filter(Boolean);
}
function cors(req, res) {
  const dynamic = parseEnvOrigins();
  const ALLOWED = dynamic || FALLBACK_ALLOWED_ORIGINS;
  const origin = String(req.headers.origin || "");
  if (ALLOWED.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
const normLang = (l="it") => {
  const s = String(l||"it").toLowerCase().slice(0,2);
  return SUP_LANGS.includes(s) ? s : "it";
};

function normLine(s=""){
  return String(s).toLowerCase()
    .replace(/[“”"']/g,"")
    .replace(/\s+/g," ")
    .replace(/[.,;:!?()[\]\-—]+$/g,"")
    .trim();
}
function tightenSentences(text, maxSentences){
  const parts = String(text||"")
    .replace(/\n+/g," ")
    .split(/(?<=[.!?…])\s+/)
    .map(x=>x.trim())
    .filter(Boolean);
  const out = [], seen = new Set();
  for(const p of parts){
    const n = normLine(p);
    if(!n || seen.has(n)) continue;
    out.push(p);
    if(out.length >= maxSentences) break;
  }
  let t = out.join(" ");
  if(!/[.!?…]$/.test(t)) t += ".";
  return t;
}
function clampWords(text, maxWords){
  const w = String(text||"").split(/\s+/);
  if(w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m ? m[1] : slice + "…";
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
  const d = String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  let t = String(text||"");
  const lead = t.slice(0, Math.min(t.length, d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  const rx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  return t.replace(rx,"");
}
function sentenceCaseAll(s=""){
  return s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g,(m,p,c)=>p+c.toUpperCase());
}
function finalPunct(s=""){
  return /[.!?…]$/.test(s) ? s : s + ".";
}

/* ========= WHAT IF rules by language ========= */
const WHATIF_RULES = {
  it: `
Sei "What If": voce calma, empatica, concreta. Scrivi in ITALIANO.
Paragrafo unico, 8–11 frasi, no elenchi né emoji, NON ripetere la domanda.
Sequenza: (1) radice emotiva; (2) perché ora; (3) prime settimane;
(4) outlook 3–6 mesi (pro + sfida); (5) realtà pratica (costi/tempo/energia/contesto);
(6) origine del desiderio; (7) micro-test; (8) criterio interno.
Stile naturale, immagini quotidiane brevi. Adatta al tema.
`.trim(),
  en: `
You are "What If": calm, empathetic, practical. Write in ENGLISH.
Single paragraph, 8–11 sentences, no bullets or emojis, do NOT restate the question.
Sequence: (1) emotional root; (2) why now; (3) first weeks; (4) 3–6 month outlook (upsides + challenge);
(5) practical reality (cost/time/energy/context); (6) origin; (7) micro-test; (8) inner criterion.
`.trim(),
  es: `
Eres "What If": voz calmada, empática y práctica. Un párrafo, 8–11 frases, sin emojis ni listas,
NO repitas la pregunta. Sigue la secuencia indicada y adapta al tema.
`.trim(),
  fr: `
Tu es "What If" : calme, empathique, concret. Un seul paragraphe, 8–11 phrases,
pas d’emojis ni listes, ne répète pas la question. Suis la séquence et adapte au thème.
`.trim(),
  de: `
Du bist "What If": ruhig, empathisch, pragmatisch. Ein Absatz, 8–11 Sätze,
keine Emojis/Listen, Frage NICHT wiederholen. Folge der Sequenz, an Thema anpassen.
`.trim(),
};

const WHATIF_EXAMPLES = {
  it: `Questa domanda nasce quando una parte di te chiede un ritmo più tuo... Fai un test di due settimane “come se fosse già così”...`,
  en: `This question appears when part of you asks for a rhythm that feels more like you... run a two-week “as if already true” test...`,
  es: `Esta pregunta aparece cuando una parte de ti pide un ritmo más tuyo... haz una prueba de dos semanas “como si ya fuera así”...`,
  fr: `Cette question arrive quand une part de toi demande un rythme plus à toi... fais un test de deux semaines “comme si c’était déjà vrai”...`,
  de: `Diese Frage taucht auf, wenn ein Teil von dir nach einem eigenen Rhythmus ruft... zwei-Wochen-Test „als wäre es schon wahr“...`,
};

/* ========= WTF banks ========= */
const WTF_IMPRE = ["bestemmione corazzato","imprecazionona a detonazione","sacramentata a ciel sereno","vulcano d’anatemi","tromba d’aria di improperi"];
const WTF_REACT = [
  "la moka ti fa una standing ovation",
  "il POS benedice la carta",
  "la tapparella si abbassa per pudore e poi sbircia",
  "la lampada lampeggia in Morse “ti capisco”",
  "Alexa finge un aggiornamento e sparisce",
  "il frigorifero decide di diventare minimalista",
  "il campanello suona da solo per solidarietà",
  "la pianta applaude con le foglie",
  "il ventilatore gira al contrario “per rispetto”",
  "il citofono fa un amen stonato",
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
    ? (L==="en" ? "Write as if it already happened."
      : (L==="es"?"Escribe como si ya hubiera pasado."
      : (L==="fr"?"Écris comme si c’était déjà arrivé."
      : (L==="de"?"Schreibe, als wäre es bereits geschehen.":"Scrivi come se fosse già successo."))))
    : (L==="en" ? "Write as a near-future unfolding starting now."
      : (L==="es"?"Escribe como un futuro cercano que empieza ahora."
      : (L==="fr"?"Écris comme un futur proche qui commence maintenant."
      : (L==="de"?"Schreibe als nahe Zukunft, die jetzt beginnt."
      :"Scrivi come un prossimo futuro che inizia ora."))));

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
    const WTF_RULE_IT = `WHAT THE F (amichevole, demenziale ma utile). Struttura: presa in giro affettuosa (≤2) → 2–3 micro-imprevisti → UNA “${impre}” teatrale (narrata, mai verso persone) → ${react.length} reazioni di oggetti → drink (“${drink}”) → 1–2 frasi davvero utili → morale calda. 6–8 frasi.`;
    const WTF_RULE_EN = `WHAT THE F (friendly, absurd but helpful). Tease (≤2) → 2–3 tiny mishaps → ONE theatrical “${impre}” (narrated, never at people) → ${react.length} object reactions → drink (“${drink}”) → 1–2 truly helpful lines → warm moral. 6–8 sentences.`;
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
ADATTAMENTO RAPIDO PER TEMA:
- CITTÀ: routine, rete, costi, identità; prime settimane + 3–6 mesi.
- LAVORO: crescita vs fuga, pipeline contatti, micro-progetto, outlook 90 giorni.
- RELAZIONI: confini, comunicazione, check 4–6 settimane.
- SOLDI/RISCHIO: tempo prima dei soldi, unità di prova, soglia di uscita (30–45 giorni).
- CRESCITA: abitudini minime, energia, criteri interni, feedback settimanale.`}
    );
  }

  const ask =
    L==="en" ? `Do NOT repeat the question. ONE PARAGRAPH (8–11 sentences). Keep it natural and concise. "${domanda}"`
  : L==="es" ? `No repitas la pregunta. Un solo párrafo (8–11 frases), natural y conciso. "${domanda}"`
  : L==="fr" ? `Ne répète pas la question. Un seul paragraphe (8–11 phrases), naturel et concis. « ${domanda} »`
  : L==="de" ? `Wiederhole die Frage nicht. Ein einziger Absatz (8–11 Sätze), natürlich und knapp. „${domanda}“`
  :           `Non ripetere la domanda. UN SOLO PARAGRAFO (8–11 frasi), naturale e conciso. "${domanda}"`;
  msgs.push({ role:"user", content: ask });
  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);

  // Preflight
  if (req.method === "OPTIONS") return res.status(204).end();

  // Health GET
  if (req.method === "GET") {
    const origin = String(req.headers.origin || "");
    return res.status(200).json({
      ok: true,
      route: "/api/ask",
      message: "alive",
      origin,
      model: MODEL,
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      cors_origins: parseEnvOrigins() || FALLBACK_ALLOWED_ORIGINS,
      ts: Date.now()
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try{
    if(!process.env.OPENAI_API_KEY) {
      return res.status(401).json({ error:"missing_api_key", detail:"OPENAI_API_KEY not set" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", periodo = "future", micro = {} } = body;
    if(!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error:"bad_request", detail:"domanda_required" });
    }

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

    // Italian niceties
    if(normLang(lang)==="it"){
      const d=String(domanda||"");
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion=new Set((d.match(nameRx)||[]));
      answer=answer.replace(nameRx,(m)=> inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Sai"].includes(m) ? m : m.toLowerCase()));
      answer=answer.replace(/\ball’aquila\b/g,"all’Aquila");
    }

    return res.status(200).json({ answer, style: stile, lang: normLang(lang), periodo, model: MODEL });
  }catch(err){
    // Mappa errori OpenAI più comuni
    const msg = String(err?.message || err);
    const isAbort = /aborted|AbortError/i.test(msg);
    const status = isAbort ? 504 : 500;
    console.error("❌ [/api/ask] error:", msg);
    return res.status(status).json({ error:"server_error", detail: msg });
  }
}
