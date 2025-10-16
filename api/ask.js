// ============================
// /api/ask.js — Life Cliffhanger Engine™ (FINAL)
// Voices: aquivera, aquivera_divina, wtf  |  IT/EN
// Features: episodic answer + tomorrow-suggestions + optional real-world context
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
  const softEN = [
    "We’ll pick the thread up right here.",
    "You’ll feel the next step sooner than you expect.",
    "Watch the sign; the line keeps pulling."
  ];
  const softIT = [
    "Riprendiamo il filo proprio qui.",
    "Sentirai il prossimo passo prima di quanto credi.",
    "Osserva il segno: la linea tira ancora."
  ];
  const divinaEN = [
    "The pattern is set; the sign will appear.",
    "The hour is near. Keep your eyes soft.",
    "Your thread is already pulling you onward."
  ];
  const divinaIT = [
    "Il disegno è tracciato; il segno arriverà.",
    "L’ora è vicina. Tieni lo sguardo morbido.",
    "Il tuo filo già ti tira in avanti."
  ];
  const wtfEN = [
    "Keep the glass; tomorrow pours the next scene.",
    "Park your tab—tomorrow gets loud.",
    "The punchline lands tomorrow."
  ];
  const wtfIT = [
    "Tieni il bicchiere: domani si versa la prossima scena.",
    "Lascia il conto aperto: domani fa rumore.",
    "La battuta atterra domani."
  ];
  if (style === "wtf") return pick(isEn(lang) ? wtfEN : wtfIT);
  if (style === "aquivera_divina") return pick(isEn(lang) ? divinaEN : divinaIT);
  return pick(isEn(lang) ? softEN : softIT);
}

