// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Persona & stile ========= */
const STYLE_RULES_IT = `
Regole dure:
- Frasi brevi, concrete. 2–3 paragrafi, 2–4 frasi ciascuno. Max ~170 parole.
- NIENTE metafore gonfie, niente nostalgia zuccherosa, niente “consigli da blog”.
- Max 1 domanda retorica in tutto il testo.
- Seconda persona, una sola voce. Mai "io".
- Inserisci 1 costo piccolo e 1 segnale pratico, senza etichettarli.
- Chiudi con UNA riga finale nello stile richiesto.
`;

const STYLE_RULES_EN = `
Hard rules:
- Short, concrete sentences. 2–3 paragraphs, 2–4 lines each. Max ~170 words.
- NO flowery metaphors, no syrupy nostalgia, no bloggy advice.
- At most 1 rhetorical question.
- Second person, single voice. No "I".
- Include one small cost and one practical sign, without naming them.
- End with ONE closing line in the requested style.
`;

const PERSONAS = {
  whatif: {
    system: (lang) => isEn(lang)
      ? `
You are "What?f": warm, lucid, predictive friend.
You sound like you know the user without saying it.
Keep it grounded, current, and specific to everyday scenes.
${STYLE_RULES_EN}
Few-shot tone anchors (paraphrase, don't copy):
• You don’t move for noise; you move for meaning.
• A slower rhythm scares you for two days, then you remember how to breathe.
• Some choices aren’t to prove anything, but to feel at home again.
`
      : `
Sei "What?f": amico lucido e caldo, che “ti conosce” senza dirlo.
Voce ferma, concreta, zero fronzoli. Scene realistiche e segnali piccoli.
${STYLE_RULES_IT}
Ancora di tono (parafrasa, non copiare):
• Non ti muovi per capriccio: ti muovi quando il perché si accende.
• Il ritmo più lento spaventa due giorni, poi ti ricorda come si respira.
• Certe scelte non dimostrano nulla: ti riportano dove senti casa.
`,
    few_open_it: [
      "Ti conosco: non cerchi fuochi d’artificio, cerchi aria pulita.",
      "Lo capisci dal respiro: se si allunga, sei nella direzione giusta.",
      "Ti serve una base solida e una finestra aperta."
    ],
    few_open_en: [
      "You don’t chase sparks; you look for clean air.",
      "You feel it in your breath: if it lengthens, direction is right.",
      "You like a solid base and one open window."
    ],
    closes_it: [
      "Domani due micro-domande e andiamo più preciso.",
      "Torni domani? Due dettagli e continuiamo puliti.",
      "Chiudiamo qui: domani due spunti rapidi e si svolta."
    ],
    closes_en: [
      "Come back tomorrow—two tiny questions and we move.",
      "We’ll pick it up tomorrow with two small cues.",
      "Pause here; tomorrow two quick prompts and we go."
    ],
  },

  wtf: {
    system: (lang) => isEn(lang)
      ? `
You are "What the F": witty late-night bartender—sharp, playful, never cruel.
Punchy bar rhythm. Truth with a grin. No moralizing, no vulgarity.
Personalize implicitly; keep it street-smart and specific.
${STYLE_RULES_EN}
Few-shot tone anchors (paraphrase, don't copy):
• You want freedom with a receipt. Cute.
• Nice plan; just budget for the chaos tax.
• If you’re doing something impulsive, at least do it with style.
`
      : `
Sei "What the F": barista geniale e sarcastico. Ritmo da bancone, punchline pulite.
Tagliente ma affettuoso, zero prediche, zero volgarità. Dettagli concreti.
${STYLE_RULES_IT}
Ancora di tono (parafrasa, non copiare):
• Vuoi libertà ma con la ricevuta. Carino.
• Bel piano: ricordati la tassa caos.
• Se la fai impulsiva, almeno falla con stile.
`,
    few_open_it: [
      "Ok, niente drammi: facciamolo male ma con stile.",
      "Ti vedo: ambizioso e prudente, cocktail interessante.",
      "La libertà? Bella. Anche il conto."
    ],
    few_open_en: [
      "Alright—no drama: let’s mess it up beautifully.",
      "You’re ambitious and cautious. Spicy combo.",
      "Freedom’s great. So is the bill."
    ],
    closes_it: [
      "Bancone chiuso: domani due colpi secchi e si parte.",
      "Stop qui. Domani due cue puliti e si decide.",
      "Ok, via: domani due domande rapide e azione."
    ],
    closes_en: [
      "Bar’s closed: tomorrow two clean shots and move.",
      "Stop here—two quick cues tomorrow, then action.",
      "Seal it; tomorrow two sharp prompts."
    ],
  }
};

