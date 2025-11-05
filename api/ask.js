// /api/ask.js — What?f Engine (WhatIf naturale + WTF libero demenziale — MULTILINGUA)

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
const normLang = (l="it") => {
  const s = String(l||"it").toLowerCase().slice(0,2);
  return SUP_LANGS.includes(s) ? s : "it";
};

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
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
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

/* ========= WHAT IF (multilingua) ========= */
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
Secuencia: raíz emocional → por qué ahora → primeras semanas → 3–6 meses (a favor + desafío) → realidad práctica → origen del deseo → micro-prueba → criterio interno. Lenguaje natural.`.trim(),
  fr: `Tu es "What If" : voix calme, empathique et concrète. Écris en FRANÇAIS.
Un seul paragraphe, 8–11 phrases, pas d’emojis ni de listes, ne répète pas la question.
Suis la séquence, reste naturel et concret.`.trim(),
  de: `Du bist "What If": ruhig, empathisch, pragmatisch. Schreibe auf DEUTSCH.
Ein Absatz, 8–11 Sätze, keine Listen/Emojis, Frage NICHT wiederholen. Natürlich und alltagsnah.`.trim()
};

const WHATIF_EXAMPLES = {
  it:`Questa domanda nasce quando una parte di te chiede un ritmo più tuo. Le prime settimane avrebbero un sapore familiare e strano insieme: luoghi che riconosci e la testa che corre meno. Dopo un mese arriva la prova vera: confrontarti con chi eri e chi sei adesso, capire se quella differenza ti allarga o ti stringe. Nel concreto guadagni spazio mentale e routine più sane, ma perdi un po’ di vibrazione quotidiana. Se lo vivi come passo in avanti e non ritorno al passato, in sei mesi puoi sentirti più stabile e presente; se ti sembra di rientrare in una versione più piccola di te, tornerà presto voglia di ripartire. Fai un test di due settimane “come se fosse già così”: orari, luoghi, lavoro. Se ti svegli più leggero e non senti di mettere la vita in pausa, non stai tornando: stai iniziando da lì.`,
  en:`This question appears when part of you asks for a rhythm that feels more like you. The first weeks feel familiar and odd at once; a month in, the real test is who you were vs who you are now. You gain mental space and steadier routines, but lose some everyday buzz. If it’s a step forward (not a return), in six months you feel more stable and present; if it shrinks you, the urge to move on returns. Run a two-week “as if already true” test: hours, places, work. If you wake up lighter and don’t feel on pause, you’re not going back — you’re starting from there.`,
  es:`Esta pregunta aparece cuando una parte de ti pide un ritmo más tuyo. Las primeras semanas se sienten familiares y raras a la vez; al mes llega la prueba real: quién eras y quién eres ahora. Ganas espacio mental y rutinas más estables, pierdes algo de zumbido diario. Si es un paso adelante, en seis meses te sientes más presente; si te encoge, volverán las ganas de moverte. Haz una prueba de dos semanas “como si ya fuera así”: horarios, lugares, trabajo. Si despiertas más ligero y sin sensación de pausa, no vuelves atrás: empiezas desde ahí.`,
  fr:`Cette question arrive quand une part de toi demande un rythme plus à toi. Les premières semaines sont familières et étranges à la fois ; au bout d’un mois, l’épreuve réelle est qui tu étais vs qui tu es. Tu gagnes de l’espace mental et des routines plus stables, tu perds un peu d’effervescence. Si c’est un pas en avant, dans six mois tu te sens plus présent ; si ça te rétrécit, l’envie de repartir reviendra. Fais un test de deux semaines “comme si c’était déjà vrai” : horaires, lieux, travail. Si tu te réveilles plus léger sans te sentir en pause, tu ne retournes pas en arrière : tu démarres de là.`,
  de:`Diese Frage taucht auf, wenn ein Teil von dir nach einem eigenen Rhythmus ruft. Die ersten Wochen wirken vertraut und ungewohnt zugleich; nach einem Monat kommt die echte Probe: wer du warst vs. wer du bist. Du gewinnst mentalen Raum und stabilere Routinen, verlierst etwas Alltagskitzel. Wenn es ein Schritt nach vorn ist, fühlst du dich in sechs Monaten präsenter; wenn es dich schrumpft, willst du wieder weiterziehen. Mach einen Zwei-Wochen-Test „als wäre es schon wahr“: Zeiten, Orte, Arbeit. Wachst du leichter auf ohne Pausengefühl, gehst du nicht zurück — du startest von dort.`
};

/* ========= WTF (multilingua, più libero e più utile) ========= */
const WTF_SOFT_RULES = {
  it: `Sei “What the F”: amico brillante (mezzo brillo), ironico e affettuoso.