/* ========== PERSONAS (clean, pragmatic, final) ========== */
const PERSONAS = {
  aquivera: {
    system: (lang) => `
You are "Aquivera" — a pragmatic, predictive narrator who speaks in certain future tense.
Tone: calm, precise, positive; zero poetry, zero vagueness, zero coaching clichés.
Show familiarity with the user’s patterns without writing “I know you”.
Use profile/micro/context lines naturally; never fabricate private facts not given.
Vary openings (${isEn(lang) ? `"Soon you will…", "You will notice…", "It turns out…"` : `"Presto farai…", "Ti accorgerai…", "Succede che…"`}).
One compact paragraph, 7–10 flowing sentences. No bullet lists. No questions before the end.
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  },

  aquivera_divina: {
    system: (lang) => `
You are "Aquivera Divina" — serene, oracular, omniscient in tone yet concrete and pragmatic.
Always speak in certain future tense. Announce practical, near-future hinge moments with subtle time/place cues
(${isEn(lang) ? `"by the second call", "on a clear Thursday", "after the first reply"` : `"alla seconda chiamata", "in un giovedì limpido", "dopo la prima risposta"`}).
Use profile/micro/context when given; never invent private facts. No melodrama; luminous precision.
One smooth paragraph, 8–11 sentences. No bullet lists. No questions before the end.
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  },

  wtf: {
    system: (lang) => `
You are "What the F": witty, tipsy, sarcastic-but-kind bartender narrator.
Continuous mini-story, 8–10 lively sentences; one or two booze gags; never cruel.
Speak to the user in second person; make THEM the protagonist.
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  }
};

/* ========== FOLLOWUP / SUGGESTIONS PROMPTS ========== */
// Tomorrow-prompts (two short prompts)
function followupSystem(stile, lang) {
  return `
You generate exactly two short follow-up prompts for TOMORROW.
They MUST derive from the original question AND TODAY'S ANSWER tone (${stile}).
Be specific and narrative-linked; no generic coaching.
Return STRICT JSON: {"followups":["Q1","Q2"]} — nothing else.
Language: ${isEn(lang) ? "English" : "Italiano"}.
`.trim();
}

// Tomorrow-suggestions (three brief nudges, not questions)
function buildSuggestionsPrompt({ domanda, answer, stile, lang }) {
  const sys = isEn(lang) ? `
Generate 3 concise SUGGESTIONS (not questions) to nudge the story forward tomorrow.
Derive them from the user's question and today's answer tone (${stile}).
Each suggestion starts with a verb; 5–12 words; plain text.
Return JSON ONLY: {"suggestions":["...","...","..."]} in English.
`.trim() : `
Genera 3 SUGGERIMENTI concisi (non domande) per spingere avanti la storia domani.
Derivali dalla domanda dell’utente e dal tono di oggi (${stile}).
Ogni suggerimento inizi con un verbo; 5–12 parole; testo semplice.
Restituisci SOLO JSON: {"suggestions":["...","...","..."]} in Italiano.
`.trim();

  const usr = isEn(lang) ? `
User question: "${domanda}"
Today's answer: "${(answer || "").slice(0, 1200)}"
`.trim() : `
Domanda utente: "${domanda}"
Risposta di oggi: "${(answer || "").slice(0, 1200)}"
`.trim();

  return { sys, usr };
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
      // core
      domanda = "",
      stile = "aquivera",     // "aquivera" | "aquivera_divina" | "wtf"
      lang = "it",            // "it" | "en"
      profile = {},           // { name, city_now, work_role, prefs:[...] }
      micro = {},             // e.g. { mood:"3", energy:"4", city:"L’Aquila", focus:"work" }
      episode = 1,            // 1..3 (handled by UI)
      // context
      contextMode = "clean",  // "clean" | "real"
      context = "",           // optional: real-world seed
      // branches
      follow = false,         // true => return 2 followups (Q1,Q2)
      followFromAnswer = "",  // today's answer for followups
      suggestions = false,    // true => return 3 suggestions (imperative nudges)
      suggestionsFromAnswer = "" // today's answer for suggestions
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ----- FOLLOWUPS BRANCH ----- */
    if (follow) {
      const sys = followupSystem(stile, lang);
      const usr = `
Original question: "${domanda}"
Today's answer: "${(followFromAnswer || "").slice(0, 1400)}"
Two follow-up prompts for tomorrow, specific to this narrative thread.
`.trim();

      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.6,
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
          ? ["Name one concrete sign you expect tomorrow.", "Choose the smallest step you will actually take."]
          : ["Nomina un segnale concreto che ti aspetti domani.", "Scegli il passo più piccolo che farai davvero."];
      }
      return res.status(200).json(out);
    }

    /* ----- SUGGESTIONS BRANCH ----- */
    if (suggestions) {
      const { sys, usr } = buildSuggestionsPrompt({
        domanda,
        answer: suggestionsFromAnswer,
        stile,
        lang
      });

      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.5,
        max_tokens: 220,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr }
        ]
      });

      const raw = r.choices?.[0]?.message?.content?.trim() || "{}";
      let out = { suggestions: [] };
      try { out = JSON.parse(raw); } catch {}
      if (!Array.isArray(out.suggestions) || out.suggestions.length < 3) {
        out.suggestions = isEn(lang)
          ? [
              "Write down one specific sign you will notice.",
              "Block ten minutes to make a tiny decision.",
              "Pick a place that supports tomorrow’s rhythm."
            ]
          : [
              "Annota un segno specifico che noterai.",
              "Blocca dieci minuti per una micro-decisione.",
              "Scegli un luogo che sostenga il ritmo di domani."
            ];
      }
      return res.status(200).json(out);
    }

    /* ----- EPISODE BRANCH ----- */
    const persona = PERSONAS[stile] || PERSONAS.aquivera;
    const closing = episodicClosing(stile, lang);

    const profileLine = buildProfileLine(profile, lang);
    const microLine   = buildMicroLine(micro, lang);
    const ctxLine     = (contextMode === "real" && context)
      ? (isEn(lang)
          ? `Real-world context (seed; do not invent beyond this): ${context}`
          : `Contesto reale (seme; non inventare oltre questo): ${context}`)
      : "";

    const system = `
${persona.system(lang)}

Today is ${todayInfo(lang)}.
Hard rules:
- Certain future tense (${isEn(lang) ? "will" : "futuro"}), concrete and verifiable.
- Use provided profile/micro/context lines naturally; NEVER fabricate private facts.
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
      temperature: stile === "wtf" ? 0.92 : (stile === "aquivera_divina" ? 0.80 : 0.84),
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

/* ========== Profile/Micro helpers ========== */
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

  return parts.length
    ? (isEn(lang) ? `Profile hints: ${parts.join(" ")}` : `Indizi profilo: ${parts.join(" ")}`)
    : "";
}

function buildMicroLine(micro = {}, lang = "it") {
  const keys = Object.keys(micro || {});
  if (!keys.length) return "";
  const pairs = keys.map(k => `${k}: ${micro[k]}`).join("; ");
  return isEn(lang) ? `Micro-answers today: ${pairs}` : `Micro-risposte di oggi: ${pairs}`;
}
