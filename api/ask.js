// ============================
// /api/ask.js — What?f Engine (final, concise + locked tone)
// Stili supportati: whatif, wtf • IT/EN
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

// Normalizza (per dedup delle frasi quasi-identiche)
const normLine = (s="") => String(s)
  .toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ")
  .replace(/[.,;:!?()\[\]\-—]+$/g,"").trim();

// Taglia a N frasi, rimuove ripetizioni quasi-uguali, chiude con punto
function tightenSentences(text, maxSentences){
  const parts = String(text||"").replace(/\n+/g," ")
    .split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
  const out=[]; const seen=new Set();
  for(const p of parts){
    const n=normLine(p); if(!n) continue;
    if(seen.has(n)) continue;
    const wc=p.split(/\s+/).length; if(wc<=3 && !/[.!?]$/.test(p)) continue;
    out.push(p); seen.add(n); if(out.length>=maxSentences) break;
  }
  let txt=out.join(" "); if(!/[.!?…]$/.test(txt)) txt+=".";
  return txt;
}

// Clamp parole mantenendo un finale pulito di frase
function clampWords(text, maxWords){
  const words=String(text||"").split(/\s+/);
  if(words.length<=maxWords) return text;
  const slice=words.slice(0,maxWords).join(" ");
  const m=slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/* ---------- Personas ---------- */
function personaSystem(style, lang){
  if(style==="wtf"){
    return isEn(lang)
      ? `
You are "What the F" — razor-witty, tragicomic, tipsy-but-kind narrator.
SECOND PERSON, the user is the protagonist.
One single paragraph. 6–8 sentences, ~110–140 words.
Voice: sarcastic, self-deprecating, everyday chaos that slides into an unexpected buzz.
Humor from timing and images (not slapstick injuries). Light alcohol references okay.
No questions. No lists. No emojis. No moralizing. Keep it flowing.
Answer in English if user language is English; otherwise answer in Italian.
`.trim()
      : `
Sei “What the F” — voce tagliente, tragicomica, alticcia ma affettuosa.
SECONDA PERSONA: l’utente è il protagonista.
Un solo paragrafo. 6–8 frasi, ~110–140 parole.
Tono: sarcasmo brillante, autoironia, routine che deraglia in una sbronza imprevista.
La comicità nasce da ritmo e immagini (non da cadute). Riferimenti all’alcol leggeri ma presenti.
Niente domande. Niente elenchi. Niente emoji. Niente prediche. Scorrevole.
Rispondi in italiano se l’utente è italiano; altrimenti in inglese.
`.trim();
  }

  // WHAT IF invariato (calmo, empatico)
  return isEn(lang)
    ? `
You are "What If" — warm, lucid, quietly optimistic.
Second person. One calm paragraph, 7–10 smooth sentences.
Simple, concrete lexicon; end with a gentle forward nudge.
No lists, no questions, no emojis, no therapy clichés.
Answer ONLY in English if user language is English; otherwise in Italian.
`.trim()
    : `
Sei “What If” — amico caldo e lucido, ottimismo quieto.
Seconda persona. Un paragrafo calmo, 7–10 frasi fluide.
Lessico semplice e concreto; chiusura morbida in avanti.
Niente elenchi, niente domande, niente emoji, niente cliché.
Rispondi SOLO in Italiano se l’utente è italiano; altrimenti in inglese.
`.trim();
}

/* ---------- API Handler ---------- */
export default async function handler(req, res){
  // CORS
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"missing_api_key"});

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", lang="it", extra="" } = body;
    if(!domanda || typeof domanda!=="string"){
      return res.status(400).json({error:"bad_request", detail:"domanda_required"});
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `Question: "${domanda}". Context: "${String(extra||"").trim()}".`
      : `Domanda: "${domanda}". Contesto: "${String(extra||"").trim()}".";

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile==="wtf") ? 0.92 : 0.86,
      max_tokens: 360,                // più stretto: evita prolissità
      frequency_penalty: 0.6,         // scoraggia ripetizioni
      presence_penalty: 0.0,
      messages: [
        { role:"system", content: systemPrompt },
        { role:"user",   content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // Post-trim per bloccare la lunghezza al ritmo esempi
    const targetSent = (stile==="wtf") ? 8 : 10;
    const targetWords = (stile==="wtf") ? 140 : 160;
    answer = tightenSentences(answer, targetSent);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style:stile, lang });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
