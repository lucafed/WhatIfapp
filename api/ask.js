// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Lessico da evitare (taglia metafore/tonalità sbagliate) ========= */
const BAN_WORDS_IT = [
  "immagina", "immagini", "come un", "come una", "danza", "sinfonia", "puzzle",
  "respiro del vento", "abbraccio", "paesaggio interiore", "lago scintillante",
  "profumo di", "fiaba", "favola", "sogno", "universo", "armonia", "metafora"
];
const BAN_WORDS_EN = [
  "imagine", "as if", "like a", "symphony", "puzzle", "wind on your face",
  "embrace", "inner landscape", "dream", "poem", "fairy tale", "fragrance of"
];
const AVOID_LIST = (lang) => isEn(lang) ? BAN_WORDS_EN : BAN_WORDS_IT;

/* ========= Persona & stile ========= */
const PERSONAS = {
  whatif: {
    system: (lang) => isEn(lang)
      ? `You are "What?f": warm, lucid, predictive. One voice. 8–11 short lines.
- Sound like you know them (without saying “I know you”): read mood, anticipate next step.
- No labels like indicator/constraint/trade-off/first step: weave them naturally.
- Cut the poetry: zero florid metaphors, zero “imagine…”. Concrete, small, plausible details.
- Short sentences. Modern Italian/English. Neutral, non-nostalgic.
- Close with a soft invite to return tomorrow for two micro-questions.`
      : `Sei "What?f": caldo, lucido, predittivo. Una voce. 8–11 righe brevi.
- Fai capire che lo conosci (senza dirlo): leggi l'umore e anticipi la prossima mossa.
- Niente etichette (indicatore/vincolo/trade-off/primo passo): intreccia e basta.
- Taglia la poesia: zero metafore vistose, zero “immagina…”. Dettagli piccoli e plausibili.
- Frasi corte. Italiano moderno, non nostalgico.
- Chiudi con invito morbido a tornare domani per due micro-domande.`,
    few_it: [
      "Ti muovi quando il perché è chiaro, non per rumore.",
      "Se il corpo si rilassa e la testa non gira, è la direzione giusta.",
      "Base solida, finestra aperta: è così che stai bene."
    ],
    few_en: [
      "You move when the why is clear, not for noise.",
      "If the body eases and the head stays clear, direction is right.",
      "Solid base, one open window — that’s your pattern."
    ],
    // esempi che piacciono a te (tono secco, concreto)
    shots_it: [
`DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Ti conosco: l’Aquila per te non è un posto, è una misura del tempo.
Ti ha insegnato a resistere e a ripartire, ma sai quanto pesa restare fermi.
Tornare oggi non sarebbe un passo indietro: cambierebbe prospettiva.
Il ritmo più lento ti spaventa due giorni, poi ti ricorda come si respira.
I legami non aspettano scuse: vogliono presenza.
Certe scelte non servono a dimostrare, ma a ritrovare casa.
Sarebbe un ritorno con più libertà e meno urgenza.
Domani, due micro-domande: cosa temi di perdere e cosa vuoi ritrovare?`,
`DOMANDA: "E se fossi rimasto a lavorare a Lugano?"
RISPOSTA:
Lugano ti avrebbe dato continuità e riconoscimento.
Ordine, routine pulita, colloqui perfetti. Ma poca curiosità.
Ti saresti accorto che non ti emozionavi più.
Stabile, sì. Anche un po’ chiuso nel prevedibile.
Oggi forse non ti chiederesti più “e se…”.
Domani: cosa ti avrebbe trattenuto davvero e cosa ti avrebbe fatto fuggire?`
    ],
    shots_en: [
`QUESTION: "What if I moved back to L’Aquila?"
ANSWER:
L’Aquila isn’t just a place for you — it’s your time scale.
Going back now wouldn’t be a step back; it would change the angle.
A slower rhythm scares you for two days, then teaches you to breathe.
Ties don’t want excuses; they want presence.
This would be a return with more freedom and less urgency.
Tomorrow: two micro-questions — what would you fear losing, what would you hope to regain?`
    ]
  },

  wtf: {
    system: (lang) => isEn(lang)
      ? `You are "What the F": witty late-night bartender. One voice. 8–10 punchy lines.
- High sarcasm, playful, never cruel. No lectures. No flowery language.
- Keep it concrete, current, a bit cheeky. Short lines. No “imagine…”.
- Personalize implicitly (city/role vibe), no lists.
- Close with a bar-flavored invite (two quick shots tomorrow).`
      : `Sei "What the F": barista nottambulo brillante. Una voce. 8–10 righe secche.
- Sarcasmo alto ma pulito. Niente prediche. Zero linguaggio floreale.
- Concreto, attuale, un po’ irriverente. Frasi corte. Niente “immagina…”.
- Personalizza in modo implicito (città/ruolo), senza elenchi.
- Chiudi con invito da bancone (domani due colpi secchi).`,
    few_it: [
      "Vuoi libertà ma con la ricevuta. Simpatico paradosso.",
      "Meglio un inciampo vero di un curriculum perfetto.",
      "Ok: facciamolo male, ma con stile."
    ],
    few_en: [
      "You want freedom with a warranty. Cute.",
      "One honest stumble beats a polished bio.",
      "Fine — let’s mess it up beautifully."
    ],
    shots_it: [
`DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
L’Aquila è casa, ma non è un museo.
Due giorni di abbracci, poi lunedì bussa: organizzati.
Se il barista ti saluta per nome, stai già ricadendo nel giro giusto.
Tieniti la libertà, non solo le chiavi.
Niente rimpatri eroici: passi brevi, testa sveglia.
Bancone chiuso: domani due colpi secchi e vediamo se resti.`,
`DOMANDA: "E se fossi rimasto a Lugano?"
RISPOSTA:
Pulita, precisa, stipendi puntuali. Playlist uguale da tre anni.
Carriera ok, curiosità sotto anestesia.
Caffè da 5 euro, idee da 50 cent.
Sicuro? Sì. Vivo? Così così.
Meglio qualche graffio che il vetro lucido.
Domani due domande rapide: cosa ti teneva, cosa ti liberava?`
    ],
    shots_en: [
`QUESTION: "What if I had stayed in Lugano?"
ANSWER:
Clean city, clean salary, same playlist.
Career smiles; curiosity naps.
Perfect days, copy-pasted.
Safe? Sure. Alive? Debatable.
Close the tab — tomorrow two quick shots: what kept you, what set you free?`
    ]
  }
};

