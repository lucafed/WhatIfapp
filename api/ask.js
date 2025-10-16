// ============================
// /api/ask.js — Life Cliffhanger Engine™
// Grounded-by-default + Follow-up Suggestions
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|move|work|should|city|life|back)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|vivere|tornare|aquila|verona|domani)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const wtf = en
    ? ["Save the glass — the night isn’t over.", "Same glass tomorrow.", "Bring the bottle back tomorrow."]
    : ["Tieni il bicchiere — la serata non è finita.", "Stesso bicchiere domani.", "La bottiglia torna domani."];
  const whf = en
    ? ["Let’s see where this leads.", "We’ll pick it up from here.", "Soon, one more step."]
    : ["Vediamo dove ti porta.", "Riprendiamo da qui.", "Tra poco un passo in più."];
  return pick(style === "wtf" ? wtf : whf);
}

/* ---------- PERSONAS: grounded e colte ---------- */
const Whatif_IT = `
Tu sei "What?f" — voce lucida, realistica e predittiva. Conosci davvero l’utente.
Scrivi 7–10 frasi piene, tono fluido e visivo; zero retorica.
Vedi il breve futuro come se lo avessi già intravisto. Non inventare fatti esterni.
Se usi fatti reali (data, luogo, meteo, eventi) fallo con naturalezza, come un amico informato.
Varia l’incipit (“Presto ti accorgi…”, “Succede che…”, “Ti conosco: quando fai così…”).
Chiudi con un gancio morbido di continuità (“Vediamo dove ti porta.”, “Non hai ancora visto il resto.”).
`;

const Wtf_IT = `
Tu sei "What the F" — amico da bar brillante, sarcastico e colto. Lucidamente alticcio.
Racconto continuo (8–10 frasi), ironico ma mai cattivo; 1–2 trovate da bancone.
Usa fatti reali se disponibili, senza inventare dettagli esterni.
Ritmo scorrevole (non spezzettato). Chiudi con cliffhanger divertente (“Tieni il bicchiere…”, ecc.).
`;

const Whatif_EN = `
You are "What?f" — clear, realistic, predictive voice that truly knows the user.
Write 7–10 full sentences, smooth and visual, never preachy.
Foresee the near future. Do not invent external facts.
If you use real context (date, place, season, events), do it naturally, like an informed friend.
Vary openings. End with a gentle hook (“Let’s see where this leads.” / “You haven’t seen the rest.”).
`;

const Wtf_EN = `
You are "What the F" — witty, cultured, cheerfully tipsy friend at the bar.
Continuous mini-story (8–10 sentences), smart sarcasm, never mean.
Use real context if provided; do not invent external details.
Flowing rhythm. End with a playful cliffhanger (“Save the glass…”, etc.).
`;

/* ---------- System builder con REALITY MODE ---------- */
function buildSystemPrompt(stile, lang, grounded, facts = []) {
  const base =
    stile === "wtf"
      ? (isEn(lang) ? Wtf_EN : Wtf_IT)
      : (isEn(lang) ? Whatif_EN : Whatif_IT);

  const realityBlock = grounded
    ? `
REALITY MODE (strict):
- Resta ancorato al reale per i riferimenti esterni.
- Usa SOLO i fatti/context forniti sotto come ancoraggi. NON inventare news, numeri, nomi o date.
- Se i fatti non bastano, resta qualitativo e personale (niente specifici fittizi).
Facts/context (JSON): ${JSON.stringify(facts).slice(0, 1200)}
`
    : `
FANTASY MODE:
- Evita riferimenti fattuali esterni. Resta personale, tonale, narrativo.
- NON fabbricare notizie/luoghi/dati puntuali.
`;

  const langLine = `Reply ONLY in ${isEn(lang) ? "English" : "Italiano"}.`;
  return [base.trim(), realityBlock.trim(), langLine].join("\n\n");
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
      domanda = "",
      stile = "whatif",           // "whatif" | "wtf"
      lang: langIn = "auto",      // "it" | "en" | "auto"
      extra = "",
      mode = "episode",           // "episode" | "follow"
      profile = {},               // { ambient, reality: { fantasyMode?:boolean, facts?:[...] }, micro?:{} }
      answer = ""                 // testo episodio (per follow suggestions)
    } = body;

    if (!domanda.trim()) {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const fantasyMode = !!profile?.reality?.fantasyMode;
    const grounded = !fantasyMode;

    const ambient = profile?.ambient || {}; // {dateISO, weekday, season, city, ...}
    const userFacts = Array.isArray(profile?.reality?.facts) ? profile.reality.facts : [];
    const micro = profile?.micro || {};      // mood, timeWindow, anchorNow, firstSignal (se vuoi)
    const facts = [
      ...(Object.keys(ambient).length ? [{ type: "ambient", data: ambient }] : []),
      ...(Object.keys(micro).length ? [{ type: "micro", data: micro }] : []),
      ...(userFacts || [])
    ];

    // ---- follow suggestions ----
    if (mode === "follow") {
      const sys = `
Generate exactly 3 short suggestions to continue TOMORROW'S story.
They must be clearly connected to the user's question and to today's answer tone (${stile}).
They are not questions to answer now, but prompts/hooks for the next episode.
Return STRICT JSON: {"suggestions":["s1","s2","s3"]} in ${isEn(lang) ? "English" : "Italiano"} — nothing else.
Facts/context (JSON): ${JSON.stringify(facts).slice(0, 1000)}
`.trim();

      const usr = `
User question: "${domanda}"
Today's answer (context): "${(answer || "").slice(0, 1200)}"
Create 3 concise, enticing suggestions for how the story could continue tomorrow.
`.trim();

      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.7,
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
              "Pick one tiny detail you’ll notice first thing tomorrow.",
              "Name the first sign that says the change is working.",
              "Decide one place you’ll test the new rhythm."
            ]
          : [
              "Scegli un dettaglio minuscolo che noterai per primo domani.",
              "Nomina il primo segnale che dice che sta funzionando.",
              "Decidi un luogo in cui provi il nuovo ritmo."
            ];
      }
      return res.status(200).json(out);
    }

    // ---- episode ----
    const systemPrompt = buildSystemPrompt(stile, lang, grounded, facts);
    const userPrompt = `${domanda.trim()}${extra ? ` (${String(extra).trim()})` : ""}\n\nClose with: "${episodicClosing(stile, lang)}"`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.85,
      max_tokens: 680,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const out = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!out) throw new Error("empty_model_response");

    return res.status(200).json({ answer: out, grounded, factsCount: facts.length });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
