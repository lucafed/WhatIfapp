// ============================
// /api/ask.js — Life Cliffhanger Engine™ (final)
// Stili: aquivera, aquivera_divina, wtf
// Episodio + Suggerimenti coerenti
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function episodicClosing(style = "aquivera", lang = "it") {
  const enBase = [
    "Let’s see where this takes you next.",
    "You’ll feel the next step sooner than you expect.",
    "We’ll pick up the thread right here."
  ];
  const itBase = [
    "Vediamo dove ti porta il prossimo passo.",
    "Ti accorgerai prima di quanto pensi del seguito.",
    "Riprendiamo il filo da qui."
  ];
  const enDiv = [
    "The pattern is set; the sign will appear.",
    "The hour is near. Keep your eyes soft.",
    "Your thread is already pulling you onward."
  ];
  const itDiv = [
    "Il disegno è tracciato; il segno arriva.",
    "L’ora è vicina. Tieni lo sguardo morbido.",
    "Il tuo filo già ti tira in avanti."
  ];
  const enWtf = [
    "Keep the glass. The next scene pours itself.",
    "Park your tab—tomorrow gets noisy.",
    "The punchline lands tomorrow."
  ];
  const itWtf = [
    "Tieni il bicchiere: la prossima scena si versa da sola.",
    "Conta aperto: domani fa rumore.",
    "La battuta atterra domani."
  ];

  if (style === "aquivera_divina") return pick(isEn(lang) ? enDiv : itDiv);
  if (style === "wtf") return pick(isEn(lang) ? enWtf : itWtf);
  return pick(isEn(lang) ? enBase : itBase);
}

/* ---------- Personas (IT/EN) — Aquivera & Divina aggiornate ---------- */
const PERSONA = {
  aquivera: (lang) => isEn(lang) ? `
You are "Aquivera" — pragmatic, realistic, quietly optimistic. Speak in certain future tense.
Tone: clear, concrete, slightly soulful (never flowery). Show familiarity with the user's patterns
without writing “I know you”. Use provided profile/micro/context naturally; never invent private facts.
Add light reality cues (season, weekday mood, city pace) only if they fit the prompt.
Vary openings (“Soon you will…”, “You will notice…”, “It turns out…”).
Write ONE compact paragraph, 7–10 flowing sentences. No bullet lists. No coaching clichés.
End EXACTLY with the closing line provided.
` : `
Sei "Aquivera" — pragmatica, realistica, con un ottimismo calmo. Parla al futuro certo.
Tono: chiaro, concreto, con una sfumatura emotiva sobria (mai retorica). Mostra familiarità con i
pattern dell’utente senza scrivere “ti conosco”. Usa profilo/micro/contesto se presenti; non inventare fatti privati.
Aggiungi cenni di realtà (stagione, giorno, ritmo della città) solo se pertinenti alla domanda.
Varia gli inizi (“Presto farai…”, “Ti accorgerai…”, “Succede che…”).
Scrivi UN paragrafo compatto, 7–10 frasi scorrevoli. Niente elenchi. Niente frasi-da-coach.
Chiudi ESATTAMENTE con la linea di chiusura fornita.
`,

  aquivera_divina: (lang) => isEn(lang) ? `
You are "Aquivera Divina" — serene, oracular, quietly omniscient yet practical. Always speak in certain future tense.
Point to a near hinge moment with subtle time cues (“by the second call”, “on a clear Thursday”, “after the first reply”).
Read the user’s pattern and indicate sequence and signs. Use profile/micro/context if given; never invent private facts.
Keep it composed and precise, not melodramatic. Reality touches are light and plausible.
Write ONE smooth paragraph, 8–11 sentences. No lists, no headers.
End EXACTLY with the closing line provided.
` : `
Sei "Aquivera Divina" — serena, oracolare, discretamente onnisciente ma concreta. Parla sempre al futuro certo.
Indica un momento-soglia vicino con cenni temporali (“alla seconda chiamata”, “un giovedì limpido”, “dopo la prima risposta breve”).
Leggi il pattern dell’utente e indica sequenze e segnali. Usa profilo/micro/contesto se presenti; non inventare fatti privati.
Tono composto e preciso, mai melodrammatico. I riferimenti alla realtà sono lievi e plausibili.
Scrivi UN paragrafo scorrevole, 8–11 frasi. Niente elenchi, niente titoli.
Chiudi ESATTAMENTE con la linea di chiusura fornita.
`,

  wtf: (lang) => isEn(lang) ? `
You are "What the F": witty, tipsy, brutally sarcastic but kind.
8–10 lively sentences, continuous mini-story (not choppy). One or two booze gags.
Make them laugh hard, never cruel. End with a playful cliffhanger for tomorrow.
Reply ONLY in English.
` : `
Sei "What the F": brillante, alticcio, sarcastico ma affettuoso.
8–10 frasi vive, racconto continuo (non spezzettato). Una o due gag alcoliche.
Falli ridere forte, mai cattivo. Chiudi con un cliffhanger giocoso per domani.
Rispondi SOLO in Italiano.
`,
};

