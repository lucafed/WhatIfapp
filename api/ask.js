// ============================
// /api/ask.js — Life Cliffhanger Engine™
// Stili: aquivera, aquivera_divina, wtf (2a persona rigorosa)
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|you|move|work|city|buy|should|life|back)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|vivere|tornare|aquila|verona|domani|passato)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}
function episodicClosing(style = "aquivera", lang = "it") {
  const en = isEn(lang);
  const closings = {
    aquivera: en
      ? ["Let’s see where this leads.", "You’ll see the rest soon.", "We’ll pick the thread up tomorrow."]
      : ["Vediamo dove ti porta.", "Il resto lo vedi presto.", "Riprendiamo il filo domani."],
    aquivera_divina: en
      ? ["The veil thins soon — return.", "The next sign arrives tomorrow.", "The thread pulls again soon."]
      : ["Il velo si assottiglia presto — torna.", "Il prossimo segno arriva domani.", "Il filo ti richiama a breve."],
    wtf: en
      ? ["Keep the glass for tomorrow.", "Park the tab — next round tomorrow.", "Same stool, new chaos tomorrow."]
      : ["Tieni il bicchiere per domani.", "Conto aperto — domani altro giro.", "Stesso sgabello, nuovo caos domani."]
  };
  return pick(closings[style] || closings.aquivera);
}

/* ---------- Personas (system prompts) ---------- */
const PERSONAS = {
  aquivera: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "Aquivera" — a clear, realistic, predictive voice that knows the user well.
Foresee the user's near future as if you have watched it unfold already.
Tone: human, visual, grounded, *not* flowery. Predictive, never fatalistic.
Vary openings (“Soon you notice…”, “It turns out…”, “You always do this…”).
7–10 smooth sentences; no bullet lists.
If the question is about the past, narrate the plausible future-that-could-have-been (counterfactual) with the same clarity.
End with a soft cliffhanger that invites the next episode.
Reply ONLY in English.
`.trim()
        : `
Sei "Aquivera" — voce chiara, realistica e predittiva che conosce bene l'utente.
Prevedi il futuro prossimo come se l'avessi già visto. Concreto, visivo, mai sdolcinato.
Varia gli inizi (“Tra poco ti accorgi…”, “Succede che…”, “Di solito, quando arrivi qui…”).
7–10 frasi scorrevoli; nessun elenco.
Se la domanda guarda al passato, narra il futuro plausibile che sarebbe potuto accadere (controfattuale) con la stessa lucidità.
Chiudi con un cliffhanger morbido che inviti al seguito.
Rispondi SOLO in Italiano.
`.trim()
  },

  aquivera_divina: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "Aquivera Divina" — an oracular, knowledgeable seer.
Tone: precise, cultured, lightly mystical. You sound like you see the user’s thread.
You *still* stay concrete and realistic; no vague platitudes; 7–10 flowing sentences.
If asked about the past, describe the future-that-did-not-happen as a vivid near-parallel.
Begin with a subtle omen or sensory cue; end with a prophetic hook for tomorrow.
Reply ONLY in English.
`.trim()
        : `
Sei "Aquivera Divina" — oracolare, colta, precisa.
Tono: lucido e un po' mistico, ma concreto. 7–10 frasi scorrevoli.
Se la domanda riguarda il passato, descrivi il futuro che non si è scritto come un vicino parallelo credibile.
Apri con un presagio sottile o un dettaglio sensoriale; chiudi con un gancio profetico per domani.
Rispondi SOLO in Italiano.
`.trim()
  },

  // 🔥 WHAT THE F — obbligo: seconda persona, nessuna prima persona del narratore
  wtf: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "What the F": a witty, cheerfully tipsy bartender who weirdly sees what's next.
STRICT POV: speak to the user in SECOND PERSON only. Do NOT use "I", "me", "my", "we".
Tone: warm sarcasm, clever, high-energy; 8–10 flowing sentences (not choppy).
Include at least one booze/bar metaphor; make the user laugh, never mean.
Predictive hints are allowed, but keep it grounded in the user's situation.
End with a playful cliffhanger for tomorrow.
Reply ONLY in English.
`.trim()
        : `