Niente sequenza fissa: varia ritmo e sorprese. Puoi usare 0–2 oggetti/ambienti che “reagiscono” (brevi e credibili-assurdi) e 0–1 sorsata (opzionale).
⚠️ Rispondi DAVVERO alla domanda: dedica ≥50% delle frasi a soluzione/consiglio concreto, passo iniziale, rischio reale o criterio di scelta.
Chiudi con una verità utile (one-liner). 6–9 frasi, paragrafo unico, niente emoji, NON ripetere la domanda.`.trim(),
  en: `You are “What the F”: witty half-tipsy friend, warm and sharp.
No fixed sequence. You may use 0–2 object/room reactions (short, realistic-silly) and 0–1 sip (optional).
⚠️ Actually answer the question: spend ≥50% of sentences on concrete advice, first step, real risk or deciding criterion.
End with a useful one-liner. 6–9 sentences, single paragraph, no emojis, do NOT restate the question.`.trim(),
  es: `Eres “What the F”: amigo ingenioso (medio alegre), cálido y filoso.
Sin secuencia rígida. Puedes usar 0–2 reacciones de objetos/entorno (breves y verosímil-absurdas) y 0–1 sorbo (opcional).
⚠️ Responde DE VERAS: dedica ≥50% de las frases a consejo concreto, primer paso, riesgo real o criterio de decisión.
Cierra con una verdad útil. 6–9 frases, un párrafo, sin emojis, no repitas la pregunta.`.trim(),
  fr: `Tu es “What the F” : ami brillant (un peu éméché), chaleureux et tranchant.
Pas de séquence figée. Tu peux utiliser 0–2 réactions d’objets/lieu (brèves, absurde crédible) et 0–1 gorgée (optionnelle).
⚠️ Réponds VRAIMENT : ≥50 % des phrases sur conseil concret, premier pas, risque réel ou critère de décision.
Conclue par une vérité utile. 6–9 phrases, un paragraphe, sans emojis, ne répète pas la question.`.trim(),
  de: `Du bist „What the F“: witziger, halb beschwipster Freund – warm und präzise.
