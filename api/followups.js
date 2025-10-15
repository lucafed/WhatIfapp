// /api/followups.js
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

const isEn = (l) => String(l||"it").toLowerCase().startsWith("en");

export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    const { question="", answer="", lang="it", style="whatif" } = req.body || {};
    const en = isEn(lang);

    const system = `
You generate 2 SHORT follow-up questions that naturally continue tomorrow's episode.
They must be tightly grounded in BOTH the user's question and the AI answer.
Tone must match the style: 
- "whatif": warm, realistic, curious.
- "wtf": witty, kind sarcasm, bar-counter vibe.
No lists with numbers, no long sentences. 6–12 words each.
Return ONLY the two questions separated by newline. Reply in ${en?"English":"Italiano"}.
`.trim();

    const user = `
Question: "${question}"
Answer (excerpt allowed): """${(answer||"").slice(0,1600)}"""
Make two concrete next-step questions for tomorrow.
`.trim();

    const r = await client.chat.completions.create({
      model: MODEL,
      temperature: style==="wtf" ? 0.9 : 0.7,
      max_tokens: 120,
      messages: [{ role:"system", content:system }, { role:"user", content:user }]
    });

    const text = r.choices?.[0]?.message?.content || "";
    const lines = text.split(/\n+/).map(s=>s.replace(/^[•\-–\d\.\)\s]+/,"").trim()).filter(Boolean).slice(0,2);

    return res.status(200).json({ followups: lines });
  }catch(err){
    console.error("[/api/followups] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