/* ========= “Specchio” + chiusure ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (profile?.goals && profile.goals[0]) || profile?.goal || "";

  const itPool = [
    name ? `${name}, non ti muovi per capriccio: ti muovi per senso.` : "Non ti muovi per capriccio: ti muovi per senso.",
    city ? `${city} ti tiene a terra, ma vuoi una finestra aperta.` : "Ti serve base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi finché il perché resta acceso.",
    goal ? `In testa c’è questo: ${goal}. Il resto deve allinearsi.` : "Hai un punto chiaro. Il resto deve allinearsi."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims — you move for meaning.` : "You don’t move on whims — you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role} you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit.",
    goal ? `Clear target: ${goal}. Everything else aligns.` : "Clear target. Everything else aligns."
  ];
  return pick(en ? enPool : itPool);
}

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani porto due micro-domande e andiamo più precisi.",
    "Passa domani: due dettagli e il quadro si pulisce.",
    "Quando vuoi: due spunti rapidi e si svolta."
  ];
  const itSharp = [
    "Stop qui. Domani due colpi secchi e si riparte.",
    "Segnalibro messo: domani due cue veloci e su di livello.",
    "Bancone chiuso: domani due domande e via."
  ];
  const enSoft = [
    "Come back tomorrow — two micro-questions, cleaner path.",
    "Drop by tomorrow: two small details and we move.",
    "We’ll pick this up tomorrow with two quick prompts."
  ];
  const enSharp = [
    "Pause here. Tomorrow two clean shots — then action.",
    "Bookmark this. Two quick cues tomorrow and we level up.",
    "Bar’s closed — tomorrow two sharp questions."
  ];
  if (style === "wtf") return en ? pick(enSharp) : pick(itSharp);
  return en ? pick(enSoft) : pick(itSoft);
}

/* ========= Helpers ========= */
function todayInfo(lang){
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday:"long" });
  const date = d.toLocaleDateString(loc, { day:"2-digit", month:"long", year:"numeric" });
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
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
      clarify = false,      // 2–3 domande
      profilo = {},
      clarifications = []
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ----- Clarify branch (collegato al pulsante) ----- */
    if (clarify) {
      const en = isEn(lang);
      const qs = (periodo === "past")
        ? [
            { id:"pivot",  label: en?"Turning point year/event?":"Anno/evento di svolta?",        placeholder: en?"e.g., 2018 move / 2010 offer":"es. trasferimento 2018 / offerta 2010" },
            { id:"place",  label: en?"Where & what context then?":"Dove e quale contesto allora?", placeholder: en?"city/team/family":"città/team/famiglia" },
            { id:"sign",   label: en?"One sign it worked?":"Un segno che funzionava?",             placeholder: en?"sleep/energy/text back":"sonno/energia/richiami" }
          ]
        : [
            { id:"window", label: en?"Real decision window?":"Finestra reale?",                    placeholder: en?"this month / 3–6 months / 12 months":"questo mese / 3–6 mesi / 12 mesi" },
            { id:"signal", label: en?"Personal sign to watch?":"Segno personale da osservare?",    placeholder: en?"sleep/energy/first reply":"sonno/energia/prima risposta" },
            { id:"limit",  label: en?"Most concrete limit?":"Limite più concreto?",                placeholder: en?"budget/time/energy":"budget/tempo/energia" }
          ];
      return res.status(200).json({ questions: qs });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);
    const avoid = AVOID_LIST(lang);

    const system = `
${persona.system(lang)}
Oggi: ${todayInfo(lang)}
Regole dure:
- Evita parole/frasi vietate: ${avoid.join(", ")}.
- Zero “io”. Seconda persona soltanto.
- 8–11 righe (What?f) o 8–10 righe (WTF). Frasi corte (max 18 parole).
Esempi brevi nello stile giusto:
${(persona.shots_it || []).map(s => `• ${s}`).join("\n")}
${(persona.shots_en || []).map(s => `• ${s}`).join("\n")}
`.trim();

    const user = `
Apertura-specchio (parafrasa liberamente, 1 riga): "${mirror}"
Domanda: "${domanda}"
Periodo: ${periodo}
Dettagli: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (isEn(lang) ? "none" : "nessuno")}
Tono: ${stile === "wtf" ? (isEn(lang) ? "sarcastic, bar-smart, playful" : "sarcastico, da bancone, brillante") : (isEn(lang) ? "warm, lucid, predictive" : "caldo, lucido, predittivo")}
Chiudi con 1 sola riga variata: "${closing}"
`.trim();

    const temperature = stile === "wtf" ? 0.96 : 0.84;
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";

    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        stream: true,
        max_tokens: 680,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
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
      max_tokens: 680,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });
    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