Keine starre Reihenfolge. Optional 0–2 Objekt-/Raumreaktionen (kurz, realistisch-schräg) und 0–1 Schluck.
⚠️ Antworte WIRKLICH: ≥50 % der Sätze mit konkretem Rat, erstem Schritt, realem Risiko oder Entscheidungskriterium.
Ende mit einer nützlichen Ein-Satz-Wahrheit. 6–9 Sätze, ein Absatz, keine Emojis, Frage nicht wiederholen.`.trim()
};

// Seed di varietà per oggetti/sorsate (la AI resta libera, sono solo esempi)
const WTF_REACT_BANK = [
  "la moka tossisce come una diva e poi applaude piano",
  "il POS benedice la carta e fa finta di commuoversi",
  "la tapparella scende per pudore e poi sbircia",
  "la lampada lampeggia in Morse “ti capisco”",
  "il frigorifero sospira e giura di diventare minimalista",
  "Alexa finge un aggiornamento e cambia stanza",
  "il campanello suona da solo per solidarietà",
  "la pianta applaude con le foglie e chiede un drink",
  "il ventilatore gira al contrario “per rispetto”",
  "il citofono fa un amen stonato"
];
const WTF_SIPS_BANK = [
  "un sorso corto per rimettere a fuoco",
  "un goccio tecnico, giusto per misurare il coraggio",
  "un dito di qualcosa che sa di verità",
  "un brindisi di manutenzione all’autostima"
];

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);
  const baseRules = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;
  const temporal = String(periodo).toLowerCase()==="past"
    ? (L==="en" ? "Write as if it already happened."
      : L==="es" ? "Escribe como si ya hubiera pasado."
      : L==="fr" ? "Écris comme si c’était déjà arrivé."
      : L==="de" ? "Schreibe, als wäre es bereits geschehen."
      : "Scrivi come se fosse già successo.")
    : (L==="en" ? "Write as a near-future unfolding starting now."
      : L==="es" ? "Escribe como un futuro cercano que empieza ahora."
      : L==="fr" ? "Écris comme un futur proche qui commence maintenant."
      : L==="de" ? "Schreibe als nahe Zukunft, die jetzt beginnt."
      : "Scrivi come un prossimo futuro che inizia ora.");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if(stile==="wtf"){
    // Pseudo-random per varietà. La AI è libera: questi sono solo esempi opzionali.
    let seed=[...String(domanda)].reduce((a,c)=>a+c.charCodeAt(0),0);
    const rnd=()=>{ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; };

    const reactCount = Math.floor(rnd()*3); // 0–2
    const sipCount   = rnd() < 0.5 ? 1 : 0; // 0–1
    const reacts = [...WTF_REACT_BANK].sort(()=>rnd()-0.5).slice(0, reactCount);
    const sips   = [...WTF_SIPS_BANK].sort(()=>rnd()-0.5).slice(0, sipCount);

    msgs.push(
      { role:"system", content: WTF_SOFT_RULES[L] || WTF_SOFT_RULES.it },
      { role:"system", content: reacts.length ? `ESEMPI FACOLTATIVI — REAZIONI OGGETTI (≤2):\n- ${reacts.join("\n- ")}` : `Reazioni oggetti: facoltative.` },
      { role:"system", content: sips.length   ? `ESEMPIO FACOLTATIVO — SORSATA (≤1):\n- ${sips.join("\n- ")}` : `Sorsata: facoltativa.` },
      { role:"system", content:
        (L==="en"
          ? `Center the user's ask: if ambiguous, pick the most helpful interpretation; give 1–2 concrete moves, a risk to watch, and a simple closing rule.`
          : L==="es" ? `Centra la consulta: si es ambigua, toma la interpretación más útil; da 1–2 acciones concretas, un riesgo y una regla de cierre.`
          : L==="fr" ? `Centre la demande : si c’est ambigu, choisis l’interprétation la plus utile ; donne 1–2 actions concrètes, un risque et une règle finale.`
          : L==="de" ? `Fokussiere die Frage: bei Mehrdeutigkeit die hilfreichste Deutung; gib 1–2 konkrete Schritte, ein Risiko und eine Schlussregel.`
          : `Centra davvero la domanda: se è ambigua, scegli l’interpretazione più utile; dai 1–2 mosse concrete, un rischio da guardare e una regola di chiusura.`)
      }
    );
  } else {
    msgs.push(
      { role:"system", content: WHATIF_RULES[L] || WHATIF_RULES.it },
      { role:"system", content: `Esempio/Example (tono/ritmo, non copiare):\n${WHATIF_EXAMPLES[L] || WHATIF_EXAMPLES.it}` },
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
    L==="en" ? `Question (do NOT repeat it). ONE SINGLE PARAGRAPH. Natural, concise. "${domanda}"`
  : L==="es" ? `No repitas la pregunta. Un solo párrafo, natural y conciso. "${domanda}"`
  : L==="fr" ? `Ne répète pas la question. Un seul paragraphe, naturel et concis. « ${domanda} »`
  : L==="de" ? `Wiederhole die Frage nicht. Ein einziger Absatz, natürlich und knapp. „${domanda}“`
  :           `Non ripetere la domanda. UN SOLO PARAGRAFO, naturale e conciso. "${domanda}"`;

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
      temperature: stile === "wtf" ? 0.97 : 0.82,   // WTF un filo libero ma non random
      top_p: 0.92,
      max_tokens: 520,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // ===== Post-process =====
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);       // WTF 6–9, WhatIf 8–11
    answer = clampWords(answer, stile === "wtf" ? 175 : 170);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // ===== IT normalizzazioni (evita falsi maiuscoli a metà frase) =====
    if(normLang(lang)==="it"){
      const d=String(domanda||"");
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion=new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m, _g1, offset, str)=>{
        if(offset===0) return m; // inizio stringa: lascia maiuscola
        const before = str.slice(0, offset);
        if(/[.!?…]["'”)\]]?\s*$/.test(before)) return m; // dopo fine frase: lascia
        return inQuestion.has(m) || ["Ah","Oh","Ehi","Sai"].includes(m) ? m : m.toLowerCase();
      });
      // L'Aquila
      answer = answer.replace(/\ball’aquila\b/g, "all’Aquila");
    }

    // ===== Forza MAIUSCOLA iniziale (ultimo step assoluto) =====
    answer = answer.replace(/^\s*([a-zà-ÿ])/u, (m,c)=>c.toUpperCase());

    return res.status(200).json({ answer, style: stile, lang: normLang(lang), periodo, model: MODEL });

  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
