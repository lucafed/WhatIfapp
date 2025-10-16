// ============================
// /api/ask.js — Life Cliffhanger Engine™ (finale)
// Stili: aquivera, aquivera_divina, wtf
// Features: episodio, suggestions (spunti), followups (opzionale)
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
  const enAq = [
    "We’ll pick the thread up tomorrow.",
    "You’ll see the rest soon.",
    "The next step will be obvious."
  ];
  const itAq = [
    "Riprendiamo il filo domani.",
    "Il resto lo vedrai presto.",
    "Il prossimo passo sarà evidente."
  ];

  const enDiv = [
    "The pattern is set; watch for the sign.",
    "Your hour draws near. Keep your eyes soft.",
    "The thread is already pulling you forward."
  ];
  const itDiv = [
    "Il disegno è tracciato: attendi il segno.",
    "L’ora si avvicina: tieni lo sguardo morbido.",
    "Il filo ti sta già tirando avanti."
  ];

  const enWtf = [
    "Keep the glass — the next scene pours itself.",
    "Leave the tab open; tomorrow gets loud.",
    "The punchline lands tomorrow."
  ];
  const itWtf = [
    "Tieni il bicchiere: la prossima scena si versa da sola.",
    "Lascia il conto aperto: domani fa rumore.",
    "La battuta atterra domani."
  ];

  if (style === "aquivera_divina") return pick(isEn(lang) ? enDiv : itDiv);
  if (style === "wtf") return pick(isEn(lang) ? enWtf : itWtf);
  return pick(isEn(lang) ? enAq : itAq);
}

