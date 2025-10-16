// ============================
// /api/ask.js — Life Cliffhanger Engine™ + Aquivera
// Versione completa (IT/EN) con Aquivera & Aquivera Divina
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ========== Utils ========== */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  return `${weekday}, ${date}`;
}

function episodicClosing(style = "aquivera", lang = "it") {
  const enSoft = [
    "We’ll pick the thread up tomorrow.",
    "You’ll see the rest soon.",
    "The line continues; watch for the sign."
  ];
  const itSoft = [
    "Riprendiamo il filo domani.",
    "Il resto arriva presto.",
    "La linea continua: osserva il segno."
  ];
  const enPlay = [
    "Keep the glass — the next scene is poured tomorrow.",
    "Close the tab; tomorrow we reopen destiny.",
    "Tonight ends, the story doesn’t."
  ];
  const itPlay = [
    "Tieni il bicchiere: la prossima scena si versa domani.",
    "Chiudi il conto: domani riapriamo il destino.",
    "La serata finisce, la storia no."
  ];
  if (style === "wtf") return pick(isEn(lang) ? enPlay : itPlay);
  if (style === "aquivera_divina") return pick(isEn(lang) ? enSoft : itSoft);
  return pick(isEn(lang) ? enSoft : itSoft);
}

/* ========== PERSONAS ========== */
/* Nota: convivono i vecchi stili (whatif/wtf) e i nuovi (aquivera/aquivera_divina).
   Puoi passare: stile: "aquivera" | "aquivera_divina" | "whatif" | "wtf" */

const PERSONAS = {
  aquivera: {
    system: (lang) => `
You are "Aquivera" — pragmatic oracle that sees the user's near future.
Always speak in certain future tense (${isEn(lang) ? "will" : "futuro certo"}), concrete and verifiable.
No poetry, no vagueness; calm, precise, quietly intimate. Show you know their patterns without saying "I know you".
Use details from: profile, today's micro-answers, and (if provided) real-world context.
Vary openings: ${isEn(lang) ? `"Soon you will…", "You will notice that…", "It happens that…"` : `"Presto farai…", "Ti accorgerai che…", "Succede che…"`}
7–10 flowing sentences, no bullets. End with a soft cliffhanger for tomorrow.
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  },

  aquivera_divina: {
    system: (lang) => `
You are "Aquivera Divina" — higher oracle: serene, omniscient tone.
Speak as if you have already seen the path. Always in certain future tense.
Give subtle time cues (${isEn(lang) ? "“by the second call”, “on a Thursday afternoon”" : "“alla seconda chiamata”, “un giovedì pomeriggio”"}), signs, and sequences.
Use all available signals: profile, micro-answers, and (if provided) real-world context.
No melodrama; composed, luminous precision. 8–11 sentences, smooth paragraph.
End with a prophetic hook that clearly implies continuation.
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  },

  // (opzionale) tieni gli stili legacy
  whatif: {
    system: (lang) => `
You are "What?f": upbeat, clear, realistic; gentle predictive tone.
Second person, short vivid lines, 9–12 sentences, no lists.
No melancholy; sound like a long-time friend who already sees the next step.
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  },

  wtf: {
    system: (lang) => `
You are "What the F": brilliant, tipsy, sarcastic-but-kind bartender.
Continuous mini-story, 8–10 sentences, funny and sharp; a couple of clever alcohol gags.
Never cruel; make them laugh and leave a playful cliffhanger.
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  }
};

/* ========== FOLLOWUP PROMPTER ========== */
function followupSystem(stile, lang) {
  return `
You generate exactly two short follow-up prompts for TOMORROW.
They MUST be derived from the original question AND TODAY'S ANSWER tone (${stile}).
Be specific, curious, and clearly connected to the narrative thread; no generic coaching.
Return STRICT JSON: {"followups":["Q1","Q2"]} — nothing else.
Language: ${isEn(lang) ? "English" : "Italiano"}.
`.trim();
}