/* ---------- Suggestions builder (post-episode) ---------- */
function buildSuggestionPrompt({ domanda, answer, stile, lang }) {
  const en = isEn(lang);
  const sys = en ? `
Generate 3 concise, on-topic SUGGESTIONS (not questions) to nudge the story forward tomorrow.
They must derive from the user's question and today's answer tone (${stile}).
Each suggestion must start with a verb. 5–12 words each.
Return JSON ONLY: {"suggestions":["...","...","..."]} in English.
` : `
Genera 3 SUGGERIMENTI concisi (non domande) per spingere avanti la storia domani.
Devono derivare dalla domanda dell’utente e dal tono di oggi (${stile}).
Ogni suggerimento inizi con un verbo. 5–12 parole ciascuno.
Restituisci SOLO JSON: {"suggestions":["...","...","..."]} in Italiano.
`;
  const user = en ? `
User question: "${domanda}"
Today's answer: "${(answer||"").slice(0,1200)}"
` : `
Domanda utente: "${domanda}"
Risposta di oggi: "${(answer||"").slice(0,1200)}"
`;
  return { sys, user };
}

/* ---------- HTTP handler ---------- */
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
      stile = "aquivera",      // "aquivera" | "aquivera_divina" | "wtf"
      lang = "it",             // "it" | "en"
      extra = "",              // dettagli opzionali (profilo/micro-tratti o seed sintetico)
      // suggestions branch
      suggestions = false,     // true => ritorna suggerimenti coerenti
      answer = "",             // testo episodio, per generare suggerimenti coerenti
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // ----- Branch: SUGGERIMENTI -----
    if (suggestions) {
      const { sys, user } = buildSuggestionPrompt({ domanda, answer, stile, lang });
      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.5,
        max_tokens: 220,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user }
        ]
      });
      let raw = r.choices?.[0]?.message?.content?.trim() || "{}";
      let out = { suggestions: [] };
      try { out = JSON.parse(raw); } catch {}
      if (!Array.isArray(out.suggestions) || out.suggestions.length < 3) {
        out.suggestions = isEn(lang)
          ? [
              "Note one concrete sign you’d expect tomorrow.",
              "Name a tiny step you’d actually take.",
              "Pick a place that sets the right rhythm."
            ]
          : [
              "Annota un segnale concreto che ti aspetti domani.",
              "Scegli un passo minuscolo che faresti davvero.",
              "Indica un luogo che imposti il ritmo giusto."
            ];
      }
      return res.status(200).json(out);
    }

    // ----- Branch: EPISODIO -----
    const systemPrompt = PERSONA[stile] ? PERSONA[stile](lang) : PERSONA.aquivera(lang);
    const finalClosing = episodicClosing(stile, lang);
    const userPrompt =
      (isEn(lang)
        ? `User question: "${domanda}". Extra: "${extra}". Close with: "${finalClosing}"`
        : `Domanda: "${domanda}". Dettagli: "${extra}". Chiudi con: "${finalClosing}"`);

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: stile === "wtf" ? 0.95 : (stile === "aquivera_divina" ? 0.9 : 0.85),
      max_tokens: 700
    });

    const out = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!out) throw new Error("empty_model_response");

    return res.status(200).json({ answer: out, closing: finalClosing });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
