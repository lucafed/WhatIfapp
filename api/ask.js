
// ============================
// /api/ask.js — The Life Cliffhanger Engine™
// Stili: aquivera, aquivera_divina, wtf
// Follow-ups + Suggestions coerenti
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e veloce

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function episodicClosing(style = "aquivera", lang = "it") {
  const en = isEn(lang);
  const base = en
    ? ["Let’s see where this takes you next.", "You’ll feel the next step sooner than you expect.", "We’ll pick up the thread right here."]
    : ["Vediamo dove ti porta il prossimo passo.", "Ti accorgi prima di quanto pensi del seguito.", "Riprendiamo il filo da qui."];
  const divina = en
    ? ["The pattern is set; the sign will appear.", "The hour is near. Keep your eyes soft.", "Your thread is already pulling you onward."]
    : ["Il disegno è tracciato; il segno arriva.", "L’ora è vicina. Tieni lo sguardo morbido.", "Il tuo filo già ti tira in avanti."];
  const wtf = en
    ? ["Keep the glass. The next scene pours itself.", "Park your tab—tomorrow gets noisy.", "The punchline lands tomorrow."]
    : ["Tieni il bicchiere: la prossima scena si versa da sola.", "Conta aperto: domani fa rumore.", "La battuta atterra domani."];

  if (style === "aquivera_divina") return pick(divina);
  if (style === "wtf") return pick(wtf);
  return pick(base);
}

/* ---------- Personas (IT/EN) ---------- */
const PERSONA = {
  aquivera: (lang) => isEn(lang) ? `
You are Aquivera — a clear, cultured, predictive narrator. You know the user well.
Write 7–10 smooth sentences, no lists. Visual, grounded, quietly prophetic.
Use reality-aware touches (season, weekdays, city mood), but don’t fabricate personal facts.
Vary openings (“Soon you notice…”, “You always do this…”, “It turns out…”).
End with a soft, forward pull to tomorrow.
Reply ONLY in English.
` : `
Sei Aquivera — narratrice lucida, colta, predittiva. Conosci bene l’utente.
Scrivi 7–10 frasi fluide, senza elenchi. Visiva, concreta, lievemente profetica.
Accenna al contesto reale (stagione, ritmo della città) senza inventare fatti personali.
Varia gli inizi (“Tra poco ti accorgi…”, “Con te succede sempre…”).
Chiudi con un invito morbido al seguito di domani.
Rispondi SOLO in Italiano.
`,
  aquivera_divina: (lang) => isEn(lang) ? `
You are Aquivera Divina — omniscient, oracular, elegant. Still kind and concrete.
7–10 flowing lines. You read the user’s pattern and foresee a near-future hinge moment.
Use subtle real-world hints (weather, weekday mood) but never invent private facts.
Close with a prophetic whisper that pulls to tomorrow.
Reply ONLY in English.
` : `
Sei Aquivera Divina — onnisciente, oracolare, elegante. Ma concreta e benevola.
7–10 righe fluide. Leggi il pattern dell’utente e prefiguri un momento-chiave a breve.
Inserisci cenni realistici (meteo, ritmo del giorno), senza inventare fatti privati.
Chiudi con un sussurro profetico che spinge a domani.
Rispondi SOLO in Italiano.
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
Each suggestion must start with a verb. 5–12 words each. No lists in the JSON.
Return JSON ONLY: {"suggestions":["...","...","..."]} in English.
` : `
Genera 3 SUGGERIMENTI concisi (non domande) per spingere avanti la storia domani.
Devono derivare dalla domanda dell’utente e dal tono di oggi (${stile}).
Ogni suggerimento inizi con un verbo. 5–12 parole ciascuno. Niente liste nel JSON.
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
      extra = "",              // dettagli opzionali (profilo/micro-tratti)
      // suggestions branch
      suggestions = false,     // true => ritorna suggerimenti coerenti
      answer = "",             // testo episodio, per generare suggerimenti coerenti
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // branch: SUGGERIMENTI
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
          ? ["Note one concrete sign you’d expect tomorrow.",
             "Name a tiny step you’d actually take.",
             "Pick a place that sets the right rhythm."]
          : ["Annota un segnale concreto che ti aspetti domani.",
             "Scegli un passo minuscolo che faresti davvero.",
             "Indica un luogo che imposti il ritmo giusto."];
      }
      return res.status(200).json(out);
    }

    // branch: EPISODIO
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
