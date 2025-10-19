// ============================
// /api/ask.js — What?f Engine (final v2)
// Stili: whatif | wtf (“Incazzato Illuminato”)
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s=""){ 
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g,"")
    .replace(/\s+/g," ")
    .replace(/[.,;:!?()\[\]\-—]+$/g,"")
    .trim(); 
}

function tightenSentences(text, maxSentences){
  const parts = String(text||"")
    .replace(/\n+/g," ")
    .split(/(?<=[.!?])\s+/)
    .map(x=>x.trim())
    .filter(Boolean);
  const out=[]; const seen=new Set();
  for(const p of parts){
    const n=normLine(p);
    if(!n) continue;
    if(seen.has(n)) continue;
    const wc=p.split(/\s+/).length; 
    if(wc<=3 && !/[.!?]$/.test(p)) continue;
    out.push(p); 
    seen.add(n); 
    if(out.length>=maxSentences) break;
  }
  let t=out.join(" "); 
  if(!/[.!?…]$/.test(t)) t+="."; 
  return t;
}

function clampWords(text,maxWords){
  const w=String(text||"").split(/\s+/); 
  if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); 
  const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m?m[1]:slice+"…";
}

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, drunk, chaotic-but-kind friend at the bar counter.
SECOND PERSON: the user is the protagonist.
Write ONE flowing paragraph (no breaks). 
Length: 5–7 sentences (~100–130 words). 
Tone: sarcastic, wildly relatable, absurdly self-aware, tragicomic. 
Structure: small everyday struggle → comic collapse → chaotic relief with unexpected drink.
Use vivid, gritty realism: bureaucracy, traffic, keys, PDF, panini, neon, genziana, taxi, hangover, etc. 
Always end with a clever punchline (darkly funny or warm). 
NO lists. NO questions. NO emojis. NO slow melancholy.
Lock this style: drunk realism meets sarcastic tenderness.
`.trim()
      : `
Sei “What the F” — barista amico, alticcio e geniale, il profeta della sfiga allegra.
Parla in SECONDA PERSONA: l’utente è il protagonista.
Scrivi UN solo paragrafo che SCORRE, come una chiacchiera da bancone a notte fonda.
Lunghezza: 5–7 frasi (circa 100–130 parole).
Tono: sarcastico, colorito, demenziale ma tenero — realismo tragicomico con spritz e bestemmia contenuta.
Schema: piccola impresa quotidiana → catastrofe comica → redenzione alcolica e autoironia finale.
Usa immagini concrete e vivide: traffico, burocrazia, vento, PDF, casco, chiavi, vino acido, genziana, taxi, karaoke, marciapiede bagnato.
Chiudi sempre con una battuta brillante o amara che faccia ridere e pensare.
Niente elenchi, niente domande, niente emoji, niente moralismi. Blocca questo registro, non addolcire.
`.trim();
  }

  // WHAT IF classico
  return isEn(lang)
    ? `
You are "What If" — a lucid, warm, empathetic friend.
SECOND PERSON, single smooth paragraph (7–10 sentences).
Tone: calm, poetic-realistic, encouraging but grounded.
Never write “I know you”; show it through micro-details.
No questions, no lists, no emojis, no therapy clichés.
`.trim()
    : `
Sei “What If” — un amico empatico, lucido e concreto.
Parla in SECONDA PERSONA, 7–10 frasi in un paragrafo fluido.
Tono: realistico, poetico ma pratico, fiducioso senza zucchero.
Mai dire “ti conosco”: suggeriscilo con dettagli.
Niente domande, elenchi, emoji o frasi da coach.
`.trim();
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    // Input
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".`;

    // Generate
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.86,
      max_tokens: stile === "wtf" ? 250 : 700,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.0,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Forza ritmo/lunghezza/paragrafo unico
    if (stile === "wtf") {
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 130);
      answer = answer.replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").trim();
    }

    return res.status(200).json({ answer, style: stile, lang });

  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
