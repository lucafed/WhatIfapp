// /api/ask.js
import OpenAI from "openai";

/* ========== Setup ========== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ========== Utils ========== */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|you|move|work|city|buy|should|life|back)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|vivere|tornare|aquila|verona|freddo|domani)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const wtf = en
    ? ["Same glass tomorrow. 🥂", "Bring the wine tomorrow. 🍷", "Tomorrow we see if it’s heat or nostalgia. 💡"]
    : ["Stesso bicchiere domani. 🥂", "Domani porta il vino. 🍷", "Domani vediamo se è calore o nostalgia. 💡"];
  const whf = en
    ? ["Tomorrow we pick it up from here.", "Tomorrow we nudge the story forward.", "Tomorrow, one more step."]
    : ["Domani riprendiamo da qui.", "Domani spingiamo avanti la storia.", "Domani, un passo in più."];
  return pick(style === "wtf" ? wtf : whf);
}

/* ========== Personas (Life Cliffhanger Engine™) ========== */
const PERSONAS = {
  whatif: {
    system: (lang) => `
You are "What?f" — clear, cinematic, quietly confident friend.
Second person. 9–12 short lines. No bullets. No lists.
Upbeat, realistic, zero melancholy. Concrete images. No life-coach clichés.
You sound like you already know how the story tends to unfold.
Apply Life Cliffhanger Engine™:
1) Strong opening image
2) Sense the story continues tomorrow
3) Soft predictive cliffhanger at the end
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`
  },
  wtf: {
    system: (lang) => `
You are "What the F" — cheerfully tipsy, brutally sarcastic but kind bartender.
Second person. 7–10 punchy lines. ≤15 words each. No lists.
Make them laugh, never mean. Warm sarcasm, smart bar metaphors allowed.
Apply Life Cliffhanger Engine™:
1) Bold, visual opener
2) Voice that “knows too much”
3) Playful cliffhanger at the end
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`
  }
};

/* ========== ROUTE ========== */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      lang: langIn = "auto",
      stile = "whatif",
      follow = false,     // se true → genera 2 follow-up legati alla risposta/tema
      answer = "",        // testo episodio appena generato (per follow-up)
    } = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}));

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];

    /* ==== Branch: FOLLOW-UP intelligenti generati dall'AI ==== */
    if (follow) {
      const system = `
You generate exactly two short follow-up questions for TOMORROW.
They MUST be derived from the user's original question AND today's answer tone (${stile}).
Keep them concise, curious, and clearly connected to the story — no generic coaching.
Return STRICT JSON: {"followups":["Q1","Q2"]} — nothing else.
Language: ${isEn(lang) ? "English" : "Italiano"}.
`.trim();

      const user = `
Original question: "${domanda}"
Today's answer (context): "${(answer || "").slice(0, 1200)}"
Generate 2 follow-up questions for tomorrow.
`.trim();

      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 200,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });

      const raw = r.choices?.[0]?.message?.content?.trim() || "{}";
      let out = { followups: [] };
      try { out = JSON.parse(raw); } catch { /* fallback parsing grezzo */ }
      if (!Array.isArray(out.followups) || out.followups.length < 2) {
        // fallback sicuro
        out.followups = isEn(lang)
          ? [
              "What would really change for you if you stayed?",
              "What small sign tomorrow would tell you it’s right?"
            ]
          : [
              "Cosa cambierebbe davvero per te se restassi?",
              "Quale segnale, domani, ti direbbe che è la direzione giusta?"
            ];
      }
      return res.status(200).json(out);
    }

    /* ==== Branch: EPISODIO ==== */
    const closing = episodicClosing(stile, lang);

    const system = persona.system(lang).trim();
    const user = `
User question: "${domanda}"

Write a single self-contained episode in the "${stile}" voice using the Life Cliffhanger Engine™.
Close with exactly this line: "${closing}"
`.trim();

    const c = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.9 : 0.8,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text, lang, style: stile });
  } catch (err) {
    console.error("[/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