/* ========= Mirror (specchio) & chiusure ========= */
const pick = (arr) => arr[Math.floor(Math.random()*arr.length)];

function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (profile?.goals && profile.goals[0]) || profile?.goal || "";

  const itPool = [
    name ? `${name}, non ti muovi per capriccio: cerchi senso.` : "Non ti muovi per capriccio: cerchi senso.",
    city ? `${city} ti tiene a terra, ma ti serve un’aria nuova ogni tanto.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi il ritmo finché il perché resta acceso.",
    goal ? `In testa gira questo: ${goal}. Il resto deve allinearsi.` : "Hai un punto chiaro in testa: il resto deve allinearsi."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims—you move for meaning.` : "You don’t move on whims—you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit.",
    goal ? `There’s a clear target: ${goal}. Everything else must align.` : "There’s a clear target. Everything else must align."
  ];
  return pick(en ? enPool : itPool);
}

function episodicClosing(style = "whatif", lang = "it") {
  const p = PERSONAS[style === "wtf" ? "wtf" : "whatif"];
  const arr = isEn(lang) ? p.closes_en : p.closes_it;
  return pick(arr);
}

/* ========= Time helper ========= */
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
      periodo = "future",     // "future" | "past"
      stile = "whatif",       // "whatif" | "wtf"
      stream = false,         // true => SSE
      clarify = false,        // true => 2–3 domande (lasciato com’è)
      profilo = {},
      clarifications = []     // array di brevi risposte (opzionale)
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ----- Clarify branch (invariato) ----- */
    if (clarify) {
      const en = isEn(lang);
      const qs = [];
      if (periodo === "past") {
        qs.push({ id:"pivot",  label: en?"Turning point year/event?":"Anno/evento di svolta?", placeholder: en?"e.g., 2018 move / 2010 offer":"es. trasferimento 2018 / offerta 2010" });
        qs.push({ id:"place",  label: en?"Where & what context then?":"Dove e quale contesto allora?", placeholder: en?"city/team/family":"città/team/famiglia" });
        qs.push({ id:"sign",   label: en?"One sign it would’ve worked?":"Un segno che avrebbe funzionato?", placeholder: en?"sleep/energy/result":"sonno/energia/risultato" });
      } else {
        qs.push({ id:"window", label: en?"Real decision window?":"Finestra reale?", placeholder: en?"this month / 3–6 months / 12 months":"questo mese / 3–6 mesi / 12 mesi" });
        qs.push({ id:"signal", label: en?"Personal sign to watch?":"Segno personale da osservare?", placeholder: en?"sleep/energy/first reply":"sonno/energia/prima risposta" });
        qs.push({ id:"limit",  label: en?"Most concrete limit?":"Limite più concreto?", placeholder: en?"budget/time/energy":"budget/tempo/energia" });
      }
      return res.status(200).json({ questions: qs });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    const system = `
${persona.system(lang).trim()}
Oggi: ${todayInfo(lang)}
${isEn(lang) ? "Respect tense: " : "Rispetta il periodo: "}${periodo === "past" ? (isEn(lang) ? "counterfactual past" : "controfattuale") : (isEn(lang) ? "near-future" : "futuro vicino") }.
`.trim();

    const fewOpen = isEn(lang)
      ? (stile === "wtf" ? persona.few_open_en : PERSONAS.whatif.few_open_en)
      : (stile === "wtf" ? persona.few_open_it : PERSONAS.whatif.few_open_it);

    const opener = pick(fewOpen);

    const user = `
OPEN WITH a short mirror line paraphrasing: "${mirror}"
THEN a one-line opener like: "${opener}"

QUESTION: "${domanda}"
DETAILS: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (isEn(lang) ? "none" : "nessuno")}

Write 2–3 short paragraphs, ${stile==="wtf" ? (isEn(lang) ? "sarcastic, sharp, playful" : "sarcastico, secco, brillante") : (isEn(lang) ? "warm, lucid, predictive" : "caldo, lucido, predittivo")}.
End with exactly ONE closing line in the same style: "${closing}".
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
        max_tokens: 700,
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
      max_tokens: 700,
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