/* ========== Personas (tono definitivo) ========== */
const PERSONAS = {
  // Aquivera — pragmatica, reale, “ooooooh”, positiva con lieve malinconia,
  // SEMPRE al futuro certo. Fa sentire che prevede davvero.
  aquivera: {
    system: (lang) => `
You are "Aquivera" — a pragmatic, quietly emotive narrator who speaks in certain future tense.
Tone: realistic, grounded, slightly wistful but ultimately positive (“ooooooh” feeling), never purple.
Sound like you’ve mapped the user’s patterns (do NOT say “I know you”).
Use any provided profile/micro/context hints naturally; never invent private facts.
Avoid lists. 7–10 smooth complete sentences in one compact paragraph.
Close with a gentle hook for tomorrow.
Reply ONLY in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  },

  // Aquivera Divina — più oracolare, colta, con segni/tempi (“alla seconda chiamata”, “di giovedì”),
  // SEMPRE al futuro, ma concreta.
  aquivera_divina: {
    system: (lang) => `
You are "Aquivera Divina" — serene, oracular, cultured. Still concrete and kind.
Speak in certain future tense; foresee a near-future hinge moment, with subtle time/place cues.
Weave in provided profile/micro/context hints; NEVER invent personal facts not given.
No melodrama; luminous precision. 8–11 flowing sentences, one paragraph.
End with a prophetic hook that clearly implies continuation.
Reply ONLY in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  },

  // What the F — barista sarcastico, demenziale ma affettuoso, leggermente alticcio,
  // mini-racconto continuo (non spezzato), 8–10 frasi, con 1–2 gag alcoliche.
  wtf: {
    system: (lang) => `
You are "What the F" — witty, tipsy, brutally sarcastic but kind.
Continuous mini-story (not choppy), 8–10 lively sentences. One or two booze gags.
Never cruel; make them laugh hard and end with a playful cliffhanger for tomorrow.
Address the user in second person; *they* do the things, not you.
Reply ONLY in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  }
};

/* ===== Lines from profile/micro (non inventare nulla) ===== */
function buildProfileLine(profile = {}, lang = "it") {
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const tags = profile?.prefs || [];

  const bits = [];
  if (name) bits.push(isEn(lang) ? `Name: ${name}.` : `Nome: ${name}.`);
  if (city) bits.push(isEn(lang) ? `City now: ${city}.` : `Città attuale: ${city}.`);
  if (role) bits.push(isEn(lang) ? `Work: ${role}.` : `Lavoro: ${role}.`);
  if (Array.isArray(tags) && tags.length) bits.push(isEn(lang) ? `Hints: ${tags.join(", ")}.` : `Indizi: ${tags.join(", ")}.`);

  if (!bits.length) return "";
  return isEn(lang) ? `Profile hints: ${bits.join(" ")}` : `Indizi profilo: ${bits.join(" ")}`;
}

function buildMicroLine(micro = {}, lang = "it") {
  const keys = Object.keys(micro || {}).filter(k => micro[k] !== undefined && micro[k] !== "");
  if (!keys.length) return "";
  const pairs = keys.map(k => `${k}: ${micro[k]}`).join("; ");
  return isEn(lang) ? `Micro-answers today: ${pairs}` : `Micro-risposte di oggi: ${pairs}`;
}

/* ========== Suggestion builder (post-episodio) ========== */
function buildSuggestionPrompt({ domanda, answer, stile, lang }) {
  const sys = isEn(lang) ? `
Generate 3 concise SUGGESTIONS (not questions) to nudge tomorrow’s continuation.
They must derive from the user's question and today's answer tone (${stile}).
Each suggestion MUST start with a verb and stay within 5–12 words.
Return JSON ONLY: {"suggestions":["...","...","..."]} in English.
`.trim() : `
Genera 3 SUGGERIMENTI concisi (non domande) per spingere la continuazione di domani.
Devono derivare dalla domanda dell’utente e dal tono di oggi (${stile}).
Ogni suggerimento DEVE iniziare con un verbo e stare tra 5–12 parole.
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

/* ========== Follow-up builder (se vuoi anche 2 domande mirate) ========== */
function buildFollowupPrompt(stile, lang) {
  return `
Return STRICT JSON: {"followups":["Q1","Q2"]}
Both follow-ups must clearly continue THIS storyline tomorrow, in ${isEn(lang) ? "English" : "Italiano"}.
Keep them specific and connected to today's answer and the original question. No generic coaching.
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
      // episodio
      domanda = "",
      stile = "aquivera",     // "aquivera" | "aquivera_divina" | "wtf"
      lang = "it",            // "it" | "en"
      profile = {},           // { name, city_now, work_role, prefs:[] }
      micro = {},             // { mood, energy, city, focus, ... }
      episode = 1,            // 1..3 (se vuoi visualizzarlo)
      contextMode = "clean",  // "clean" | "real"
      context = "",           // seed realistico opzionale (meteo/eventi) fornito da server/app
      // suggestions
      suggestions = false,    // true -> ritorna { suggestions:[] }
      answer = "",            // testo episodio (per suggestions/followups)
      // followups (opzionale)
      follow = false          // true -> ritorna { followups:[] }
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // ----- suggestions branch -----
    if (suggestions) {
      const { sys, usr } = buildSuggestionPrompt({ domanda, answer, stile, lang });
      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.5,
        max_tokens: 220,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr }
        ]
      });
      let raw = r.choices?.[0]?.message?.content?.trim() || "{}";
      let out = { suggestions: [] };
      try { out = JSON.parse(raw); } catch {}
      if (!Array.isArray(out.suggestions) || out.suggestions.length < 3) {
        out.suggestions = isEn(lang)
          ? ["Note one sign you expect tomorrow.", "Name a tiny step you will take.", "Choose one place that sets your rhythm."]
          : ["Annota un segno che ti aspetti domani.", "Nomina un passo minuscolo che farai.", "Scegli un luogo che imposti il tuo ritmo."];
      }
      return res.status(200).json(out);
    }

    // ----- followups branch (se vuoi 2 domande mirate per domani) -----
    if (follow) {
      const sys = buildFollowupPrompt(stile, lang);
      const usr = isEn(lang) ? `
Original question: "${domanda}"
Today's answer: "${(answer || "").slice(0, 1400)}"
`.trim() : `
Domanda originale: "${domanda}"
Risposta di oggi: "${(answer || "").slice(0, 1400)}"
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

      let raw = r.choices?.[0]?.message?.content?.trim() || "{}";
      let out = { followups: [] };
      try { out = JSON.parse(raw); } catch {}
      if (!Array.isArray(out.followups) || out.followups.length < 2) {
        out.followups = isEn(lang)
          ? ["What precise sign tomorrow would confirm you’re on track?", "Which constraint will you remove first?"]
          : ["Quale segno preciso domani ti confermerà la direzione?", "Quale vincolo toglierai per primo?"];
      }
      return res.status(200).json(out);
    }

    // ----- episodio branch -----
    const persona = PERSONAS[stile] || PERSONAS.aquivera;
    const closing = episodicClosing(stile, lang);

    const profileLine = buildProfileLine(profile, lang);
    const microLine   = buildMicroLine(micro, lang);
    const ctxLine     =
      (contextMode === "real" && context)
        ? (isEn(lang)
            ? `Real-world seed (do not invent beyond this): ${context}`
            : `Contesto reale (seed, non inventare oltre): ${context}`)
        : "";

    const system = `
${persona.system(lang)}

Today is ${todayInfo(lang)}.
Rules:
- Speak in certain future tense; concrete, verifiable tone (no fortune-cookie vagueness).
- Use provided profile/micro/context hints naturally; NEVER invent private facts.
- One compact paragraph: ${stile === "wtf" ? "8–10 lively sentences." : "7–11 smooth sentences."}
- End EXACTLY with: "${closing}"
`.trim();

    const user = `
Question: "${domanda}"
${profileLine ? profileLine + "\n" : ""}${microLine ? microLine + "\n" : ""}${ctxLine ? ctxLine + "\n" : ""}
Episode: ${episode} / 3
Write a self-contained scene that feels like the next step.
`.trim();

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : (stile === "aquivera_divina" ? 0.78 : 0.82),
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!text) throw new Error("empty_model_response");

    return res.status(200).json({
      answer: text,
      lang,
      style: stile,
      episode,
      closing
    });

  } catch (err) {
    console.error("[/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