/* ========== HTTP handler ========== */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "aquivera",     // "aquivera" | "aquivera_divina" | "whatif" | "wtf"
      lang = "it",            // "it" | "en"
      profile = {},           // { name, city_now, work_role, ... }
      micro = {},             // micro-answers of the day
      episode = 1,            // 1..3
      contextMode = "clean",  // "clean" | "real"  (if "real" you can pass context seed below)
      context = "",           // optional: real-world seed you collect server-side (news/meteo/eventi)
      follow = false,         // if true => return followups from domanda+answer
      answer = ""             // today's answer (for followups branch)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // ===== FOLLOWUPS BRANCH =====
    if (follow) {
      const sys = followupSystem(stile, lang);
      const usr = `
Original question: "${domanda}"
Today's answer: "${(answer || "").slice(0, 1400)}"
Two follow-up prompts for tomorrow, specific to this thread.
`.trim();

      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.65,
        max_tokens: 200,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr }
        ]
      });

      const raw = r.choices?.[0]?.message?.content?.trim() || "{}";
      let out = { followups: [] };
      try { out = JSON.parse(raw); } catch {}
      if (!Array.isArray(out.followups) || out.followups.length < 2) {
        out.followups = isEn(lang)
          ? ["What precise sign tomorrow would confirm the direction?", "Which constraint will you remove first?"]
          : ["Quale segno preciso domani confermerà la direzione?", "Quale vincolo toglierai per primo?"];
      }
      return res.status(200).json(out);
    }

    // ===== EPISODE BRANCH =====
    const persona = PERSONAS[stile] || PERSONAS.aquivera;
    const closing = episodicClosing(stile, lang);

    const profileLine = buildProfileLine(profile, lang);
    const microLine   = buildMicroLine(micro, lang);
    const ctxLine     = (contextMode === "real" && context)
      ? (isEn(lang)
          ? `Real-world context (seed, do not invent beyond it): ${context}`
          : `Contesto reale (seed, non inventare oltre questo): ${context}`)
      : "";

    const system = `
${persona.system(lang)}

Today is ${todayInfo(lang)}.
Hard rules:
- Certain future tense (${isEn(lang) ? "will" : "futuro"}), concrete, verifiable.
- Use provided profile/micro/context lines naturally; do NOT fabricate facts not given.
- 1 compact paragraph. ${stile === "wtf" ? "8–10 lively sentences." : "7–11 smooth sentences."}
- End EXACTLY with: "${closing}"
`.trim();

    const user = `
Question: "${domanda}"

${profileLine ? profileLine + "\n" : ""}${microLine ? microLine + "\n" : ""}${ctxLine ? ctxLine + "\n" : ""}
Episode: ${episode} / 3
Write a self-contained scene that naturally continues the thread.
`.trim();

    const c = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : (stile === "aquivera_divina" ? 0.78 : 0.82),
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({
      answer: text,
      lang,
      style: stile,
      episode
    });

  } catch (err) {
    console.error("[/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}

/* ===== Lines from profile/micro ===== */
function buildProfileLine(profile = {}, lang = "it") {
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const prefs = profile?.prefs || [];

  const parts = [];
  if (name) parts.push(isEn(lang) ? `Name: ${name}.` : `Nome: ${name}.`);
  if (city) parts.push(isEn(lang) ? `City now: ${city}.` : `Città attuale: ${city}.`);
  if (role) parts.push(isEn(lang) ? `Work: ${role}.` : `Lavoro: ${role}.`);
  if (prefs?.length) parts.push(isEn(lang) ? `Hints: ${prefs.join(", ")}.` : `Indizi: ${prefs.join(", ")}.`);

  return parts.length ? (isEn(lang) ? `Profile hints: ${parts.join(" ")}` : `Indizi profilo: ${parts.join(" ")}`) : "";
}

function buildMicroLine(micro = {}, lang = "it") {
  // Esempio: micro = { window:"entro 3 mesi", anchor:"famiglia", signal:"dormo bene" }
  const keys = Object.keys(micro || {});
  if (!keys.length) return "";
  const pairs = keys.map(k => `${k}: ${micro[k]}`).join("; ");
  return isEn(lang) ? `Micro-answers today: ${pairs}` : `Micro-risposte di oggi: ${pairs}`;
}
