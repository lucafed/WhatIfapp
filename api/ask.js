// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Heuristica lingua (fallback) ========= */
function detectLang(text = "", profile = {}) {
  // Se la UI manda già lang, usala. Altrimenti heuristiche semplici.
  const t = `${text} ${profile?.name || ""}`.toLowerCase();
  const itHits = ["che", "non", "perché", "all'", "l'", "gli", "una", "un", "sei"];
  const enHits = ["what", "if", "you", "the", "and", "would", "could"];
  const itScore = itHits.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
  const enScore = enHits.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
  return enScore > itScore ? "en" : "it";
}

/* ========= Persona & stile ========= */
const PERSONAS = {
  whatif: {
    system: `
Sei "What?f": voce empatica, lucida, concreta.
Seconda persona, una sola voce. 8–12 frasi brevi, tono caldo e netto.
Fai capire che lo conosci senza dirlo esplicitamente (specchio iniziale).
NON usare etichette ("indicatore", "vincolo", "trade-off", "primo passo").
Niente moralismi, niente nostalgia, niente liste di consigli.
Preferisci dettagli verificabili (tempi, piccoli costi, segnali interni).
LIMITA le metafore: massimo UNA breve, altrimenti lessico diretto.
Evita verbi onirici (es. "danza", "abbraccia", "sinfonia", "sussurra", "tempesta interiore").
Chiudi con un invito morbido: domani 2 micro-domande per continuare.
`,
    few_it: [
      "Lo capisci dal respiro: se si allunga, stai andando dove vuoi stare.",
      "Cerchi stabilità, non immobilità: base solida e finestra aperta.",
      "Quando la sera è più leggera senza spiegarti perché, stai scegliendo bene."
    ],
    few_en: [
      "You move when the why is lit, not for noise.",
      "A solid base and one open window — that’s your pattern.",
      "If evenings feel lighter, you’re choosing well."
    ]
  },
  wtf: {
    system: `
Sei "What the F": amico brillante da bancone, affettuosamente sarcastico.
Seconda persona, una voce. 8–10 righe secche, ritmo da bar, punchline pulite.
Niente volgarità, niente prediche. Verità schiette ma calorose.
Personalizza in modo implicito (luogo/ruolo), senza elencare dati.
LIMITA le metafore: massimo UNA breve, preferisci battute concrete.
Chiudi con una battuta/invito (domani due colpi secchi).
`,
    few_it: [
      "Vuoi libertà con garanzia. Carino.",
      "Le idee ti arrivano come gli aperitivi: una di troppo e inspiegabilmente prendi la decisione giusta.",
      "Ok: niente drammi, ma fammi vedere una ricevuta."
    ],
    few_en: [
      "You want freedom with a warranty. Cute.",
      "Let’s mess this up beautifully — you bring hope, I’ll bring nonsense.",
      "Calm beats chaos; attitude beats planning (but bring both)."
    ]
  }
};