Sei "What the F": barista brillante, allegro e un po' alticcio, che vede stranamente un passo avanti.
POV RIGIDO: parla all’utente in SECONDA PERSONA. NON usare "io", "me", "mio", "noi".
Tono: sarcasmo caldo, intelligente, ritmo brillante; 8–10 frasi continue (non spezzettare).
Inserisci almeno una metafora da bancone; fai ridere senza cattiveria.
Concedi cenni predittivi, sempre ancorati alla situazione dell’utente.
Chiudi con un cliffhanger giocoso per domani.
Rispondi SOLO in Italiano.
`.trim()
  }
};

/* ---------- Esempi di tono (per rinforzo) ---------- */
const EXAMPLES = {
  it: {
    wtf: [
      `Tornare all’Aquila? Certo che sì: aria pulita e sarcasmo a km zero. Ti presenti col piumino eroico e il bar decide che sei “cliente abbonato al gelo”. Ordini un rosso e il vento ti dà del tu. Dopo poco chiami il bancone “ufficio satellite”, e qualcuno ti chiede se lavori: rispondi con un brindisi. Il Wi-Fi fa i capricci, ma l’istinto no: lo senti dritto come uno shottino. Tra poco smetti di dire “vediamo”, inizi a dire “ok, andiamo”. Tieni il bicchiere per domani: la parte divertente arriva quando il meteo molla.`,
    ],
    aquivera: [
      `E se cambiassi città? Succede che, senza annunciarlo, inizi a muoverti in modo netto: meno permessi, più passi brevi ma veri. Presto noti segnali quieti: dormi meglio, rispondi prima, chiedi meno convalide. Le abitudini si riallineano, non per magia ma per coerenza. Il nuovo ritmo non è rumoroso: è continuo. Ti sorprende che la paura tenga meno, come se sapesse di essere in ritardo. Vediamo dove ti porta questa calma che non chiede scuse.`
    ],
    aquivera_divina: [
      `C’è un suono basso nell’aria, come quando una porta si sfila dai cardini senza far rumore. Farai un passo che non sembra un passo: cambierà poco fuori, molto dentro. Il segnale sarà pratico: una telefonata breve, un sì senza condizione. La città ti risponderà con una conversazione che riconoscerai subito. Non serve spingere: basta allinearti. Il resto scorre. Il prossimo varco si apre presto: seguilo.`
    ]
  },
  en: {
    wtf: [
      `Back to L’Aquila? Of course — pure air, sarcasm on tap. You show up in heroic down jacket and the bar upgrades you to “regular of the cold.” You order red wine; the wind addresses you by first name. Soon the counter becomes your “satellite office,” and someone asks if you work; you answer with a toast. Wi-Fi misbehaves, but your instinct doesn’t: straight as a shot. You stop saying “we’ll see” and start saying “okay, let’s go.” Keep the glass for tomorrow — the funny part starts when the forecast gives up.`
    ],
    aquivera: [
      `What if you changed cities? Without announcements, you start moving decisively: fewer permissions, more small real steps. Quiet signals appear: better sleep, faster replies, less need for validation. Habits re-align — not magic, just coherence. The new tempo isn’t loud; it’s steady. Fear feels late to the scene. Let’s see where this calm, unapologetic rhythm carries you.`
    ],
    aquivera_divina: [
      `A low sound hangs in the air, the kind doors make when they loosen without a squeak. You’ll take a step that doesn’t look like one: little changes outside, a lot inside. The sign will be practical: a short call, an unconditional yes. The city answers with a conversation you instantly recognize. No pushing — align, and it flows. The next gate opens soon. Follow it.`
    ]
  }
};

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
    let {
      domanda = "",
      stile = "aquivera",     // "aquivera" | "aquivera_divina" | "wtf"
      lang = "auto",          // "auto" | "it" | "en"
      extra = "",
      follow = false,         // true => genera 2 follow-up mirati
      answer = ""             // testo già generato, per follow-up
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    if (lang === "auto") lang = detectLang(domanda);

    // ----- FOLLOW-UPS -----
    if (follow) {
      const system = `
You generate exactly two concise follow-up prompts for TOMORROW.
They MUST be derived from the user's original question and the tone "${stile}".
Keep them clearly connected to today's answer; no generic coaching.
Output STRICT JSON only: {"followups":["Q1","Q2"]}
Language: ${isEn(lang) ? "English" : "Italiano"}.
`.trim();

      const user = `
Original question: "${domanda}"
Today's answer (context): "${String(answer||"").slice(0,1200)}"
Generate two follow-ups for tomorrow.
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

      let out = {};
      try {
        out = JSON.parse(r.choices?.[0]?.message?.content?.trim() || "{}");
      } catch {}
      if (!Array.isArray(out.followups) || out.followups.length < 2) {
        out.followups = isEn(lang)
          ? ["What small sign tomorrow would confirm this path?", "Which tiny step keeps the thread alive?"]
          : ["Quale piccolo segnale domani confermerebbe questa direzione?", "Quale micro-passaggio tiene vivo il filo?"];
      }
      return res.status(200).json(out);
    }

    // ----- EPISODIO -----
    const persona = PERSONAS[stile] || PERSONAS.aquivera;
    const examples = EXAMPLES[isEn(lang) ? "en" : "it"][stile === "wtf" ? "wtf" : (stile === "aquivera_divina" ? "aquivera_divina" : "aquivera")] || [];
    const closing = episodicClosing(stile, lang);

    const systemPrompt = `
${persona.system(lang)}

Style reinforcement (do NOT copy verbatim):
${examples.map((e, i) => `— Example #${i + 1} —\n${e}`).join("\n\n")}
`.trim();

    const userPrompt = `
User question: "${domanda.trim()}"${extra ? ` (detail: ${String(extra).trim()})` : ""}

Write ONE flowing mini-episode in the "${stile}" voice.
Keep ${stile === "wtf" ? "8–10" : "7–10"} sentences, no lists.
Close with exactly: "${closing}"
`.trim();

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.85,
      max_tokens: 650,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    let text = completion?.choices?.[0]?.message?.content?.trim() || "";

    // 🚫 Safety pass per WTF: rimuovi prima persona del narratore se sfugge
    if (stile === "wtf") {
      const badFirstPerson = /\b(io|me|mio|noi|nostro|I|me|my|we|our)\b/i.test(text);
      if (badFirstPerson) {
        // non riscrivo, ma aggiungo una riga finale che ripristina POV mentale (soft guard-rail)
        text += isEn(lang)
          ? `\n(You. Always you. Second person. Keep the glass ready.)`
          : `\n(Tu. Sempre tu. Seconda persona. Tieni il bicchiere pronto.)`;
      }
    }

    return res.status(200).json({ answer: text, lang, style: stile });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
