// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Utility ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

/* ========= Mirror lines ========= */
/* — What?f (empatica, lucida) — */
function mirrorLineWhatIf(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (profile?.goals && profile.goals[0]) || profile?.goal || "";

  const base_it = [
    name ? `${name}, non ti muovi per capriccio: ti muovi quando il perché è chiaro.` : "Non ti muovi per capriccio: ti muovi quando il perché è chiaro.",
    city ? `${city} ti dà base, ma ogni tanto ti serve aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) resti finché il senso resta acceso.` : "Resti dove il senso resta acceso.",
    goal ? `In testa hai questo punto: ${goal}. Il resto si allinea.` : "Hai un punto chiaro; il resto si allinea."
  ];
  const base_en = [
    name ? `${name}, you don’t move on whims — you move when the why is clear.` : "You don’t move on whims — you move when the why is clear.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In your role (${role}) you stay while meaning stays alive.` : "You stay while meaning stays alive.",
    goal ? `You keep this point in mind: ${goal}. Everything else aligns.` : "You hold one clear point; everything else aligns."
  ];

  const narrative_it = [
    "Ti conosco: l’Aquila per te non è solo un posto, è una misura del tempo.",
    "Ti ha insegnato a resistere e a ripartire; ora ti serve coerenza, non rumore.",
    "Il ritmo più lento ti spaventerebbe due giorni, poi ti ricorderebbe come si respira davvero.",
    "I legami che hai lasciato non aspettano scuse: aspettano presenza.",
    "Certe scelte non provano niente: ti riportano solo dove chiami casa.",
    "Hai imparato a riconoscere il momento esatto in cui la stabilità diventa gabbia."
  ];
  const narrative_en = [
    "I know you: L’Aquila isn’t just a place — it’s your measure of time.",
    "It taught you to endure and restart; now you need coherence, not noise.",
    "The slower rhythm would scare you for two days, then teach you how to breathe again.",
    "The ties you left don’t wait for excuses — they wait for presence.",
    "Some choices aren’t proof — they’re a way back to what feels like home.",
    "You can tell the exact moment when stability turns into a cage."
  ];

  const pool = [...(en ? base_en : base_it), ...(en ? narrative_en : narrative_it)];
  return pick(pool);
}

/* — What the F (sarcastica, brillante) — */
function mirrorLineWTF(profile = {}, lang = "it") {
  const en = isEn(lang);
  const city = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const role = profile?.work_role || profile?.role || (en ? "your job" : "il tuo lavoro");

  const it = [
    `Oh, guarda chi torna a pensarci. ${city} ti sta stretto solo il lunedì, vero?`,
    `Promemoria: nel (${role}) fai il serio, ma è il bar che ti fa dire la verità.`,
    `Hai fame di libertà… ma con fattura. Elegante, mi piace.`,
    `Se è solo nostalgia, passa. Se è fiato più lungo, ascolta.`,
    `Vuoi il cambiamento, ma in confezione richiudibile. Classico tuo.`
  ];
  const enArr = [
    `Look who’s thinking about it again. ${city} only feels tight on Mondays, right?`,
    `Reminder: in (${role}) you act proper; at the bar you tell the truth.`,
    `You want freedom — with a receipt. Classy.`,
    `If it’s nostalgia, it fades. If your breath gets longer, listen.`,
    `You want change, but resealable. Very you.`
  ];
  return pick(en ? enArr : it);
}

/* ========= Personae ========= */
const PERSONAS = {
  whatif: {
    system: (lang) => (isEn(lang) ? `
You are "What?f": lucid, warm, predictive.
Second person only. One voice. 8–12 short lines, concrete and current.
No labels like "indicator/constraint/first step" — weave them naturally.
Avoid nostalgia, moralizing, and clichés. Keep details small and plausible.
Close with a soft invite to return tomorrow for two micro-questions.
` : `
Sei "What?f": voce lucida, calda, predittiva.
Solo seconda persona. Una voce. 8–12 righe brevi, concrete e attuali.
Niente etichette tipo "indicatore/vincolo/primo passo": intrecciale senza nominarle.
Evita nostalgia, moralismi e cliché. Dettagli piccoli e plausibili.
Chiudi con un invito morbido a tornare domani per due micro-domande.
`)
  },
  wtf: {
    system: (lang) => (isEn(lang) ? `
You are "What the F": witty late-night bartender — playful, sharp, never cruel.
Second person only. One voice. 8–10 punchy lines, bar rhythm.
Clear sarcasm, clean punchlines, zero profanity or lectures.
Personalize implicitly (place/role) without listing facts.
Close with a cheeky invite like "two clean shots tomorrow".
` : `
Sei "What the F": barista nottambulo brillante — giocoso, affilato, mai cattivo.
Solo seconda persona. Una voce. 8–10 righe secche, ritmo da bancone.
Sarcasmo chiaro, punchline pulite, zero volgarità o prediche.
Personalizza in modo implicito (luogo/ruolo) senza elenchi.
Chiudi con un invito sfrontato tipo "domani due colpi secchi".
`)
  }
};