/* ========= Mirror (specchio) & chiusure ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (profile?.goals && profile.goals[0]) || profile?.goal || "";

  const itPool = [
    name ? `${name}, non ti muovi per capriccio: cerchi senso.` : "Non ti muovi per capriccio: cerchi senso.",
    city ? `${city} ti dà base, ma ogni tanto cerchi aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il “perché” resta acceso.` : "Reggi il ritmo finché il “perché” resta acceso.",
    goal ? `Ti gira in testa questo: ${goal}. Il resto deve allinearsi.` : "Hai un punto chiaro: il resto deve allinearsi."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims — you move for meaning.` : "You don’t move on whims — you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit.",
    goal ? `There’s a clear target: ${goal}. Everything else must align.` : "There’s a clear target. Everything else must align."
  ];
  return pick(en ? enPool : itPool);
}

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani due micro-domande e continuiamo puliti.",
    "Se torni domani, aggiungo due dettagli e andiamo più a fondo.",
    "Quando vuoi, riprendiamo: due spunti rapidi e si svolta."
  ];
  const itSharp = [
    "Stop qui. Domani due colpi secchi e si riparte.",
    "Segnalibro messo: domani due cue veloci e alziamo il livello.",
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
    "Bar’s closed — for now. Tomorrow, two sharp questions."
  ];
  if (style === "wtf") return en ? pick(enSharp) : pick(itSharp);
  return en ? pick(enSoft) : pick(itSoft);
}

/* ========= Time helpers ========= */
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
    let {
      domanda,
      lang,                        // può mancare: lo deduciamo
      periodo = "future",          // "future" | "past"
      stile = "whatif",            // "whatif" | "wtf"
      stream = false,              // true => SSE
      clarify = false,             // true => 2–3 domande
      profilo = {},
      clarifications = [],         // array di brevi risposte (opzionale)
      metaphors = "low"            // "off" | "low" | "default"
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // Lingua automatica se non arriva dal frontend
    if (!lang) lang = detectLang(domanda, profilo);

    /* ----- Clarify branch ----- */
    if (clarify) {
      const en = isEn(lang);
      const qs = [];
      if (periodo === "past") {
        qs.push({ id:"pivot",  label: en?"Turning point year/event?":"Anno/evento di svolta?", placeholder: en?"e.g., 2018 move / 2010 offer":"es. trasferimento 2018 / offerta 2010" });
        qs.push({ id:"place",  label: en?"Where & what context then?":"Dove e quale contesto allora?", placeholder: en?"city/team/family":"città/team/famiglia" });
        qs.push({ id:"sign",   label: en?"One sign it worked?":"Un segno che funzionava?",       placeholder: en?"sleep/energy/text back":"sonno/energia/richiami" });
      } else {
        qs.push({ id:"window", label: en?"Real decision window?":"Finestra reale?",               placeholder: en?"this month / 3–6 months / 12 months":"questo mese / 3–6 mesi / 12 mesi" });
        qs.push({ id:"signal", label: en?"Personal sign to watch?":"Segno personale da osservare?", placeholder: en?"sleep/energy/first reply":"sonno/energia/prima risposta" });
        qs.push({ id:"limit",  label: en?"Most concrete limit?":"Limite più concreto?",          placeholder: en?"budget/time/energy":"budget/tempo/energia" });
      }
      return res.status(200).json({ questions: qs, lang });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    // Regole anti-metafora
    const metaRule =
      metaphors === "off"
        ? (isEn(lang)
            ? "Do not use metaphors. Use plain, concrete language only."
            : "Non usare metafore. Linguaggio piano e concreto, punto.")
        : (isEn(lang)
            ? "At most ONE short metaphor. Prefer plain, concrete language."
            : "Al massimo UNA metafora breve. Preferisci linguaggio piano e concreto.");

    const system = `
${persona.system.trim()}
${metaRule}
Oggi: ${todayInfo(lang)}

Linee guida forti:
- Mai etichette esplicite (no "indicatore", "vincolo", "primo passo", ecc.).
- Seconda persona, zero "io". Varia lessico e struttura; evita ripetizioni (niente "chiama un amico" fisso).
- Integra impliciti di città/ruolo/valori se presenti, senza elenchi.
- Periodo: ${periodo === "past" ? (isEn(lang) ? "counterfactual past" : "controfattuale") : (isEn(lang) ? "near-future" : "futuro vicino")}.

Esempi IT:
${persona.few_it.map(s => `• ${s}`).join("\n")}
Esempi EN:
${persona.few_en.map(s => `• ${s}`).join("\n")}
`.trim();

    const user = `
Apertura-specchio (parafrasa, non copiare): "${mirror}".

${isEn(lang) ? "QUESTION" : "DOMANDA"}: "${domanda}"
${isEn(lang) ? "DETAILS" : "DETTAGLI"}: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (isEn(lang) ? "none" : "nessuno")}

${isEn(lang)
  ? `Write 8–12 flowing sentences (${stile==="wtf" ? "witty and sharp" : "warm and predictive"}), ~180 words max.
Avoid bullet lists and rhetorical questions; use small realistic costs and inner/outer signals.
Close with ONE single line, in the spirit of: "${closing}".`
  : `Scrivi 8–12 frasi fluide (${stile==="wtf" ? "brillanti e taglienti" : "calde e predittive"}), max ~180 parole.
Evita elenchi e domande retoriche; usa piccoli costi realistici e segnali interni/esterni.
Chiudi con UNA sola riga, nello spirito: "${closing}".`
}
`.trim();

    const temperature = stile === "wtf" ? 0.93 : 0.82;
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
      res.write(`data: ${JSON.stringify({ done: true, lang })}\n\n`);
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
    return res.status(200).json({ answer: text, lang });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