/* ========= Closings ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani due micro-domande e continuiamo puliti.",
    "Se torni domani, aggiungo due dettagli e andiamo più a fondo.",
    "Riprendiamo domani: due spunti rapidi e svoltiamo."
  ];
  const itSharp = [
    "Stop qui. Domani due colpi secchi e si riparte.",
    "Segnalibro messo: domani due cue veloci e si alza il livello.",
    "Bancone chiuso: domani due domande e via."
  ];
  const enSoft = [
    "Come back tomorrow — two micro-questions and we move on.",
    "Return tomorrow: two small details, cleaner path.",
    "We’ll pick it up tomorrow with two quick prompts."
  ];
  const enSharp = [
    "Pause here. Tomorrow two clean shots — then action.",
    "Bookmark this. Two fast cues tomorrow and we level up.",
    "Bar’s closed — tomorrow two sharp questions."
  ];
  if (style === "wtf") return en ? pick(enSharp) : pick(itSharp);
  return en ? pick(enSoft) : pick(itSoft);
}

/* ========= Clarify generator ========= */
function buildClarify(domanda = "", periodo = "future", profile = {}, lang = "it") {
  const en = isEn(lang);
  const Q = [];
  const hint = (s) => (en ? s.en : s.it);
  // Le domande sono collegate alla domanda principale:
  // una sull'orizzonte temporale, una sul "segnale" personale, una sul vincolo concreto.
  if (periodo === "past") {
    Q.push({
      id: "pivot",
      label: hint({ it: "Anno o evento di svolta?", en: "Turning year/event?" }),
      placeholder: hint({ it: "es. offerta 2019 / trasferimento 2015", en: "e.g., 2019 offer / 2015 move" })
    });
    Q.push({
      id: "then_place",
      label: hint({ it: "Dove eri e con chi (contesto)?", en: "Where and with whom (context)?" }),
      placeholder: hint({ it: "città/ruolo/team/famiglia", en: "city/role/team/family" })
    });
    Q.push({
      id: "then_signal",
      label: hint({ it: "Un segno che avrebbe detto ‘funziona’?", en: "One sign it would've worked?" }),
      placeholder: hint({ it: "persona/numero/risultato", en: "person/number/result" })
    });
  } else {
    Q.push({
      id: "window",
      label: hint({ it: "Finestra reale della decisione?", en: "Real decision window?" }),
      placeholder: hint({ it: "questo mese / 3–6 mesi / 12 mesi", en: "this month / 3–6 months / 12 months" })
    });
    Q.push({
      id: "personal_signal",
      label: hint({ it: "Quale segno personale controlleresti?", en: "Personal sign you’d watch?" }),
      placeholder: hint({ it: "sonno/energia/prima risposta", en: "sleep/energy/first reply" })
    });
    Q.push({
      id: "limit",
      label: hint({ it: "Vincolo più concreto?", en: "Most concrete limit?" }),
      placeholder: hint({ it: "budget/tempo/energia", en: "budget/time/energy" })
    });
  }
  // Rende il set corto e chiaro
  return Q.slice(0, 3);
}

/* ========= HTTP handler ========= */
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
      lang = "it",
      periodo = "future",   // "future" | "past"
      stile = "whatif",     // "whatif" | "wtf"
      stream = false,       // SSE
      clarify = false,      // return 2–3 questions
      profilo = {},
      clarifications = []   // array di brevi risposte opzionali
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ----- Clarify branch ----- */
    if (clarify) {
      const questions = buildClarify(domanda, periodo, profilo, lang);
      return res.status(200).json({
        question: domanda,
        timeframe: periodo,
        lang,
        questions
      });
    }

    /* ----- Generation branch ----- */
    const sysPersona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"].system(lang);
    const mirror = stile === "wtf" ? mirrorLineWTF(profilo, lang) : mirrorLineWhatIf(profilo, lang);
    const closing = episodicClosing(stile, lang);

    const systemPrompt = `
${sysPersona}
Today: ${todayInfo(lang)}

Hard rules:
- Second person only. One voice.
- No literal labels (indicator/constraint/first step). Show, don't name.
- Keep metaphors minimal; prefer concrete signals and small realistic costs.
- Period: ${isEn(lang)
        ? (periodo === "past" ? "counterfactual past vignette" : "near-future fork")
        : (periodo === "past" ? "vignetta controfattuale" : "bivio di futuro vicino") }.
`.trim();

    const userPrompt = `
OPEN WITH A SHORT MIRROR LINE, paraphrasing: "${mirror}"

MAIN QUESTION: "${domanda}"
EXTRA DETAILS: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (isEn(lang) ? "none" : "nessuno")}

Write ${stile === "wtf" ? "8–10 punchy lines, playful and sharp" : "8–12 concise lines, warm and predictive"} (~160–190 words).
Include: a tiny actionable move (call/email/hour/test) and one natural sign to watch. Do not label them.
End with one single episodic closing line, same spirit as: "${closing}" (vary wording).
Language: ${isEn(lang) ? "English" : "Italian"}.
`.trim();

    const temperature = stile === "wtf" ? 0.96 : 0.84;
    const maxTokens = 720;

    const doStream = !!(stream || String(req.headers["x-whatif-stream"] || "").length);
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        max_tokens: maxTokens,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      });

      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const text = (c.choices?.[0]?.message?.content || "").trim();
    return res.status(200).json({
      lang,
      style: stile,
      timeframe: periodo,
      answer: text
    });

  } catch (err) {
    console.error("API /ask error:", err);
    const msg = (err?.message || "unknown").toString();
    return res.status(500).json({ error: "server_error", detail: msg });
  }
}
